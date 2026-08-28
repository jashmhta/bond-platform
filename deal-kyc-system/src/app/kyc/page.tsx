import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | string | null): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function ClientsPage() {
  let clients: Awaited<ReturnType<typeof prisma.client.findMany>> = [];
  let dbError = false;
  try {
    clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
  } catch {
    dbError = true;
  }

  return (
    <div className="container-x">
      <div className="pt-8 fade-in flex items-end justify-between gap-4 flex-wrap">
        <div>
          <span className="eyebrow">KYC · BinaryBonds</span>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] mt-2">Clients</h1>
          <p className="muted text-[13.5px] mt-1">Onboarded clients — auto-filled into deal confirmations.</p>
        </div>
        <Link href="/kyc/new" className="btn">+ New KYC</Link>
      </div>

      {dbError ? (
        <div className="card mt-6">
          <p className="err" style={{ marginTop: 0 }}>Database not reachable — run `npx prisma db push` and retry.</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="card mt-6 text-center py-10">
          <p className="font-semibold">No clients yet</p>
          <p className="note mt-1">Complete the first KYC to enable deal confirmations.</p>
          <Link href="/kyc/new" className="btn mt-5 inline-flex">Open KYC form</Link>
        </div>
      ) : (
        <div className="table-scroll mt-6 fade-in">
          <table>
            <thead>
              <tr>
                <th>Client</th><th>UCC</th><th>PAN</th><th>Mobile</th><th>Email</th>
                <th>Demat (DP / BO)</th><th>Docs</th><th>Added</th><th></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const docs = [
                  c.panDocUrl && "PAN",
                  c.aadharDocUrl && "AADHAAR",
                  c.cancelledChequeUrl && "CHEQUE",
                  c.cmlCmrUrl && "CML",
                ].filter(Boolean) as string[];
                return (
                  <tr key={c.id}>
                    <td className="font-medium">{c.holderName || "—"}{c.address ? "" : null}</td>
                    <td className="num">{c.ucc}</td>
                    <td className="num">{c.panNumber || "—"}</td>
                    <td className="num">{c.mobileNo}</td>
                    <td>{c.email}</td>
                    <td className="num">{[c.dpId, c.clientId].filter(Boolean).join(" / ") || "—"}</td>
                    <td>
                      <span className="badge gold">{docs.length}/4</span>
                    </td>
                    <td className="num">{fmtDate(c.createdAt)}</td>
                    <td>
                      <Link href={`/kyc/${c.id}/edit`} className="btn-ghost text-[11px]">✎ Edit</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
