import os
import re
import json
import sys
from datetime import date, datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
from bondlab import Bond

CANONICAL_HEADERS = [
    "Coupon (Interest Rate)",
    "Security Name",
    "Issuer Category",
    "ISIN No.",
    "Coupon Frequency",
    "Balance FV Per Bond",
    "Type",
    "Credit Rating",
    "Final Maturity / Call Date",
    "Residual Period to Maturity / Call",
    "Offer Yield Percentage",
    "Min Investment: Multiples of (₹ Lacs)",
    "Offer Price",
    "Tiny URL",
]

LEGACY_HEADERS = {
    "ISIN Number": "isin",
    "Security Name": "security_name",
    "Coupon Rate": "coupon",
    "Maturity Date": "maturity",
    "Residual Tenure": "residual",
    "Interest Payment Date(s)": "first_coupon",
    "Interest Payment Frequency": "coupon_frequency",
    "Indicative Offer Yield": "offer_yield",
    "Yield to Maturity (YTM)": "_ytm_legacy",
    "Rating(s)": "credit_rating",
    "Rating Agency(ies)": "rating_agency",
    "Type of Security": "type",
    "Face Value": "face_value",
    "Minimum Investment": "min_investment",
    "Call / Put Date": "_callput",
    "Allotment Date": "issue_date",
    "Type of Guarantee": "guarantee",
    "Listing": "listing",
    "Issue Size": "issue_size",
    "Mode of Issuance": "mode",
    "Sector": "sector",
    "Taxable": "taxable",
    "Coupon Type": "coupon_type",
    "Day Count Convention": "day_count",
    "Series / Tranche": "series",
}

FREQ_MAP = {
    "annual": 1, "yearly": 1, "once a year": 1,
    "semi-annual": 2, "semi annual": 2, "half yearly": 2, "half-yearly": 2, "halfyearly": 2, "semiannual": 2,
    "quarterly": 4,
    "monthly": 12,
    "zero coupon": 0, "zero": 0, "cumulative": 0, "zc": 0,
}

DC_MAP = {
    "act/act": "ACT/ACT", "actual/actual": "ACT/ACT", "act-act": "ACT/ACT",
    "30/360": "30/360", "30e/360": "30E/360", "act/365": "ACT/365F",
    "act/365l": "ACT/365L", "actual/365l": "ACT/365L",
    "act/365y": "ACT/365Y", "actual/365y": "ACT/365Y",
}

DEFAULT_DC_BY_TYPE = {"ACT/ACT"}


def slugify(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:48] or "bond"


def encode_id(n):
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = chars[r] + out
    return out or "0"


def parse_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y-%m-%d", "%d-%b-%Y", "%d-%b-%y", "%d %b %Y", "%d/%b/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    m = re.search(r"(\d{1,2})[-\s./]([A-Za-z]{3,9})[-\s./](\d{2,4})", s)
    if m:
        try:
            return datetime.strptime(f"{m.group(1)}-{m.group(2)}-{m.group(3)}", "%d-%b-%Y").date()
        except ValueError:
            return None
    return None


def parse_num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    m = re.search(r"-?\d+(\.\d+)?", s)
    return float(m.group()) if m else None


def parse_min_investment(v):
    n = parse_num(v)
    if n is None:
        return None
    s = str(v).lower()
    if any(k in s for k in ("lac", "lakh", "lk", "₹ lacs")):
        if n < 10000:
            n = n * 100000
    return n


def parse_frequency(v):
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in FREQ_MAP:
        return FREQ_MAP[s]
    for key, val in FREQ_MAP.items():
        if key in s:
            return val
    return None


def parse_day_count(v):
    if v is None or str(v).strip() == "":
        return None
    s = str(v).strip().lower()
    return DC_MAP.get(s)


def default_day_count(security_type, issuer_category):
    t = (security_type or "").lower()
    c = (issuer_category or "").lower()
    if any(k in t for k in ("g-sec", "gsec", "government security", "sdl", "t-bill", "treasury", "sgb", "sovereign gold")):
        return "ACT/ACT"
    if "government" in c or "sovereign" in c:
        return "ACT/ACT"
    return "30/360"


