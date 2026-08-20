from datetime import date, datetime
import calendar

def is_leap(y):
    return calendar.isleap(y)

def _add_months(d, months):
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)

def _to_date(d):
    if isinstance(d, date):
        return d
    if isinstance(d, str):
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y%m%d"):
            try:
                return datetime.strptime(d, fmt).date()
            except ValueError:
                continue
        raise ValueError(f"unparseable date: {d!r}")
    raise TypeError(f"unsupported date type: {type(d)}")

def days_30_360(start, end, euro=False):
    d1, d2 = start.day, end.day
    if euro:
        d1 = min(d1, 30)
        d2 = min(d2, 30)
    else:
        if d1 == 31:
            d1 = 30
        if d2 == 31 and d1 == 30:
            d2 = 30
    return (end.year - start.year) * 360 + (end.month - start.month) * 30 + (d2 - d1)

def year_fraction_30_360(start, end, euro=False):
    return days_30_360(start, end, euro) / 360.0

def year_fraction_act_365f(start, end):
    return (end - start).days / 365.0

def _contains_leap_day(start, end):
    for y in range(start.year, end.year + 1):
        if is_leap(y):
            fd = date(y, 2, 29)
            if start < fd <= end:
                return True
    return False

def act_365l_denom(start, end):
    return 366.0 if _contains_leap_day(start, end) else 365.0

def year_fraction_act_365l(start, end):
    return (end - start).days / act_365l_denom(start, end)

def year_fraction_act_365y(start, end):
    # leap year of the END date: /366 if the later date falls in a leap year, else /365
    denom = 366.0 if is_leap(end.year) else 365.0
    return (end - start).days / denom

def year_fraction_act_366(start, end):
    return (end - start).days / 366.0

def year_fraction_act_act_isda(start, end):
    if end <= start:
        return 0.0
    total = 0.0
    cur = start
    y = start.year
    while True:
        seg_end = min(end, date(y + 1, 1, 1))
        denom = 366.0 if is_leap(y) else 365.0
        total += (seg_end - cur).days / denom
        if seg_end == end:
            break
        cur = seg_end
        y += 1
    return total

CONVENTIONS = {
    "30/360": lambda s, e: year_fraction_30_360(s, e, euro=False),
    "30E/360": lambda s, e: year_fraction_30_360(s, e, euro=True),
    "ACT/365F": year_fraction_act_365f,
    "ACT/365L": year_fraction_act_365l,
    "ACT/365Y": year_fraction_act_365y,
    "ACT/ACT": year_fraction_act_act_isda,
}

PERIOD_CONVENTIONS = {"30/360", "30E/360", "ACT/365F", "ACT/365L", "ACT/365Y", "ACT/ACT"}

def year_fraction(start, end, convention="ACT/ACT"):
    if convention not in CONVENTIONS:
        raise ValueError(f"unsupported convention: {convention}")
    return CONVENTIONS[convention](start, end)

def add_months(d, months):
    return _add_months(d, months)

def to_date(d):
    return _to_date(d)
