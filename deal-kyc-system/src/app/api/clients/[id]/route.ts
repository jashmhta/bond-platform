import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json(client);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Load failed" },
      { status: 500 }
    );
  }
}

/** PATCH — every KYC field stays editable post-registration. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    /* ---- zero data-leak tolerance: blob: URLs are session-scoped and die with the tab ---- */
    const DOC_FIELDS = ["panDocUrl", "aadharDocUrl", "aadharBackUrl", "cancelledChequeUrl", "cmlCmrUrl"] as const;
    const dead = DOC_FIELDS.filter((f) => typeof b[f] === "string" && b[f].startsWith("blob:"));
    if (dead.length) {
      return NextResponse.json(
        { error: "Internal document link expired (blob URL) — please re-attach: " + dead.join(", ") + ". Nothing was saved." },
        { status: 400 }
      );
    }

    const client = await prisma.client.update({
      where: { id },
      data: {
        ucc: b.ucc ? String(b.ucc).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15) : undefined,
        panNumber: b.panNumber?.toUpperCase() || null,
        panDocUrl: b.panDocUrl,
        aadharNumber: b.aadhaarNumber?.replace(/\s/g, "") || null,
        aadharDocUrl: b.aadharDocUrl,
        aadharBackUrl: b.aadharBackUrl,
        cancelledChequeUrl: b.cancelledChequeUrl,
        cmlCmrUrl: b.cmlCmrUrl,
        mobileNo: b.mobileNo ?? undefined,
        email: b.email ?? undefined,
        holderName: b.holderName ?? undefined,
        fatherName: b.fatherName,
        occupation: b.occupation,
        nomineeName: b.nomineeName,
        dob: b.dob ? new Date(`${b.dob}T00:00:00.000Z`) : null,
        address: b.address,
        bankIfsc: b.bankIfsc?.toUpperCase() || null,
        bankAccountNo: b.bankAccountNo || null,
        bankName: b.bankName || null,
        dpId: b.dpId?.toUpperCase() || null,
        clientId: b.clientId || null,
        dpName: b.dpName || null,
      },
    });
    return NextResponse.json(client);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err.code === "P2002") return NextResponse.json({ error: "That UCC already exists for another client." }, { status: 400 });
    return NextResponse.json(
      { error: err.message || "Update failed" },
      { status: 500 }
    );
  }
}
