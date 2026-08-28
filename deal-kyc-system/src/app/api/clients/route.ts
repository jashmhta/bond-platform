import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const clients = await prisma.client.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json(clients);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    /* ---- 4/4 compulsory documents ---- */
    const CORE_DOCS: Array<["panDocUrl", string] | ["aadharDocUrl", string] | ["cancelledChequeUrl", string] | ["cmlCmrUrl", string]> = [
      ["panDocUrl", "PAN card"],
      ["aadharDocUrl", "Aadhaar card"],
      ["cancelledChequeUrl", "Cancelled cheque"],
      ["cmlCmrUrl", "CML/CMR"],
    ];
    /* ---- zero data-leak tolerance: blob: URLs are session-scoped and die with the tab ---- */
    const DOC_FIELDS = ["panDocUrl", "aadharDocUrl", "aadharBackUrl", "cancelledChequeUrl", "cmlCmrUrl"] as const;
    const dead = DOC_FIELDS.filter((f) => typeof body[f] === "string" && body[f].startsWith("blob:"));
    if (dead.length) {
      return NextResponse.json(
        { error: "Internal document link expired (blob URL) — please re-attach: " + dead.join(", ") + ". Nothing was saved." },
        { status: 400 }
      );
    }
    const missing = CORE_DOCS.filter(([key]) => !String(body[key] ?? "").trim()).map(([, label]) => label);
    if (missing.length) {
      return NextResponse.json(
        { error: `All 4 documents are compulsory — missing: ${missing.join(", ")}.` },
        { status: 400 }
      );
    }
    const client = await prisma.client.create({
      data: {
        panNumber: body.panNumber?.toUpperCase(),
        panDocUrl: body.panDocUrl,
        aadharNumber: body.aadhaarNumber?.replace(/\s/g, ""),
        aadharDocUrl: body.aadharDocUrl,
        aadharBackUrl: body.aadharBackUrl,
        cancelledChequeUrl: body.cancelledChequeUrl,
        cmlCmrUrl: body.cmlCmrUrl,
        mobileNo: body.mobileNo,
        email: body.email,
        ucc: body.ucc,
        holderName: body.holderName,
        dob: body.dob ? new Date(`${body.dob}T00:00:00.000Z`) : null,
        address: body.address,
        bankIfsc: body.bankIfsc?.toUpperCase(),
        bankAccountNo: body.bankAccountNo,
        bankName: body.bankName,
        dpId: body.dpId?.toUpperCase(),
        clientId: body.clientId,
        dpName: body.dpName,
        fatherName: body.fatherName?.toUpperCase() || null,
        occupation: body.occupation || null,
        nomineeName: body.nomineeName?.toUpperCase() || null,
      },
    });
    return NextResponse.json(client, { status: 201 });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === "P2002") return NextResponse.json({ error: "UCC already exists" }, { status: 400 });
    return NextResponse.json({ error: err.message || "Save failed" }, { status: 500 });
  }
}
