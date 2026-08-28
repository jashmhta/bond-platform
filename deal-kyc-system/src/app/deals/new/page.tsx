"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DealForm from "@/components/DealForm";

export default function DealNewPage() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((j) => setOk(Array.isArray(j)))
      .catch(() => setOk(false));
  }, []);

  return (
    <div className="container-x">
      <section className="pt-[clamp(28px,5vh,48px)] fade-in">
        <span className="eyebrow">Deal Confirmation · BinaryBonds</span>
        <h1 className="text-[clamp(1.9rem,4vw,2.8rem)] font-semibold tracking-[-0.035em] leading-[1.08] mt-3 max-w-[22ch]">
          Buy / Sell via BinaryBonds
        </h1>
        <p className="lead mt-3 text-[15px]">
          Client auto-fills from the KYC database · security is manual · exchange stays hardcoded · the
          reference number runs in serial order and remains editable until you save.
        </p>
        <p className="note !mt-2">
          <Link href="/deals" style={{ textDecoration: "underline" }}>View confirmed deals</Link>
          {" · "}
          <Link href="/overview" style={{ textDecoration: "underline" }}>Overview</Link>
        </p>
      </section>

      {ok === false ? (
        <div className="flash error mt-6">
          Could not load clients. <Link href="/kyc/new" style={{ textDecoration: "underline" }}>Complete a KYC</Link>
        </div>
      ) : null}

      <DealForm mode="new" />
    </div>
  );
}
