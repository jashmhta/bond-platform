import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calcStampDuty } from "@/lib/deal-math";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  try {
    const deals = await prisma.deal.findMany({
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json(deals);
  } catch {
    return NextResponse.json([]);
  }
}

/**
 * POST /api/deals
 * body: {
 *   clientId, type "TS"|"TB", date "YYYY-MM-DD",
 *   refNo?: string (editable override), serial?: number,
 *   securityName, isin?, couponRate?, paymentDates?, maturityDate?,
 *   price (per unit), yieldValue?, facePerUnit, quantity (units),
 *   interestDays?, clientAddress?
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const client = await prisma.client.findUnique({ where: { id: body.clientId } });
    if (!client) return NextResponse.json({ error: "Client not found — complete KYC first." }, { status: 404 });

    /* ---- 4/4 compulsory: deal allowed only when all KYC docs exist ---- */
    const docChecks = [
      ["panDocUrl", "PAN card"],
      ["aadharDocUrl", "Aadhaar card"],
      ["cancelledChequeUrl", "Cancelled cheque"],
      ["cmlCmrUrl", "CML/CMR"],
    ] as const;
    const missing = docChecks
      .filter(([fld]) => !String(client[fld as keyof typeof client] ?? "").trim())
      .map(([, label]) => label);
    if (missing.length) {
      return NextResponse.json(
        { error: `KYC incomplete — deal not allowed. Missing docs (4/4 compulsory): ${missing.join(", ")}. Complete the client KYC first.` },
        { status: 403 }
      );
    }

    const type = body.type === "TB" ? "TB" : "TS";
    const dateRaw: string =
      typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(body.date)
        ? body.date.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const date = new Date(`${dateRaw}T00:00:00.000Z`);

    /* ---- reference no: automatic TS/TB·YYYYMMDD·### , editable ---- */
    let refNo: string;
    let serial: number;

    const provided = typeof body.refNo === "string" ? body.refNo.replace(/[\s\/\.\-]/g, "").toUpperCase() : "";
    if (provided) {
      const m = provided.match(/^(TS|TB)(\d{8})(\d{1,3})$/);
      if (!m) {
        return NextResponse.json(
          { error: "Ref No must look like TS20260824001 (TS/TB + YYYYMMDD + serial)." },
          { status: 400 }
        );
      }
      refNo = `${m[1]}${m[2]}${m[3].padStart(3, "0")}`;
      serial = Number(m[3]);
    } else {
      const last = await prisma.deal.findFirst({
        where: { type, date },
        orderBy: { serial: "desc" },
        select: { serial: true },
      });
      serial = Math.min(Number(body.serial) || (last?.serial ?? 0) + 1, 999);
      refNo = `${type}${dateRaw.replaceAll("-", "")}${String(serial).padStart(3, "0")}`;
    }

    /* ---- numbers: exhaustive logic
       face total = face/unit × units
       principal = price (per-unit clean) × units
       accrued   = explicit (+/- allowed), else 0 — security schedule isn't loaded yet
       total     = explicit, else principal + accrued                            ---- */
    const price = Number(body.price) || 0;
    const units = Math.max(0, Math.round(Number(body.quantity) || 0));
    const facePerUnit = Number(body.facePerUnit) || 0;
    const coupon = Number(body.couponRate) || 0;
    const days = body.interestDays != null && Number.isFinite(Number(body.interestDays))
      ? Math.round(Number(body.interestDays))
      : null;
    const faceTotal = Math.round(facePerUnit * units) || 0;

    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const explicitPrincipal = num(body.principalAmount);
    const explicitAccrued = num(body.accruedInterest);
    const explicitStamp = num(body.stampDuty);
    const explicitTotal = num(body.totalConsideration);

    const principalAmount = round2(explicitPrincipal != null ? Math.max(0, explicitPrincipal) : price * units);
    const accruedInterest = round2(
      explicitAccrued != null ? explicitAccrued : (coupon > 0 && days != null && faceTotal > 0 ? (faceTotal * coupon) / 100 * (days / 365) : 0)
    );
    const dealAmount = round2(principalAmount + accruedInterest);
    const stampDuty = explicitStamp != null ? Math.max(0, Math.round(explicitStamp)) : calcStampDuty(dealAmount);
    const totalConsideration = round2(explicitTotal != null ? explicitTotal : dealAmount + stampDuty);
    if (!(totalConsideration >= 0)) {
      return NextResponse.json({ error: "Total consideration cannot be negative." }, { status: 400 });
    }

    const deal = await prisma.deal.create({
      data: {
        refNo,
        type,
        date,
        serial,
        clientId: client.id,
        securityName: String(body.securityName || "").trim(),
        isin: body.isin ? String(body.isin).toUpperCase() : null,
        couponRate: coupon || null,
        maturityDate: body.maturityDate ? new Date(`${body.maturityDate}T00:00:00.000Z`) : null,
        faceValue: facePerUnit * units || null,
        quantity: units || null,
        price: price || null,
        cleanPrice: num(body.cleanPrice) != null ? Math.round(num(body.cleanPrice)! * 1000) / 1000 : null,
        yieldValue: Number(body.yieldValue) || null,
        exchange: "BSE",
        marketType: "BSE",
        settlementType: "T+0",
        dematDpId: client.dpId,
        dematClientId: client.clientId,
        dematDpName: client.dpName,
        clientAddress: body.clientAddress ?? client.address ?? null,
        interestPaymentDates: body.paymentDates ? String(body.paymentDates) : "MONTHLY",
        interestDays: days,
        principalAmount,
        accruedInterest,
        stampDuty,
        totalConsideration,
      },
      include: { client: true },
    });
    return NextResponse.json(deal, { status: 201 });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === "P2002")
      return NextResponse.json({ error: `Ref No already exists — edit the serial.` }, { status: 409 });
    return NextResponse.json({ error: err.message || "Save failed" }, { status: 500 });
  }
}
