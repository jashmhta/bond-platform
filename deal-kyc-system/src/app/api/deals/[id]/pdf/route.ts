import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildDealPdf } from "@/lib/pdf";

const round2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ddmm = (d: Date, sep: string) =>
  `${String(d.getUTCDate()).padStart(2, "0")}${sep}${String(d.getUTCMonth() + 1).padStart(2, "0")}${sep}${d.getUTCFullYear()}`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, include: { client: true } });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const units = deal.quantity ?? 0;
  const price = deal.price ?? 0;
  const coupon = deal.couponRate ?? 0;
  const days = deal.interestDays ?? 13;

  const principal = deal.principalAmount ?? round2(price * units);
  const accrued =
    deal.accruedInterest ?? round2(((principal * coupon) / 100) * (days / 365));
  const stampDutyVal = (deal as unknown as { stampDuty?: number | null }).stampDuty ?? 0;
  const total = deal.totalConsideration ?? round2(principal + accrued + stampDutyVal);

  try {
    const pdfBytes = await buildDealPdf({
      refNo: deal.refNo,
      dealDateDash: ddmm(deal.date, "-"),
      dealDateSlash: ddmm(deal.date, "/"),
      dealDateLong: deal.date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      side: deal.type === "TB" ? "BUY" : "SELL",
      clientName: (deal.client.holderName || deal.client.ucc || "").toUpperCase(),
      pan: deal.client.panNumber || "—",
      clientAddress: deal.clientAddress || deal.client.address || "",
      bankName: deal.client.bankName || "",
      bankIfsc: deal.client.bankIfsc || "",
      bankAccountNo: deal.client.bankAccountNo || "",
      security: deal.securityName,
      isin: deal.isin || "",
      paymentDates: deal.interestPaymentDates || "MONTHLY",
      maturity: deal.maturityDate ? ddmm(deal.maturityDate, "/") : "",
      price: inr(price),
      cleanPrice: deal.cleanPrice != null
        ? Number(deal.cleanPrice).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
        : price > 0 && price <= 5000
          ? Number(price).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
          : "",
      yieldPct: deal.yieldValue ? `${deal.yieldValue}%` : "",
      totalFaceValue: inr(deal.faceValue ?? 0),
      units: String(units),
      principal: inr(principal),
      accrued: inr(accrued),
      interestDays: String(days),
      stampDuty: inr(stampDutyVal),
      dealAmount: inr(round2(principal + accrued)),
      total: inr(total),
      dpId: deal.dematDpId || deal.client.dpId || "",
      clientId: deal.dematClientId || deal.client.clientId || "",
      dpName: deal.dematDpName || deal.client.dpName || "",
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${deal.refNo}.pdf"`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PDF generation failed" },
      { status: 500 }
    );
  }
}
