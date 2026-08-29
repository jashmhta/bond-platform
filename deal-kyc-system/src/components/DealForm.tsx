"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ytmPercent, calcStampDuty } from "@/lib/deal-math";

type ClientRow = {
  id: string;
  ucc: string;
  holderName: string | null;
  panNumber: string | null;
  mobileNo: string;
  email: string;
  dpId: string | null;
  clientId: string | null;
  dpName: string | null;
  address: string | null;
  panDocUrl: string | null;
  aadharDocUrl: string | null;
  cancelledChequeUrl: string | null;
  cmlCmrUrl: string | null;
};

const DOC_STRIP: Array<{ key: keyof ClientRow; label: string }> = [
  { key: "panDocUrl", label: "PAN" },
  { key: "aadharDocUrl", label: "Aadhaar" },
  { key: "cancelledChequeUrl", label: "Cheque" },
  { key: "cmlCmrUrl", label: "CML" },
];

const pad3 = (n: number) => String(n).padStart(3, "0");
const ymdOf = (d: string) => d.replaceAll("-", "");
const todayIso = () => new Date().toISOString().slice(0, 10);
const numDays = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

const inr = (n: number) =>
  "Rs. " +
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SecState = {
  securityName: string;
  isin: string;
  couponRate: string;
  paymentDates: string;
  maturityDate: string;
  price: string;
  yieldValue: string;
  facePerUnit: string;
  units: string;
  interestDays: string;
};

type DealInitial = {
  id: string;
  client: ClientRow | null;
  clientId: string;
  type: "TB" | "TS";
  date: string;
  serial: number;
  refNo: string;
  securityName: string;
  isin: string | null;
  couponRate: number | null;
  maturityDate: string | null;
  price: number | null;
  cleanPrice: number | null;
  yieldValue: number | null;
  faceValue: number | null;
  quantity: number | null;
  interestPaymentDates: string | null;
  interestDays: number | null;
  principalAmount: number | null;
  accruedInterest: number | null;
  totalConsideration: number | null;
};

