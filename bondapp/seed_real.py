import json
import math
import os
from datetime import datetime
import json
import sys
from datetime import date, datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)
sys.path.insert(0, os.path.join(BASE_DIR, "bondlab"))

import db
import models
from bondlab import Bond

FEED_SETTLE = date(2026, 8, 18)

FREQ_MAP = {
    "MONTHLY": "Monthly", "QUARTERLY": "Quarterly",
    "SEMI ANNUALLY": "Semi-Annual", "ANNUALLY": "Annual", "CUMULATIVE": "Zero Coupon",
}

JIRAAF_VERIFIED = [
    {
        "isin": "INE03K307165",
        "security_name": "Satin Finserv Limited",
        "issuer_category": "NBFC",
        "coupon": 10.75,
        "coupon_frequency": "Monthly",
        "face_value": 10000.0,
        "type": "NCD",
        "credit_rating": "ICRA A-",
        "maturity": "2028-06-10",
        "offer_yield": 12.30,
        "min_investment": 100000.0,
        "source": "Jiraaf bond page (live, 2026-08-18): coupon 10.75%, monthly, face 10,000, ICRA A-, secured",
        "staggered": False,
    },
    {
        "isin": "INE530L07BK9",
        "security_name": "NIDO Home Finance Limited",
        "issuer_category": "NBFC",
        "coupon": 0.0,
        "coupon_frequency": "Zero Coupon",
        "face_value": 100000.0,
        "type": "Structured (SDI)",
        "credit_rating": "CARE A-",
        "maturity": "2027-07-08",
        "offer_yield": 10.45,
        "min_investment": 100000.0,
        "source": "Jiraaf bond page (live, 2026-08-18): monthly payouts, principal at maturity, coupon N/A (structured)",
        "staggered": False,
    },
]


def infer_face(price):
    p = round(math.log10(price))
    p = max(2, min(6, p))
    face = float(10 ** p)
    if not (60.0 <= price / face * 100.0 <= 130.0):
        for alt in (1000.0, 10000.0, 100000.0, 1000000.0):
            if 60.0 <= price / alt * 100.0 <= 130.0:
                face = alt
                break
    return face


def fetch_indiabonds():
    data_path = os.path.join(BASE_DIR, "..", "bondlab", "comparison", "platform_data_indiabonds.json")
    if os.path.exists(data_path):
        return json.load(open(data_path))
    import urllib.request
    ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
    out = []
    for tag in ("All Bonds", "G-Sec/SDL"):
        url = f"https://prod-api.indiabonds.com/api/v3/web/bond-list/?page_no=1&page_size=100&sort_by=yield_high_to_low&tag_name={tag.replace(' ', '%20').replace('/', '%2F')}"
        req = urllib.request.Request(url, headers=ua)
        with urllib.request.urlopen(req, timeout=30) as r:
            out.extend(json.loads(r.read()).get("bond_list", []))
    return out


def category_for(rec):
    name = (rec.get("issuer_name") or "").upper()
    tob = (rec.get("type_of_bond") or "").lower()
    if "sovereign" in (rec.get("security_type") or "") or "development loan" in tob or "government" in tob:
        return "Government"
    if "bank" in name or "small finance" in name:
        return "Bank"
    if any(k in name for k in ("CORPORATION", "AUTHORITY", "POWER", "INFRASTRUCTURE", "HOUSING AND URBAN")):
        return "PSU"
    return "NBFC / Corporate"


def type_for(rec):
    tob = (rec.get("type_of_bond") or "").lower()
    if "development loan" in tob:
        return "SDL"
    if rec.get("security_type") == "SOVEREIGN" or "government securit" in tob:
        return "G-Sec"
    if "tax-free" in tob:
        return "Tax-free Bond"
    if "tier 2" in tob or "tier 1" in tob:
        return "Tier 2"
    if "secured" in tob:
        return "NCD"
    return "Bond"


