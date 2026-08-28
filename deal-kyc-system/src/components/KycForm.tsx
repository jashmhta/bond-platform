"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parseDocument } from "@/lib/ocr";
import { scanImage } from "@/lib/scan";
import { optimizeImage, prepForOcr } from "@/lib/image";
import { extractPdf } from "@/lib/pdf-text";

type ScanState = { status: "idle" | "scanning" | "done" | "error" | "skipped"; message?: string; pct?: number };

const DOC_KEYS = ["panDocUrl", "aadharDocUrl", "aadharBackUrl", "cancelledChequeUrl", "cmlCmrUrl"] as const;
type DocKey = (typeof DOC_KEYS)[number];

/* 4 compulsory documents — deal confirmation is blocked unless all four exist */
const CORE_DOCS: Array<{ key: DocKey; label: string; hint: string }> = [
  { key: "panDocUrl", label: "PAN card", hint: "Identity" },
  { key: "aadharDocUrl", label: "Aadhaar", hint: "Identity" },
  { key: "cancelledChequeUrl", label: "Cancelled cheque", hint: "Bank account" },
  { key: "cmlCmrUrl", label: "CML / CMR", hint: "Demat" },
];

export type KycFormValues = {
  holderName: string; fatherName: string; panNumber: string; dob: string;
  aadhaarNumber: string; mobileNo: string; email: string; ucc: string; address: string;
  occupation: string; nomineeName: string;
  bankIfsc: string; bankAccountNo: string; bankName: string;
  dpId: string; clientId: string; dpName: string;
};

export type KycFormDocs = Record<DocKey, string>;

type DocMeta = Record<DocKey, { url: string; name: string; size: number }>;

const EMPTY_VALUES: KycFormValues = {
  holderName: "", fatherName: "", panNumber: "", dob: "", aadhaarNumber: "",
  mobileNo: "", email: "", ucc: "", address: "", occupation: "", nomineeName: "",
  bankIfsc: "", bankAccountNo: "", bankName: "", dpId: "", clientId: "", dpName: "",
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/* ---------------- input constraints ---------------- */
const up = (v: string, n: number) => v.toUpperCase().replace(/\s+/g, " ").slice(0, n);
const digits = (v: string, n: number) => v.replace(/\D/g, "").slice(0, n);
const alnumUp = (v: string, n: number) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n);

