/* Deal math helpers — schedule-aware accrued days + annual-compounding YTM solver. */

export const FREQ_BY_PAYMENT: Record<string, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  "SEMI-ANNUALLY": 2,
  ANNUALLY: 1,
  CUMULATIVE: 0,
};

/**
 * Anchor-based month arithmetic: `maturity` shifted by `shift` months keeps its
 * original day-of-month whenever the target month allows it (no drift via Feb).
 */
function shiftMonths(anchor: Date, shift: number): Date {
  const total = anchor.getUTCMonth() + shift;
  const year = anchor.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), dim)));
}

/** Last coupon date on or before settlement (periods counted back from maturity). */
export function lastCouponDate(maturity: Date, freq: number, settle: Date): Date {
  if (!(freq > 0)) return new Date(maturity);
  const step = Math.max(1, Math.round(12 / freq));
  const d = (n: number): Date => (n <= 0 ? new Date(maturity) : shiftMonths(maturity, -n * step));
  let j = Math.max(0, Math.ceil(((maturity.getTime() - settle.getTime()) / 86400000 / 365.25) * freq) - 2);
  let guard = 0;
  while (d(j).getTime() > settle.getTime() && guard++ < 5000) j++;
  guard = 0;
  while (j > 0 && d(j - 1).getTime() <= settle.getTime() && guard++ < 5000) j--;
  return d(j);
}

/**
 * Auto accrued-interest days (ACT) from previous coupon date to settlement.
 * Returns null when maturity or a valid frequency is missing.
 */
export function autoInterestDays(
  maturityIso: string | null | undefined,
  paymentDates: string,
  settleIso: string
): number | null {
  const freq = FREQ_BY_PAYMENT[paymentDates] ?? 0;
  if (!freq || !maturityIso || !settleIso) return null;
  const maturity = new Date(`${maturityIso}T00:00:00.000Z`);
  const settle = new Date(`${settleIso}T00:00:00.000Z`);
  if (Number.isNaN(maturity.getTime()) || Number.isNaN(settle.getTime())) return null;
  if (settle >= maturity) return null;
  const last = lastCouponDate(maturity, freq, settle);
  return Math.max(0, Math.round((settle.getTime() - last.getTime()) / 86400000));
}

/** Cash-flow dates per unit: coupons at each period end + face redemption at maturity. */
function cashflows(
  maturity: Date,
  freq: number,
  couponPct: number,
  face: number,
  settle: Date
): Array<{ t: number; amount: number }> {
  const step = Math.max(1, Math.round(12 / freq));
  const dates: Date[] = [];
  let k = 0;
  let cur = new Date(maturity);
  while (cur > settle && dates.length < 400) {
    dates.push(cur);
    k += step;
    cur = shiftMonths(maturity, -k);
  }
  const couponAmt = (face * couponPct) / 100 / freq;
  // dates[0] is maturity → redemption lands there; every other date is a plain coupon
  return dates.map((d, i) => ({
    t: (d.getTime() - settle.getTime()) / 86400000 / 365,
    amount: i === 0 ? couponAmt + face : couponAmt,
  }));
}

/** Stamp duty slab: Rs.1 per Rs.10 lakh (or part) from Rs.5 lakh.
 *  <500k→0, 500k-1,499,999.99→1, 1.5M-2,499,999.99→2, etc.
 *  Formula: floor((amount-500000)/1_000_000)+1 for amount>=500000.
 */
export function calcStampDuty(amount: number): number {
  const a = Math.round(amount * 100) / 100;
  if (!(a >= 500000)) return 0;
  return Math.floor((a - 500000) / 1000000) + 1;
}

/** Bisection YTM (annual compounding, ACT/365 time). priceClean is per unit; accrued added inside. */
export function ytmPercent(opts: {
  priceClean: number;
  accruedPerUnit: number;
  facePerUnit: number;
  couponRatePct: number;
  maturityIso: string | null | undefined;
  paymentDates: string;
  settleIso: string;
}): number | null {
  const { priceClean, accruedPerUnit, facePerUnit, couponRatePct, maturityIso, paymentDates, settleIso } = opts;
  if (!(priceClean > 0) || !maturityIso || !settleIso) return null;
  const maturity = new Date(`${maturityIso}T00:00:00.000Z`);
  const settle = new Date(`${settleIso}T00:00:00.000Z`);
  if (Number.isNaN(maturity.getTime()) || Number.isNaN(settle.getTime()) || settle >= maturity) return null;

  const freq = FREQ_BY_PAYMENT[paymentDates] ?? 0;
  const dirty = priceClean + accruedPerUnit;
  const pvAt = (y: number): number => {
    if (freq === 0) {
      const yrs = (maturity.getTime() - settle.getTime()) / 86400000 / 365;
      return facePerUnit / Math.pow(1 + y, yrs);
    }
    return cashflows(maturity, freq, couponRatePct, facePerUnit, settle)
      .reduce((acc, cf) => acc + cf.amount / Math.pow(1 + y, Math.max(cf.t, 0)), 0);
  };

  let lo = 1e-6, hi = 3;
  if (pvAt(hi) - dirty > 0) return null; // even 300% yield too cheap → data inconsistent
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fmid = pvAt(mid) - dirty;
    if (fmid > 0) lo = mid; else hi = mid;
  }
  const ytm = ((lo + hi) / 2) * 100;
  return Number.isFinite(ytm) ? Math.round(ytm * 100) / 100 : null;
}
