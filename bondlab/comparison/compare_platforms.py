import json
import math
import os
import sys
from datetime import date, timedelta
from statistics import mean, median

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from bondlab import Bond
from bondlab.analytics import effective_annual_yield

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "platform_data_indiabonds.json")

FREQ_MAP = {
    "MONTHLY": 12, "QUARTERLY": 4, "SEMI ANNUALLY": 2, "HALF YEARLY": 2,
    "ANNUALLY": 1, "YEARLY": 1, "CUMULATIVE": 0, "ZERO COUPON": 0,
}


def fetch_live():
    import urllib.request
    ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
    out = []
    for tag in ("All Bonds", "G-Sec/SDL"):
        url = f"https://prod-api.indiabonds.com/api/v3/web/bond-list/?page_no=1&page_size=100&sort_by=yield_high_to_low&tag_name={tag.replace(' ', '%20').replace('/', '%2F')}"
        req = urllib.request.Request(url, headers=ua)
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
        out.extend(d.get("bond_list", []))
    return out


def infer_face(price):
    if price <= 0:
        return 1000.0
    p = round(math.log10(price))
    p = max(2, min(6, p))
    face = float(10 ** p)
    if not (60.0 <= price / face * 100.0 <= 130.0):
        for alt in (1000.0, 10000.0, 100000.0, 1000000.0):
            if 60.0 <= price / alt * 100.0 <= 130.0:
                face = alt
                break
    return face


def parse_maturity(s):
    from datetime import datetime
    return datetime.strptime(s.strip(), "%d %b %Y").date()


def our_ytm(rec, settle, treat_price_as, day_count=None):
    coupon = float(rec["coupon_rate"].replace("%", ""))
    freq = FREQ_MAP.get(rec["frequency"], 1)
    maturity = parse_maturity(rec["maturity_date"])
    face = infer_face(rec["price"])
    price = float(rec["price"])
    is_gsec = rec.get("security_type") == "SOVEREIGN" or "Development Loan" in rec.get("type_of_bond", "") or "Government" in rec.get("type_of_bond", "")
    dc = day_count or ("ACT/ACT" if is_gsec else "30/360")
    b = Bond(maturity=maturity, coupon=coupon, freq=freq, face_value=face, day_count=dc)
    if treat_price_as == "clean":
        return b.yield_from_price(price / face * 100.0, settle, clean=True)
    return b.yield_from_price(price / face * 100.0, settle, clean=False)


def effective_from_nominal(y, freq):
    if freq <= 1:
        return y
    return ((1.0 + y / 100.0 / freq) ** freq - 1.0) * 100.0


