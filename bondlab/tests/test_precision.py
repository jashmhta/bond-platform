import unittest
import math
from datetime import date

from bondlab.bond import Bond
from bondlab.analytics import xirr, xnpv

# ---------------------------------------------------------------------------
# Extreme-precision suite: machine-level checks + SEBI official calculator
# formula cross-check (investor.sebi.gov.in/calc/bond.html, bond.js)
# ---------------------------------------------------------------------------


def sebi_root(p, c, b, y, tol=1e-15, max_iter=300):
    """Solve SEBI's fYTM polynomial at machine precision:
    f(z) = (c+b)*z^(y+1) - b*z^y - (c+p)*z + p == 0,  z = 1/(1+r).
    The polynomial has a trivial root z=1; the financial root r>0 lies on
    the descending branch. Returns r (decimal).
    """
    def f(z):
        return (c + b) * z ** (y + 1) - b * z ** y - (c + p) * z + p

    def g(r):
        return f(1.0 / (1.0 + r))

    def dg(r):
        z = 1.0 / (1.0 + r)
        return -((y + 1) * (c + b) * z ** y - y * b * z ** (y - 1) - (c + p)) / (1.0 + r) ** 2

    lo = 1e-12
    if g(lo) >= 0:
        return 0.0  # price >= par + total coupons: no positive-yield root
    hi = None
    r = 1e-3
    for _ in range(14):
        if g(r) > 0:
            hi = r
            break
        r *= 10.0
    if hi is None:
        raise ValueError("no positive-yield root")
    x = (lo + hi) / 2
    for _ in range(max_iter):
        fv = g(x)
        if abs(fv) < tol:
            break
        if fv > 0:
            hi = min(hi, x)
        else:
            lo = max(lo, x)
        d = dg(x)
        if d == 0 or not math.isfinite(d):
            x = (lo + hi) / 2
            continue
        xn = x - fv / d
        if not (lo < xn < hi):
            xn = (lo + hi) / 2
        x = xn
    return x


class TestSebiFormulaParity(unittest.TestCase):
    """Our engine must reproduce SEBI's official calculator formula exactly
    in its special case: annual coupons, settlement on a coupon date,
    whole periods (no accrued, no fractional first period)."""

    def test_matches_sebi_root_across_prices_and_tenors(self):
        """SEBI's fYTM = (c+b)z^(y+1) - b*z^y - (c+p)*z + p factors as
        (z-1)*Q(z), Q(z) = (c+b)z^y + c(z+...+z^(y-1)) - p, i.e. y coupon
        periods with redemption AT t=y. Build the equivalent Bond (maturity
        y years out, annual coupons) and require identical yields."""
        worst = 0.0
        n = 0
        for y in range(1, 11):                      # SEBI 'y' = coupon periods to maturity
            for p in (95.0, 100.0, 108.0, 72.5):
                for c_rate in (7.0, 10.0, 12.75):
                    r_sebi = sebi_root(p, c_rate, 100.0, y)
                    settle = date(2026, 6, 10)
                    maturity = date(2026 + y, 6, 10)  # coupons at 1..y, redemption at t=y
                    b = Bond(coupon=c_rate, freq=1, face_value=100.0,
                             maturity=maturity, day_count="ACT/365F")
                    ours = b.yield_from_price(p, settle) / 100.0
                    if r_sebi == 0.0:
                        self.assertLess(ours, 1e-9)   # both see no positive-yield root
                        continue
                    worst = max(worst, abs(ours - r_sebi))
                    n += 1
                    self.assertLess(abs(ours - r_sebi), 1e-12)
        print(f"SEBI parity: {n} positive-yield cases, max |diff| = {worst:.3e} (decimal)")

    def test_par_bond_ytm_equals_coupon_exactly(self):
        for c in (7.0, 10.0, 12.75):
            for y in (1, 5, 10):
                settle = date(2026, 6, 10)
                b = Bond(coupon=c, freq=1, face_value=100.0,
                         maturity=date(2026 + y + 1, 6, 10), day_count="ACT/365F")
                self.assertAlmostEqual(b.yield_from_price(100.0, settle), c, places=12)


