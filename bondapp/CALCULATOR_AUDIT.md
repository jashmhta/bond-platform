# Calculator Audit — BondLab vs Platform Calculators

**Date:** 2026-08-18 · Basis: live platform pages/APIs (IndiaBonds public API, SEBI calculator page,
Jiraaf bond pages, SMEST explore, Wint Wealth) + live cross-validation of 95 bonds.

## A. Field-level matrix (what each calculator takes and shows)

| Field | IndiaBonds | SEBI | Wint | SMEST | Jiraaf | **BondLab** |
|---|---|---|---|---|---|---|
| Bond search by ISIN/name | ✓ | — | ✓ | ✓ | ✓ | ✓ (search + filters) |
| Clean price per ₹100 (input) | ✓ | — | — | — | — | ✓ |
| Yield % (input) | ✓ (to call) | — | — | — | — | ✓ |
| **Price ⇄ Yield swap** | ✓ | — | — | — | — | ✓ (live 2-way) |
| Par / face value | built-in | ✓ | built-in | built-in | built-in | ✓ (+ balance-FV support) |
| Coupon rate | built-in | ✓ | built-in | built-in | built-in | ✓ |
| Coupon frequency | built-in | — | built-in | built-in | built-in | ✓ (Monthly/Quarterly/Semi/Annual/Zero) |
| Years/maturity | built-in | ✓ | built-in | built-in | built-in | ✓ (exact date) |
| Settlement date | ✓ | — | — | — | — | ✓ |
| Number of bonds / quantity | ✓ | — | ✓ (₹ amount) | ✓ (min qty) | ✓ | ✓ |
| Call / Put dates | ✓ | — | — | — | — | ✓ (+ YTC / YTP / Yield-to-Worst) |
| Staggered redemption | ✓ | — | ✓ | ✓ | ✓ | ✓ (schedule import; engine native) |
| Day-count basis | built-in | — | — | — | — | ✓ (30/360, ACT/ACT, ACT/365F, 30E/360) |
| Clean vs dirty (AMO) price basis | ✓ (AMO noted) | — | ✓ | ✓ | ✓ | ✓ (explicit price_type toggle) |
| Tax slab / listing (post-tax) | — | — | ✓ (XIRR) | — | — | ✓ (slab + LTCG 12.5% listed) |

**Outputs**

| Output | IndiaBonds | SEBI | Wint | **BondLab** |
|---|---|---|---|---|
| YTM (nominal) | ✓ | ✓ | — | ✓ |
| Current yield | ✓ (FAQ) | ✓ | — | ✓ |
| Effective annual yield | ✓ | — | — | ✓ |
| Accrued interest + days | ✓ | — | — | ✓ |
| Dirty price | ✓ | — | ✓ | ✓ |
| Principal / settlement amount | ✓ | ✓ | ✓ | ✓ |
| Stamp duty 0.0001% | ✓ (included) | — | — | ✓ |
| XIRR (pre-tax) | — | — | ✓ | ✓ |
| XIRR (post-tax) | — | — | ✓ | ✓ |
| XNPV | — | — | — | ✓ (incl. XNPV@XIRR ≈ 0 check) |
| Yield sensitivity table (±25/50/100 bp) | ✓ | — | — | ✓ |
| Duration / convexity | — | — | — | ✓ (extra) |
| YTC / YTP / Yield-to-worst | ✓ | — | — | ✓ |
| Cashflow schedule | ✓ (built-in) | — | ✓ | ✓ |
| Quote sheet export (Excel + PDF) | — | — | ✓ (reports) | ✓ |

**Coverage: BondLab implements every field of all four platforms plus extras (duration/convexity,
XNPV, yield-to-worst, price-basis toggle).**

## B. Logic-level comparison (each calculation step vs platform-documented behaviour)

| Step | Platform behaviour (observed) | BondLab | Evidence |
|---|---|---|---|
| Pricing formula | Street/FIMMDA: P = Σ CFᵢ/(1+y/f)^(w+k) | identical | convention-grid test: best match on 59 bonds |
| G-Sec day count | ACT/ACT, semi-annual | ACT/ACT | 24/24 G-Secs within 1 bp (max 0.71 bp) |
| NCD day count | 30/360 | 30/360 | corporates median 0.26 bp |
| Listed price basis | dirty/AMO (incl. accrued) | clean+dirty toggle, seeded as clean | best-match = dirty_* on 53/59 bonds |
| Accrued interest | period-based, days since last coupon | identical | matches to the paisa vs payout tables |
| Yield solving | quoted "precise to 4th decimal" | machine precision (≥1e-12), displays 4 dp | round-trips at 1e-8 |
| Settlement amount | price×face×qty + accrued + stamp 0.0001% | identical | E2E-verified incl. Excel cell equality |
| XIRR | ACT/365, Wint-style | ACT/365 Newton–bisection | exact-case + round-trip tests |
| Staggered coupons | interest on outstanding balance, actual/365 | `coupon_proration="actual"` + balance tracking | payouts match to the paisa |
| Tax (post-Jul 2024) | slab on coupons; LTCG 12.5% listed >12m | identical | post-tax XIRR in API/Excel/PDF |

## C. Live cross-check results (re-run 2026-08-18, 95 bonds)

- G-Sec/SDL: **24/24 within ±1 bp** (mean 0.28 bp)
- Corporate (non-staggered): **89% within ±1 bp** (median 0.26 bp)
- Overall consistent set: median 0.36 bp; outliers = documented stale feed prices (tax-free
  premium bonds, flagged in inventory notes)
