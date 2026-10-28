import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const take = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60));
  try {
    const trades = await db.trade.findMany({
      where: { mode: "BOT" },
      orderBy: { openedAt: "desc" },
      take,
    });
    return NextResponse.json({ trades });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, trades: [] }, { status: 500 });
  }
}