def parse_call_put(v, data):
    if v is None or str(v).strip() == "":
        return
    s = str(v)
    d = parse_date(s)
    if d is None:
        return
    if "call" in s.lower():
        data["call_date"] = d.isoformat()
    elif "put" in s.lower():
        data["put_date"] = d.isoformat()
    else:
        data["call_date"] = d.isoformat()


def legacy_row_to_data(row):
    data = {}
    for key, value in row.items():
        if key is None:
            continue
        key_s = str(key).strip()
        if key_s in LEGACY_HEADERS:
            field = LEGACY_HEADERS[key_s]
            if field.startswith("_"):
                if field == "_callput":
                    parse_call_put(value, data)
                continue
            data[field] = value
    if "coupon_frequency" in data:
        fq = parse_frequency(data["coupon_frequency"])
        if fq is not None:
            data["coupon_frequency"] = {1: "Annual", 2: "Semi-Annual", 4: "Quarterly", 12: "Monthly", 0: "Zero Coupon"}[fq]
    if "day_count" in data:
        dc = parse_day_count(data["day_count"])
        data["day_count"] = dc if dc else None
    if "min_investment" in data:
        data["min_investment"] = parse_min_investment(data["min_investment"])
    if "face_value" in data:
        data["face_value"] = parse_num(data["face_value"])
    if "coupon" in data:
        data["coupon"] = parse_num(data["coupon"])
    if "offer_yield" in data:
        data["offer_yield"] = parse_num(data["offer_yield"])
    if "maturity" in data:
        mat = parse_date(data["maturity"])
        data["maturity"] = mat.isoformat() if mat else data["maturity"]
    if "isin" in data and data["isin"]:
        data["isin"] = str(data["isin"]).strip().upper()
    return data


def canonical_row_to_data(row):
    data = {}
    hmap = {h: i for i, h in enumerate(row.keys())}
    def getv(headers):
        for h in headers:
            if h in hmap and row[h] is not None and str(row[h]).strip() != "":
                return row[h]
        return None
    data["coupon"] = parse_num(getv(["Coupon (Interest Rate)"]))
    data["security_name"] = getv(["Security Name"])
    data["issuer_category"] = getv(["Issuer Category"])
    data["isin"] = getv(["ISIN No."])
    fq = parse_frequency(getv(["Coupon Frequency"]))
    data["coupon_frequency"] = {1: "Annual", 2: "Semi-Annual", 4: "Quarterly", 12: "Monthly", 0: "Zero Coupon"}.get(fq, "Annual")
    data["face_value"] = parse_num(getv(["Balance FV Per Bond"]))
    data["type"] = getv(["Type"])
    data["credit_rating"] = getv(["Credit Rating"])
    mat = parse_date(getv(["Final Maturity / Call Date"]))
    data["maturity"] = mat.isoformat() if mat else None
    data["residual"] = getv(["Residual Period to Maturity / Call"])
    data["offer_yield"] = parse_num(getv(["Offer Yield Percentage"]))
    data["min_investment"] = parse_min_investment(getv(["Min Investment: Multiples of (₹ Lacs)"]))
    data["offer_price"] = parse_num(getv(["Offer Price"]))
    data["tiny_url"] = getv(["Tiny URL"])
    return data


def detect_and_map(row):
    keys = [str(k).strip() for k in row.keys()]
    if "Coupon (Interest Rate)" in keys or "ISIN No." in keys:
        return canonical_row_to_data(row), "canonical"
    if any(k in keys for k in ("ISIN Number", "Coupon Rate", "Interest Payment Frequency")):
        return legacy_row_to_data(row), "legacy"
    return {}, "unknown"


