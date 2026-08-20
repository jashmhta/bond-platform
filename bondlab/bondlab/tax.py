from datetime import date

from .daycount import to_date
from .analytics import xirr

LTCG_LISTED = 0.125
LTCG_THRESHOLD_DAYS = 365

def post_tax_cashflows(
    bond,
    settlement,
    clean_price,
    n_bonds=1,
    slab_rate=0.30,
    ltcg_rate=LTCG_LISTED,
    listed=True,
    ltcg_threshold_days=LTCG_THRESHOLD_DAYS,
    sell_date=None,
    sell_price=None,
):
    settlement = to_date(settlement)
    accrued, _ = bond.accrued_interest_per100(settlement)
    dirty = clean_price + accrued
    cost = dirty / 100.0 * bond.face_value * n_bonds
    scale = bond.face_value / 100.0 * n_bonds
    cfs = [(-cost, settlement)]

    def net_coupon_slab(gross, d):
        coupon_part = bond.coupon / max(bond.freq, 1) * scale if bond.freq else 0.0
        return gross - coupon_part * slab_rate

    if sell_date is not None:
        horizon = to_date(sell_date)
        sp = sell_price if sell_price is not None else 100.0
        proceeds = sp / 100.0 * bond.face_value * n_bonds
        holding = (horizon - settlement).days
        rate = ltcg_rate if (listed and holding > ltcg_threshold_days) else slab_rate
        for d, a in bond.cashflows_per100(settlement):
            if d > horizon:
                continue
            if d == horizon:
                continue
            cfs.append((net_coupon_slab(a * scale, d), d))
        gain = max(proceeds - cost, 0.0)
        cfs.append((proceeds - gain * rate, horizon))
    else:
        for d, a in bond.cashflows_per100(settlement):
            cfs.append((net_coupon_slab(a * scale, d), d))
        holding = (bond.maturity - settlement).days
        rate = ltcg_rate if (listed and holding > ltcg_threshold_days) else slab_rate
        redemption_at_maturity = sum(pct for rd, pct in bond.redemptions if rd == bond.maturity) * scale
        gain = max(redemption_at_maturity - cost, 0.0)
        cfs = [
            (a - gain * rate if d == bond.maturity and a > 0 else a, d) for a, d in cfs
        ]
    return cfs

def post_tax_xirr(bond, settlement, clean_price, **kwargs):
    cfs = post_tax_cashflows(bond, settlement, clean_price, **kwargs)
    r = xirr([(d, a) for a, d in cfs])
    return r, cfs
