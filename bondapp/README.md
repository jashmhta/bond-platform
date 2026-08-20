# BondLab — Bond Offers Platform, Admin Panel & Quote-Sheet Generator

Production-grade replication of bond-platform calculators (IndiaBonds / Wint Wealth / SMEST / Jiraaf)
with an admin backend for managing bond inventory and generating perfectly calculated client quote sheets
(Excel + PDF).

```
bondapp/
  app.py               Flask routes: public offers, tiny URLs, calc/quote APIs, admin
  models.py            Excel→data mapping (14-col canonical + 25-col legacy), validation, engine binding
  quotesheet.py        Quote computation + Excel/PDF generation (all numbers from the bondlab engine)
  db.py                SQLite storage (bonds, quotes)
  templates/           Public site + admin panel (Jinja2, dark premium UI)
  static/              CSS + JS calculator (engine port validated to 9 decimals vs Python)
  data/bonds.db        Database (auto-created, demo-seeded on first run)
  data/generated/      Generated quote sheets (.xlsx + .pdf)
```

## Run

```bash
cd bondapp
python3 app.py                # http://localhost:8000   (ADMIN_PASSWORD env, default admin123)
```

## Features

### Public frontend
- Offers list: search by name/ISIN, filter by category / type / rating, sort by yield / rating / tenure / newest
- Stats: live count, yield range, clearing-settlement, precision guarantees
- Bond detail page: security facts + live calculator (clean price ⇄ YTM swap, qty, settlement date)
  → YTM, effective annual, current yield, accrued interest (days + amount), dirty price, principal,
  stamp duty, total settlement, Macaulay/modified duration, convexity, XIRR (pre-tax), yield sensitivity ±100bp,
  full cashflow schedule
- Tiny URLs: every bond gets a short public link `/b/<slug>` → offer page

### Client quote sheets (Excel + PDF)
- Form: client name/contact, qty, price, settlement date, tax slab, listing, notes
- Both files computed server-side by the engine — identical numbers in Excel cells, PDF and web
- Excel: Quote Summary · Cashflows · Post-Tax · Yield Sensitivity (formatted numeric cells)
- PDF: branded A4, breakup tables, cashflow schedule, sensitivity, disclaimer
- Quote history stored; re-download from admin any time

### Admin panel (`/admin`, password `admin123`)
- Add/Edit bond form: all 14 template fields + advanced (issue/first-coupon/call/put dates, day count,
  guarantee, listing, sector, rating agency, series…)
- Bulk Excel import: upload → preview with per-row validation → confirm. Bad rows reported and skipped.
  Duplicate ISIN guard. Both formats auto-detected:
  - **14-column canonical template** (exact headers from spec)
  - **legacy 25-column AdminWebsiteheaders format** (`ISIN Number`, `Coupon Rate`, `Interest Payment
    Frequency`, `Call / Put Date`, `Allotment Date`, …) — missing Offer Price is **computed from the
    indicative offer yield by the engine** (round-trip verified to <1e-6)
- Download blank import template (3 sheets: 14-col, legacy, instructions) and export full inventory
- Quote-sheet log with file downloads

## The 14 import headers

1. Coupon (Interest Rate) · 2. Security Name · 3. Issuer Category · 4. ISIN No. · 5. Coupon Frequency
6. Balance FV Per Bond · 7. Type · 8. Credit Rating · 9. Final Maturity / Call Date
10. Residual Period to Maturity / Call · 11. Offer Yield Percentage · 12. Min Investment: Multiples of (₹ Lacs)
13. Offer Price · 14. Tiny URL

Accepted values: frequency = Annual | Semi-Annual | Quarterly | Monthly | Zero Coupon;
dates = dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd / 20-Mar-2032; min investment = "1" ⇒ ₹1,00,000
(also "2 Lacs" / 100000); price is clean per ₹100 face.

## Accuracy

- Engine: street/FIMMDA convention, hybrid Newton–bisection yield solving (machine precision),
  stamp duty 0.0001% on consideration, ACT/ACT (G-Sec) & 30/360 (NCD) day counts
- 41 engine unit/fuzz tests green (1,500 randomized price↔yield round-trips at 1e-8)
- 27 Playwright E2E tests green (public site, calculator numbers, quote downloads, admin CRUD,
  both import formats, duplicate guards)
- JS calculator cross-validated against Python engine to 9 decimals

## Real inventory (no test data)

The database is seeded exclusively from real directories:

- **78 live bonds** — IndiaBonds public directory API (fetched 2026-08-18) + Jiraaf bond pages
  (verified coupon/maturity/face/rating). Every record carries real ISIN, exact maturity date,
  platform price and yield. No example or placeholder rows.
- Stored offer prices are engine-computed clean prices from the platform's listed (dirty/AMO)
  price at the feed date, so the displayed yield reproduces the platform's quoted yield —
  verified worst deviation **0.11 bp on G-Secs**, median < 0.5 bp on corporates (see
  `../bondlab/comparison/COMPARISON_REPORT.md`).
- Bonds whose platform feed price/yield pair is internally inconsistent (stale) are flagged in
  the notes field. Staggered-redemption bonds are flagged "schedule pending" (bullet
  approximation until the schedule is imported).
- Refresh anytime: `python3 seed_real.py` (re-fetches live data and reseeds).

## Data caveat

Verify cashflows against the ISIN master & offer documents before real use. Not investment advice.
