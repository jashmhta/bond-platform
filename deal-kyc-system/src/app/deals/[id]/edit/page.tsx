"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import DealForm from "@/components/DealForm";

export default function DealEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; initial: NonNullable<Parameters<typeof DealForm>[0]["initial"]> }
  >({ kind: "loading" });

  useEffect(() => {
    fetch(`/api/deals/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Deal not found"))))
      .then((d) => {
        setState({
          kind: "ready",
          initial: {
            id: d.id,
            client: d.client ?? null,
            clientId: d.clientId,
            type: d.type === "TB" ? "TB" : "TS",
            date: String(d.date).slice(0, 10),
            serial: d.serial,
            refNo: d.refNo,
            securityName: d.securityName,
            isin: d.isin,
            couponRate: d.couponRate,
            maturityDate: d.maturityDate ? String(d.maturityDate).slice(0, 10) : null,
            price: d.price,
            cleanPrice: d.cleanPrice,
            yieldValue: d.yieldValue,
            faceValue: d.faceValue,
            quantity: d.quantity,
            interestPaymentDates: d.interestPaymentDates,
            interestDays: d.interestDays,
            principalAmount: d.principalAmount,
            accruedInterest: d.accruedInterest,
            totalConsideration: d.totalConsideration,
          },
        });
      })
      .catch((e) => setState({ kind: "error", message: e instanceof Error ? e.message : "Load failed" }));
  }, [id]);

  if (state.kind === "loading") {
    return <div className="container-x pt-16 muted text-center">Loading deal…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="container-x pt-16 text-center">
        <p className="err font-semibold">{state.message}</p>
        <Link href="/deals" className="btn-ghost mt-4 inline-flex">← Back to confirmed deals</Link>
      </div>
    );
  }
  return (
    <div className="container-x">
      <section className="pt-[clamp(28px,5vh,48px)] fade-in">
        <span className="eyebrow">Edit deal · BinaryBonds</span>
        <h1 className="text-[clamp(1.6rem,3vw,2.3rem)] font-semibold tracking-[-0.035em] leading-[1.08] mt-3">
          Edit {state.initial.refNo}
        </h1>
        <p className="lead mt-3 text-[15px]">
          Full confirmation editable — security, coupons, price, units, dates &amp; reference. Totals
          recompute; the letterhead PDF regenerates from the saved terms. Client stays locked to the
          original holder.
        </p>
      </section>
      <DealForm key={state.initial.id} mode="edit" dealId={state.initial.id} initial={state.initial} />
    </div>
  );
}
