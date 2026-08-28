import Link from "next/link";

export default function Home() {
  return (
    <div className="container-x">
      <section className="pt-[clamp(36px,6vh,64px)] pb-[clamp(10px,2vh,20px)] fade-in">
        <span className="eyebrow">Client onboarding + deal confirmation</span>
        <h1 className="display mt-5 max-w-[16ch]">
          Onboard once.
          <br />
          <span className="text-gold-deep">Confirm in seconds.</span>
        </h1>
        <p className="lead mt-5">
          KYC captures PAN, Aadhaar, cheque, CML/CMR, mobile, email &amp; UCC — with on-device OCR that reads
          the documents for you. Deal confirmations auto-fill the client, generate{" "}
          <code className="rounded bg-white-warm px-1.5 py-0.5 text-[12px] border border-line">TS/TB·YYYYMMDD·###</code>{" "}
          references and print the BinaryBonds letterhead PDF.
        </p>
        <div className="flex gap-3 mt-7 flex-wrap">
          <Link href="/kyc/new" className="btn">New KYC</Link>
          <Link href="/deals/new" className="btn-ghost">New Deal (TB/TS)</Link>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 gap-5 mt-10 fade-in">
        <Link href="/kyc/new" className="card hover:shadow-lift transition-shadow">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-gold-deep">Step 1</p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">Client KYC</h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed muted">
            PAN card · Aadhaar · Cancelled cheque · CML/CMR uploads — OCR auto-fills PAN number,
            Aadhaar, IFSC/A/c, DP ID &amp; BO ID. Mobile · Email · UCC · Demat.
          </p>
          <span className="btn mt-4">Open KYC form</span>
        </Link>
        <Link href="/deals/new" className="card hover:shadow-lift transition-shadow">
          <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-pos">Step 2</p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.02em]">
            Deal Confirmation — Buy/Sell via BinaryBonds
          </h3>
          <p className="mt-1.5 text-[13.5px] leading-relaxed muted">
            Client name auto from KYC database · Security manual · Exchange hardcoded (BSE — T+0) ·
            Demat fetched from earlier · Date calendar + serial-order ref no, auto but editable.
          </p>
          <span className="btn mt-4">New Deal (TB/TS)</span>
        </Link>
      </div>

      <div className="card mt-6">
        <h2><span className="dot" />Reference number logic</h2>
        <div className="table-scroll">
          <table className="min-w-[560px]">
            <thead>
              <tr><th>Side</th><th>Format</th><th>Example</th><th>Meaning</th></tr>
            </thead>
            <tbody>
              <tr><td className="font-semibold whitespace-nowrap">TS</td><td className="num whitespace-nowrap">TS·YYYYMMDD·###</td><td className="num whitespace-nowrap">TS20260824001</td><td className="whitespace-nowrap pr-6">Today Sell — serial 001 of 24 Aug 2026</td></tr>
              <tr><td className="font-semibold whitespace-nowrap">TB</td><td className="num whitespace-nowrap">TB·YYYYMMDD·###</td><td className="num whitespace-nowrap">TB20260824001</td><td className="whitespace-nowrap pr-6">Today Buy — serial resets per day per side</td></tr>
            </tbody>
          </table>
        </div>
        <p className="note">
          Date comes from a calendar dropdown; the next serial in order is suggested automatically and stays
          editable before saving. The generated PDF replicates the standard BinaryBonds deal confirmation —
          BSE Clearing Agent settlement details, red total consideration with amount in words, computer-generated notice.
        </p>
      </div>
    </div>
  );
}