class TestPlatformPairMachinePrecision(unittest.TestCase):
    def test_jiraaf_satin_pair(self):
        """Platform pair (price 97.494025 <-> yield 12.30%) carries the
        platform's own rounding (price 6 dp, yield 2 dp). Our solve must be
        machine-consistent: PV residual < 1e-12, price@12.3% within the
        platform's 6-dp rounding of the quoted dirty, exact round trips."""
        settle = date(2026, 8, 18)
        b = Bond(coupon=10.75, freq=12, face_value=10000.0,
                 maturity=date(2028, 6, 10), day_count="30/360")
        quoted_dirty = 97.494025 + 10.75 * 8 / 360.0
        ytm = b.yield_from_price(97.494025, settle)

        acc, _ = b._pricing_accrued_per100(settle)
        dirty = 97.494025 + acc
        cfs = b._pricing_cashflows_per100(settle)
        cp = b._current_period(settle)
        nps = [b._periods_from_settle(d, settle, cp) for d, _ in cfs]
        residual = b._pv_per100([d for d, _ in cfs], [a for _, a in cfs], nps, ytm / 100.0) - dirty
        self.assertLess(abs(residual), 1e-12)                      # machine precision

        full = b.price_from_yield(12.3, settle)                    # unrounded price at 12.3%
        self.assertLess(abs(full - quoted_dirty), 2e-7)            # matches quoted dirty at 6 dp
        self.assertLess(abs(full - quoted_dirty), 5e-7 * quoted_dirty)  # relative guard

        self.assertLess(abs(b.yield_from_price(b.price_from_yield(ytm, settle), settle, clean=False) - ytm), 1e-11)
        self.assertLess(abs(b.yield_from_price(b.price_from_yield(12.3, settle), settle, clean=False) - 12.3), 1e-10)
        print(f"Satin: ytm={ytm:.12f}% |pv-dirty|={abs(residual):.2e} "
              f"price@12.3%={full:.12f} vs quoted dirty={quoted_dirty:.6f} "
              f"(delta {abs(full - quoted_dirty):.2e} = platform 6-dp rounding)")

    def test_zero_coupon_round_trip(self):
        settle = date(2026, 8, 18)
        b = Bond(coupon=0.0, freq=0, face_value=100.0,
                 maturity=date(2029, 8, 18), day_count="ACT/365F")
        y = b.yield_from_price(82.5, settle)
        self.assertAlmostEqual(b.price_from_yield(y, settle), 82.5, places=9)
        self.assertAlmostEqual(b.yield_from_price(b.price_from_yield(9.5, settle), settle), 9.5, places=10)

    def test_gsec_ismact_round_trip(self):
        settle = date(2026, 8, 18)
        b = Bond(coupon=6.62, freq=2, face_value=100.0,
                 maturity=date(2035, 8, 15), day_count="ACT/ACT")
        y = b.yield_from_price(96.85, settle)
        self.assertAlmostEqual(b.yield_from_price(b.price_from_yield(y, settle), settle, clean=False), y, places=11)


class TestCashflowExactness(unittest.TestCase):
    def test_spandana_payouts_exact_linear(self):
        """Every payout must equal coupon x (outstanding/100) x period-days/365
        exactly (platform IndiaBonds convention), relative error < 1e-12."""
        settle = date(2026, 8, 18)
        b = Bond(coupon=11.25, freq=12, face_value=10000.0,
                 maturity=date(2028, 4, 26), day_count="30/360",
                 interest_basis="ACT/365F",
                 redemptions=[(date(2026, 10, 26), 25.0),
                              (date(2027, 4, 26), 25.0),
                              (date(2027, 10, 26), 25.0),
                              (date(2028, 4, 26), 25.0)])
        pay = b.cashflows_per100(settle)
        n = 0
        for d, amt in pay:
            pp = next((x for x in b._periods if x.payment == d), None)
            red = sum(pct for rd, pct in b.redemptions if rd == d)
            if pp is None and red == 0:
                continue
            coupon_leg = amt - red
            bal = 100.0 - sum(pct for rd, pct in b.redemptions if rd < d)
            exp = 11.25 * (bal / 100.0) * (pp.accrual_end - pp.accrual_start).days / 365.0
            self.assertLess(abs(coupon_leg - exp), 1e-12 * exp)
            n += 1
        self.assertEqual(n, len(pay))
        print("Spandana payouts: exact linear actual/365 on outstanding balance (<1e-12 relative)")

    def test_xirr_self_consistency(self):
        settle = date(2026, 8, 18)
        b = Bond(coupon=11.25, freq=12, face_value=10000.0,
                 maturity=date(2028, 4, 26), day_count="30/360",
                 interest_basis="ACT/365F",
                 redemptions=[(date(2026, 10, 26), 25.0),
                              (date(2027, 4, 26), 25.0),
                              (date(2027, 10, 26), 25.0),
                              (date(2028, 4, 26), 25.0)])
        dirty = 99.0 + b.accrued_interest_per100(settle)[0]
        cfs = [(settle, -dirty)] + [(d, a) for d, a in b.cashflows_per100(settle)]
        r = xirr(cfs)                                   # already percent
        residual = xnpv(r, cfs)
        self.assertLess(abs(residual), 1e-9 * dirty)
        self.assertGreater(r, 5.0)
        print(f"XIRR: {r:.10f}%  xnpv residual = {residual:.3e}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
