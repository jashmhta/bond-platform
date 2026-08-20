import math
import random
import unittest
from datetime import date, timedelta

from bondlab import Bond
from bondlab.analytics import modified_duration, convexity


class TestFuzzRoundTrip(unittest.TestCase):
    def test_price_yield_round_trips(self):
        rng = random.Random(20260815)
        checked = 0
        for _ in range(1500):
            freq = rng.choice([0, 1, 2, 4])
            settle = date(2026, 1, 1) + timedelta(days=rng.randrange(0, 700))
            mat = settle + timedelta(days=rng.randrange(200, 5000))
            if freq == 0:
                coupon = 0.0
            else:
                coupon = round(rng.uniform(0.5, 14.0), 3)
            dc = rng.choice(["ACT/ACT", "30/360"])
            b = Bond(maturity=mat, coupon=coupon, freq=freq, day_count=dc)
            try:
                acc, _ = b.accrued_interest_per100(settle)
            except ValueError:
                continue
            target = round(rng.uniform(0.8, 22.0), 4)
            try:
                dirty = b.price_from_yield(target, settle)
                clean = dirty - acc
                if not (1.0 < clean < 400.0):
                    continue
                y = b.yield_from_price(clean, settle)
            except ValueError:
                continue
            self.assertAlmostEqual(y, target, places=8,
                                   msg=f"freq={freq} dc={dc} settle={settle} mat={mat} coupon={coupon} target={target}")
            checked += 1
        self.assertGreater(checked, 1200)

    def test_duration_convexity_fd_random(self):
        rng = random.Random(7)
        checked = 0
        for _ in range(120):
            freq = rng.choice([1, 2])
            settle = date(2026, 3, 1) + timedelta(days=rng.randrange(0, 400))
            mat = settle + timedelta(days=rng.randrange(365, 4000))
            b = Bond(maturity=mat, coupon=round(rng.uniform(1.0, 13.0), 2), freq=freq)
            try:
                y = round(rng.uniform(3.0, 13.0), 2)
                p0 = b.price_from_yield(y, settle)
                if not (5.0 < p0 < 300.0):
                    continue
                mod, _ = modified_duration(b, y, settle)
                conv, _ = convexity(b, y, settle)
            except ValueError:
                continue
            h = 1e-4
            p_up = b.price_from_yield(y + h, settle)
            p_dn = b.price_from_yield(y - h, settle)
            mod_fd = (p_dn - p_up) / (2 * h) / p0 * 100.0
            h2 = 1e-2
            p0b = b.price_from_yield(y, settle)
            p_up2 = b.price_from_yield(y + h2, settle)
            p_dn2 = b.price_from_yield(y - h2, settle)
            conv_fd = (p_up2 + p_dn2 - 2 * p0b) / (h2**2) / p0b * 10000.0
            self.assertLess(abs(mod - mod_fd) / max(mod, 1e-9), 1e-6)
            self.assertLess(abs(conv - conv_fd) / max(conv, 1e-9), 1e-5)
            checked += 1
        self.assertGreater(checked, 90)

    def test_dirty_equals_pv_of_cashflows(self):
        rng = random.Random(99)
        for _ in range(300):
            settle = date(2026, 2, 1) + timedelta(days=rng.randrange(0, 600))
            mat = settle + timedelta(days=rng.randrange(100, 3000))
            b = Bond(maturity=mat, coupon=round(rng.uniform(2.0, 12.0), 3), freq=2)
            try:
                acc, _ = b.accrued_interest_per100(settle)
            except ValueError:
                continue
            y = rng.uniform(3.0, 12.0)
            dirty = b.price_from_yield(y, settle)
            cfs = b.cashflows_per100(settle)
            cp = b._current_period(settle)
            w = (cp.accrual_end - settle).days / (cp.accrual_end - cp.accrual_start).days
            pay_dates = [p.payment for p in b._periods if p.payment > settle]
            pv = 0.0
            for d, a in cfs:
                n = w + pay_dates.index(d) if d in pay_dates else w + len(pay_dates)
                pv += a / (1 + y / 200.0) ** n
            self.assertAlmostEqual(dirty, pv, places=9)


if __name__ == "__main__":
    unittest.main()
