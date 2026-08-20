# Bond Platform — Indian Fixed Income

Exact Excel-logic bond math, IndiaBonds-matched calculator, bulk import, and quote sheets.

* Engine `bondlab/` — day-counts `30/360 · ACT/365F/L/Y · ACT/ACT`, frequencies `1/2/4/12/0`, coupon-day-anchored schedule with final stub, staggered redemptions, `price_from_yield` / `price_from_xirr` / `xirr_from_price` (all verified to 9 decimals vs `Sample cashflow.xlsx`)
* App `bondapp/` — Flask, public offers, offer pages (IP dates, server-driven XIRR), calculator (Investor YTM headline, amount-based qty, one-box results, real-time debounced), admin (add/edit with price auto from yield, bulk import 14-col + legacy 25-col, template hyperlink, tiny URL ` /b/<slug>`, ISIN copy)
* Verified: engine `65/65`, independent audit `397/397`, E2E `27/27`, live `bondapp-lake.vercel.app`

Run locally:
```
pip install -r bondapp/requirements.txt
python bondapp/app.py  # http://127.0.0.1:8000  admin admin123
python -m unittest discover -s bondlab/tests
```
