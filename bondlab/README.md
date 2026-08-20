# BondLab

Precision bond analytics engine replicating and extending the calculators offered by
IndiaBonds, Wint Wealth, SMEST Capital and Jiraaf — pure Python stdlib, zero dependencies.

## Layout

```
bondlab/
  bondlab/            Python package (engine)
    bond.py           Bond class: pricing, YTM/YTC/YTP/YTW, settlement, stamp duty
    schedule.py       Coupon schedule generation (odd first coupon, day-capping)
    daycount.py       ACT/ACT (street), 30/360 US & Euro, ACT/365F
    analytics.py      Macaulay/modified duration, convexity, XIRR, yield movement
    tax.py            India post-tax cashflows (slab coupons, LTCG 12.5% listed >365d)
    cli.py            JSON CLI
  app/index.html      Web calculator (single file, engine ported to JS)
  examples/platform_bonds.json   Platform offer presets (public data, fetched 2026-08-15)
  tests/              41 unit + fuzz tests
```

## Methodology (matches platform behavior)

- Dirty price = Σ CFᵢ / (1+y/f)^(w+k), w = days-to-next-coupon / period-days (street convention)
- Accrued interest per current coupon period, ACT or 30/360 as configured
- Yield solver: hybrid Newton + safeguarded bisection — machine precision, round-trips to 1e-8
- Settlement amount = dirty × face × qty + stamp duty @ 0.0001% (transfer, demat)
- Staggered redemptions, call/put (YTC/YTP/yield-to-worst), zero-coupon, monthly/quarterly freqs
- Post-tax: coupons at slab; maturity gain vs cost at LTCG 12.5% (listed, >365d) else slab

## Use

```bash
cd bondlab

# tests (41)
python3 -m unittest discover -s tests

# price from yield + risk metrics
python3 -m bondlab.cli price --maturity 2034-01-15 --coupon 7.10 --freq 2 --face 100 \
  --settle 2026-08-17 --yield-pct 7.05 --duration

# yield from clean price + post-tax XIRR
python3 -m bondlab.cli yield --maturity 2032-03-20 --coupon 9.25 --freq 1 \
  --day-count 30/360 --settle 2026-08-17 --price 99.25 --tax-slab 0.3

# settlement breakup for 10 bonds
python3 -m bondlab.cli settle --maturity 2032-03-20 --coupon 9.25 --freq 1 \
  --day-count 30/360 --settle 2026-08-17 --price 99.25 --n-bonds 10

# platform presets (Jiraaf/Wint/G-Sec/NCD examples)
python3 -m bondlab.cli preset --list
python3 -m bondlab.cli preset --id satin-finserv --settle 2026-08-17 --price 99.50 --n-bonds 10

# web calculator
python3 -m http.server -d app 8000   # then open http://localhost:8000
```

## Accuracy evidence

- 41 unit/fuzz tests green (1500 randomized price↔yield round-trips to 1e-8; duration/convexity
  validated against central finite differences; schedule/day-count edge cases)
- JS engine (web app) cross-validated against Python engine to 9 decimals on all metrics,
  including staggered redemption and zero-coupon cases

## Live platform comparison (2026-08-18)

Evaluated against 90 live bonds from the IndiaBonds public API — see
`comparison/COMPARISON_REPORT.md` for the full report.

- **G-Sec/SDL: 24/24 bonds within ±1 bp** (max 0.71 bp, median 0.11 bp)
- **Corporate NCDs: 91% within ±2 bp** (median 0.26 bp, mean 1.62 bp)
- Discovered platform conventions now built in: dirty/AMO price quoting,
  30/360 for NCDs vs ACT/ACT street for G-Secs, and balance-FV staggered
  redemption with actual/365 coupons (`redemptions=` + `coupon_proration="actual"`)
- Staggered payouts verified to the paisa against platform payout tables;
  residual deviations traced to feed-date staleness and AMO discount pricing

## Data caveat

`examples/platform_bonds.json` contains advertised offers from public platform pages.
Maturity/coupon dates marked `maturity_is_example` must be verified against the ISIN master
and offer documents before any real use. Not investment advice.
