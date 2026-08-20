from dataclasses import dataclass, field
from datetime import date, timedelta

from .daycount import add_months, to_date

@dataclass(frozen=True)
class CouponPeriod:
    accrual_start: date
    accrual_end: date
    payment: date

def _roll_following(d):
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d

def generate_schedule(maturity, freq=1, issue=None, first_coupon=None, adjust=False):
    maturity = to_date(maturity)
    if freq not in (1, 2, 3, 4, 6, 12):
        raise ValueError("freq must be one of 1,2,3,4,6,12")
    if first_coupon is not None and issue is not None:
        if to_date(issue) >= to_date(first_coupon):
            raise ValueError("issue must precede first_coupon")
    step = 12 // freq

    if first_coupon is not None:
        # Coupon-anchored forward schedule: coupons land on the same day-of-month
        # as the first coupon; the last period is a stub ending at maturity.
        fc = to_date(first_coupon)
        if fc >= maturity:
            raise ValueError("first_coupon must precede maturity")
        dates = []
        cur = fc
        while add_months(cur, step) < maturity:
            dates.append(cur)
            cur = add_months(cur, step)
        dates.append(maturity)
    else:
        dates = [maturity]
        cur = maturity
        floor = to_date(issue) if issue is not None else None
        while True:
            prev = add_months(cur, -step)
            dates.append(prev)
            cur = prev
            if floor is not None:
                if prev <= floor:
                    break
            elif cur.year <= maturity.year - 80:
                break
        dates.reverse()

    if issue is not None:
        iss = to_date(issue)
        if dates[0] < iss:
            dates[0] = iss
        elif dates[0] > iss:
            dates.insert(0, iss)
    deduped = []
    for d in dates:
        if not deduped or deduped[-1] != d:
            deduped.append(d)
    dates = deduped
    periods = []
    for a, b in zip(dates[:-1], dates[1:]):
        pay = b if not adjust else _roll_following(b)
        periods.append(CouponPeriod(a, b, pay))
    return periods

def periods_after(periods, as_of):
    as_of = to_date(as_of)
    return [p for p in periods if p.payment > as_of]
