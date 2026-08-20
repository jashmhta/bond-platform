import json
import math
import unittest
from datetime import date

from bondlab import Bond
from bondlab.daycount import days_30_360, year_fraction, year_fraction_act_act_isda
from bondlab.schedule import generate_schedule
from bondlab.analytics import (
    current_yield,
    macaulay_duration,
    modified_duration,
    convexity,
    yield_movement,
    xirr,
    effective_annual_yield,
)
from bondlab.tax import post_tax_xirr

TOL = 1e-10


class TestDayCount(unittest.TestCase):
    def test_30_360_us(self):
        self.assertEqual(days_30_360(date(2023, 1, 31), date(2023, 2, 28)), 28)
        self.assertEqual(days_30_360(date(2023, 2, 28), date(2023, 3, 31)), 33)
        self.assertEqual(days_30_360(date(2023, 1, 15), date(2023, 7, 15)), 180)
        self.assertEqual(days_30_360(date(2023, 5, 31), date(2023, 6, 30)), 30)
        self.assertEqual(days_30_360(date(2024, 1, 31), date(2024, 3, 31)), 60)

    def test_30_360_euro(self):
        self.assertEqual(days_30_360(date(2023, 1, 31), date(2023, 3, 31), euro=True), 60)
        self.assertEqual(days_30_360(date(2024, 2, 29), date(2024, 3, 31), euro=True), 31)

    def test_act_act_isda(self):
        self.assertAlmostEqual(year_fraction_act_act_isda(date(2023, 1, 1), date(2024, 1, 1)), 1.0, places=12)
        self.assertAlmostEqual(year_fraction_act_act_isda(date(2024, 1, 1), date(2025, 1, 1)), 1.0, places=12)
        expected = 184 / 365 + 182 / 366
        self.assertAlmostEqual(year_fraction_act_act_isda(date(2023, 7, 1), date(2024, 7, 1)), expected, places=12)
        self.assertAlmostEqual(year_fraction_act_act_isda(date(2024, 1, 15), date(2024, 7, 15)), 182 / 366, places=12)
        self.assertEqual(year_fraction_act_act_isda(date(2024, 5, 5), date(2024, 5, 5)), 0.0)


class TestSchedule(unittest.TestCase):
    def test_regular_annual(self):
        ps = generate_schedule(date(2030, 6, 30), 1, issue=date(2025, 6, 30))
        self.assertEqual([p.accrual_end for p in ps][-1], date(2030, 6, 30))
        self.assertEqual(len(ps), 5)
        self.assertEqual(ps[0].accrual_start, date(2025, 6, 30))

    def test_semiannual(self):
        ps = generate_schedule(date(2028, 2, 15), 2)
        self.assertEqual(ps[-1].accrual_start, date(2027, 8, 15))
        self.assertEqual(ps[-1].accrual_end, date(2028, 2, 15))

    def test_odd_first_coupon(self):
        ps = generate_schedule(
            date(2030, 5, 15), 1, issue=date(2026, 9, 15), first_coupon=date(2027, 5, 15)
        )
        self.assertEqual(ps[0].accrual_start, date(2026, 9, 15))
        self.assertEqual(ps[0].accrual_end, date(2027, 5, 15))
        self.assertEqual(ps[1].accrual_end, date(2028, 5, 15))
        self.assertEqual(ps[-1].accrual_end, date(2030, 5, 15))

    def test_day_capping(self):
        ps = generate_schedule(date(2029, 8, 31), 2)
        self.assertEqual(ps[-1].accrual_start, date(2029, 2, 28))
        self.assertEqual(ps[-2].accrual_end, date(2029, 2, 28))


class TestAccrued(unittest.TestCase):
    def test_gsec_mid_period(self):
        b = Bond(maturity=date(2028, 2, 15), coupon=7.10, freq=2, face_value=100.0)
        settle = date(2026, 9, 14)
        acc, days = b.accrued_interest_per100(settle)
        period_days = (date(2027, 2, 15) - date(2026, 8, 15)).days
        elapsed = (settle - date(2026, 8, 15)).days
        self.assertEqual(days, elapsed)
        self.assertAlmostEqual(acc, 7.10 / 2 * elapsed / period_days, places=12)

    def test_on_coupon_date_zero(self):
        b = Bond(maturity=date(2028, 2, 15), coupon=7.10, freq=2, face_value=100.0)
        acc, days = b.accrued_interest_per100(date(2026, 8, 15))
        self.assertEqual(acc, 0.0)
        self.assertEqual(days, 0)

    def test_30_360_clean_half_year(self):
        b = Bond(maturity=date(2028, 1, 1), coupon=12.0, freq=1, day_count="30/360")
        acc, days = b.accrued_interest_per100(date(2027, 7, 1))
        self.assertEqual(days, 180)
        self.assertAlmostEqual(acc, 6.0, places=12)

    def test_zero_coupon(self):
        b = Bond(maturity=date(2029, 3, 1), coupon=0.0, freq=0)
        acc, _ = b.accrued_interest_per100(date(2026, 8, 15))
        self.assertEqual(acc, 0.0)


