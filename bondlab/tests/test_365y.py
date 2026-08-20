import unittest
from datetime import date

from bondlab import Bond
from bondlab.analytics import xirr
from bondlab.daycount import year_fraction, year_fraction_act_365y
from bondlab.schedule import generate_schedule


class TestAct365Y(unittest.TestCase):
    def test_year_fraction(self):
        # leap year of END date drives denominator
        self.assertAlmostEqual(year_fraction(date(2026, 8, 15), date(2026, 8, 20), "ACT/365Y"), 5 / 365.0, places=12)
        self.assertAlmostEqual(year_fraction(date(2027, 12, 15), date(2028, 1, 15), "ACT/365Y"), 31 / 366.0, places=12)
        self.assertAlmostEqual(year_fraction_act_365y(date(2028, 2, 15), date(2028, 3, 31)), 45 / 366.0, places=12)
        self.assertAlmostEqual(year_fraction_act_365y(date(2028, 6, 1), date(2029, 6, 1)), 365 / 365.0, places=12)

    def test_forward_schedule_stub(self):
        # Navi Finserv 10.30%: coupons on the 15th, final stub 2028-03-31
        ps = generate_schedule(date(2028, 3, 31), 12, issue=date(2026, 6, 15), first_coupon=date(2026, 7, 15))
        ends = [p.accrual_end for p in ps]
        self.assertEqual(ends[0], date(2026, 7, 15))
        self.assertEqual(ends[1], date(2026, 8, 15))
        self.assertEqual(ends[-2], date(2028, 2, 15))
        self.assertEqual(ends[-1], date(2028, 3, 31))
        self.assertNotIn(date(2028, 3, 15), ends)

    def test_forward_schedule_in_cycle(self):
        # first_coupon consistent with maturity (annual 15-May) still works
        ps = generate_schedule(date(2030, 5, 15), 1, issue=date(2026, 9, 15), first_coupon=date(2027, 5, 15))
        self.assertEqual(ps[0].accrual_start, date(2026, 9, 15))
        self.assertEqual(ps[0].accrual_end, date(2027, 5, 15))
        self.assertEqual(ps[1].accrual_end, date(2028, 5, 15))
        self.assertEqual(ps[-1].accrual_end, date(2030, 5, 15))


class TestSampleCashflow(unittest.TestCase):
    """Reproduces Sample cashflow.xlsx (Navi Finserv 10.30% monthly, INE342T07718)."""

    def setUp(self):
        self.b = Bond(
            maturity=date(2028, 3, 31),
            coupon=10.3,
            freq=12,
            face_value=10000,
            issue=date(2026, 6, 15),
            first_coupon=date(2026, 7, 15),
            day_count="ACT/365Y",
            interest_basis="ACT/365Y",
        )
        self.sd = date(2026, 8, 20)
        self.clean = 100.1256

    def test_accrued(self):
        acc, days = self.b.accrued_interest_per100(self.sd)
        self.assertEqual(days, 5)
        self.assertAlmostEqual(acc, 0.1410958904109589, places=10)

    def test_total_consideration(self):
        acc, _ = self.b.accrued_interest_per100(self.sd)
        total = 10000 * self.clean / 100 + acc * 10000 / 100
        self.assertAlmostEqual(total, 10026.669589041096, places=8)

    def test_coupon_schedule_matches_excel(self):
        excel = {
            "2026-09-15": 87.479452, "2026-10-15": 84.657534, "2026-11-15": 87.479452, "2026-12-15": 84.657534,
            "2027-01-15": 87.479452, "2027-02-15": 87.479452, "2027-03-15": 79.013699, "2027-04-15": 87.479452,
            "2027-05-15": 84.657534, "2027-06-15": 87.479452, "2027-07-15": 84.657534, "2027-08-15": 87.479452,
            "2027-09-15": 87.479452, "2027-10-15": 84.657534, "2027-11-15": 87.479452, "2027-12-15": 84.657534,
            "2028-01-15": 87.240437, "2028-02-15": 87.240437, "2028-03-31": 126.639344,
        }
        cfs = self.b.cashflows_per100(self.sd)
        self.assertEqual(len(cfs), len(excel))
        for d, amt in cfs:
            k = d.isoformat()
            coupon_part = amt - 100.0 if k == "2028-03-31" else amt
            self.assertAlmostEqual(coupon_part * 100.0, excel[k], delta=1e-4)

    def test_xirr_matches_excel(self):
        acc, _ = self.b.accrued_interest_per100(self.sd)
        total = 10000 * self.clean / 100 + acc * 10000 / 100
        cfs = self.b.cashflows_per100(self.sd)
        flows = [[self.sd, -total]] + [[d, a * 100.0] for d, a in cfs]
        self.assertAlmostEqual(xirr(flows), 10.699983, delta=0.001)


if __name__ == "__main__":
    unittest.main()
