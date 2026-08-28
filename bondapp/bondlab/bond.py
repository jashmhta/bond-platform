from dataclasses import dataclass, field
from datetime import date
import math

from .daycount import to_date, year_fraction, days_30_360, act_365l_denom, is_leap
from .schedule import generate_schedule, periods_after

STAMP_DUTY_TRANSFER = 0.000001


def _solve_yield(pv, target, dpv=None, lo=-0.9999, hi=100.0, guess=0.05, max_iter=200):
    f_lo, f_hi = pv(lo) - target, pv(hi) - target
    if f_lo * f_hi > 0:
        raise ValueError("cannot bracket yield for given price")
    if not (lo < guess < hi):
        guess = (lo + hi) / 2
    y = guess
    for _ in range(max_iter):
        fv = pv(y) - target
        tol = 1e-14 * max(1.0, abs(target))
        if abs(fv) <= tol:
            break
        if fv > 0:
            lo = max(lo, y)
        else:
            hi = min(hi, y)
        d = dpv(y) if dpv is not None else (pv(y + 1e-9) - pv(y - 1e-9)) / 2e-9
        if d == 0 or not math.isfinite(d):
            y = (lo + hi) / 2
            continue
        y_new = y - fv / d
        if not (lo < y_new < hi):
            y_new = (lo + hi) / 2
        y = y_new
    return y

