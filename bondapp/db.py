import os
import sqlite3
from datetime import datetime, timezone

DB_DIR = os.environ.get("BONDAPP_DATA_DIR") or (
    "/tmp/bondapp_data" if os.environ.get("VERCEL") == "1"
    else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "bonds.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS bonds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  security_name TEXT NOT NULL,
  issuer_category TEXT,
  isin TEXT UNIQUE,
  coupon REAL NOT NULL,
  coupon_frequency TEXT NOT NULL,
  face_value REAL NOT NULL,
  type TEXT,
  credit_rating TEXT,
  maturity TEXT NOT NULL,
  call_date TEXT,
  put_date TEXT,
  issue_date TEXT,
  first_coupon TEXT,
  day_count TEXT,
  residual TEXT,
  offer_yield REAL,
  min_investment REAL,
  offer_price REAL NOT NULL,
  tiny_url TEXT,
  guarantee TEXT, listing TEXT, sector TEXT, taxable TEXT,
  coupon_type TEXT, rating_agency TEXT, issue_size TEXT, mode TEXT, series TEXT,
  notes TEXT,
  redemptions TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bond_id INTEGER NOT NULL,
  quote_no TEXT,
  client_name TEXT,
  client_contact TEXT,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  settle TEXT NOT NULL,
  principal REAL,
  accrued REAL,
  stamp REAL,
  total REAL,
  ytm REAL,
  xirr REAL,
  xlsx_path TEXT,
  pdf_path TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bonds_category ON bonds(issuer_category);
CREATE INDEX IF NOT EXISTS idx_bonds_type ON bonds(type);
"""

BOND_FIELDS = [
    "security_name", "issuer_category", "isin", "coupon", "coupon_frequency",
    "face_value", "type", "credit_rating", "maturity", "call_date", "put_date",
    "issue_date", "first_coupon", "day_count", "residual", "offer_yield",
    "min_investment", "offer_price", "tiny_url", "guarantee", "listing",
    "sector", "taxable", "coupon_type", "rating_agency", "issue_size",
    "mode", "series", "notes", "redemptions",
]


def _ensure_redemptions_column():
    conn = sqlite3.connect(DB_PATH)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        if "bonds" not in tables:
            conn.executescript(SCHEMA)
            conn.commit()
            return
        cols = [r[1] for r in conn.execute("PRAGMA table_info(bonds)")]
        if "redemptions" not in cols:
            conn.execute("ALTER TABLE bonds ADD COLUMN redemptions TEXT")
            conn.commit()
    finally:
        conn.close()

_ensure_redemptions_column()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def insert_bond(data):
    conn = get_db()
    try:
        now = now_iso()
        cols = BOND_FIELDS + ["slug", "created_at", "updated_at"]
        vals = [data.get(f) for f in BOND_FIELDS] + [data["slug"], now, now]
        q = "INSERT INTO bonds (" + ",".join(cols) + ") VALUES (" + ",".join("?" * len(cols)) + ")"
        cur = conn.execute(q, vals)
        conn.commit()
        bid = cur.lastrowid
        return bid
    finally:
        conn.close()


def update_bond(bond_id, data):
    conn = get_db()
    sets = ",".join(f"{f}=?" for f in BOND_FIELDS)
    vals = [data.get(f) for f in BOND_FIELDS] + [now_iso(), bond_id]
    conn.execute(f"UPDATE bonds SET {sets}, updated_at=? WHERE id=?", vals)
    conn.commit()
    conn.close()


def get_bond(bond_id=None, slug=None, isin=None):
    conn = get_db()
    if bond_id is not None:
        row = conn.execute("SELECT * FROM bonds WHERE id=?", (bond_id,)).fetchone()
    elif slug is not None:
        row = conn.execute("SELECT * FROM bonds WHERE slug=?", (slug,)).fetchone()
    elif isin is not None:
        row = conn.execute("SELECT * FROM bonds WHERE isin=?", (isin,)).fetchone()
    else:
        row = None
    conn.close()
    return dict(row) if row else None


def list_bonds(q=None, category=None, btype=None, rating=None, sort="offer_yield desc"):
    conn = get_db()
    sql = "SELECT * FROM bonds WHERE 1=1"
    args = []
    if q:
        sql += " AND (security_name LIKE ? OR isin LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    if category:
        sql += " AND issuer_category = ?"
        args.append(category)
    if btype:
        sql += " AND type = ?"
        args.append(btype)
    if rating:
        sql += " AND credit_rating LIKE ?"
        args.append(f"{rating}%")
    order = {"yield": "offer_yield DESC", "rating": "credit_rating ASC", "new": "id DESC", "tenure": "maturity ASC"}.get(sort, "offer_yield DESC")
    sql += f" ORDER BY {order}"
    rows = conn.execute(sql, args).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_bonds():
    conn = get_db()
    rows = conn.execute("SELECT * FROM bonds ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_bond(bond_id):
    conn = get_db()
    conn.execute("DELETE FROM quotes WHERE bond_id=?", (bond_id,))
    conn.execute("DELETE FROM bonds WHERE id=?", (bond_id,))
    conn.commit()
    conn.close()


def insert_quote(data):
    conn = get_db()
    now = now_iso()
    cur = conn.execute(
        "INSERT INTO quotes (bond_id, quote_no, client_name, client_contact, qty, price, settle, principal, accrued, stamp, total, ytm, xirr, xlsx_path, pdf_path, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (data["bond_id"], data.get("quote_no"), data.get("client_name"), data.get("client_contact"),
         data["qty"], data["price"], data["settle"], data.get("principal"),
         data.get("accrued"), data.get("stamp"), data.get("total"),
         data.get("ytm"), data.get("xirr"), data.get("xlsx_path"), data.get("pdf_path"), now),
    )
    conn.commit()
    qid = cur.lastrowid
    conn.close()
    return qid


def list_quotes(limit=100):
    conn = get_db()
    rows = conn.execute(
        "SELECT q.*, b.security_name, b.isin FROM quotes q LEFT JOIN bonds b ON b.id=q.bond_id ORDER BY q.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_quote(quote_id):
    conn = get_db()
    row = conn.execute(
        "SELECT q.*, b.security_name, b.isin FROM quotes q LEFT JOIN bonds b ON b.id=q.bond_id WHERE q.id=?",
        (quote_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def count_bonds():
    conn = get_db()
    n = conn.execute("SELECT COUNT(*) FROM bonds").fetchone()[0]
    conn.close()
    return n


def bond_exists_isin(isin, exclude_id=None):
    if not isin:
        return False
    conn = get_db()
    if exclude_id:
        row = conn.execute("SELECT id FROM bonds WHERE isin=? AND id!=?", (isin, exclude_id)).fetchone()
    else:
        row = conn.execute("SELECT id FROM bonds WHERE isin=?", (isin,)).fetchone()
    conn.close()
    return row is not None


def slug_exists(slug):
    conn = get_db()
    row = conn.execute("SELECT id FROM bonds WHERE slug=?", (slug,)).fetchone()
    conn.close()
    return row is not None