class TestPricing(unittest.TestCase):
    def test_par_yield_on_coupon_date(self):
        b = Bond(maturity=date(2031, 6, 30), coupon=8.0, freq=1)
        self.assertAlmostEqual(b.price_from_yield(8.0, date(2026, 6, 30)), 100.0, places=10)

    def test_closed_form_annual(self):
        b = Bond(maturity=date(2028, 6, 30), coupon=10.0, freq=1)
        expected = 10 / 1.12 + 110 / 1.12**2
        self.assertAlmostEqual(b.price_from_yield(12.0, date(2026, 6, 30)), expected, places=10)

    def test_closed_form_semi_on_coupon_date(self):
        b = Bond(maturity=date(2028, 2, 15), coupon=7.10, freq=2, face_value=100.0)
        y = 0.0725
        expected = sum(
            3.55 / (1 + y / 2) ** k for k in (1, 2, 3)
        ) + 100 / (1 + y / 2) ** 3
        self.assertAlmostEqual(b.price_from_yield(7.25, date(2026, 8, 15)), expected, places=10)

    def test_street_fractional_period(self):
        b = Bond(maturity=date(2028, 2, 15), coupon=7.10, freq=2, face_value=100.0)
        settle = date(2026, 9, 14)
        w = (date(2027, 2, 15) - settle).days / (date(2027, 2, 15) - date(2026, 8, 15)).days
        y = 0.0700
        expected = (
            3.55 / (1 + y / 2) ** w
            + 3.55 / (1 + y / 2) ** (w + 1)
            + 103.55 / (1 + y / 2) ** (w + 2)
        )
        self.assertAlmostEqual(b.price_from_yield(7.0, settle), expected, places=10)

    def test_30_360_fractional(self):
        b = Bond(maturity=date(2029, 9, 10), coupon=9.25, freq=1, day_count="30/360")
        settle = date(2026, 8, 15)
        y = 0.085
        n1 = 360 - 335
        n1 = year_fraction(settle, date(2026, 9, 10), "30/360")
        n2 = year_fraction(settle, date(2027, 9, 10), "30/360")
        n3 = year_fraction(settle, date(2028, 9, 10), "30/360")
        n4 = year_fraction(settle, date(2029, 9, 10), "30/360")
        expected = (
            9.25 / (1 + y) ** n1
            + 9.25 / (1 + y) ** n2
            + 9.25 / (1 + y) ** n3
            + 109.25 / (1 + y) ** n4
        )
        self.assertAlmostEqual(b.price_from_yield(8.5, settle), expected, places=10)

    def test_zero_coupon(self):
        b = Bond(maturity=date(2033, 2, 15), coupon=0.0, freq=0)
        settle = date(2026, 8, 15)
        t = (date(2033, 2, 15) - settle).days / 365.0
        self.assertAlmostEqual(b.price_from_yield(7.0, settle), 100 / 1.07**t, places=10)


class TestYieldSolver(unittest.TestCase):
    def test_round_trip_semi(self):
        b = Bond(maturity=date(2028, 2, 15), coupon=7.10, freq=2, face_value=100.0)
        settle = date(2026, 9, 14)
        for target in (2.0, 7.1, 12.5):
            dirty = b.price_from_yield(target, settle)
            acc, _ = b.accrued_interest_per100(settle)
            clean = dirty - acc
            y = b.yield_from_price(clean, settle)
            self.assertAlmostEqual(y, target, places=10)

    def test_round_trip_corporate(self):
        b = Bond(maturity=date(2029, 9, 10), coupon=9.25, freq=1, day_count="30/360")
        settle = date(2026, 8, 15)
        for target in (5.0, 9.25, 14.0):
            dirty = b.price_from_yield(target, settle)
            acc, _ = b.accrued_interest_per100(settle)
            y = b.yield_from_price(dirty - acc, settle)
            self.assertAlmostEqual(y, target, places=10)

    def test_round_trip_zero(self):
        b = Bond(maturity=date(2033, 2, 15), coupon=0.0, freq=0)
        settle = date(2026, 8, 15)
        for target in (4.0, 9.0):
            price = b.price_from_yield(target, settle)
            self.assertAlmostEqual(b.yield_from_price(price, settle, clean=False), target, places=10)

    def test_deep_discount_and_premium(self):
        b = Bond(maturity=date(2036, 6, 30), coupon=5.0, freq=1)
        for target in (0.5, 18.0):
            dirty = b.price_from_yield(target, date(2026, 6, 30))
            self.assertAlmostEqual(b.yield_from_price(dirty, date(2026, 6, 30), clean=False), target, places=10)


