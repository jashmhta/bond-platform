import Link from "next/link";
import Image from "next/image";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 pt-[max(0.5rem,env(safe-area-inset-top))] sm:pt-3">
      <div className="container-x">
        <nav className="nav-shell">
          <Link href="/" className="flex items-center gap-2 min-w-0 pl-0.5">
            <Image
              src="/logo.png"
              alt="Binary Bonds logo"
              width={26}
              height={26}
              className="rounded-lg flex-none"
              priority
            />
            <span className="text-[1.0625rem] sm:text-[18px] font-semibold tracking-[-0.02em] whitespace-nowrap hidden min-[430px]:inline">
              BinaryBonds
            </span>
          </Link>
          <div className="flex items-center gap-0.5 ml-auto">
            <Link href="/overview" className="nav-link inline-flex">
              Overview
            </Link>
            <Link href="/deals" className="nav-link inline-flex">
              Deals
            </Link>
            <Link href="/kyc" className="nav-link hidden sm:inline-flex">
              Clients
            </Link>
            <Link href="/kyc/new" className="nav-link hidden sm:inline-flex">
              New KYC
            </Link>
            <Link href="/deals/new" className="nav-link cta">
              New Deal
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="page">
      <div className="inner">
        <b>BinaryBonds Private Limited</b> · CIN U67100MH2023PTC396840 · PAN AALCB3429N ·
        compliance@binarybonds.in · 7738056127 · Andheri West, Mumbai 400053.
        Deal confirmations are computer-generated and carry the BSE Clearing Agent settlement rails
        (BSE T+0). Reference numbers run as <code>TS/TB·YYYYMMDD·###</code>, serial per day per side.
        Not investment advice; verify details against the exchange contract note.
      </div>
    </footer>
  );
}
