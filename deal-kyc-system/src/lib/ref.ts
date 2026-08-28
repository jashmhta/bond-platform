import { prisma } from "./db";

/** TS = Today Sell, TB = Today Buy */
export type DealType = "TS" | "TB";

export async function nextRefNo(type: DealType, date: Date): Promise<{ refNo: string; serial: number }> {
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${type}${yyyymmdd}`;
  // find max serial for this date+type
  const last = await prisma.deal.findFirst({
    where: { type, date },
    orderBy: { serial: "desc" },
    select: { serial: true },
  });
  const serial = (last?.serial ?? 0) + 1;
  if (serial > 999) throw new Error("Too many deals today (max 999)");
  const refNo = `${prefix}${String(serial).padStart(3, "0")}`;
  return { refNo, serial };
}

export function formatRefNo(type: DealType, dateStr: string, serial: number): string {
  // dateStr YYYY-MM-DD -> YYYYMMDD
  const ymd = dateStr.replace(/-/g, "");
  return `${type}${ymd}${String(serial).padStart(3, "0")}`;
}
