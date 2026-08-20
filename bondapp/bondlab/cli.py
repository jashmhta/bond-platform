import argparse
import json
import sys
from datetime import date

from .bond import Bond, STAMP_DUTY_TRANSFER
from .analytics import (
    current_yield,
    macaulay_duration,
    modified_duration,
    convexity,
    yield_movement,
    xirr,
    effective_annual_yield,
)
from .tax import post_tax_xirr


def _bond_from_args(a):
    return Bond(
        maturity=a.maturity,
        coupon=a.coupon,
        freq=a.freq,
        face_value=a.face,
        issue=a.issue,
        first_coupon=a.first_coupon,
        day_count=a.day_count,
        redemptions=_parse_redemptions(a.redemptions),
        calls=_parse_calls(a.calls),
        puts=_parse_calls(a.puts),
    )


def _parse_redemptions(spec):
    if not spec:
        return []
    out = []
    for part in spec.split(","):
        d, p = part.split(":")
        out.append((d, float(p)))
    return out


def _parse_calls(spec):
    if not spec:
        return []
    out = []
    for part in spec.split(","):
        if ":" in part:
            d, p = part.split(":")
            out.append((d, float(p)))
        else:
            out.append((part, 100.0))
    return out


def _base_output(bond, a):
    accrued, days = bond.accrued_interest_per100(a.settle)
    out = {
        "settlement": str(a.settle),
        "coupon": bond.coupon,
        "freq": bond.freq,
        "maturity": str(bond.maturity),
        "day_count": bond.day_count,
        "face_value": bond.face_value,
        "accrued_days": days,
        "accrued_per100": round(accrued, 6),
    }
    return out, accrued


def cmd_price(a):
    bond = _bond_from_args(a)
    out, accrued = _base_output(bond, a)
    dirty = bond.price_from_yield(a.yield_pct, a.settle)
    clean = dirty - accrued
    out.update({
        "input_yield": a.yield_pct,
        "dirty_price": round(dirty, 6),
        "clean_price": round(clean, 6),
        "current_yield": round(current_yield(bond.coupon, clean), 6),
    })
    if a.duration:
        mac, _ = macaulay_duration(bond, a.yield_pct, a.settle)
        mod, _ = modified_duration(bond, a.yield_pct, a.settle)
        conv, _ = convexity(bond, a.yield_pct, a.settle)
        out.update({
            "macaulay_duration_years": round(mac, 6),
            "modified_duration": round(mod, 6),
            "convexity": round(conv, 6),
        })
    print(json.dumps(out, indent=2))


def cmd_yield(a):
    bond = _bond_from_args(a)
    out, accrued = _base_output(bond, a)
    y = bond.yield_from_price(a.price, a.settle, clean=not a.dirty)
    dirty = a.price + accrued if not a.dirty else a.price
    out.update({
        "input_price": a.price,
        "price_type": "dirty" if a.dirty else "clean",
        "ytm": round(y, 6),
        "effective_annual": round(effective_annual_yield(y, bond._comp), 6),
        "current_yield": round(current_yield(bond.coupon, a.price if not a.dirty else a.price - accrued), 6),
    })
    if bond.calls:
        out["yield_to_call"] = [
            {"date": str(d), "ytc": round(v, 6)} for d, v in bond.yield_to_call(a.price, a.settle, clean=not a.dirty)
        ]
        kind, hd, yw = bond.yield_to_worst(a.price, a.settle, clean=not a.dirty)
        out["yield_to_worst"] = {"type": kind, "date": str(hd), "yield": round(yw, 6)}
    if bond.puts:
        out["yield_to_put"] = [
            {"date": str(d), "ytp": round(v, 6)} for d, v in bond.yield_to_put(a.price, a.settle, clean=not a.dirty)
        ]
    if a.tax_slab is not None:
        r, cfs = post_tax_xirr(bond, a.settle, a.price if not a.dirty else a.price - accrued, slab_rate=a.tax_slab)
        out["post_tax_xirr"] = round(r, 6)
    print(json.dumps(out, indent=2))


def cmd_settle(a):
    bond = _bond_from_args(a)
    res = bond.settlement_amount(a.price, a.n_bonds, a.settle, stamp_rate=a.stamp_rate)
    res["ytm"] = round(bond.yield_from_price(a.price, a.settle), 6)
    res["n_bonds"] = a.n_bonds
    print(json.dumps(res, indent=2))


def cmd_cashflows(a):
    bond = _bond_from_args(a)
    scale = bond.face_value / 100.0 * a.n_bonds
    rows = [
        {"date": str(d), "amount_per_bond": round(amt * bond.face_value / 100.0, 4), "total": round(amt * scale, 2)}
        for d, amt in bond.cashflows_per100(a.settle)
    ]
    print(json.dumps({"cashflows": rows, "count": len(rows)}, indent=2))


def cmd_xirr(a):
    cfs = []
    for tok in a.cashflows.split(","):
        d, amt = tok.split("=")
        cfs.append((d, float(amt)))
    print(json.dumps({"xirr_pct": round(xirr(cfs), 6)}, indent=2))


