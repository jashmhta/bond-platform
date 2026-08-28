import { NextResponse } from "next/server";

export const revalidate = 300;

/** GET /api/bond-directory — proxies bondapp-lake's bond inventory (no CORS issues). */
export async function GET() {
  try {
    const r = await fetch("https://bondapp-lake.vercel.app/api/bonds", {
      next: { revalidate: 300 },
    });
    if (!r.ok) return NextResponse.json([]);
    const bonds = await r.json();
    return NextResponse.json(bonds);
  } catch {
    return NextResponse.json([]);
  }
}