export default function KycForm({
  mode,
  clientId,
  initial,
  initialDocs,
}: {
  mode: "new" | "edit";
  clientId?: string;
  initial?: Partial<KycFormValues>;
  initialDocs?: Partial<KycFormDocs>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; ucc: string } | null>(null);
  const [error, setError] = useState("");

  const [form, setForm] = useState<KycFormValues>({ ...EMPTY_VALUES, ...initial });

  const [docs, setDocs] = useState<DocMeta>(() => {
    const base = {} as DocMeta;
    for (const k of DOC_KEYS) base[k] = { url: (initialDocs as Record<string, string | undefined>)?.[k] ?? "", name: "", size: 0 };
    return base;
  });
  const [activeDoc, setActiveDoc] = useState<DocKey | null>(
    (DOC_KEYS.find((k) => (initialDocs as Record<string, string | undefined>)?.[k]) as DocKey) ?? null
  );
  const [scan, setScan] = useState<Record<string, ScanState>>({});
  const fileRefs = useRef<Partial<Record<DocKey, HTMLInputElement | null>>>({});

  /* BO ID auto-composed from DP + Client (8+8=16) */
  const boId = useMemo(() => `${form.dpId}${form.clientId}`, [form.dpId, form.clientId]);

  const clearDoc = (key: DocKey) => {
    setDocs((d) => ({ ...d, [key]: { url: "", name: "", size: 0 } }));
    if (fileRefs.current[key]) fileRefs.current[key]!.value = "";
    setActiveDoc((cur) => (cur === key ? null : cur));
  };

  function applyFields(kind: "pan" | "aadhaar" | "cheque" | "cml", fields: Record<string, string>) {
    setForm((f) => {
      const next = { ...f };
      if (kind === "pan") {
        if (fields.panNumber) next.panNumber = digits(fields.panNumber.toUpperCase(), 10);
        if (fields.holderName) next.holderName = up(fields.holderName, 60);
        if (fields.dob) next.dob = fields.dob;
      } else if (kind === "aadhaar") {
        if (fields.aadhaarNumber) next.aadhaarNumber = digits(fields.aadhaarNumber, 12);
        if (!next.holderName && fields.holderName) next.holderName = up(fields.holderName, 60);
        if (fields.address) next.address = fields.address.slice(0, 300);
        if (fields.dob && !next.dob) next.dob = fields.dob;
        else if (fields.yob && !next.dob) next.dob = `${fields.yob}-01-01`;
      } else if (kind === "cheque") {
        if (fields.ifsc) next.bankIfsc = alnumUp(fields.ifsc, 11);
        if (fields.accountNo) next.bankAccountNo = digits(fields.accountNo, 20);
        if (fields.bankName) next.bankName = up(fields.bankName, 40);
      } else if (kind === "cml") {
        if (fields.dpId) next.dpId = alnumUp(fields.dpId, 8);
        if (fields.clientId) next.clientId = digits(fields.clientId, 8);
        if (fields.dpName) next.dpName = up(fields.dpName, 50);
        if (fields.holderName) next.nomineeName = up(fields.holderName, 80);   // A/c holder from CML
        if (!next.holderName && fields.holderName) next.holderName = up(fields.holderName, 60);
        if (!next.address && fields.address) next.address = fields.address.slice(0, 300);
        if (!next.mobileNo && fields.mobileNo) next.mobileNo = digits(fields.mobileNo, 15);
        if (!next.email && fields.email) next.email = fields.email.toLowerCase().slice(0, 80);
      }
      return next;
    });
  }

  const FIELD_LABELS: Record<string, Record<string, string>> = {
    pan: { panNumber: "PAN", holderName: "Name", dob: "DOB" },
    aadhaar: { aadhaarNumber: "Aadhaar", holderName: "Name", dob: "DOB", address: "Addr" },
    cheque: { ifsc: "IFSC", accountNo: "A/c", bankName: "Bank" },
    cml: { dpId: "DP", clientId: "Client", dpName: "DP name", holderName: "Name", mobileNo: "Mob", email: "Email", address: "Addr" },
  };
  function checklist(kind: "pan" | "aadhaar" | "cheque" | "cml", fields: Record<string, string>): string {
    return Object.entries(FIELD_LABELS[kind])
      .map(([k, lbl]) => (fields[k] ? `✓${lbl}` : `·${lbl}`))
      .join("  ");
  }

  const onDoc = useCallback(async (key: DocKey, kind: "pan" | "aadhaar" | "cheque" | "cml", file: File | null) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setScan((s) => ({ ...s, [kind]: { status: "error", message: "Max 8 MB per document" } }));
      return;
    }
    setActiveDoc(key);
    const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);

    /* digital PDF: text-layer extraction — 100% accurate */
      if (isPdf) {
      setScan((s) => ({ ...s, [kind]: { status: "scanning", message: "Opening PDF…", pct: 10 } }));
      try {
        const pdf = await extractPdf(file);
        setDocs((d) => ({ ...d, [key]: { url: pdf.previewDataUrl, name: file.name, size: file.size } }));
        if (pdf.hasTextLayer) {
          const fields = parseDocument(kind, pdf.text);
          applyFields(kind, fields);
          const list = checklist(kind, fields);
          const any = Object.keys(fields).length > 0;
          setScan((s) => ({
            ...s,
            [kind]: {
              status: any ? "done" : "error",
              pct: 100,
              message: any ? `${list}  · digital PDF (100%)` : "PDF opened but no known fields found — fill manually",
            },
          }));
          return;
        }
        if (pdf.ocrBytes) {
          setScan((s) => ({ ...s, [kind]: { status: "scanning", message: "Scanned PDF — reading…", pct: 15 } }));
          const res = await scanImage(kind, pdf.ocrBytes, (m, p) =>
            setScan((st) => (st[kind]?.status === "scanning" ? { ...st, [kind]: { ...st[kind], pct: Math.min(p ?? 0, 95), message: m } } : st))
          );
          finishScan(kind, res);
          return;
        }
        setScan((s) => ({ ...s, [kind]: { status: "error", message: "Unreadable PDF — fill manually" } }));
      } catch {
        setScan((s) => ({ ...s, [kind]: { status: "error", message: "Could not open PDF — fill manually" } }));
      }
      return;
    }

    /* image: on-device OCR (neural first, tesseract fallback) */
    setScan((s) => ({ ...s, [kind]: { status: "scanning", message: "Preparing image…", pct: 2 } }));
    let ocrBytes: Uint8Array;
    try {
      const opt = await optimizeImage(file);
      const previewUrl = opt?.dataUrl ?? (await fileToDataUrl(file));
      setDocs((d) => ({ ...d, [key]: { url: previewUrl, name: file.name, size: file.size } }));
      ocrBytes = (await prepForOcr(file)) ?? opt?.bytes ?? new Uint8Array(await file.arrayBuffer());
    } catch {
      setScan((s) => ({ ...s, [kind]: { status: "error", message: "Could not process image" } }));
      return;
    }
    setScan((s) => ({ ...s, [kind]: { status: "scanning", message: "Reading document…", pct: 6 } }));
    const res = await scanImage(kind, ocrBytes, (m, p) =>
      setScan((st) => (st[kind]?.status === "scanning" ? { ...st, [kind]: { ...st[kind], pct: Math.min(p ?? 0, 96), message: m } } : st))
    );
    finishScan(kind, res);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finishScan(
    kind: "pan" | "aadhaar" | "cheque" | "cml",
    res: { ok: boolean; fields: Record<string, string>; engine: string; error?: string }
  ) {
    if (!res.ok) {
      setScan((s) => ({ ...s, [kind]: { status: "error", message: res.error || "OCR failed — fill manually" } }));
      return;
    }
    applyFields(kind, res.fields);
    const list = checklist(kind, res.fields);
    const any = Object.keys(res.fields).length > 0;
    const engineTag = res.engine === "neural" ? "neural OCR" : res.engine === "tesseract" ? "tesseract OCR" : "OCR";
    setScan((s) => ({
      ...s,
      [kind]: {
        status: any ? "done" : "error",
        pct: 100,
        message: any ? `${list}  · ${engineTag}` : `nothing detected (${engineTag}) — retake in good light`,
      },
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const missing: string[] = [];
    if (!form.mobileNo.trim()) missing.push("Mobile");
    if (!form.email.trim()) missing.push("Email");
    if (!form.ucc.trim()) missing.push("UCC");
    if (!form.holderName.trim()) missing.push("Holder Name");
    if (missing.length) {
      setError(`Required: ${missing.join(", ")}.`);
      return;
    }
    /* ---- zero-leak guard: blob: URLs die with the tab and must never be saved ---- */
    const deadDocs = DOC_KEYS.filter((k) => docs[k].url.startsWith("blob:"));
    if (deadDocs.length) {
      setError("A document preview link expired — remove and re-attach the highlighted file(s), then save.");
      return;
    }
    /* ---- 4/4 compulsory documents ---- */
    const missingDocs = CORE_DOCS.filter((d) => !docs[d.key].url).map((d) => d.label);
    if (missingDocs.length) {
      setError(`All 4 documents are compulsory — missing: ${missingDocs.join(", ")}. Left panel shows them; upload on the right side once each.`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        dob: form.dob || undefined,
        panDocUrl: docs.panDocUrl.url || undefined,
        aadharDocUrl: docs.aadharDocUrl.url || undefined,
        aadharBackUrl: docs.aadharBackUrl.url || undefined,
        cancelledChequeUrl: docs.cancelledChequeUrl.url || undefined,
        cmlCmrUrl: docs.cmlCmrUrl.url || undefined,
      };
      const res =
        mode === "edit"
          ? await fetch(`/api/clients/${clientId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch("/api/clients", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      setSaved({ id: j.id, ucc: j.ucc });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="container-x">
        <div className="wrap-narrow pt-10 fade-in">
          <div className="quote-result">
            <h3>{mode === "edit" ? "KYC updated" : "KYC saved"} — UCC {saved.ucc}</h3>
            <p className="mt-1 text-[13px]" style={{ marginTop: 6 }}>
              All details stay editable anytime from the clients list.
            </p>
            <div className="flex gap-3 mt-5 flex-wrap">
              <Link href="/deals/new" className="btn">Create deal confirmation</Link>
              <Link href="/kyc" className="btn-ghost">View clients</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const docLabels: Record<DocKey, string> = {
    panDocUrl: "PAN card",
    aadharDocUrl: "Aadhaar (front)",
    aadharBackUrl: "Aadhaar (back / address)",
    cancelledChequeUrl: "Cancelled cheque",
    cmlCmrUrl: "CML / CMR",
  };
  const shown = activeDoc ? docs[activeDoc] : null;

  /* ---------- field renderers ---------- */
  const F = (
    label: React.ReactNode,
    input: React.ReactNode
  ) => (
    <label className="block">
      <span className="text-[12px] font-medium">{label}</span>
      <span className="block mt-1.5">{input}</span>
    </label>
  );

  const fmtSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  const DF = (key: DocKey, kind: "pan" | "aadhaar" | "cheque" | "cml", label: React.ReactNode) => {
    const meta = docs[key];
    return F(label, (
      <div className="relative">
        <input ref={(el) => { fileRefs.current[key] = el; }} type="file" accept="image/*,.pdf,application/pdf"
          className={`calc-input w-full py-1 ${meta.url ? "pr-2" : "pr-16"}`}
          onChange={(e) => onDoc(key, kind, e.target.files?.[0] ?? null)} />
        {meta.url ? (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 max-w-[55%]">
            <span className="inline-flex items-center gap-1 rounded-full border border-pos/30 bg-pos-soft px-2 py-0.5 text-[11px] font-medium text-[#1a7f3d] min-w-0">
              <span className="truncate">{meta.name}</span>
              <span className="opacity-70 shrink-0">·{fmtSize(meta.size)}</span>
            </span>
            <button type="button" title="Remove document"
              className="size-5 shrink-0 rounded-full bg-red-soft text-red grid place-items-center text-[10px] font-bold hover:brightness-95"
              onClick={() => clearDoc(key)}>✕</button>
          </span>
        ) : null}
      </div>
    ));
  };

  return (
    <div className="bg-paper lg:fixed lg:inset-0 lg:top-[var(--nav-h,64px)] lg:flex lg:flex-row lg:overflow-hidden">
      {/* ================= LEFT · FORM ================= */}
      <div className="lg:flex-1 lg:overflow-y-auto px-4 sm:px-8 pt-6 pb-16">
        <span className="eyebrow">KYC · BinaryBonds</span>
        <h1 className="text-[clamp(1.7rem,3vw,2.3rem)] font-semibold tracking-[-0.03em] leading-tight mt-1">
          {mode === "edit" ? "Edit client KYC" : "Client KYC"}
        </h1>
        <p className="muted text-[13.5px] mt-1">
          Upload each document → OCR autofills the fields → everything stays editable.
        </p>

        {/* ===== document tracker — 4/4 compulsory ===== */}
        <div className="card mt-5 !py-4">
          <h2 className="!mb-3"><span className="dot" />Documents —4/4 compulsory</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CORE_DOCS.map((d) => {
              const ok = !!docs[d.key].url;
              return (
                <button key={d.key} type="button"
                  onClick={() => { setActiveDoc(d.key); if (!ok) fileRefs.current[d.key]?.click(); }}
                  className={`group relative text-left rounded-xl border p-3 transition-all ${ok
                    ? "border-pos/40 bg-pos-soft/60 hover:shadow-soft"
                    : "border-gold-line bg-gold-soft/60 hover:shadow-soft border-dashed"}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`h-[22px] w-[22px] rounded-full grid place-items-center text-[11px] font-bold ring-2 ${ok ? "bg-pos text-white ring-pos/20" : "bg-white text-line2 ring-gold-line"}`}>
                      {ok ? "✓" : "!"}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] muted">{d.hint}</span>
                  </span>
                  <span className="block text-[13px] font-semibold mt-2 leading-tight">{d.label}</span>
                  <span className={`block text-[11px] mt-0.5 ${ok ? "text-pos" : "muted"}`}>
                    {ok ? (docs[d.key].name || "Attached") : "Not attached"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="note !mt-3">
            Deal confirmation stays locked until all 4 are attached — PAN, Aadhaar (front), cancelled
            cheque, CML/CMR. Missing ones are flagged above and enforced server-side too.
          </p>
          {/* progress strip */}
          <div className="flex items-center gap-3 mt-3">
            <div className="flex-1 h-1.5 rounded-full bg-surface overflow-hidden">
              <div className="h-full rounded-full bg-pos transition-all duration-500"
                style={{ width: `${(CORE_DOCS.filter((d) => docs[d.key].url).length / 4) * 100}%` }} />
            </div>
            <span className={`text-[12px] font-semibold num ${CORE_DOCS.every((d) => docs[d.key].url) ? "text-pos" : "muted"}`}>
              {CORE_DOCS.filter((d) => docs[d.key].url).length}/4
            </span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 mt-5 max-w-[860px]" spellCheck={false}>
          {/* 1 · identity */}
          <div className="card">
            <h2><span className="dot" />1 · Identity <span className="badge gold">PAN OCR</span></h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {F("Holder Name (as per PAN) *",
                <input className="calc-input w-full uppercase" placeholder="RAVI P SHAH" maxLength={60}
                  value={form.holderName}
                  onChange={(e) => setForm((f) => ({ ...f, holderName: up(e.target.value, 60) }))} />)}
              {F("Father's Name",
                <input className="calc-input w-full uppercase" placeholder="PRANLAL P SHAH" maxLength={60}
                  value={form.fatherName}
                  onChange={(e) => setForm((f) => ({ ...f, fatherName: up(e.target.value, 60) }))} />)}
              {F(<>Date of Birth <span className="auto-tag">OCR</span></>,
                <input type="date" className="calc-input w-full" value={form.dob}
                  onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />)}
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-3">
              {F("PAN Number *",
                <input className="calc-input w-full uppercase tracking-wider" placeholder="ABCDE1234F"
                  value={form.panNumber} maxLength={10}
                  onChange={(e) => setForm((f) => ({ ...f, panNumber: alnumUp(e.target.value, 10) }))} />)}
              {DF("panDocUrl", "pan", <span>PAN upload * <span className={docs.panDocUrl.url ? "text-pos" : "muted"}>{docs.panDocUrl.url ? "✓ attached" : ""}</span></span>)}
              {F("Occupation",
                <input className="calc-input w-full" placeholder="BUSINESS / SERVICE / RETIRED" maxLength={60}
                  value={form.occupation} onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value.slice(0, 60) }))} />)}
            </div>
            <button type="button" className="btn-ghost mt-3 text-[12px]"
              onClick={() => docs.panDocUrl.url && setActiveDoc("panDocUrl")}>
              ⤢ View PAN document
            </button>
            <ScanNote state={scan.pan} />
          </div>

          {/* 2 · aadhaar */}
          <div className="card">
            <h2><span className="dot" />2 · Aadhaar <span className="badge gold">front + back OCR</span></h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {F("Aadhaar Number *",
                <input className="calc-input w-full num tracking-widest" placeholder="123456789012"
                  value={form.aadhaarNumber}
                  onChange={(e) => setForm((f) => ({ ...f, aadhaarNumber: digits(e.target.value, 12) }))} />)}
              {DF("aadharDocUrl", "aadhaar", <>Front upload * <span className={docs.aadharDocUrl.url ? "text-pos" : "muted"}>{docs.aadharDocUrl.url ? "✓ attached" : ""}</span></>)}
              {DF("aadharBackUrl", "aadhaar", <><span>Back (address side)</span> <span className="badge gold">fills address</span> <span className={docs.aadharBackUrl.url ? "text-pos" : "muted"}>{docs.aadharBackUrl.url ? "✓ attached" : ""}</span></>)}
            </div>
            {F("Address (from Aadhaar back)",
              <textarea rows={2} className="calc-input w-full" placeholder="Registered address as per Aadhaar" maxLength={300}
                value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />)}
            <div className="flex gap-2 mt-2">
              <button type="button" className="btn-ghost text-[12px]"
                onClick={() => docs.aadharDocUrl.url && setActiveDoc("aadharDocUrl")}>⤢ Front</button>
              <button type="button" className="btn-ghost text-[12px]"
                onClick={() => docs.aadharBackUrl.url && setActiveDoc("aadharBackUrl")}>⤢ Back</button>
            </div>
            <ScanNote state={scan.aadhaar} />
          </div>

          {/* 3 · bank */}
          <div className="card">
            <h2><span className="dot" />3 · Bank — cancelled cheque <span className="badge gold">IFSC / A-c / bank OCR</span></h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {DF("cancelledChequeUrl", "cheque", <>Cheque upload * <span className={docs.cancelledChequeUrl.url ? "text-pos" : "muted"}>{docs.cancelledChequeUrl.url ? "✓ attached" : ""}</span></>)}
              {F(<>IFSC <span className="auto-tag">11</span></>,
                <input className="calc-input w-full uppercase tracking-wider" placeholder="HDFC0001234"
                  value={form.bankIfsc}
                  onChange={(e) => setForm((f) => ({ ...f, bankIfsc: alnumUp(e.target.value, 11) }))} />)}
              {F(<>A/C No <span className="auto-tag">≤20</span></>,
                <input className="calc-input w-full num" placeholder="50100234567890"
                  value={form.bankAccountNo}
                  onChange={(e) => setForm((f) => ({ ...f, bankAccountNo: digits(e.target.value, 20) }))} />)}
            </div>
            {F("Bank name",
              <input className="calc-input w-full uppercase" placeholder="HDFC BANK" maxLength={40}
                value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: up(e.target.value, 40) }))} />)}
            <button type="button" className="btn-ghost mt-3 text-[12px]"
              onClick={() => docs.cancelledChequeUrl.url && setActiveDoc("cancelledChequeUrl")}>
              ⤢ View cheque
            </button>
            <ScanNote state={scan.cheque} />
          </div>

          {/* 4 · demat */}
          <div className="card">
            <h2><span className="dot" />4 · Demat — CML / CMR <span className="badge gold">DP · Client · BO OCR</span></h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {DF("cmlCmrUrl", "cml", <>CML upload * <span className={docs.cmlCmrUrl.url ? "text-pos" : "muted"}>{docs.cmlCmrUrl.url ? "✓ attached" : ""}</span></>)}
              {F(<>DP ID <span className="auto-tag">8</span></>,
                <input className="calc-input w-full num tracking-wider" placeholder="12081600"
                  value={form.dpId}
                  onChange={(e) => setForm((f) => ({ ...f, dpId: alnumUp(e.target.value, 8) }))} />)}
              {F(<>Client ID <span className="auto-tag">8</span></>,
                <input className="calc-input w-full num tracking-wider" placeholder="06111329"
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: digits(e.target.value, 8) }))} />)}
            </div>
            <div className="rounded-xl border border-gold-line bg-gold-soft px-4 py-3 mt-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.1em] uppercase muted">BO ID (auto · DP + Client)</p>
                <p className="num text-[15px] font-semibold mt-0.5 tracking-wide">{boId || "————"}</p>
              </div>
              <span className={`auto-tag ${boId.length === 16 ? "text-pos" : ""}`}>{boId.length}/16{boId.length === 16 ? " ✓" : ""}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              {F("DP Name",
                <input className="calc-input w-full uppercase" placeholder="CDSL — STOCK HOLDING CORP" maxLength={60}
                  value={form.dpName} onChange={(e) => setForm((f) => ({ ...f, dpName: up(e.target.value, 60) }))} />)}
              {F(<>A/c Holder Name <span className="badge gold">from CML/CMR</span></>,
                <input className="calc-input w-full uppercase" placeholder="HOLDER NAME AS PER CML / CMR" maxLength={80}
                  value={form.nomineeName}
                  onChange={(e) => setForm((f) => ({ ...f, nomineeName: up(e.target.value, 80) }))} />)}
            </div>
            <button type="button" className="btn-ghost mt-3 text-[12px]"
              onClick={() => docs.cmlCmrUrl.url && setActiveDoc("cmlCmrUrl")}>
              ⤢ View CML
            </button>
            <ScanNote state={scan.cml} />
          </div>

          {/* 5 · contact */}
          <div className="card">
            <h2><span className="dot" />5 · Contact &amp; UCC</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {F(<>Mobile * <span className="auto-tag">≤15</span></>,
                <input className="calc-input w-full num" placeholder="+919876543210"
                  value={form.mobileNo}
                  onChange={(e) => setForm((f) => ({ ...f, mobileNo: e.target.value.replace(/[^\d+]/g, "").slice(0, 15) }))} />)}
              {F("Email *",
                <input type="email" className="calc-input w-full" placeholder="name@email.com" maxLength={80}
                  value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.slice(0, 80) }))} />)}
              {F(<>UCC * <span className="auto-tag">≤15</span></>,
                <input className="calc-input w-full uppercase tracking-wider" placeholder="UCC123456789012"
                  value={form.ucc}
                  onChange={(e) => setForm((f) => ({ ...f, ucc: alnumUp(e.target.value, 15) }))} />)}
            </div>
            {mode === "edit" ? <p className="note -mt-1">UCC can be corrected here — it must stay unique across clients.</p> : null}
          </div>

          {error ? <div className="flash error">{error}</div> : null}

          <button type="submit" className="btn w-full" disabled={saving}>
            {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Save KYC → Enable Deal Confirmation"}
          </button>
          <p className="note -mt-1">
            Photos are downscaled and read on-device — nothing is sent to third-party services.
          </p>
        </form>
      </div>

      {/* ================= RIGHT · DOCUMENT VIEWER ================= */}
      <aside className="hidden lg:flex w-[44%] xl:w-[46%] shrink-0 border-l border-line bg-white-warm/70 sticky top-0 h-screen items-center justify-center p-4">
        {shown?.url ? (
          <figure className="w-full h-full flex flex-col gap-2 min-h-0">
            <figcaption className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold tracking-[0.1em] uppercase muted">{docLabels[activeDoc!]}</span>
              <div className="flex gap-2">
                {/* Aadhaar front/back toggle — view both sides */}
                {(activeDoc === "aadharDocUrl" || activeDoc === "aadharBackUrl") ? (
                  <div className="flex rounded-full border border-line overflow-hidden">
                    <button type="button"
                      className={`px-3 py-1 text-[10px] font-semibold tracking-wide uppercase ${activeDoc === "aadharDocUrl" ? "bg-ink text-white" : "bg-white muted"}`}
                      onClick={() => docs.aadharDocUrl.url && setActiveDoc("aadharDocUrl")}
                      disabled={!docs.aadharDocUrl.url}>Front</button>
                    <button type="button"
                      className={`px-3 py-1 text-[10px] font-semibold tracking-wide uppercase ${activeDoc === "aadharBackUrl" ? "bg-ink text-white" : "bg-white muted"}`}
                      onClick={() => docs.aadharBackUrl.url && setActiveDoc("aadharBackUrl")}
                      disabled={!docs.aadharBackUrl.url}>Back</button>
                  </div>
                ) : null}
                <a href={shown.url} download={`${docLabels[activeDoc!]}.png`} className="btn-ghost text-[11px]">⬇ Save</a>
                <button type="button" className="btn-ghost text-[11px]" onClick={() => clearDoc(activeDoc!)}>✕ Remove</button>
              </div>
            </figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.url} alt={docLabels[activeDoc!] ?? "document"}
              className="flex-1 min-h-0 w-full rounded-xl border border-line bg-white object-contain shadow-lift" />
          </figure>
        ) : (
          <div className="text-center px-8">
            <p className="text-[42px] leading-none">🗂️</p>
            <p className="font-semibold mt-3">Document viewer</p>
            <p className="note mt-1 max-w-[36ch] mx-auto">
              Upload any KYC document on the left — the complete page appears here at full size while OCR reads it.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function ScanNote({ state }: { state?: ScanState }) {
  if (!state || state.status === "idle") return null;
  const cls = state.status === "done" ? "text-pos" : state.status === "error" ? "err" : "muted";
  const icon = state.status === "done" ? "✓" : state.status === "error" ? "✕" : "◔";
  const pct = typeof state.pct === "number" ? ` ${state.pct}%` : "";
  return (
    <p className={`text-[12px] mt-2 flex items-center gap-1.5 flex-wrap ${cls}`}>
      <span aria-hidden>{icon}</span>
      <span>{state.message}{state.status === "scanning" ? pct : ""}</span>
      {state.status === "done" ? <span className="auto-tag">autofilled — verify</span> : null}
    </p>
  );
}
