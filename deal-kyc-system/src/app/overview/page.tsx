import Link from "next/link";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type DealWithClient = Prisma.DealGetPayload<{ include: { client: true } }>;

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const inr = (n: number | null | undefined) =>
  n == null
    ? "—"
    : "Rs. " +
      Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function OverviewPage() {
  let clients: Awaited<ReturnType<typeof prisma.client.findMany>> = [];
  let deals: DealWithClient[] = [];
  let dbError = false;
  try {
    [clients, deals] = await Promise.all([
      prisma.client.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.deal.findMany({ include: { client: true }, orderBy: { date: "desc" }, take: 500 }),
    ]);
  } catch {
    dbError = true;
  }

  const docsOk = clients.filter(
    (c) => c.panDocUrl && c.aadharDocUrl && c.cancelledChequeUrl && c.cmlCmrUrl
  ).length;
  const totalConsideration = deals.reduce((s, d) => s + (d.totalConsideration ?? 0), 0);
  const tb = deals.filter((d) => d.type === "TB").length;
  const ts = deals.filter((d) => d.type === "TS").length;
  const today = new Date().toISOString().slice(0, 10);
  const todayDeals = deals.filter((d) => String(d.date).slice(0, 10) === today).length;
  const recent = deals.slice(0, 5);

  return (
    <div className="container-x">
      <div className="pt-8 pb-3 fade-in flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="eyebrow">Overview · BinaryBonds</span>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] mt-2">Platform overview</h1>
          <p className="muted text-[13.5px] mt-1">
            Live numbers across onboarding, KYC completeness and the deal register — every deal row remains
            editable from Confirmed deals.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/kyc/new" className="btn-ghost">+ New KYC</Link>
          <Link href="/deals/new" className="btn">+ New Deal</Link>
        </div>
      </div>

      {dbError ? (
        <div className="card mt-6">
          <p className="err" style={{ marginTop: 0 }}>Database not reachable — run `npx prisma db push` and retry.</p>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="kpis mt-2">
            <div className="kpi">
              <div className="k">Clients</div>
              <div className="v">{clients.length}</div>
              <div className="s">onboarded via KYC</div>
            </div>
            <div className="kpi accent">
              <div className="k">KYC 4/4 complete</div>
              <div className="v">{docsOk}/{clients.length}</div>
              <div className="s">PAN · Aadhaar · Cheque · CML</div>
            </div>
            <div className="kpi">
              <div className="k">Confirmed deals</div>
              <div className="v">{deals.length}</div>
              <div className="s">{tb} buy (TB) · {ts} sell (TS)</div>
            </div>
            <div className="kpi accent">
              <div className="k">Total consideration</div>
              <div className="v">{inr(totalConsideration).replace("Rs. ", "")}</div>
              <div className="s">{inr(totalConsideration) !== "—" ? "sum of register" : "no deals yet"}</div>
            </div>
            <div className="kpi">
              <div className="k">Today</div>
              <div className="v">{todayDeals}</div>
              <div className="s">{fmtDate(new Date())} · T+0 via BSE</div>
            </div>
          </div>

          {/* register + clients */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
            <div className="card min-w-0">
              <h2>
                <span className="dot" />
                Recent confirmed deals
                <span className="badge gold flex-none">editable</span>
              </h2>
              {recent.length === 0 ? (
                <p className="note" style={{ marginTop: 0 }}>Nothing yet — the first confirmation appears here.</p>
              ) : (
                <div className="space-y-3">
                  {recent.map((d) => (
                    <Link key={d.id} href={`/deals/${d.id}/edit`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-4 py-3 hover:shadow-soft transition-shadow">
                      <div className="min-w-0">
                        <p className="font-mono text-[12.5px] font-semibold tracking-wide whitespace-nowrap">
                          {d.refNo} <span className={`badge ${d.type === "TB" ? "gold" : ""}`}>{d.type}</span>
                        </p>
                        <p className="text-[12.5px] muted truncate mt-0.5">
                          {d.client?.holderName || d.client?.ucc || "—"} · {d.securityName}
                        </p>
                      </div>
                      <div className="text-right flex-none">
                        <p className="num font-semibold text-[14px]">{inr(d.totalConsideration)}</p>
                        <p className="text-[11px] muted">{fmtDate(d.date)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <p className="note" style={{ marginTop: 14 }}>
                <Link href="/deals" style={{ textDecoration: "underline" }}>Open full deal register →</Link>
              </p>
            </div>

            <div className="card min-w-0">
              <h2>
                <span className="dot" />
                Clients &amp; KYC completeness
              </h2>
              {clients.length === 0 ? (
                <p className="note" style={{ marginTop: 0 }}>No clients yet — start with the KYC form.</p>
              ) : (
                <div className="space-y-3">
                  {clients.slice(0, 6).map((c) => {
                    const n = [c.panDocUrl, c.aadharDocUrl, c.cancelledChequeUrl, c.cmlCmrUrl].filter(Boolean).length;
                    return (
                      <Link key={c.id} href={`/kyc/${c.id}/edit`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-4 py-3 hover:shadow-soft transition-shadow">
                        <div className="min-w-0">
                          <p className="font-medium text-[14px] truncate">{c.holderName || "—"}</p>
                          <p className="text-[11.5px] muted num mt-0.5 truncate overflow-hidden">
                            {c.ucc} · PAN {c.panNumber || "—"} · {fmtDate(c.createdAt)}
                          </p>
                        </div>
                        <div className="text-right flex-none">
                          <span className={`badge ${n === 4 ? "gold" : ""}`}>{n}/4 docs</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              <p className="note" style={{ marginTop: 14 }}>
                <Link href="/kyc" style={{ textDecoration: "underline" }}>Open clients list →</Link>
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
