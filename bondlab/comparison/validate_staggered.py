import json
import os
import re
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from bondlab import Bond
import compare_platforms as cp

HERE = os.path.dirname(os.path.abspath(__file__))
SCHED_FILE = os.path.join(HERE, "staggered_schedules.json")


def fetch_schedules(isins):
    from playwright.sync_api import sync_playwright
    data = json.load(open(cp.DATA_FILE))
    by_isin = {r["isin"]: r for r in data}
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")
        page = ctx.new_page()
        for isin in isins:
            rec = by_isin.get(isin)
            if not rec:
                continue
            try:
                page.goto(rec["url"], wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(3000)
                page.mouse.wheel(0, 9000)
                page.wait_for_timeout(2500)
                cols = page.evaluate("""() => {
                  const out = [];
                  document.querySelectorAll('.col-1-data, .col-2-data, .col-3-data, .col-4-data, .col-5-data').forEach(e => out.push(e.innerText.trim()));
                  return out;
                }""")
                text = page.inner_text("body")
                mfv = re.search(r"Face Value\s*\|\s*₹\s*([\d,]+\.?\d*)", text)
                face_val = float(mfv.group(1).replace(",", "")) if mfv else None
                sched = []
                chunk = [cols[i:i + 5] for i in range(0, len(cols), 5)]
                for c in chunk:
                    if len(c) < 5:
                        continue
                    year, dstr, interest, amount, pct = c
                    if dstr and dstr.lower() != "monthly" and dstr.lower() != "semi annually" and amount and pct:
                        m = re.match(r"([\d.]+)\s*%", pct.replace(",", ""))
                        if m:
                            sched.append({"date": f"{dstr} {year}", "pct": float(m.group(1)), "amount": amount.replace(",", "")})
                if not sched:
                    out[isin] = None
                    print(f"{isin}: NO GRID ({rec.get('issuer_name','')[:28]})")
                    continue
                out[isin] = {"face": face_val, "schedule": sched}
                print(f"{isin}: face={face_val} instalments={len(sched)} ({rec.get('issuer_name','')[:28]})")
            except Exception as e:
                print(f"{isin}: FAILED {e}")
                out[isin] = None
        browser.close()
    return out


def parse_sched_date(s):
    for fmt in ("%d %b %Y",):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"bad date {s}")


def main():
    data = json.load(open(cp.DATA_FILE))
    staggered = [r for r in data if str(r.get("is_staggered")).lower() == "true"]
    isins = [r["isin"] for r in staggered]

    if os.path.exists(SCHED_FILE) and json.load(open(SCHED_FILE)):
        schedules = json.load(open(SCHED_FILE))
        print(f"using saved schedules ({sum(1 for v in schedules.values() if v)}/{len(schedules)} bonds)")
    else:
        schedules = fetch_schedules(isins)
        json.dump(schedules, open(SCHED_FILE, "w"), indent=1)

    settle = date(2026, 8, 18)
    print(f"\n{'ISIN':<13}{'Issuer':<30}{'Plat%':>8}{'EngStag%':>10}{'Dev(bp)':>9}{'Conv':>16}")
    rows = []
    for rec in staggered:
        isin = rec["isin"]
        sched = schedules.get(isin)
        if not sched:
            continue
        coupon = float(rec["coupon_rate"].replace("%", ""))
        freq = cp.FREQ_MAP[rec["frequency"]]
        mat = cp.parse_maturity(rec["maturity_date"])
        face = sched["face"] or cp.infer_face(rec["price"])
        price = float(rec["price"])
        yp = float(rec["yield_value"].replace("%", ""))
        redems = sorted((parse_sched_date(s["date"]), s["pct"]) for s in sched["schedule"] if s["pct"] > 0)
        best = None
        for dc, pror in (("ACT/365F", "actual"), ("ACT/ACT", "actual"), ("30/360", "fixed")):
            try:
                b = Bond(maturity=mat, coupon=coupon, freq=freq, face_value=face, day_count=dc,
                         redemptions=redems, coupon_proration=pror)
                y = b.yield_from_price(price / face * 100.0, settle, clean=False)
                dev = (y - yp) * 100
                if best is None or abs(dev) < abs(best["dev"]):
                    best = {"y": y, "dev": dev, "conv": f"{dc}:{pror}"}
            except Exception as e:
                pass
        if best:
            rows.append({**best, "isin": isin, "issuer": (rec.get("issuer_name") or "")[:28], "yp": yp})
            print(f"{isin:<13}{(rec.get('issuer_name') or '')[:28]:<30}{yp:>8.2f}{best['y']:>9.4f}{best['dev']:>+9.2f}{best['conv']:>16}")
    if rows:
        import statistics
        devs = [abs(r["dev"]) for r in rows]
        print(f"\nstaggered validation: {len(rows)} bonds with exact schedules (balance-FV, actual-day coupons)")
        print(f"  mean abs dev {statistics.mean(devs):.2f} bp | median {statistics.median(devs):.2f} bp | max {max(devs):.2f} bp")
        for thr in (5, 10, 25, 50):
            print(f"  within ±{thr:>2}bp: {sum(1 for d in devs if d <= thr)}/{len(rows)}")
        json.dump(rows, open(os.path.join(HERE, "staggered_results.json"), "w"), indent=1, default=str)


if __name__ == "__main__":
    main()
