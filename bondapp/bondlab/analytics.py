import math
from datetime import date

from .daycount import to_date
from .bond import Bond

def current_yield(coupon, clean_price):
    if clean_price <= 0:
        raise ValueError("price must be positive")
    return coupon / clean_price * 100.0

def _exponents_and_cfs(bond, settlement):
    settlement = to_date(settlement)
    cfs = bond.cashflows_per100(settlement)
    if not cfs:
        raise ValueError("no remaining cashflows")
    cp = bond._current_period(settlement) if bond.freq else None
    if bond.freq:
        n_periods = [bond._periods_from_settle(d, settlement, cp) for d, _ in cfs]
    else:
        n_periods = [(d - settlement).days / 365.0 for d, _ in cfs]
    amounts = [a for _, a in cfs]
    return n_periods, amounts

def macaulay_duration(bond, y, settlement):
    n_periods, amounts = _exponents_and_cfs(bond, settlement)
    i = y / 100.0 / bond._comp
    pv_total = 0.0
    weighted = 0.0
    for a, n in zip(amounts, n_periods):
        pv = a * (1.0 + i) ** (-n)
        pv_total += pv
        weighted += pv * n
    periods_per_year = bond._comp
    return weighted / pv_total / periods_per_year, pv_total

def modified_duration(bond, y, settlement):
    mac, pv = macaulay_duration(bond, y, settlement)
    return mac / (1.0 + y / 100.0 / bond._comp), pv

def convexity(bond, y, settlement):
    n_periods, amounts = _exponents_and_cfs(bond, settlement)
    i = y / 100.0 / bond._comp
    pv_total = sum(a * (1.0 + i) ** (-n) for a, n in zip(amounts, n_periods))
    c = sum(a * n * (n + 1.0) * (1.0 + i) ** (-n - 2) for a, n in zip(amounts, n_periods))
    return c / (pv_total * bond._comp**2), pv_total

def yield_movement(bond, y, settlement, steps_bp=(25, 50, 100)):
    rows = []
    for s in (0, *steps_bp, *(-s for s in steps_bp)):
        yy = y - s / 100.0
        if yy <= -99.0:
            continue
        rows.append({"yield": round(yy, 4), "price": round(bond.price_from_yield(yy, settlement), 4)})
    return sorted(rows, key=lambda r: r["yield"], reverse=True)

def xirr(cashflows, guess=0.1):
    cfs = [(to_date(d), float(a)) for d, a in cashflows]
    if len(cfs) < 2:
        raise ValueError("need at least two cashflows")
    t0 = min(d for d, _ in cfs)
    ts = [(d - t0).days / 365.0 for d, _ in cfs]
    amts = [a for _, a in cfs]
    def npv(r):
        return sum(a / (1.0 + r) ** t for a, t in zip(amts, ts))

    def dnpv(r):
        return sum(-a * t / (1.0 + r) ** (t + 1) for a, t in zip(amts, ts))

    lo, hi = -0.999999, 1000.0
    if npv(lo) * npv(hi) > 0:
        raise ValueError("cannot bracket XIRR")
    r = guess
    if not (lo < r < hi):
        r = 0.1
    for _ in range(300):
        f = npv(r)
        if abs(f) < 1e-10:
            break
        if f > 0:
            lo = max(lo, r)
        else:
            hi = min(hi, r)
        d = dnpv(r)
        if d == 0 or not math.isfinite(d):
            r = (lo + hi) / 2
            continue
        r_new = r - f / d
        if not (lo < r_new < hi):
            r_new = (lo + hi) / 2
        r = r_new
    return r * 100.0

def effective_annual_yield(y, compounding):
    i = y / 100.0
    if compounding <= 0:
        return y
    return ((1.0 + i / compounding) ** compounding - 1.0) * 100.0


def xnpv(rate, cashflows):
    cfs = [(to_date(d), float(a)) for d, a in cashflows]
    if len(cfs) < 2:
        raise ValueError("need at least two cashflows")
    t0 = min(d for d, _ in cfs)
    r = rate / 100.0
    total = 0.0
    for d, a in cfs:
        t = (d - t0).days / 365.0
        total += a / (1.0 + r) ** t
    return total
