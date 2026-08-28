import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calcStampDuty } from "@/lib/deal-math";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deal = await prisma.deal.findUnique({ where: { id }, include: { client: true } });
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    return NextResponse.json(deal);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Load failed" },
      { status: 500 }
    );
  }
}

/** PATCH — full deal confirmation stays editable: security, terms, price, serial/ref, amounts recompute. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const existing = await prisma.deal.findUnique({ where: { id }, include: { client: true } });
    if (!existing) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    /* client stays locked to the original holder (KYC 4/4 already validated at creation) */
    const client = existing.client;
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
        { error: `KYC incomplete — missing docs (4/4 compulsory): ${missing.join(", ")}.` },
        { status: 403 }
      );
    }

    const type = body.type === "TB" ? "TB" : "TS";
    const dateRaw: string =
      typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(body.date)
        ? body.date.slice(0, 10)
        : existing.date.toISOString().slice(0, 10);
    const date = new Date(`${dateRaw}T00:00:00.000Z`);

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
      serial = Math.min(Number(body.serial) || existing.serial, 999);
      refNo = `${type}${dateRaw.replaceAll("-", "")}${String(serial).padStart(3, "0")}`;
    }

    const price = Number(body.price) || 0;
    const units = Math.max(0, Math.round(Number(body.quantity) || 0));
    const facePerUnit = Number(body.facePerUnit) || 0;
    const coupon = Number(body.couponRate) || 0;
    const days = body.interestDays != null && Number.isFinite(Number(body.interestDays))
      ? Math.round(Number(body.interestDays))
      : null;

    const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const explicitPrincipal = num(body.principalAmount);
    const explicitAccrued = num(body.accruedInterest);
    const explicitStamp = num(body.stampDuty);
    const explicitTotal = num(body.totalConsideration);

    const principalAmount = round2(explicitPrincipal != null ? Math.max(0, explicitPrincipal) : price * units);
    const accruedInterest = round2(
      explicitAccrued != null ? explicitAccrued : (coupon > 0 && days != null && facePerUnit * units > 0 ? (facePerUnit * units * coupon) / 100 * (days / 365) : 0)
    );
    const dealAmount = round2(principalAmount + accruedInterest);
    const stampDuty = explicitStamp != null ? Math.max(0, Math.round(explicitStamp)) : calcStampDuty(dealAmount);
    const totalConsideration = round2(explicitTotal != null ? explicitTotal : dealAmount + stampDuty);
    if (!(totalConsideration >= 0)) {
      return NextResponse.json({ error: "Total consideration cannot be negative." }, { status: 400 });
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        refNo,
        type,
        date,
        serial,
        securityName: String(body.securityName || "").trim(),
        isin: body.isin ? String(body.isin).toUpperCase() : null,
        couponRate: coupon || null,
        maturityDate: body.maturityDate ? new Date(`${body.maturityDate}T00:00:00.000Z`) : null,
        faceValue: facePerUnit * units || null,
        quantity: units || null,
        price: price || null,
        cleanPrice: num(body.cleanPrice) != null ? Math.round(num(body.cleanPrice)! * 1000) / 1000 : null,
        yieldValue: Number(body.yieldValue) || null,
        interestPaymentDates: body.paymentDates ? String(body.paymentDates) : "MONTHLY",
        interestDays: days,
        principalAmount,
        accruedInterest,
        stampDuty,
        totalConsideration,
        clientAddress: body.clientAddress ?? existing.clientAddress,
      },
      include: { client: true },
    });
    return NextResponse.json(deal);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === "P2002")
      return NextResponse.json({ error: `Ref No already exists — edit the serial.` }, { status: 409 });
    return NextResponse.json({ error: err.message || "Update failed" }, { status: 500 });
  }
}