class TestAnalytics(unittest.TestCase):
    def test_current_yield(self):
        self.assertAlmostEqual(current_yield(9.0, 98.5), 9.0 / 98.5 * 100, places=10)

    def test_duration_fd(self):
        b = Bond(maturity=date(2031, 8, 15), coupon=7.10, freq=2)
        settle = date(2026, 8, 15)
        y = 7.4
        h = 1e-6
        p0 = b.price_from_yield(y, settle)
        p_up = b.price_from_yield(y + h, settle)
        p_dn = b.price_from_yield(y - h, settle)
        mod_fd = (p_dn - p_up) / (2 * h) / p0 * 100.0
        mod, _ = modified_duration(b, y, settle)
        self.assertAlmostEqual(mod, mod_fd, places=6)

    def test_convexity_fd(self):
        b = Bond(maturity=date(2031, 8, 15), coupon=7.10, freq=2)
        settle = date(2026, 8, 15)
        y = 7.4
        h = 1e-2
        p0 = b.price_from_yield(y, settle)
        p_up = b.price_from_yield(y + h, settle)
        p_dn = b.price_from_yield(y - h, settle)
        conv_fd = (p_up + p_dn - 2 * p0) / (h**2) / p0 * 10000.0
        conv, _ = convexity(b, y, settle)
        self.assertAlmostEqual(conv, conv_fd, places=4)

    def test_zero_coupon_duration_equals_maturity(self):
        b = Bond(maturity=date(2031, 8, 15), coupon=0.0, freq=0)
        settle = date(2026, 8, 15)
        mac, _ = macaulay_duration(b, 7.0, settle)
        t = (date(2031, 8, 15) - settle).days / 365.0
        self.assertAlmostEqual(mac, t, places=10)

    def test_yield_movement_monotonic(self):
        b = Bond(maturity=date(2029, 6, 30), coupon=8.0, freq=1)
        rows = yield_movement(b, 8.0, date(2026, 8, 15))
        prices = [r["price"] for r in rows]
        self.assertEqual(prices, sorted(prices))

    def test_xirr_simple(self):
        r = xirr([(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 1100.0)])
        self.assertAlmostEqual(r, 10.0, places=8)

    def test_xirr_monthly_coupons(self):
        from datetime import timedelta
        cfs = [(date(2026, 1, 1), -100000.0)]
        d = date(2026, 1, 1)
        for k in range(1, 18):
            cfs.append((d + timedelta(days=30 * k), 1000.0))
        cfs.append((d + timedelta(days=510), 101000.0))
        r = xirr(cfs)
        self.assertTrue(11.0 < r < 14.0)

    def test_xnpv_exact(self):
        from bondlab.analytics import xnpv
        self.assertAlmostEqual(xnpv(10.0, [(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 1100.0)]), 0.0, places=10)
        self.assertAlmostEqual(xnpv(0.0, [(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 1000.0)]), 0.0, places=10)
        self.assertAlmostEqual(
            xnpv(0.0, [(date(2025, 1, 1), -500.0), (date(2025, 6, 1), 300.0), (date(2026, 1, 1), 250.0)]),
            50.0, places=10)

    def test_xnpv_xirr_round_trip(self):
        from bondlab.analytics import xnpv
        cases = [
            [(date(2026, 1, 1), -100000.0), (date(2026, 2, 1), 1000.0), (date(2026, 4, 1), 1000.0), (date(2027, 1, 1), 101000.0)],
            [(date(2024, 3, 15), -50000.0), (date(2024, 9, 15), 5000.0), (date(2025, 3, 15), 55000.0)],
            [(date(2020, 1, 1), -1000.0), (date(2021, 1, 1), 600.0), (date(2022, 1, 1), 600.0)],
        ]
        for cfs in cases:
            r = xirr(cfs)
            npv = xnpv(r, cfs)
            self.assertLess(abs(npv), 1e-4, f"xnpv(xirr) = {npv} for rate {r}")

    def test_effective_annual(self):
        self.assertAlmostEqual(effective_annual_yield(8.0, 2), ((1.04) ** 2 - 1) * 100, places=10)