@dataclass
class Bond:
    maturity: date
    coupon: float = 0.0
    freq: int = 1
    face_value: float = 1000.0
    issue: date = None
    first_coupon: date = None
    day_count: str = "ACT/ACT"
    compounding: int = None
    redemptions: list = field(default_factory=list)
    calls: list = field(default_factory=list)
    puts: list = field(default_factory=list)
    adjust_payment_dates: bool = False
    coupon_proration: str = "fixed"
    interest_basis: str = None

    def __post_init__(self):
        self.maturity = to_date(self.maturity)
        if self.issue is not None:
            self.issue = to_date(self.issue)
        if self.first_coupon is not None:
            self.first_coupon = to_date(self.first_coupon)
        if self.day_count not in ("ACT/ACT", "30/360", "30E/360", "ACT/365F", "ACT/365L", "ACT/365Y"):
            raise ValueError(f"unsupported day_count: {self.day_count}")
        if self.freq not in (0, 1, 2, 3, 4, 6, 12):
            raise ValueError("freq must be 0,1,2,3,4,6,12")
        if self.freq == 0 and self.coupon != 0.0:
            raise ValueError("freq=0 only valid for zero coupon bonds")
        if self.coupon_proration not in ("fixed", "actual"):
            raise ValueError("coupon_proration must be 'fixed' or 'actual'")
        if self.coupon_proration == "actual" and self.interest_basis not in (None, "ACT/365F", "ACT/365L", "ACT/365Y", "ACT/ACT"):
            raise ValueError("coupon_proration='actual' requires actual-day interest basis")
        if self.interest_basis not in (None, "ACT/365F", "ACT/365L", "ACT/365Y", "30/360", "ACT/ACT"):
            raise ValueError(f"unsupported interest_basis: {self.interest_basis}")
        self._comp = self.compounding if self.compounding else max(self.freq, 1)
        if self.freq == 0:
            self._periods = []
        else:
            self._periods = generate_schedule(
                self.maturity,
                self.freq,
                issue=self.issue,
                first_coupon=self.first_coupon,
                adjust=self.adjust_payment_dates,
            )
        if not self.redemptions:
            self.redemptions = [(self.maturity, 100.0)]
        self.redemptions = [(to_date(d), float(p)) for d, p in self.redemptions]
        tot = sum(p for _, p in self.redemptions)
        if abs(tot - 100.0) > 1e-9:
            raise ValueError(f"redemption fractions sum to {tot}, must equal 100")
        self.calls = [(to_date(d), float(p) if p else 100.0) for d, p in self.calls]
        self.puts = [(to_date(d), float(p) if p else 100.0) for d, p in self.puts]

    @property
    def coupon_per_period_per100(self):
        return self.coupon / max(self.freq, 1)

    def _validate_settlement(self, settlement):
        settlement = to_date(settlement)
        if settlement > self.maturity:
            raise ValueError("settlement date is after maturity")
        if self.issue and settlement < self.issue:
            raise ValueError("settlement date is before issue date")
        return settlement

    def _current_period(self, settlement):
        for p in self._periods:
            if p.accrual_start <= settlement < p.accrual_end:
                return p
        if settlement == self.maturity:
            raise ValueError("bond matures on settlement date")
        # IndiaBonds parity: during a long first stub, accrual reference is the
        # anchored regular boundary before the first coupon (can precede settlement,
        # producing negative elapsed days).
        if self.first_coupon is not None and self._periods:
            fc = self._periods[0].accrual_end
            step = 12 // self.freq
            prev = fc
            from .daycount import add_months
            while prev > settlement:
                prev = add_months(prev, -step)
            if prev <= settlement < fc:
                return CouponPeriod(prev, fc, fc)
        raise ValueError("settlement outside accrual schedule")

    def _accrual_reference_period(self, settlement):
        """Period used for accrued-interest math.

        IndiaBonds parity: when the schedule is anchored on first_coupon, the
        accrual grid stays on the regular coupon boundaries (day-of-month of
        the anchor) even inside a long first stub — elapsed days may be negative.
        """
        p = self._current_period(settlement)
        if self.first_coupon is not None and self._periods:
            fc = self._periods[0].accrual_end
            # only special-case the long-stub period itself
            if p.accrual_end == fc and (fc - p.accrual_start).days > 366 // max(self.freq, 1):
                from .schedule import CouponPeriod
                from .daycount import add_months
                step = 12 // self.freq
                # IndiaBonds: reference start is exactly one regular step before
                # the first coupon; elapsed days may be negative inside a long stub.
                return CouponPeriod(add_months(fc, -step), fc, fc)
        return p

    def _pricing_accrued_per100(self, settlement):
        if self.coupon == 0.0 or self.freq == 0:
            return 0.0, 0
        p = self._accrual_reference_period(settlement)
        if self.day_count in ("30/360", "30E/360"):
            days = days_30_360(p.accrual_start, settlement, euro=self.day_count == "30E/360")
            return self.coupon * days / 360.0, days
        elapsed = (settlement - p.accrual_start).days
        if self.day_count == "ACT/365F":
            return self.coupon * elapsed / 365.0, elapsed
        if self.day_count == "ACT/365L":
            return self.coupon * elapsed / act_365l_denom(p.accrual_start, settlement), elapsed
        if self.day_count == "ACT/365Y":
            denom = 366.0 if is_leap(settlement.year) else 365.0
            return self.coupon * elapsed / denom, elapsed
        total = (p.accrual_end - p.accrual_start).days
        return self.coupon / self.freq * elapsed / total, elapsed

    def accrued_interest_per100(self, settlement):
        settlement = self._validate_settlement(settlement)
        if self.coupon == 0.0 or self.freq == 0:
            return 0.0, 0
        p = self._accrual_reference_period(settlement)
        if self.interest_basis == "ACT/365F":
            elapsed = (settlement - p.accrual_start).days
            return self.coupon * elapsed / 365.0, elapsed
        if self.interest_basis == "ACT/365L":
            elapsed = (settlement - p.accrual_start).days
            return self.coupon * elapsed / act_365l_denom(p.accrual_start, settlement), elapsed
        if self.interest_basis == "ACT/365Y":
            elapsed = (settlement - p.accrual_start).days
            denom = 366.0 if is_leap(settlement.year) else 365.0
            return self.coupon * elapsed / denom, elapsed
        if self.interest_basis == "30/360":
            days = days_30_360(p.accrual_start, settlement)
            return self.coupon * days / 360.0, days
        if self.day_count in ("30/360", "30E/360"):
            days = days_30_360(p.accrual_start, settlement, euro=self.day_count == "30E/360")
            return self.coupon * days / 360.0, days
        elapsed = (settlement - p.accrual_start).days
        if self.day_count == "ACT/365F":
            return self.coupon * elapsed / 365.0, elapsed
        if self.day_count == "ACT/365L":
            return self.coupon * elapsed / act_365l_denom(p.accrual_start, settlement), elapsed
        if self.day_count == "ACT/365Y":
            denom = 366.0 if is_leap(settlement.year) else 365.0
            return self.coupon * elapsed / denom, elapsed
        total = (p.accrual_end - p.accrual_start).days
        return self.coupon / self.freq * elapsed / total, elapsed

    def accrued_interest(self, settlement):
        per100, days = self.accrued_interest_per100(settlement)
        return per100 * self.face_value / 100.0, days

    def _pricing_cashflows_per100(self, settlement):
        cfs = {}
        if self.freq:
            for p in periods_after(self._periods, settlement):
                outstanding = 100.0 - sum(pct for d, pct in self.redemptions if d < p.accrual_end)
                amt = self.coupon / self.freq * (outstanding / 100.0)
                cfs[p.payment] = cfs.get(p.payment, 0.0) + amt
        for d, pct in self.redemptions:
            if d > settlement:
                cfs[d] = cfs.get(d, 0.0) + pct
        return sorted(cfs.items())

    def cashflows_per100(self, settlement):
        settlement = self._validate_settlement(settlement)
        cfs = {}
        if self.freq:
            for p in periods_after(self._periods, settlement):
                outstanding = 100.0 - sum(pct for d, pct in self.redemptions if d < p.accrual_end)
                if self.coupon_proration == "actual" or self.interest_basis in ("ACT/365F", "ACT/365L", "ACT/365Y"):
                    days = (p.accrual_end - p.accrual_start).days
                    if self.interest_basis == "ACT/365L":
                        amt = self.coupon * (outstanding / 100.0) * days / act_365l_denom(p.accrual_start, p.accrual_end)
                    elif self.interest_basis == "ACT/365Y":
                        denom = 366.0 if is_leap(p.accrual_end.year) else 365.0
                        amt = self.coupon * (outstanding / 100.0) * days / denom
                    else:
                        amt = self.coupon * (outstanding / 100.0) * days / 365.0
                else:
                    amt = self.coupon / self.freq * (outstanding / 100.0)
                cfs[p.payment] = cfs.get(p.payment, 0.0) + amt
        for d, pct in self.redemptions:
            if d > settlement:
                cfs[d] = cfs.get(d, 0.0) + pct
        return sorted(cfs.items())

    def _periods_from_settle(self, cf_date, settlement, cp):
        if self.day_count in ("30/360", "30E/360"):
            return max(self.freq, 1) * year_fraction(settlement, cf_date, self.day_count)
        days_to_next = (cp.accrual_end - settlement).days
        period_days = (cp.accrual_end - cp.accrual_start).days
        w = days_to_next / period_days
        pay_dates = [p.payment for p in self._periods if p.payment > settlement]
        if cf_date == cp.accrual_end:
            return w
        if cf_date in pay_dates:
            return w + pay_dates.index(cf_date)
        for j, pd in enumerate(pay_dates):
            nxt = pay_dates[j + 1] if j + 1 < len(pay_dates) else self.maturity
            if pd < cf_date <= nxt:
                frac = (cf_date - pd).days / (nxt - pd).days if nxt > pd else 0.0
                return w + j + frac
        if cf_date == self.maturity and self.maturity not in pay_dates:
            j = len(pay_dates)
            return w + j
        raise ValueError(f"cannot map cashflow date {cf_date} onto schedule")

    def _dpv(self, amounts, n_periods):
        def dpv(y):
            i = y / self._comp
            return sum(a * (-n) * (1.0 + i) ** (-n - 1.0) / self._comp
                       for a, n in zip(amounts, n_periods))
        return dpv

    def _pv_per100(self, cf_dates, cf_amounts, n_periods, y):
        i = y / self._comp
        pv = 0.0
        for amt, n in zip(cf_amounts, n_periods):
            pv += amt * (1.0 + i) ** (-n)
        return pv

    def price_from_yield(self, y, settlement):
        settlement = self._validate_settlement(settlement)
        cfs = self._pricing_cashflows_per100(settlement)
        if not cfs:
            raise ValueError("no remaining cashflows")
        cp = self._current_period(settlement) if self.freq else None
        if self.freq:
            n_periods = [self._periods_from_settle(d, settlement, cp) for d, _ in cfs]
        else:
            denom_days = 365.0
            n_periods = [(d - settlement).days / denom_days for d, _ in cfs]
        return self._pv_per100([d for d, _ in cfs], [a for _, a in cfs], n_periods, y / 100.0)

    def price_from_xirr(self, y, settlement, clean=True):
        """Dirty (or clean) price per 100 such that the XIRR of the schedule equals y (%).

        Follows the desk/Excel investor-yield convention: actual-day cashflows
        discounted with ACT/365 exponents (XIRR), outflow = dirty price.
        """
        settlement = self._validate_settlement(settlement)
        cfs = self.cashflows_per100(settlement)
        if not cfs:
            raise ValueError("no remaining cashflows")
        r = y / 100.0
        dirty = sum(a / (1.0 + r) ** ((d - settlement).days / 365.0) for d, a in cfs)
        if clean:
            acc, _ = self.accrued_interest_per100(settlement)
            return dirty - acc
        return dirty

    def xirr_from_price(self, price, settlement, clean=True):
        """XIRR (%) for a given price per 100 (Excel 'Yield')."""
        settlement = self._validate_settlement(settlement)
        acc, _ = self.accrued_interest_per100(settlement)
        dirty = price + acc if clean else price
        cfs = self.cashflows_per100(settlement)
        face = float(self.face_value or 100.0)
        flows = [[settlement, -dirty / 100.0 * face]] + [[d, a * face / 100.0] for d, a in cfs]
        from .analytics import xirr
        return xirr(flows)

    def yield_from_price(self, price, settlement, clean=True, horizon=None):
        settlement = self._validate_settlement(settlement)
        accrued, _ = self._pricing_accrued_per100(settlement)
        dirty = price + accrued if clean else price
        cfs = self._pricing_cashflows_per100(settlement)
        if not cfs:
            raise ValueError("no remaining cashflows")
        cp = self._current_period(settlement) if self.freq else None
        if self.freq:
            n_periods = [self._periods_from_settle(d, settlement, cp) for d, _ in cfs]
        else:
            n_periods = [(d - settlement).days / 365.0 for d, _ in cfs]
        amounts = [a for _, a in cfs]

        def pv(y):
            i = y / self._comp
            return sum(a * (1.0 + i) ** (-n) for a, n in zip(amounts, n_periods))

        y = _solve_yield(pv, dirty, self._dpv(amounts, n_periods))
        return y * 100.0

    def yield_to_call(self, price, settlement, clean=True):
        if not self.calls:
            raise ValueError("bond has no call dates")
        results = []
        for cd, cprice in self.calls:
            if cd <= to_date(settlement):
                continue
            results.append((cd, self._yield_to_horizon(price, settlement, cd, cprice, clean)))
        return results

    def yield_to_put(self, price, settlement, clean=True):
        if not self.puts:
            raise ValueError("bond has no put dates")
        results = []
        for pd_, pprice in self.puts:
            if pd_ <= to_date(settlement):
                continue
            results.append((pd_, self._yield_to_horizon(price, settlement, pd_, pprice, clean)))
        return results

    def yield_to_worst(self, price, settlement, clean=True):
        ytm = self.yield_from_price(price, settlement, clean)
        worst = [("maturity", self.maturity, ytm)]
        for cd, cprice in self.calls:
            if cd > to_date(settlement):
                worst.append(("call", cd, self._yield_to_horizon(price, settlement, cd, cprice, clean)))
        best = min(worst, key=lambda t: t[2])
        return best

    def _yield_to_horizon(self, price, settlement, horizon, horizon_price_pct, clean=True):
        settlement = self._validate_settlement(settlement)
        horizon = to_date(horizon)
        accrued, _ = self._pricing_accrued_per100(settlement)
        dirty = price + accrued if clean else price
        cfs = [(d, a) for d, a in self._pricing_cashflows_per100(settlement) if d <= horizon]
        merged = dict(cfs)
        merged[horizon] = merged.get(horizon, 0.0) + horizon_price_pct
        cfs = sorted(merged.items())
        cp = self._current_period(settlement) if self.freq else None
        if self.freq:
            n_periods = [self._periods_from_settle(d, settlement, cp) for d, _ in cfs]
        else:
            n_periods = [(d - settlement).days / 365.0 for d, _ in cfs]
        amounts = [a for _, a in cfs]

        def pv(y):
            i = y / self._comp
            return sum(a * (1.0 + i) ** (-n) for a, n in zip(amounts, n_periods))

        y = _solve_yield(pv, dirty, self._dpv(amounts, n_periods))
        return y * 100.0

    def settlement_amount(self, clean_price, n_bonds, settlement, stamp_rate=STAMP_DUTY_TRANSFER):
        accrued, _ = self.accrued_interest_per100(settlement)
        dirty = clean_price + accrued
        principal = dirty / 100.0 * self.face_value * n_bonds
        stamp = principal * stamp_rate
        return {
            "clean_price": clean_price,
            "dirty_price": round(dirty, 6),
            "accrued_per100": round(accrued, 6),
            "principal_amount": round(principal, 2),
            "stamp_duty": round(stamp, 2),
            "settlement_amount": round(principal + stamp, 2),
        }
