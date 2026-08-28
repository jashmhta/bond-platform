# Cross-platform validation sources (status 2026-08-22)

| Platform | Access | Validatable surface | Result |
|---|---|---|---|
| IndiaBonds | sitemap + detail pages (public) | AI + YTM conventions, 109 bonds | AI median err Rs 0.01; YTM median 0.6bp; sovereigns exact |
| Grip bond-directory | Playwright render (Next.js SPA) | Accrued + schedule construction, 27 bonds (their yield = independent quote, not repricable) | AI exact (<Re 1) on 11/27; schedule/freq fit confirmed |
| TheFixedIncome | JS-rendered listing; detail pages have cashflow tables (not yet scraped) | Full cashflow ladder + published methodology | pending scrape |
| GoldenPi | SPA, minimal SSR data | price/yield pairs only | low coverage |
| Wint Wealth / SMEST / Jiraaf / Aspero | gated or down from this host | — | not accessible |
| BSE/NSE APIs | blocked (bot protection) | exchange quotes | not accessible |

Engine conventions confirmed across sources: backward-from-maturity schedules, no
holiday roll in displayed schedules, ACT/365F corporate accrual with anchored-grid stubs,
street BEY for sovereigns, XIRR/effective-annual for corporates.