class TestFeatures(unittest.TestCase):
    def test_settlement_amount_math(self):
        b = Bond(maturity=date(2029, 9, 10), coupon=9.25, freq=1, day_count="30/360", face_value=1000.0)
        settle = date(2026, 8, 15)
        clean = 98.5
        acc, _ = b.accrued_interest_per100(settle)
        res = b.settlement_amount(clean, 10, settle)
        principal = (clean + acc) / 100 * 1000 * 10
        self.assertAlmostEqual(res["principal_amount"], round(principal, 2), places=2)
        self.assertAlmostEqual(res["stamp_duty"], round(principal * 0.000001, 2), places=2)
        self.assertAlmostEqual(res["settlement_amount"], round(principal + principal * 0.000001, 2), places=2)

    def test_staggered_redemption(self):
        b = Bond(
            maturity=date(2031, 6, 30),
            coupon=8.0,
            freq=1,
            redemptions=[(date(2030, 6, 30), 50.0), (date(2031, 6, 30), 50.0)],
        )
        cfs = dict(b.cashflows_per100(date(2026, 8, 15)))
        self.assertAlmostEqual(cfs[date(2030, 6, 30)], 58.0, places=10)
        self.assertAlmostEqual(cfs[date(2031, 6, 30)], 54.0, places=10)

    def test_yield_to_call_par(self):
        b = Bond(maturity=date(2029, 6, 30), coupon=8.0, freq=1, calls=[(date(2027, 6, 30), 100.0)])
        ytc = b.yield_to_call(100.0, date(2026, 6, 30))
        self.assertAlmostEqual(ytc[0][1], 8.0, places=8)

    def test_yield_to_worst(self):
        b = Bond(maturity=date(2029, 6, 30), coupon=8.0, freq=1, calls=[(date(2027, 6, 30), 100.0)])
        kind, hd, yw = b.yield_to_worst(101.0, date(2026, 6, 30))
        self.assertEqual(kind, "call")
        ytm = b.yield_from_price(101.0, date(2026, 6, 30))
        self.assertLess(yw, ytm)

    def test_post_tax(self):
        b = Bond(maturity=date(2031, 6, 30), coupon=9.0, freq=1, day_count="30/360", face_value=1000.0)
        r, cfs = post_tax_xirr(b, date(2026, 6, 30), 100.0, slab_rate=0.3)
        self.assertTrue(0 < r < 9.0)
        total_in = sum(a for a, _ in cfs if a > 0)
        total_out = -sum(a for a, _ in cfs if a < 0)
        self.assertGreater(total_in, total_out)

    def test_settlement_validation(self):
        b = Bond(maturity=date(2028, 6, 30), coupon=8.0, freq=1)
        with self.assertRaises(ValueError):
            b.price_from_yield(8.0, date(2029, 1, 1))


class TestPlatformCases(unittest.TestCase):
    def test_indiabonds_style_gsec(self):
        b = Bond(maturity=date(2033, 8, 15), coupon=7.18, freq=2, face_value=100.0, day_count="ACT/ACT")
        settle = date(2026, 8, 17)
        acc, days = b.accrued_interest_per100(settle)
        self.assertEqual(days, 2)
        dirty = b.price_from_yield(7.05, settle)
        y = b.yield_from_price(dirty - acc, settle)
        self.assertAlmostEqual(y, 7.05, places=9)

    def test_ncd_indiabonds_style(self):
        b = Bond(maturity=date(2032, 3, 20), coupon=9.85, freq=1, day_count="30/360", face_value=1000.0)
        settle = date(2026, 8, 15)
        for target in (7.0, 9.85, 11.5):
            dirty = b.price_from_yield(target, settle)
            acc, _ = b.accrued_interest_per100(settle)
            self.assertAlmostEqual(b.yield_from_price(dirty - acc, settle), target, places=9)

    def test_quarterly_coupon(self):
        b = Bond(maturity=date(2028, 5, 1), coupon=8.0, freq=4, face_value=100.0)
        settle = date(2026, 9, 1)
        acc, _ = b.accrued_interest_per100(settle)
        dirty = b.price_from_yield(8.2, settle)
        self.assertAlmostEqual(b.yield_from_price(dirty - acc, settle), 8.2, places=9)


if __name__ == "__main__":
    unittest.main()