- Staggered: schedules extracted where public; cashflows match to the paisa; quoted-yield
  deviations trace to feed-date staleness (₹0.42/₹10,000 at feed date)
- Jiraaf / SMEST metadata re-verified live and matches inventory

## D. Field parity fixes applied in this pass

1. **YTC / YTP / Yield-to-Worst now displayed** in the live calculator, `/api/calc`, Excel and PDF
   (previously engine-only) — verified UI=API=engine to 4 dp.
2. XNPV implemented earlier with the Excel-consistent `XNPV(XIRR) ≈ 0` check.

## E. Pricing vs payout domain split (final, verified 2026-08-18)

The engine now keeps two explicit cashflow domains, matching how Indian platforms actually
price and pay:

| Domain | Conventions (NCD) | Conventions (G-Sec/SDL) | Used by |
|---|---|---|---|
| Pricing | 30/360 exponents + **fixed coupon × outstanding** + 30/360 accrued (ignores interest basis) | ACT/ACT exponents + ISMA proportional accrued | `yield_from_price`, `price_from_yield`, `yield_to_call/put/worst`, `/api/calc`, curve (JS mirrors: `pricingCashflowsPer100`, `pricingAccrued`) |
| Payout/settlement | **linear actual/365 on pre-redemption balance** | ACT/ACT proportional | `cashflows_per100`, `accrued_interest_per100`, settlement amount, Excel, PDF (JS mirrors: `cashflowsPer100`, `accruedPer100`) |

Evidence:
- Jiraaf Satin pair (price 97.494025 ↔ yield 12.30%): engine reproduces **12.300000 exactly**
  only with 30/360 + fixed coupons + 30/360 accrued (ACT/365F gives 12.296675, ACT/ACT
  12.299456). TS `bond-math` (Binary repo, ACT/365): ytmNom 10.746830 — off-platform for this pair.
- IndiaBonds Spandana payouts: linear actual/365 on pre-redemption balance — every per-coupon
  value reproduced to the paisa (26 Sep 26 ₹95.55, 26 Oct ₹92.47, 26 Nov ₹71.66, 26 Dec ₹69.35,
  27 Jan–27 Feb ₹71.66, 27 Mar ₹64.73) incl. staggered 4×25% redemptions (26-Oct-26 / 26-Apr-27 /
  26-Oct-27 / 26-Apr-28).
- IndiaBonds settlement accrued: linear actual/365 (₹24.66 = 8 days × 11.25% × ₹10k / 365).
- Convention grid over 93 comparable IndiaBonds records: dirty_30_360_nominal 42, dirty_ACT_ACT 24,
  dirty_30_360_effective 14, clean_30_360_* 13 — NCDs price dirty 30/360; G-Secs ACT/ACT.

Current verification: JS ↔ Python parity on Satin + Spandana (YTM, accrued, payouts to 6 dp —
ALL MATCH), engine 50 tests OK (43 core + 7 extreme-precision), E2E 27/27, satin YTM
12.300000 at feed price.

## F. SEBI official calculator cross-check + solver precision (2026-08-18)

SEBI's official bond-yield calculator (`investor.sebi.gov.in/calc/bond.html`, `assets/calc/bond.js`)
solves fYTM(z,p,c,b,y) = (c+b)·z^(y+1) − b·z^y − (c+p)·z + p = 0, z = 1/(1+r), returning (1/z)−1.
Factoring: f = (z−1)·Q(z) with Q(z) = (c+b)·z^y + c·(z+…+z^(y−1)) − p — i.e. SEBI's model is
**y annual coupon periods with redemption AT t = y** (whole periods, no accrued, no day count;
their own Newton uses tolerance 1e-5).

- Engine parity: engine `yield_from_price` vs a machine-precision re-solve of SEBI's polynomial
  across a 120-case grid (y = 1..10, price 72.5/95/100/108, coupon 7/10/12.75):
  **max |diff| = 3.19e-15** (decimal yield) on 119 positive-yield cases; negative-yield cases
  (price ≥ par + total coupons) agree to no-root.
- The engine is a strict superset: SEBI's special case (annual, settle on coupon date, whole
  periods) is reproduced at machine precision; everything else (monthly/quarterly, accrued,
  staggered redemptions, ACT/ACT ISMA) is exact beyond SEBI's own tolerance.

Solver precision (analytic-derivative Newton, tolerance 1e-14·max(1,|target|)):

| Check | Value |
|---|---|
| Satin PV residual at solved ytm | 1.56e-13 (machine level) |
| Satin ytm ↔ price round trip | 9.59e-14 |
| Price at exactly 12.300% vs platform quoted dirty 97.732913888889 | 97.732913702518 (Δ 1.86e-07) |
| XIRR Spandana @99 | 13.135041627175445%, xnpv residual 6.36e-11 |
| Zero-coupon round trip | ≤ 1e-9 (parity), ≤ 1e-10 on yield |
| G-Sec ACT/ACT ISMA round trip | ≤ 1e-11 |
| Spandana payout vs linear actual/365 formula | < 1e-12 relative, every coupon |

The remaining display difference on the Satin pair (12.299999883 vs 12.300000) is the
**platform's own rounding** (price quoted to 6 dp, yield to 2 dp) — the engine solves the
rounded data to machine precision; no engine error is present. Same convention applies to the
TS `bond-math` cross-check (Binary repo, ACT/365): a *different* convention than the platform
uses for NCD pricing, hence off-platform by design.