export default function DealForm({
  mode,
  dealId,
  initial,
}: {
  mode: "new" | "edit";
  dealId?: string;
  initial?: DealInitial;
}) {
  const editMode = mode === "edit";

  /* ---- clients (auto from KYC DB) ---- */
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientsErr, setClientsErr] = useState("");
  const [clientId, setClientId] = useState(initial?.clientId ?? "");

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((rows: ClientRow[]) =>
        Array.isArray(rows) && setClients(rows.filter((c) => c.id !== (initial?.clientId ?? "")))
      )
      .catch(() => setClientsErr("Could not load clients — complete a KYC first."));
  }, [initial?.clientId]);

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? initial?.client ?? null,
    [clients, clientId, initial]
  );

  /* ---- 4/4 compulsory KYC documents ---- */
  const clientDocs = useMemo(() => {
    const src = client ?? (mode === "edit" ? initial?.client ?? null : null);
    if (!src) return null;
    const items = DOC_STRIP.map((d) => ({ label: d.label, ok: Boolean(src[d.key] || "") }));
    return { items, okCount: items.filter((i) => i.ok).length };
  }, [client, mode, initial]);

  /* ---- deal meta ---- */
  const [type, setType] = useState<"TB" | "TS">(initial?.type ?? "TS");
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [serial, setSerial] = useState(initial?.serial ?? 1);
  const [refNo, setRefNo] = useState(initial?.refNo ?? `${initial?.type ?? "TS"}${ymdOf(initial?.date ?? todayIso())}001`);
  const [refTouched, setRefTouched] = useState(!!initial);

  /* auto ref: TS/TB + YYYYMMDD + next serial in order (new deals only) */
  useEffect(() => {
    if (editMode || refTouched) return;
    let alive = true;
    fetch(`/api/deals/next-ref?type=${type}&date=${date}`)
      .then((r) => r.json())
      .then((j: { refNo?: string; serial?: number }) => {
        if (!alive || !j?.refNo || !j?.serial) return;
        setSerial(j.serial);
        setRefNo(j.refNo);
      })
      .catch(() => {
        if (!alive) return;
        setSerial(1);
        setRefNo(`${type}${ymdOf(date)}${pad3(1)}`);
      });
    return () => {
      alive = false;
    };
  }, [type, date, editMode, refTouched]);

  /* ---- security: bond directory lookup from bondapp-lake API ---- */
  type BondHit = {
    slug: string; security_name: string; isin: string;
    coupon: number; coupon_frequency: string; maturity: string;
    offer_price: number | null; offer_yield: number | null;
    face_value: number | null; issue_date: string | null; first_coupon: string | null;
    credit_rating: string | null;
    type: string | null;
  };
  const [bondQuery, setBondQuery] = useState("");
  const [bondHits, setBondHits] = useState<BondHit[]>([]);
  const [allBonds, setAllBonds] = useState<BondHit[]>([]);
  const [showBondList, setShowBondList] = useState(false);
  const [selectedBonds, setSelectedBonds] = useState<BondHit[]>([]);

  useEffect(() => {
    fetch("/security-master.json")
      .then((r) => r.json())
      .then((rows: BondHit[]) => Array.isArray(rows) && setAllBonds(rows))
      .catch(() => {});
  }, []);

  const searchBonds = (q: string) => {
    setBondQuery(q);
    if (q.trim().length < 2) { setBondHits([]); setShowBondList(false); return; }
    const ql = q.toLowerCase();
    const qIsin = ql.replace(/\s/g, "");
    const hits = allBonds.filter(
      (b) =>
        (b.isin || "").toUpperCase().startsWith(qIsin.toUpperCase()) ||
        (b.security_name || "").toLowerCase().includes(ql) ||
        (b.isin || "").toUpperCase().includes(qIsin.toUpperCase())
    ).slice(0, 12);
    setBondHits(hits);
    setShowBondList(hits.length > 0);
  };

  const selectBond = (b: BondHit) => {
    const FREQ: Record<string, string> = {
      Monthly: "MONTHLY", Quarterly: "QUARTERLY", "Semi-Annual": "SEMI-ANNUALLY",
      Annual: "ANNUALLY", "ZERO_COUPON": "CUMULATIVE",
    };
    const bn = b.security_name || "";
    const hasCpn = /^\d{1,2}(?:\.\d+)?\s*%/.test(bn);
    const mat = b.maturity ? new Date(b.maturity).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "";
    const base = hasCpn ? bn : `${b.coupon || 0}% ${bn}`;
    const secName = mat && !bn.toUpperCase().includes(mat) ? `${base} ${mat}`.trim() : base;
    setSec((s) => ({
      ...s,
      securityName: secName,
      isin: b.isin || "",
      couponRate: b.coupon != null ? String(b.coupon) : s.couponRate,
      paymentDates: FREQ[b.coupon_frequency] || s.paymentDates,
      maturityDate: b.maturity || s.maturityDate,
      price: b.offer_price != null ? String(b.offer_price) : s.price,
      yieldValue: b.offer_yield != null ? String(b.offer_yield) : s.yieldValue,
      facePerUnit: b.face_value != null ? String(b.face_value) : s.facePerUnit,
    }));
    setBondQuery("");
    setBondHits([]);
    setShowBondList(false);
  };

  /* multi-select: add bond to selection without clearing previous */
  const addBondToSelection = (b: BondHit) => {
    if (selectedBonds.some((x) => x.isin === b.isin)) return;
    setSelectedBonds((prev) => [...prev, b]);
    selectBond(b);
    setBondQuery("");
    setBondHits([]);
    setShowBondList(false);
  };

  const removeBondFromSelection = (isin: string) => {
    setSelectedBonds((prev) => prev.filter((x) => x.isin !== isin));
  };

  /* ---- security (manual) ---- */
  const [yieldAuto, setYieldAuto] = useState(!editMode);
  const [sec, setSec] = useState<SecState>({
    securityName: initial?.securityName ?? "",
    isin: initial?.isin ?? "",
    couponRate: initial?.couponRate != null ? String(initial.couponRate) : "",
    paymentDates: initial?.interestPaymentDates ?? "MONTHLY",
    maturityDate: initial?.maturityDate?.slice(0, 10) ?? "",
    price: initial?.cleanPrice != null ? String(initial.cleanPrice) : initial?.price != null && initial.price <= 5000 ? String(initial.price) : "",
    yieldValue: initial?.yieldValue != null ? String(initial.yieldValue) : "",
    facePerUnit:
      initial?.faceValue != null && initial?.quantity
        ? String(initial.faceValue / initial.quantity)
        : "100000",
    units: initial?.quantity != null ? String(initial.quantity) : "",
    interestDays: initial?.interestDays != null ? String(initial.interestDays) : "13",
  });
  const setS = useCallback(
    (k: keyof SecState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setSec((s) => ({ ...s, [k]: e.target.value })),
    []
  );

  /* live amounts — exhaustive deal confirmation math:
     faceTot = face/unit × units
     principal = faceTot × clean price% / 100      (bond convention, clean per ₹100 face)
     per-unit price = face/unit × price% / 100      (what the letterhead PDF shows as PRICE)
     accrued = faceTot × coupon% × days / 365      (± days, ACT/365 — long-stub rebates go negative)
               manual override always wins if typed (+/- amount)
     stamp duty slab: <500k→0, 500k-1,499,999.99→1, 1.5M-2,499,999.99→2, etc. (Rs.1 per Rs.10 lakh part)
     total consideration = principal + accrued + stamp duty */
  const auto = useMemo(() => {
    const pricePct = Number(sec.price) || 0;
    const units = Number(sec.units) || 0;
    const fpu = Number(sec.facePerUnit) || 0;
    const coupon = Number(sec.couponRate) || 0;
    const days = Number(sec.interestDays) || 0;
    const faceTot = Math.round(fpu * units) || 0;
    const principal = Math.round(((faceTot * pricePct) / 100) * 100) / 100;
    const perUnitPrice = Math.round(((fpu * pricePct) / 100) * 100) / 100;
    const accruedByDays = Math.round(((faceTot * coupon) / 100) * (days / 365) * 100) / 100;
    const dealAmount = Math.round((principal + accruedByDays) * 100) / 100;
    const stampDuty = calcStampDuty(dealAmount);
    return { pricePct, units, fpu, faceTot, principal, perUnitPrice, accruedByDays, dealAmount, stampDuty };
  }, [sec.price, sec.units, sec.facePerUnit, sec.couponRate, sec.interestDays]);

  /* ---- editable amount overrides (blank = auto; edit mode preloads stored figures) ---- */
  const [ov, setOv] = useState<{ principal: string; accrued: string; stampDuty: string; total: string }>(() => ({
    principal: initial?.principalAmount != null ? String(initial.principalAmount) : "",
    accrued: initial?.accruedInterest != null ? String(initial.accruedInterest) : "",
    stampDuty: (initial as unknown as { stampDuty?: number | null })?.stampDuty != null ? String((initial as unknown as { stampDuty: number }).stampDuty) : "",
    total: initial?.totalConsideration != null ? String(initial.totalConsideration) : "",
  }));
  const numOv = (v: string) => (v.trim() === "" ? null : Number(v));
  const amounts = useMemo(() => {
    const principal = numOv(ov.principal) ?? auto.principal;
    const accrued = Math.round((numOv(ov.accrued) ?? auto.accruedByDays) * 100) / 100;
    const dealAmount = Math.round((principal + accrued) * 100) / 100;
    const stampDuty = numOv(ov.stampDuty) ?? calcStampDuty(dealAmount);
    const total = numOv(ov.total) ?? Math.round((dealAmount + stampDuty) * 100) / 100;
    return { ...auto, principal, accrued, dealAmount, stampDuty, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, ov]);
  const autoPrincipal = numOv(ov.principal) == null;
  const autoAccrued = numOv(ov.accrued) == null;
  const autoStampDuty = numOv(ov.stampDuty) == null;
  const autoTotal = numOv(ov.total) == null;

  /* ---- auto YTM from dated cashflows (face-based price) ---- */
  const computedYield = useMemo(
    () =>
      ytmPercent({
        priceClean: auto.perUnitPrice || 0,
        accruedPerUnit: amounts.accrued / Math.max(1, Number(sec.units) || 1),
        facePerUnit: Number(sec.facePerUnit) || 0,
        couponRatePct: Number(sec.couponRate) || 0,
        maturityIso: sec.maturityDate || null,
        paymentDates: sec.paymentDates,
        settleIso: date,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sec.price, sec.units, sec.facePerUnit, sec.couponRate, sec.maturityDate, sec.paymentDates, date, amounts.accrued]
  );
  useEffect(() => {
    if (yieldAuto && computedYield != null) {
      setSec((s) => ({ ...s, yieldValue: String(computedYield) }));
    }
  }, [computedYield, yieldAuto]);

  /* ---- coupon rate auto-extracted from the security name (e.g. "13.00% Lucina…") ---- */
  const [couponAuto, setCouponAuto] = useState(!editMode);
  const onSecurityName = (v: string) => {
    setSec((s) => ({ ...s, securityName: v }));
    const m = v.match(/^(?:\s*)(\d{1,2}(?:\.\d+)?)\s*%/);
    if (couponAuto && m) {
      setSec((s) => ({ ...s, couponRate: m[1] }));
    }
  };

  /* ---- submit ---- */
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; refNo: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Select a client (auto from KYC database).");
    if (!clientDocs || clientDocs.okCount < 4) {
      const missing = (clientDocs?.items || []).filter((i) => !i.ok).map((i) => i.label).join(", ");
      return setError(`KYC incomplete — 4/4 documents compulsory. Missing: ${missing}. Complete the client KYC first.`);
    }
    if (!sec.securityName.trim()) return setError("Security name is required (manual entry).");
    if (!(amounts.pricePct > 0)) return setError("Clean price (per ₹100 face) must be greater than zero.");
    if (!(amounts.units > 0)) return setError("Number of units must be at least 1.");
    setSaving(true);
    try {
      const body = JSON.stringify({
        clientId,
        type,
        date,
        refNo,
        serial,
        securityName: sec.securityName,
        isin: sec.isin,
        couponRate: Number(sec.couponRate),
        paymentDates: sec.paymentDates,
        maturityDate: sec.maturityDate,
        price: amounts.perUnitPrice,
        cleanPrice: Number(sec.price),
        yieldValue: Number(sec.yieldValue),
        facePerUnit: Number(sec.facePerUnit),
        quantity: amounts.units,
        interestDays: Number(sec.interestDays),
        clientAddress: client?.address ?? undefined,
        principalAmount: amounts.principal,
        accruedInterest: amounts.accrued,
        stampDuty: amounts.stampDuty,
        totalConsideration: amounts.total,
      });
      const res = editMode
        ? await fetch(`/api/deals/${dealId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body,
          })
        : await fetch("/api/deals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not save deal");
      setCreated({ id: j.id, refNo: j.refNo });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save deal");
    } finally {
      setSaving(false);
    }
  }

  const resetForAnother = () => {
    setCreated(null);
    setClientId("");
    setSec({
      securityName: "", isin: "", couponRate: "", paymentDates: "MONTHLY", maturityDate: "",
      price: "", yieldValue: "", facePerUnit: "100000", units: "", interestDays: "13",
    });
    setRefTouched(false);
  };

  if (created) {
    return (
      <div className="container-x">
        <div className="wrap-narrow pt-10 fade-in">
          <div className="quote-result">
            <h3>{editMode ? "Deal updated" : "Deal confirmed"} — {created.refNo}</h3>
            <p className="mt-1 text-[13px]" style={{ marginTop: 6 }}>
              Saved to the register. The letterhead PDF reflects the saved terms.
            </p>
            <div className="flex gap-3 mt-5 flex-wrap">
              <a className="btn" href={`/api/deals/${created.id}/pdf`} target="_blank" rel="noreferrer">
                ⬇ Download confirmation PDF
              </a>
              {editMode ? (
                <Link href="/deals" className="btn-ghost">← All confirmed deals</Link>
              ) : (
                <button className="btn-ghost" onClick={resetForAnother}>+ Another deal</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-[900px] space-y-5 mt-7 pb-4 fade-in">
      {/* 1 · client */}
      <div className="card">
        <h2>
          <span className="dot" />1 · Client{" "}
          <span className="badge gold">{editMode ? "locked to deal holder" : "auto from KYC database"}</span>
        </h2>
        {editMode ? (
          <div className="grid sm:grid-cols-3 gap-4">
            <ReadOnly label="Client (fixed)" value={initial?.client?.holderName || "—"} />
            <ReadOnly label="UCC" value={initial?.client?.ucc || "—"} />
            <ReadOnly label="PAN" value={initial?.client?.panNumber || "—"} />
          </div>
        ) : (
          <label className="block">
            <span className="text-[12px] font-medium">Client Name *</span>
            <select
              className="calc-input w-full mt-1.5"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">{clients.length ? "— Select client —" : "No clients yet"}</option>
              {clients.map((c) => {
                const ok = DOC_STRIP.filter((d) => Boolean(c[d.key] || "")).length;
                return (
                  <option key={c.id} value={c.id}>
                    {c.holderName || c.ucc} — {ok}/4 KYC docs — UCC {c.ucc}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        {client && clientDocs ? (
          <>
            {/* 4/4 document status */}
            <div className={`rounded-xl border p-4 mt-4 ${clientDocs.okCount === 4
              ? "border-pos/35 bg-pos-soft/70"
              : "border-red/30 bg-red-soft/70"}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[11px] font-semibold tracking-[0.08em] uppercase"
                  style={{ color: clientDocs.okCount === 4 ? "#1a7f3d" : "var(--color-red)" }}>
                  KYC documents — {clientDocs.okCount}/4 compulsory
                </p>
                <span className={`auto-tag ${clientDocs.okCount === 4 ? "text-pos" : ""}`}
                  style={clientDocs.okCount === 4 ? { color: "#1a7f3d" } : {}}>
                  {clientDocs.okCount === 4 ? "✓ deal allowed" : "deal blocked until 4/4"}
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-4 gap-2 mt-3">
                {clientDocs.items.map((d) => (
                  <div key={d.label}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11.5px] font-semibold ${
                      d.ok ? "border-pos/30 bg-white/70 text-[#1a7f3d]" : "border-red/25 bg-white/70 text-red"}`}>
                    <span aria-hidden>{d.ok ? "✓" : "✕"}</span>{d.label}
                  </div>
                ))}
              </div>
              {clientDocs.okCount < 4 ? (
                <p className="note !mt-2">
                  <Link href="/kyc" style={{ textDecoration: "underline" }}>Update the client KYC</Link>{" "}
                  (PAN + Aadhaar + cancelled cheque + CML/CMR) — enforced server-side as well.
                </p>
              ) : null}
            </div>
            <div className="grid sm:grid-cols-3 gap-4 mt-4">
              <ReadOnly label="PAN" value={client.panNumber || "—"} />
              <ReadOnly label="UCC" value={client.ucc} />
              <ReadOnly label="Mobile" value={client.mobileNo} />
            </div>
            <div className="rounded-xl border border-gold-line bg-gold-soft p-4 mt-4">
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-gold-deep">
                Demat details — fetched from earlier KYC
              </p>
              <div className="grid sm:grid-cols-3 gap-3 mt-3">
                <ReadOnly label="DP ID / Client ID" value={[client.dpId, client.clientId].filter(Boolean).join(" · ") || "—"} />
                <ReadOnly label="BO ID (DP+Client)" value={[client.dpId, client.clientId].filter(Boolean).join("") || "—"} />
                <ReadOnly label="DP Name" value={client.dpName || "—"} />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* 2 · security */}
      <div className="card">
        <h2><span className="dot" />2 · Security &amp; Deal Terms <span className="badge">directory search · manual override</span></h2>
        <div className="relative">
          <label className="block">
            <span className="text-[12px] font-medium">Search security (from bond directory) <span className="auto-tag">auto-fills coupon · price · maturity · face</span></span>
            <input className="calc-input w-full mt-1.5"
              placeholder="Type issuer name or ISIN…"
              value={bondQuery}
              onChange={(e) => searchBonds(e.target.value)}
              onFocus={() => bondHits.length && setShowBondList(true)}
              onBlur={() => setTimeout(() => setShowBondList(false), 150)} />
          </label>
          {showBondList ? (
            <div className="absolute z-20 w-full mt-1 rounded-xl border border-line bg-white shadow-lift overflow-hidden max-h-[240px] overflow-y-auto">
              {bondHits.map((b) => (
                <button key={b.slug} type="button" className="w-full text-left px-4 py-2.5 hover:bg-paper transition-colors border-b border-line last:border-0"
                  onMouseDown={() => addBondToSelection(b)}>
                  <p className="text-[13px] font-medium truncate">{b.security_name}</p>
                  <p className="text-[11px] muted num mt-0.5">
                    {b.isin} · {b.coupon ?? "—"}% {b.coupon_frequency || ""} · {b.maturity ? b.maturity.slice(0, 10) : "—"} ·
                    {' '}₹{b.offer_price ?? "—"}/{b.face_value ?? "—"} · {b.credit_rating || "—"} · {b.type || ""}
                  </p>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {selectedBonds.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedBonds.map((b) => (
              <span key={b.isin} className="inline-flex items-center gap-1 rounded-full border border-gold-line bg-gold-soft px-2.5 py-0.5 text-[11px] font-medium text-gold-deep">
                {b.security_name?.slice(0, 35) || b.isin}
                <button type="button" className="ml-0.5 text-[13px] leading-none hover:text-red" onClick={() => removeBondFromSelection(b.isin)} title="Remove">×</button>
              </span>
            ))}
            {selectedBonds.length > 1 ? (
              <button type="button" className="text-[10px] muted underline hover:text-red" onClick={() => setSelectedBonds([])}>clear all</button>
            ) : null}
          </div>
        ) : null}
        <label className="block mt-3">
          <span className="text-[12px] font-medium">Security name (final — editable) *</span>
          <input className="calc-input w-full mt-1.5"
            placeholder="13.00% Lucina Land Development Limited 30/Jan/2029"
            value={sec.securityName} onChange={(e) => onSecurityName(e.target.value)} />
        </label>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <label className="block">
            <span className="text-[12px] font-medium">ISIN</span>
            <input className="calc-input w-full mt-1.5 uppercase" placeholder="INE0IZ007040" maxLength={12}
              value={sec.isin}
              onChange={(e) => setSec((s) => ({ ...s, isin: e.target.value.toUpperCase() }))} />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium">
              Coupon rate (%) <span className="auto-tag">auto from name</span>
            </span>
            <div className="flex items-center gap-2 mt-1.5">
              <input className="calc-input flex-1" inputMode="decimal" step="0.0001" placeholder="13.00"
                value={sec.couponRate}
                onChange={(e) => { setCouponAuto(false); setSec((s) => ({ ...s, couponRate: e.target.value })); }} />
              <button type="button"
                className={`shrink-0 text-[10px] px-2 py-1.5 rounded-full border ${couponAuto ? "border-gold-line bg-gold-soft text-gold-deep" : "border-line muted"}`}
                onClick={() => setCouponAuto((v) => !v)}>
                {couponAuto ? "AUTO" : "manual"}
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-[12px] font-medium">Interest payment dates</span>
            <select className="calc-input w-full mt-1.5" value={sec.paymentDates} onChange={setS("paymentDates")}>
              <option>MONTHLY</option>
              <option>QUARTERLY</option>
              <option>SEMI-ANNUALLY</option>
              <option>ANNUALLY</option>
              <option>CUMULATIVE</option>
            </select>
          </label>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <label className="block">
            <span className="text-[12px] font-medium">Maturity date</span>
            <input type="date" className="calc-input w-full mt-1.5"
              value={sec.maturityDate} onChange={setS("maturityDate")} />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium">Face value (per unit) *</span>
            <input className="calc-input w-full mt-1.5 num" inputMode="numeric" placeholder="100000"
              value={sec.facePerUnit} onChange={setS("facePerUnit")} />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium">No of units *</span>
            <input className="calc-input w-full mt-1.5 num" inputMode="numeric" placeholder="4"
              value={sec.units} onChange={setS("units")} />
          </label>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <label className="block">
            <span className="text-[12px] font-medium">Clean price (per ₹100 face) *</span>
            <input className="calc-input w-full mt-1.5 num" inputMode="decimal" step="0.0001" placeholder="99.1424"
              value={sec.price} onChange={setS("price")} />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium">
              Yield (% YTM)
              {computedYield != null ? (
                <button type="button"
                  className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full border ${yieldAuto ? "border-gold-line bg-gold-soft text-gold-deep" : "border-line muted"}`}
                  onClick={() => setYieldAuto((v) => !v)}>
                  {yieldAuto ? `AUTO · IRR (${computedYield}%)` : "AUTO"}
                </button>
              ) : null}
            </span>
            <input className="calc-input w-full mt-1.5 num" inputMode="decimal" step="0.0001" placeholder="13.38"
              value={sec.yieldValue}
              onChange={(e) => { setYieldAuto(false); setSec((s) => ({ ...s, yieldValue: e.target.value })); }} />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium">Accrued interest days <span className="auto-tag">± ACT/365</span></span>
            <div className="flex items-center gap-1.5 mt-1.5">
              <button type="button" title="Minus 1 day"
                className="shrink-0 size-8 rounded-lg border border-line2 bg-white text-[15px] font-semibold hover:border-gold-line hover:shadow-soft transition"
                onClick={() => setSec((s) => ({ ...s, interestDays: String((numDays(s.interestDays) ?? 0) - 1) }))}>−</button>
              <input type="text" className="calc-input flex-1 text-center num" placeholder="13"
                value={sec.interestDays}
                onChange={(e) => setSec((s) => ({ ...s, interestDays: e.target.value.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "").slice(0, 5) }))} />
              <button type="button" title="Plus 1 day"
                className="shrink-0 size-8 rounded-lg border border-line2 bg-white text-[15px] font-semibold hover:border-gold-line hover:shadow-soft transition"
                onClick={() => setSec((s) => ({ ...s, interestDays: String((numDays(s.interestDays) ?? 0) + 1) }))}>+</button>
            </div>
            <p className="text-[11px] muted mt-1">Type a minus (e.g. −6) or press − for long-stub rebates · face × coupon% × days ÷ 365</p>
          </label>
        </div>

        {/* date & ref — above exchange */}
        <div className="mt-5 pt-5 border-t border-line">
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase muted mb-3">Date &amp; Reference No <span className="badge ml-2">calendar · serial · editable</span></p>
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="text-[12px] font-medium">Date * <span className="auto-tag">calendar</span></span>
              <input type="date" className="calc-input w-full mt-1.5" value={date}
                onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium">Side *</span>
              <select className="calc-input w-full mt-1.5" value={type}
                onChange={(e) => setType(e.target.value as "TB" | "TS")}>
                <option value="TS">TS — Today Sell</option>
                <option value="TB">TB — Today Buy</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] font-medium">Serial (per day/side)</span>
              <input type="number" min={1} max={999} className="calc-input w-full mt-1.5 num" value={serial}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(999, Number(e.target.value) || 1));
                  setSerial(v);
                  setRefNo(`${type}${ymdOf(date)}${pad3(v)}`);
                }} />
            </label>
          </div>
          <label className="block mt-4">
            <span className="text-[12px] font-medium">Reference No (editable)</span>
            <input className="calc-input w-full mt-1.5 font-mono tracking-wide uppercase" value={refNo}
              onChange={(e) => {
                setRefNo(e.target.value.toUpperCase());
                setRefTouched(true);
              }} />
          </label>
          <p className="note -mt-1">
            Format <b>{`${type}·YYYYMMDD·###`}</b> — suggested automatically as the next serial in order for this
            day &amp; side; overwrite freely before saving.
          </p>
        </div>

        {/* exchange — hardcoded, always last */}
        <div className="mt-5 pt-5 border-t border-line">
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase muted mb-3">Exchange &amp; Settlement <span className="badge gold ml-2">hardcoded · permanent</span></p>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[12px] font-medium">Exchange</span>
              <input className="calc-input w-full mt-1.5" value="BSE" readOnly />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium">Market type / settlement</span>
              <input className="calc-input w-full mt-1.5" value="BSE T+0 — BSE CLEARING CORPORATION" readOnly />
            </label>
          </div>
        </div>
      </div>

      {/* amounts — face × price% → principal; accrued manual ±; stamp slab; TC = sum */}
      <div className="kpis">
        <div className="kpi"><div className="k">Total face value</div><div className="v">{inr(amounts.faceTot)}</div><div className="s">{amounts.units || 0} unit(s) of {inr(amounts.fpu)}</div></div>
        <div className="kpi">
          <div className="k flex items-center gap-2">Principal amount
            <button type="button" title="Revert to auto"
              className={`text-[9px] px-1.5 py-0.5 rounded-full border leading-none ${autoPrincipal ? "border-gold-line bg-gold-soft text-gold-deep" : "border-line muted"}`}
              onClick={() => setOv((o) => ({ ...o, principal: "" }))}>
              {autoPrincipal ? "AUTO" : "custom"}
            </button>
          </div>
          <input type="text" inputMode="decimal" className="calc-input mt-1.5 font-medium num !text-[15px]" placeholder={inr(auto.principal).replace("Rs. ", "")}
            value={ov.principal} onChange={(e) => setOv((o) => ({ ...o, principal: e.target.value }))} />
          <div className="s">face × {auto.pricePct || 0}% ÷ 100 · price/unit {inr(auto.perUnitPrice)}</div>
        </div>
        <div className="kpi">
          <div className="k flex items-center gap-2">Accrued interest
            <button type="button" title="Revert to days-based formula"
              className={`text-[9px] px-1.5 py-0.5 rounded-full border leading-none ${autoAccrued ? "border-gold-line bg-gold-soft text-gold-deep" : "border-line muted"}`}
              onClick={() => setOv((o) => ({ ...o, accrued: "" }))}>
              {autoAccrued ? `AUTO · ±days` : "custom"}
            </button>
          </div>
          <input type="text" className="calc-input mt-1.5 font-medium num !text-[15px]"
            placeholder={inr(auto.accruedByDays).replace("Rs. ", "RS ") || "0.00"}
            value={ov.accrued}
            onChange={(e) => setOv((o) => ({ ...o, accrued: e.target.value.replace(/[^\d.-]/g, "") }))} />
          <div className="s">face × {sec.couponRate || 0}% × {sec.interestDays || 0} days ÷ 365{sec.interestDays && +sec.interestDays < 0 ? " (negative days → rebate)" : ""}</div>
        </div>
        <div className="kpi">
          <div className="k flex items-center gap-2">Stamp duty
            <button type="button" title="Revert to slab"
              className={`text-[9px] px-1.5 py-0.5 rounded-full border leading-none ${autoStampDuty ? "border-gold-line bg-gold-soft text-gold-deep" : "border-line muted"}`}
              onClick={() => setOv((o) => ({ ...o, stampDuty: "" }))}>
              {autoStampDuty ? "AUTO · slab" : "custom"}
            </button>
          </div>
          <input type="text" inputMode="numeric" className="calc-input mt-1.5 font-medium num !text-[15px]" placeholder={String(auto.stampDuty)}
            value={ov.stampDuty} onChange={(e) => setOv((o) => ({ ...o, stampDuty: e.target.value.replace(/[^\d]/g, "") }))} />
          <div className="s">Slab: &lt;5L→0, 5L-15L→1, 15L-25L→2… (Rs.1/10L)</div>
        </div>
        <div className="kpi accent">
          <div className="k flex items-center gap-2">Total consideration
            <button type="button" title="Revert to auto"
              className={`text-[9px] px-1.5 py-0.5 rounded-full border leading-none ${autoTotal ? "border-gold-line bg-gold-soft text-gold-deep" : "border-line muted"}`}
              onClick={() => setOv((o) => ({ ...o, total: "" }))}>
              {autoTotal ? "AUTO" : "custom"}
            </button>
          </div>
          <input type="text" inputMode="decimal" style={{ color: "var(--color-gold-deep)" }} className="calc-input mt-1.5 font-semibold num !text-[15px]" placeholder={inr(amounts.total).replace("Rs. ", "")}
            value={ov.total} onChange={(e) => setOv((o) => ({ ...o, total: e.target.value }))} />
          <div className="s">{autoTotal ? "principal + accrued + stamp" : "manual — PDF uses this"}</div>
        </div>
      </div>
      <p className="note !mt-2">
        <b>Logic:</b> Total face value = face/unit × units · Principal = face × clean price% ÷ 100 (price is
        per ₹100 face) · Accrued = face × coupon% × days/365 (or manual ±) ·
        Stamp = slab on deal amount (principal+accrued): &lt;5L→0, 5L-15L→1, 15L-25L→2, +1 per 10L ·
        Total consideration = principal + accrued + stamp. Override any tile — AUTO restores slab.
      </p>

      {error ? <div className="flash error">{error}</div> : null}

      <button type="submit" className="btn w-full" disabled={saving || (!editMode && !clients.length) || (!!client && !!clientDocs && clientDocs.okCount < 4)}>
        {saving ? "Saving…" :
          editMode ? `Save changes (${refNo})` :
          clientDocs && clientDocs.okCount < 4 ? `KYC incomplete (${clientDocs.okCount}/4) — upload missing docs first` :
          `Generate ${type === "TS" ? "Sell" : "Buy"} Confirmation (${refNo})`}
      </button>
    </form>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.1em] uppercase muted">{label}</p>
      <p className="num text-[14px] font-medium mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{value}</p>
    </div>
  );
}
