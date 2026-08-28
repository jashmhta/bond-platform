import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** GET /api/deals/next-ref?type=TS&date=YYYY-MM-DD → { refNo, serial } */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") === "TB" ? "TB" : "TS";
  const raw = sp.get("date");
  const dateStr = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const ymd = dateStr.replaceAll("-", "");
  const suggest = (serial: number) => ({
    refNo: `${type}${ymd}${String(serial).padStart(3, "0")}`,
    serial,
  });

  try {
    const last = await prisma.deal.findFirst({
      where: { type, date },
      orderBy: { serial: "desc" },
      select: { serial: true },
    });
    const serial = Math.min((last?.serial ?? 0) + 1, 999);
    return NextResponse.json(suggest(serial));
  } catch {
    return NextResponse.json(suggest(1));
  }
}