def build_records():
    out = []
    for rec in fetch_indiabonds():
        try:
            coupon = float(rec["coupon_rate"].replace("%", ""))
            price = float(rec["price"])
        except Exception:
            continue
        freq_label = FREQ_MAP.get(rec["frequency"])
        if not freq_label:
            continue
        freq = {"Monthly": 12, "Quarterly": 4, "Semi-Annual": 2, "Annual": 1, "Zero Coupon": 0}[freq_label]
        face = infer_face(price)
        mat = datetime.strptime(rec["maturity_date"], "%d %b %Y").date()
        is_gsec = "Development Loan" in rec.get("type_of_bond", "") or "Government" in rec.get("type_of_bond", "")
        dc = "ACT/ACT" if is_gsec else "30/360"
        ib = None if is_gsec else "ACT/365F"
        b = Bond(maturity=mat, coupon=coupon, freq=freq, face_value=face, day_count=dc, interest_basis=ib)
        acc, _ = b.accrued_interest_per100(FEED_SETTLE)
        clean = price / face * 100.0 - acc
        out.append({
            "isin": rec["isin"],
            "security_name": rec.get("issuer_name") or rec["isin"],
            "issuer_category": category_for(rec),
            "coupon": coupon,
            "coupon_frequency": freq_label,
            "face_value": face,
            "type": type_for(rec),
            "credit_rating": rec.get("rating_combined") or "NR",
            "maturity": mat.isoformat(),
            "offer_yield": float(rec["yield_value"].replace("%", "")),
            "offer_price": round(clean, 6),
            "min_investment": 10000.0 if face <= 10000 else 100000.0,
            "day_count": dc,
            "staggered": str(rec.get("is_staggered")).lower() == "true",
            "redemptions": KNOWN_SCHEDULES.get(rec["isin"]) or None,
            "call_date": rec.get("call_date"),
            "source": f"IndiaBonds live directory API (fetched 2026-08-18), balance tenure {rec.get('balance_tenure_days')}d",
        })
    return out



def _load_known_schedules():
    known = {}
    path = "/home/ubuntu/c/bondlab/comparison/staggered_schedules.json"
    try:
        data = json.load(open(path))
    except Exception:
        return known
    for isin, entry in data.items():
        if not entry or not entry.get("schedule"):
            continue
        sched = [[datetime.strptime(x["date"], "%d %b %Y").date().isoformat(), float(x["pct"])] for x in entry["schedule"]]
        total = sum(pct for _, pct in sched)
        if abs(total - 100.0) > 1e-6:
            sched[-1] = (sched[-1][0], sched[-1][1] + (100.0 - total))
        known[isin] = sched
    return known

KNOWN_SCHEDULES = _load_known_schedules()

def seed(records):
    conn = db.get_db()
    conn.execute("DELETE FROM quotes")
    conn.execute("DELETE FROM bonds")
    conn.commit()
    conn.close()
    inserted = 0
    for r in records:
        data = dict(r)
        data["redemptions"] = json.dumps(r.get("redemptions") or []) if r.get("redemptions") else None
        data.pop("staggered", None)
        data.pop("source", None)
        data["offer_yield"] = round(r["offer_yield"], 4)
        data["residual"] = models.compute_residual(data["maturity"])
        note = r.get("source", "")
        if r.get("staggered"):
            note = f"{note}; staggered redemption — schedule pending"
        else:
            try:
                b2 = models.data_to_bond(data)
                y2 = b2.yield_from_price(data["offer_price"], FEED_SETTLE)
                if abs(y2 - r["offer_yield"]) * 100 > 50:
                    note = f"{note}; platform feed price/yield pair inconsistent (stale) — verified vs engine"
            except Exception:
                pass
        data["notes"] = note
        data["tiny_url"] = ""
        data["slug"] = models.slugify(data["security_name"])
        base = data["slug"]
        i = 2
        while db.slug_exists(data["slug"]):
            data["slug"] = f"{base}-{i}"
            i += 1
        db.insert_bond(data)
        inserted += 1
    return inserted


def fill_missing_prices(records):
    for r in records:
        if r.get("offer_price") is not None:
            continue
        freq = {"Monthly": 12, "Quarterly": 4, "Semi-Annual": 2, "Annual": 1, "Zero Coupon": 0}[r["coupon_frequency"]]
        mat = datetime.strptime(r["maturity"], "%Y-%m-%d").date()
        b = Bond(maturity=mat, coupon=r["coupon"], freq=freq, face_value=r["face_value"],
                 day_count=r.get("day_count") or ("ACT/ACT" if r["type"] in ("G-Sec", "SDL") else "30/360"))
        acc, _ = b.accrued_interest_per100(FEED_SETTLE)
        r["offer_price"] = round(b.price_from_yield(r["offer_yield"], FEED_SETTLE) - acc, 6)
    return records


def main():
    records = []
    seen = set()
    for r in build_records() + JIRAAF_VERIFIED:
        isin = (r.get("isin") or "").strip().upper()
        if not isin or isin in seen:
            continue
        seen.add(isin)
        records.append(r)
    records = fill_missing_prices(records)
    json.dump(records, open(os.path.join(BASE_DIR, "examples", "real_bonds.json"), "w"), indent=1)
    print(f"real_bonds.json written: {len(records)} bonds (IndiaBonds live + Jiraaf verified)")
    n = seed(records)
    print(f"database reseeded: {n} real bonds, no example/test rows")


if __name__ == "__main__":
    main()