def validate(data):
    errors = []
    if "coupon" in data and isinstance(data["coupon"], str):
        data["coupon"] = parse_num(data["coupon"])
    if "offer_yield" in data and isinstance(data["offer_yield"], str):
        data["offer_yield"] = parse_num(data["offer_yield"])
    if "maturity" in data and data["maturity"]:
        mat = parse_date(data["maturity"])
        if mat is None:
            errors.append(f"Unparseable maturity date: {data['maturity']}")
        else:
            data["maturity"] = mat.isoformat()
            if mat <= date.today():
                errors.append("Final Maturity / Call Date must be in the future")
    if not data.get("security_name"):
        errors.append("Security Name required")
    if data.get("coupon") is None:
        errors.append("Coupon required")
    if not data.get("coupon_frequency"):
        errors.append("Coupon Frequency required")
    if data.get("face_value") is None or data["face_value"] <= 0:
        errors.append("Balance FV Per Bond required")
    if not data.get("maturity"):
        errors.append("Final Maturity / Call Date required")
    if data.get("coupon_frequency") == "Zero Coupon" and data.get("coupon") not in (None, 0):
        errors.append("Zero Coupon bonds must have Coupon (Interest Rate) = 0")
    if (data.get("offer_price") is None or data["offer_price"] <= 0) and data.get("offer_yield") is None:
        errors.append("Offer Price or Offer Yield required (enter one; price is computed from yield)")
    isin = data.get("isin")
    if isin:
        isin = str(isin).strip().upper()
        if len(isin) != 12 or not isin[:2].isalpha():
            errors.append(f"ISIN looks invalid: {isin}")
        data["isin"] = isin
    if data.get("coupon") is not None and data["coupon"] < 0:
        errors.append("Coupon cannot be negative")
    if data.get("offer_yield") is not None and data["offer_yield"] < 0:
        errors.append("Offer Yield cannot be negative")
    if data.get("min_investment") is not None and data["min_investment"] <= 0:
        errors.append("Min Investment must be positive")
    data["residual"] = str(data.get("residual") or "")
    return errors


def data_to_bond(data):
    fq = parse_frequency(data["coupon_frequency"])
    if fq is None:
        raise ValueError(f"bad frequency: {data['coupon_frequency']}")
    dc = data.get("day_count") or default_day_count(data.get("type"), data.get("issuer_category"))
    calls = []
    puts = []
    if data.get("call_date"):
        calls = [(data["call_date"], 100.0)]
    if data.get("put_date"):
        puts = [(data["put_date"], 100.0)]
    kwargs = dict(
        maturity=data["maturity"],
        coupon=float(data["coupon"] or 0.0),
        freq=fq,
        face_value=float(data["face_value"]),
        day_count=dc,
    )
    if data.get("issue_date"):
        kwargs["issue"] = data["issue_date"]
    if data.get("first_coupon"):
        kwargs["first_coupon"] = data["first_coupon"]
    if calls:
        kwargs["calls"] = calls
    if puts:
        kwargs["puts"] = puts
    redemptions = []
    if data.get("redemptions"):
        try:
            val = data["redemptions"]
            redemptions = [(d, float(pct)) for d, pct in (val if isinstance(val, list) else json.loads(val))]
        except Exception:
            pass
    if redemptions:
        kwargs["redemptions"] = redemptions
        kwargs["coupon_proration"] = "actual"
    if str(data.get("type") or "").lower() not in ("g-sec", "gsec", "sdl"):
        if dc in ("ACT/365F", "ACT/365L", "ACT/365Y"):
            kwargs["interest_basis"] = dc
        else:
            kwargs["interest_basis"] = "ACT/365F"
    return Bond(**kwargs)


def normalize_record(data):
    if not data.get("residual"):
        data["residual"] = compute_residual(data.get("maturity"))
    if not data.get("day_count"):
        data["day_count"] = default_day_count(data.get("type"), data.get("issuer_category"))
    data["tiny_url"] = str(data.get("tiny_url") or "").strip()
    return data


def compute_residual(maturity):
    m = parse_date(maturity)
    if not m:
        return ""
    today = date.today()
    days = (m - today).days
    if days < 0:
        return "Matured"
    yrs = days / 365.0
    if yrs >= 1:
        return f"{yrs:.2f} Years ({days} days)"
    months = days / 30.0
    if months >= 1:
        return f"{months:.1f} Months ({days} days)"
    return f"{days} Days"


def fill_offer_price(data):
    if data.get("offer_price") is not None:
        return
    if data.get("offer_yield") is None:
        return
    try:
        bond = data_to_bond(data)
        settle = next_business_day(date.today())
        data["offer_price"] = round(bond.price_from_xirr(float(data["offer_yield"]), settle, clean=True), 6)
    except Exception:
        pass


def next_business_day(d):
    d = d + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d
