"""Parity check vs IndiaBonds public reference (data/indiabonds_reference_full.json).

IndiaBonds conventions (reverse-engineered & verified):
  Accrued : FV x coupon% x days/365 (ACT/365F simple); reference boundary on the regular
            anchored coupon grid (prev = next_ip - one period) -> negative days inside
            long first stubs. Sovereigns accrue ACT/ACT period-fraction.
  YTM     : Sovereigns = street semi-annual BEY (freq-compounded).
            Corporates  = XIRR (ACT/365 daily exponents, outflow = dirty price).
  NOTE    : IB page price & yield are independent market observations (dealer quote vs
            last offered); pairs can be mutually stale -> residual bp is data, not math.
Run: python3 examples/verify_indiabonds.py
"""
import json, os, sys, statistics as S
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bondlab.bond import Bond

ROWS = json.load(open(os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "data", "indiabonds_reference_full.json")))
FREQ = {"Monthly": 12, "Quarterly": 4, "Semi-Annual": 2, "Annual": 1}
SETTLE = date(2026, 8, 24)

ai_err, y_err = [], []
kinds = {}
for r in ROWS:
    try:
        gs = bool(r.get("is_sovereign"))
        f = FREQ.get(r["freq_label"]) or (2 if gs else None)
        if not f or not r.get("coupon_pct") or not r.get("clean_per_100"):
            continue
        if date.fromisoformat(r["maturity_iso"]) <= SETTLE:
            continue
        kw = dict(maturity=r["maturity_iso"], coupon=r["coupon_pct"], freq=f,
                  face_value=r["face_value_inr"] or 100.0,
                  day_count="ACT/ACT" if gs else "ACT/365F")
        b = Bond(**kw)
        acc, _ = b.accrued_interest_per100(SETTLE)
        ai_err.append(abs(acc * (r["face_value_inr"] or 100) / 100 - (r["accrued_inr"] or 0)))
        ytm = r.get("ytm_semi_bey") if gs else r.get("ytm_pct")
        if ytm:
            y = b.yield_from_price(r["clean_per_100"], SETTLE) if gs \
                else b.xirr_from_price(r["clean_per_100"], SETTLE)
            e = abs((y - ytm) * 100)
            y_err.append(e)
            kinds.setdefault("gsec" if gs else f"f{f}", []).append(e)
    except Exception:
        continue

print(f"bonds checked        : {len(ai_err)}")
print(f"accrued median |err| : Rs {S.median(ai_err):.2f}")
print(f"accrued within Re 1  : {sum(1 for x in ai_err if x < 1)}/{len(ai_err)}")
if y_err:
    print(f"YTM median |err|     : {S.median(y_err):.1f} bp")
    print(f"YTM within 2 / 5 bp  : {sum(1 for e in y_err if e < 2)} / {sum(1 for e in y_err if e < 5)} of {len(y_err)}")
for k in sorted(kinds):
    v = kinds[k]
    print(f"   {k:<6} n={len(v):>2}  median {S.median(v):5.1f}bp  max {max(v):6.1f}bp")