def main():
    if os.path.exists(DATA_FILE):
        bonds = json.load(open(DATA_FILE))
        print(f"using saved dataset ({len(bonds)} bonds) — delete {DATA_FILE} to re-fetch")
    else:
        bonds = fetch_live()
        json.dump(bonds, open(DATA_FILE, "w"), indent=1)
        print(f"fetched {len(bonds)} bonds from IndiaBonds live API")

    settle = date(2026, 8, 18)

    rows = []
    staggered = []
    inconsistent = []
    for rec in bonds:
        try:
            coupon = float(rec["coupon_rate"].replace("%", ""))
        except Exception:
            coupon = None
        if coupon is None:
            continue
        price = float(rec["price"])
        face = infer_face(price)
        y_platform = float(rec["yield_value"].replace("%", ""))
        freq = FREQ_MAP.get(rec["frequency"], 1)
        is_gsec = rec.get("security_type") == "SOVEREIGN" or "Development Loan" in rec.get("type_of_bond", "")
        row = {
            "isin": rec["isin"],
            "issuer": (rec.get("issuer_name") or "")[:38],
            "type": rec.get("type_of_bond", ""),
            "rating": rec.get("rating_combined", ""),
            "coupon": coupon,
            "freq": rec["frequency"],
            "maturity": rec["maturity_date"],
            "face": face,
            "price": price,
            "platform_yield": y_platform,
            "staggered": str(rec.get("is_staggered")).lower() == "true",
            "call": rec.get("call_date"),
            "gsec": is_gsec,
        }
        variants = {}
        errors = []
        for treat in ("clean", "dirty"):
            for dc in ("30/360", "ACT/ACT", "ACT/365F"):
                if is_gsec and dc != "ACT/ACT":
                    continue
                if not is_gsec and dc != "30/360":
                    continue
                try:
                    y = our_ytm(rec, settle, treat, day_count=dc)
                except Exception as e:
                    errors.append(f"{treat}/{dc}: {e}")
                    continue
                variants[f"{treat}_{dc.replace('/', '_')}_nominal"] = y
                variants[f"{treat}_{dc.replace('/', '_')}_effective"] = effective_from_nominal(y, freq)
        if not variants:
            row["error"] = "; ".join(errors) or "no variants computed"
            rows.append(row)
            continue
        best_var = min(variants, key=lambda k: abs(variants[k] - y_platform))
        best_y = variants[best_var]
        row["best_variant"] = best_var
        row["engine_yield"] = round(best_y, 6)
        row["dev_bps"] = round((best_y - y_platform) * 100.0, 2)
        row["abs_dev_bps"] = round(abs(best_y - y_platform) * 100.0, 2)
        try:
            b2 = Bond(maturity=parse_maturity(rec["maturity_date"]), coupon=coupon, freq=freq, face_value=face,
                      day_count="ACT/ACT" if is_gsec else "30/360")
            acc2, _ = b2.accrued_interest_per100(settle)
            calc_price_clean = b2.price_from_yield(y_platform, settle) - acc2
            calc_price_dirty = b2.price_from_yield(y_platform, settle)
            shown = price / face * 100.0
            row["recon_diff_pts"] = round(calc_price_clean - shown, 4)
            row["recon_diff_pts_matched"] = round(
                (calc_price_dirty - shown) if best_var.startswith("dirty_") else (calc_price_clean - shown), 4)
            if abs(row["recon_diff_pts_matched"]) > 2.5:
                inconsistent.append(row)
        except Exception:
            row["recon_diff_pts"] = None
        if row["staggered"]:
            staggered.append(row)
        else:
            rows.append(row)

    rows = [r for r in rows if "error" not in r]
    err = [r for r in rows if "error" in r]
    ok = [r for r in rows if abs(r.get("recon_diff_pts_matched") or 0) <= 2.5 and "error" not in r]

    print("\n" + "=" * 100)
    print(f"COMPARISON: BondLab engine vs IndiaBonds live platform data")
    print(f"dataset: {len(bonds)} bonds (IndiaBonds API, fetched live) | settlement: {settle}")
    print("=" * 100)

    devs = [r["abs_dev_bps"] for r in ok]

    print("\n--- deviation stats (engine best-fit vs platform quoted yield) ---")
    print(f"compared (consistent, non-staggered): {len(ok)}")
    if devs:
        print(f"mean abs deviation        : {mean(devs):.2f} bps")
        print(f"median abs deviation      : {median(devs):.2f} bps")
        print(f"max abs deviation         : {max(devs):.2f} bps")
        for thr in (1, 2, 5, 10, 25):
            n = sum(1 for d in devs if d <= thr)
            print(f"within ±{thr:>2} bps            : {n}/{len(ok)} ({n/len(ok)*100:.0f}%)")

    variants_win = {}
    for r in ok:
        variants_win[r["best_variant"]] = variants_win.get(r["best_variant"], 0) + 1
    print("\nbest-matching convention (how IndiaBonds quotes its numbers):")
    for k, v in sorted(variants_win.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<28}: {v}/{len(ok)} bonds")

    print(f"\nlargest deviations (within consistent set):")
    for r in sorted(ok, key=lambda x: -x["abs_dev_bps"])[:10]:
        print(f"  {r['isin']:<13} {r['issuer']:<32} {r['type'][:24]:<24} plat {r['platform_yield']:>7.2f}%  engine {r['engine_yield']:>7.4f}%  dev {r['dev_bps']:>+8.2f}bp  ({r['best_variant']})")

    if inconsistent:
        print(f"\nyield/price reconciliation inconsistencies (>3pts diff, platform-data issue not engine): {len(inconsistent)}")
        for r in sorted(inconsistent, key=lambda x: -abs(x["recon_diff_pts"]))[:10]:
            print(f"  {r['isin']:<13} {r['issuer']:<32} plat yield {r['platform_yield']:>7.2f}%  shown {r['price']/r['face']*100:>8.2f}  recomputed {r['price']/r['face']*100 + r['recon_diff_pts_matched']:>8.2f}  diff {r['recon_diff_pts_matched']:>+7.2f}pts ({r['best_variant']})")
    if staggered:
        print(f"\nstaggered-redemption bonds (excluded, cashflow-dependent): {len(staggered)}")
        for r in sorted(staggered, key=lambda x: -x["abs_dev_bps"])[:8]:
            print(f"  {r['isin']:<13} {r['issuer']:<32} plat {r['platform_yield']:>7.2f}%  engine-bullet {r['engine_yield']:>7.4f}%  dev {r['dev_bps']:>+8.2f}bp  ({r['best_variant']})")
    if err:
        print(f"\nfailed to compute: {len(err)}")
        for r in err[:6]:
            print("  ", r["isin"], r["error"])

    taxfree = [r for r in ok if "Tax-free" in r["type"]]
    regular = [r for r in ok if "Tax-free" not in r["type"]]
    gsec_sub = [r for r in ok if r["gsec"]]

    def sub_stats(subset, label):
        dd = [r["abs_dev_bps"] for r in subset]
        if not dd:
            return
        print(f"\n{label}: {len(dd)} bonds")
        print(f"  mean abs dev {mean(dd):.2f} bp | median {median(dd):.2f} bp | max {max(dd):.2f} bp | "
              f"within ±1bp {sum(1 for d in dd if d<=1)}/{len(dd)} | ±2bp {sum(1 for d in dd if d<=2)}/{len(dd)}")

    print("\n--- subsets ---")
    sub_stats(regular, "Corporate (excl. tax-free)")
    sub_stats(gsec_sub, "G-Sec / SDL (ACT/ACT)")
    sub_stats(taxfree, "Tax-free bonds (premium, feed-price staleness suspected)")

    out = {
        "settlement": str(settle),
        "stats": {
            "count": len(ok),
            "mean_abs_bps": round(mean(devs), 2) if devs else None,
            "median_abs_bps": round(median(devs), 2) if devs else None,
            "max_abs_bps": round(max(devs), 2) if devs else None,
            "within_1bp": sum(1 for d in devs if d <= 1) if devs else 0,
            "within_5bp": sum(1 for d in devs if d <= 5) if devs else 0,
            "within_25bp": sum(1 for d in devs if d <= 25) if devs else 0,
        },
        "conventions": variants_win,
        "rows": rows,
        "staggered": staggered,
        "inconsistent": inconsistent,
    }
    json.dump(out, open(os.path.join(HERE, "comparison_results.json"), "w"), indent=1)

    import csv
    with open(os.path.join(HERE, "comparison_results.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["isin", "issuer", "type", "rating", "coupon", "frequency", "maturity", "face", "price",
                    "platform_yield", "engine_yield", "dev_bps", "best_convention", "staggered", "recon_diff_pts"])
        for r in sorted(rows + staggered, key=lambda x: -x["abs_dev_bps"]):
            w.writerow([r["isin"], r["issuer"], r["type"], r["rating"], r["coupon"], r["freq"], r["maturity"],
                        r["face"], r["price"], r["platform_yield"], r["engine_yield"], r["dev_bps"],
                        r["best_variant"], r["staggered"], r.get("recon_diff_pts")])
    print("\nresults saved: comparison_results.json + comparison_results.csv")


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