def cmd_movement(a):
    bond = _bond_from_args(a)
    rows = yield_movement(bond, a.yield_pct, a.settle)
    print(json.dumps({"yield_movement": rows}, indent=2))


def cmd_preset(a):
    import os

    path = os.path.join(os.path.dirname(__file__), "..", "examples", "platform_bonds.json")
    with open(path) as f:
        data = json.load(f)
    bonds = {b["id"]: b for b in data["bonds"]}
    if a.list:
        rows = [
            {
                "id": b["id"],
                "platform": b["platform"],
                "issuer": b["issuer"],
                "isin": b["isin"],
                "rating": b["rating"],
                "advertised_yield": b["advertised_yield"],
            }
            for b in data["bonds"]
        ]
        print(json.dumps(rows, indent=2))
        return
    if a.id not in bonds:
        raise SystemExit(f"unknown preset id: {a.id}")
    p = bonds[a.id]
    bond = Bond(
        maturity=p["maturity"],
        coupon=p["coupon"],
        freq=p["freq"],
        face_value=p["face_value"],
        day_count=p["day_count"],
    )
    out = {
        "preset": p["id"],
        "issuer": p["issuer"],
        "isin": p["isin"],
        "platform": p["platform"],
        "rating": p["rating"],
        "advertised_yield": p["advertised_yield"],
        "maturity_is_example": p.get("maturity_is_example", False),
    }
    accrued, days = bond.accrued_interest_per100(a.settle)
    out["accrued_days"] = days
    out["accrued_per100"] = round(accrued, 6)
    if a.price is not None:
        y = bond.yield_from_price(a.price, a.settle)
        out["input_price"] = a.price
        out["ytm"] = round(y, 6)
        out["dirty_price"] = round(a.price + accrued, 6)
        if a.n_bonds:
            out.update(bond.settlement_amount(a.price, a.n_bonds, a.settle))
    else:
        y = a.yield_pct if a.yield_pct is not None else p["advertised_yield"]
        dirty = bond.price_from_yield(y, a.settle)
        out["input_yield"] = y
        out["clean_price"] = round(dirty - accrued, 6)
        out["dirty_price"] = round(dirty, 6)
        if a.n_bonds:
            out.update(bond.settlement_amount(dirty - accrued, a.n_bonds, a.settle))
    print(json.dumps(out, indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(prog="bondlab", description="Bond pricing, yield and settlement engine")
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp):
        sp.add_argument("--maturity", required=True)
        sp.add_argument("--coupon", type=float, default=0.0)
        sp.add_argument("--freq", type=int, default=1, help="coupons per year: 0,1,2,3,4,6,12")
        sp.add_argument("--face", type=float, default=1000.0)
        sp.add_argument("--issue")
        sp.add_argument("--first-coupon")
        sp.add_argument("--day-count", default="ACT/ACT", choices=["ACT/ACT", "30/360", "30E/360", "ACT/365F"])
        sp.add_argument("--settle", type=lambda s: date.fromisoformat(s), default=date.today())
        sp.add_argument("--redemptions", help="date:pct,date:pct for staggered redemption")
        sp.add_argument("--calls", help="date[:price],... call dates")
        sp.add_argument("--puts", help="date[:price],... put dates")

    sp = sub.add_parser("price")
    common(sp)
    sp.add_argument("--yield-pct", type=float, required=True)
    sp.add_argument("--duration", action="store_true")
    sp.set_defaults(fn=cmd_price)

    sp = sub.add_parser("yield")
    common(sp)
    sp.add_argument("--price", type=float, required=True)
    sp.add_argument("--dirty", action="store_true")
    sp.add_argument("--tax-slab", type=float)
    sp.set_defaults(fn=cmd_yield)

    sp = sub.add_parser("settle")
    common(sp)
    sp.add_argument("--price", type=float, required=True)
    sp.add_argument("--n-bonds", type=float, required=True)
    sp.add_argument("--stamp-rate", type=float, default=STAMP_DUTY_TRANSFER)
    sp.set_defaults(fn=cmd_settle)

    sp = sub.add_parser("cashflows")
    common(sp)
    sp.add_argument("--n-bonds", type=float, default=1.0)
    sp.set_defaults(fn=cmd_cashflows)

    sp = sub.add_parser("xirr")
    sp.add_argument("--cashflows", required=True, help="date=amount,date=amount (negative=outflow)")
    sp.set_defaults(fn=cmd_xirr)

    sp = sub.add_parser("movement")
    common(sp)
    sp.add_argument("--yield-pct", type=float, required=True)
    sp.set_defaults(fn=cmd_movement)

    sp = sub.add_parser("preset")
    sp.add_argument("--id")
    sp.add_argument("--list", action="store_true")
    sp.add_argument("--settle", type=lambda s: date.fromisoformat(s), default=date.today())
    sp.add_argument("--price", type=float)
    sp.add_argument("--yield-pct", type=float)
    sp.add_argument("--n-bonds", type=float)
    sp.set_defaults(fn=cmd_preset)

    a = p.parse_args(argv)
    try:
        a.fn(a)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
