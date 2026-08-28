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

export default async function DealsPage() {
  let deals: DealWithClient[] = [];
  let dbError = false;
  try {
    deals = await prisma.deal.findMany({
      include: { client: true },
      orderBy: { date: "desc" },
      take: 200,
    });
  } catch {
    dbError = true;
  }

  const totalConsideration = deals.reduce((s, d) => s + (d.totalConsideration ?? 0), 0);

  return (
    <div className="container-x">
      <div className="pt-8 fade-in flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="eyebrow">Deal register · BinaryBonds</span>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] mt-2">Confirmed deals</h1>
          <p className="muted text-[13.5px] mt-1">
            {deals.length} confirmation{deals.length === 1 ? "" : "s"} · {inr(totalConsideration)} total consideration ·
            click any row to edit or reprint.
          </p>
        </div>
        <Link href="/deals/new" className="btn">+ New Deal (TB/TS)</Link>
      </div>

      {dbError ? (
        <div className="card mt-6">
          <p className="err" style={{ marginTop: 0 }}>Database not reachable — run `npx prisma db push` and retry.</p>
        </div>
      ) : deals.length === 0 ? (
        <div className="card mt-6 text-center py-10">
          <p className="font-semibold">No confirmed deals yet</p>
          <p className="note mt-1">Generate the first confirmation — it lands here with its PDF.</p>
          <Link href="/deals/new" className="btn mt-5 inline-flex">Open deal confirmation form</Link>
        </div>
      ) : (
        <div className="table-scroll mt-6 fade-in">
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Date</th><th>Side</th><th>Client</th><th>Security</th>
                <th>Face value</th><th>Price</th><th>Units</th><th>Days</th><th>Total consideration</th><th></th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="font-mono text-[12.5px] font-semibold tracking-wide whitespace-nowrap">
                      {d.refNo}
                    </span>
                  </td>
                  <td className="num whitespace-nowrap">{fmtDate(d.date)}</td>
                  <td>
                    <span className={`badge ${d.type === "TB" ? "gold" : ""}`}>
                      {d.type === "TB" ? "TB · Buy" : "TS · Sell"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis font-medium">
                    {d.client?.holderName || d.client?.ucc || "—"}
                  </td>
                  <td className="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap muted">
                    {d.securityName}
                  </td>
                  <td className="num">{inr(d.faceValue)}</td>
                  <td className="num">{d.price != null ? d.price.toLocaleString("en-IN") : "—"}</td>
                  <td className="num">{d.quantity ?? "—"}</td>
                  <td className="num">{d.interestDays ?? "—"}</td>
                  <td className="num font-semibold whitespace-nowrap">{inr(d.totalConsideration)}</td>
                  <td>
                    <div className="flex gap-2 justify-end">
                      <Link href={`/deals/${d.id}/edit`} className="btn-ghost text-[11px]">✎ Edit</Link>
                      <a href={`/api/deals/${d.id}/pdf`} target="_blank" rel="noreferrer" className="btn-ghost text-[11px]">PDF</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
