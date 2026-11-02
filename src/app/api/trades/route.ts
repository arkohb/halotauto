import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const url = new URL(req.url);
  const take = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60));
  try {
    const trades = await db.trade.findMany({
      where: { mode: { in: ["BOT", "TV", "SCAN", "MANUAL"] } },
      orderBy: { openedAt: "desc" },
      take,
    });
    return NextResponse.json({ trades });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, trades: [] }, { status: 500 });
  }
}
