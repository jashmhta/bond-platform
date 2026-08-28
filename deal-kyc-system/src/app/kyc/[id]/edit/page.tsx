"use client";

import { use, useEffect, useState } from "react";
import KycForm, { type KycFormDocs, type KycFormValues } from "@/components/KycForm";

const DOC_KEYS = ["panDocUrl", "aadharDocUrl", "aadharBackUrl", "cancelledChequeUrl", "cmlCmrUrl"] as const;

export default function KycEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; values: Partial<KycFormValues>; docs: Partial<KycFormDocs>; ucc: string }
  >({ kind: "loading" });

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Client not found"))))
      .then((c) => {
        const docs: Record<string, string> = {};
        for (const k of DOC_KEYS) if (c[k]) docs[k] = c[k];
        const values = {
          holderName: c.holderName ?? "", fatherName: c.fatherName ?? "",
          panNumber: c.panNumber ?? "", dob: c.dob ? String(c.dob).slice(0, 10) : "",
          aadhaarNumber: c.aadharNumber ?? "", mobileNo: c.mobileNo ?? "",
          email: c.email ?? "", ucc: c.ucc ?? "", address: c.address ?? "",
          occupation: c.occupation ?? "", nomineeName: c.nomineeName ?? "",
          bankIfsc: c.bankIfsc ?? "", bankAccountNo: c.bankAccountNo ?? "", bankName: c.bankName ?? "",
          dpId: c.dpId ?? "", clientId: c.clientId ?? "", dpName: c.dpName ?? "",
        };
        setState({ kind: "ready", values, docs, ucc: c.ucc });
      })
      .catch((e) => setState({ kind: "error", message: e instanceof Error ? e.message : "Load failed" }));
  }, [id]);

  if (state.kind === "loading") {
    return <div className="container-x pt-16 muted text-center">Loading client…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="container-x pt-16 text-center">
        <p className="err font-semibold">{state.message}</p>
        <a href="/kyc" className="btn-ghost mt-4 inline-flex">← Back to clients</a>
      </div>
    );
  }
  return (
    <KycForm
      key={state.ucc}
      mode="edit"
      clientId={id}
      initial={state.values}
      initialDocs={state.docs}
    />
  );
}
