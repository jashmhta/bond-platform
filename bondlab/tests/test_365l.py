import unittest
from datetime import date

from bondlab import Bond
from bondlab.daycount import (
    year_fraction_act_365l,
    year_fraction,
    act_365l_denom,
    year_fraction_act_365f,
)

TOL = 1e-12


class TestAct365L(unittest.TestCase):
    def test_year_fraction_full_years(self):
        self.assertEqual(year_fraction_act_365l(date(2023, 1, 1), date(2024, 1, 1)), 1.0)
        self.assertEqual(year_fraction_act_365l(date(2024, 1, 1), date(2025, 1, 1)), 1.0)

    def test_leap_day_denominator(self):
        self.assertAlmostEqual(year_fraction_act_365l(date(2024, 2, 28), date(2024, 3, 1)), 2 / 366.0)
        self.assertAlmostEqual(year_fraction_act_365l(date(2023, 2, 28), date(2023, 3, 1)), 1 / 365.0)
        self.assertEqual(act_365l_denom(date(2024, 2, 28), date(2024, 3, 1)), 366.0)
        self.assertEqual(act_365l_denom(date(2023, 2, 28), date(2023, 3, 1)), 365.0)

    def test_year_fraction_router(self):
        self.assertAlmostEqual(year_fraction(date(2024, 2, 28), date(2024, 3, 1), "ACT/365L"), 2 / 366.0)

    def test_bond_constructs_with_365l(self):
        b = Bond(coupon=10.75, freq=12, face_value=10000.0, maturity=date(2028, 6, 10),
                 day_count="ACT/365L", interest_basis="ACT/365L")
        self.assertEqual(b.day_count, "ACT/365L")
        self.assertEqual(b.interest_basis, "ACT/365L")

    def test_roundtrip_price_yield_365l(self):
        mat = date(2028, 6, 10)
        settle = date(2026, 8, 18)
        b = Bond(coupon=10.75, freq=12, face_value=10000.0, maturity=mat,
                 day_count="ACT/365L", interest_basis="ACT/365L")
        y = b.yield_from_price(97.732913888889, settle)
        p_dirty = b.price_from_yield(y, settle)
        y2 = b.yield_from_price(p_dirty, settle, clean=False)
        self.assertAlmostEqual(y2, y, places=9)

    def test_365l_vs_365f_differ_across_leap_day(self):
        mat = date(2024, 8, 10)
        settle = date(2024, 3, 1)
        f = Bond(coupon=10.75, freq=12, face_value=10000.0, maturity=mat,
                 day_count="ACT/365F", interest_basis="ACT/365F")
        l = Bond(coupon=10.75, freq=12, face_value=10000.0, maturity=mat,
                 day_count="ACT/365L", interest_basis="ACT/365L")
        yf = f.yield_from_price(100.0, settle)
        yl = l.yield_from_price(100.0, settle)
        self.assertNotAlmostEqual(yf, yl, places=8)
        self.assertLess(abs(yf - yl), 1.0)
        self.assertEqual(f.accrued_interest_per100(settle)[0] * 365.0 / 366.0,
                         l.accrued_interest_per100(settle)[0])
        self.assertNotEqual(f.cashflows_per100(settle)[0][1], l.cashflows_per100(settle)[0][1])

    def test_365l_near_par_close_to_platform_ytm(self):
        mat = date(2028, 6, 10)
        settle = date(2026, 8, 18)
        b = Bond(coupon=10.75, freq=12, face_value=10000.0, maturity=mat,
                 day_count="ACT/365L", interest_basis="ACT/365L")
        y = b.yield_from_price(97.732913888889, settle)
        self.assertGreater(y, 11.9)
        self.assertLess(y, 12.4)

    def test_year_fraction_365f_unchanged(self):
        self.assertAlmostEqual(year_fraction_act_365f(date(2024, 2, 28), date(2024, 3, 1)), 2 / 365.0)


if __name__ == "__main__":
    unittest.main()
