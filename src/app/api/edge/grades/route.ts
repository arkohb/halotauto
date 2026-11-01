// Recent graded trades from the live book + per-grade results
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tradeR } from "@/lib/edge/guardian";
import { GRADE_LETTERS } from "@/lib/edge/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.trade.findMany({
    where: { mode: { not: "BACKTEST" }, gradeLetter: { not: "" } },
    orderBy: { openedAt: "desc" },
    take: 300,
  });
  const recent = rows.slice(0, 40).map((t) => ({
    id: t.id,
    symbol: t.symbol,
    tf: t.timeframe,
    dir: t.direction,
    grade: t.grade,
    letter: t.gradeLetter,
    sizeMult: t.sizeMult,
    status: t.status,
    r: tradeR(t),
    openedAt: t.openedAt.getTime(),
  }));
  const table = GRADE_LETTERS.map((letter) => {
    const rs = rows.filter((t) => t.gradeLetter === letter).map((t) => tradeR({ ...t, sizeMult: 1 })).filter((r): r is number => r !== null);
    const net = rs.reduce((a, r) => a + r, 0);
    return { letter, trades: rs.length, winRate: rs.length ? (rs.filter((r) => r > 0).length * 100) / rs.length : null, avgR: rs.length ? net / rs.length : null, netR: net };
  });
  return NextResponse.json({ ok: true, recent, table });
}
