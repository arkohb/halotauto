// ════════════════════════════════════════════════════════════════════════
//  ORPHAN PAPER TRADES · close book entries nothing is managing any more
//
//  Paper trades opened before the persistent execution lock (or by test
//  fires) can sit at OPEN forever: no engine, scanner or restart monitor
//  owns them, so they never hit TP/SL in the book. At boot each such trade
//  is settled from REAL candles since its entry — the first bar that
//  touches SL or TP decides it (same bar touching both = SL, like the
//  engine). When that cannot be decided honestly (simulated-only market,
//  history no longer reaching back to the entry, or no touch yet while no
//  one manages it) it is marked VOID with the reason. PAPER only — a LIVE
//  trade is never touched here; the broker and the execution lock own it.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { getKlines } from "@/lib/market";
import { getSymbolMeta, tfSec } from "@/lib/market-symbols";
import { getTradeLock } from "@/lib/trade-lock";

const g = globalThis as unknown as { __haloOrphansDone?: Promise<number> };

export function settleOrphanTradesOnce(keep: Array<string | null | undefined> = []): Promise<number> {
  return (g.__haloOrphansDone ??= settleOrphanTrades(keep).catch((e) => {
    console.error("[orphans] settle failed:", (e as Error).message);
    return 0;
  }));
}

async function settleOrphanTrades(keep: Array<string | null | undefined>): Promise<number> {
  const owned = new Set<string>(keep.filter((x): x is string => !!x));
  const lock = getTradeLock();
  if (lock?.tradeDbId) owned.add(lock.tradeDbId);
  const intents = await db.executionIntent.findMany({
    where: { state: { in: ["PENDING", "SUBMITTING", "OPEN", "UNCERTAIN"] } },
    select: { tradeId: true },
  });
  for (const i of intents) if (i.tradeId) owned.add(i.tradeId);

  const open = await db.trade.findMany({ where: { status: "OPEN", execMode: "PAPER" }, orderBy: { openedAt: "asc" } });
  let settled = 0;
  for (const t of open) {
    if (owned.has(t.id)) continue;
    const verdict = await decide(t);
    await db.trade.update({
      where: { id: t.id },
      data: {
        status: verdict.status,
        resultPips: verdict.pips,
        closedAt: verdict.closedAt,
        note: `${t.note ? `${t.note} | ` : ""}${verdict.note}`.slice(0, 250),
      },
    });
    settled++;
  }
  if (settled) console.log(`[orphans] settled ${settled} unmanaged paper trade(s)`);
  return settled;
}

type Verdict = { status: "WIN" | "LOSS" | "VOID"; pips: number | null; closedAt: Date; note: string };

async function decide(t: { symbol: string; timeframe: string; direction: number; entry: number; sl: number; tp: number; openedAt: Date }): Promise<Verdict> {
  const now = new Date();
  const k = await getKlines(t.symbol, t.timeframe, 2000, { deep: true }).catch(() => null);
  if (!k || k.candles.length === 0) return { status: "VOID", pips: null, closedAt: now, note: "void: no price history to settle this unmanaged paper trade" };
  if (k.source === "simulator") return { status: "VOID", pips: null, closedAt: now, note: "void: simulated-only market — no real prices to settle this paper trade" };
  const tfMs = tfSec(t.timeframe) * 1000;
  const opened = t.openedAt.getTime();
  if (k.candles[0].time > opened) {
    return { status: "VOID", pips: null, closedAt: now, note: "void: price history no longer reaches back to this paper trade's entry" };
  }
  const pip = (getSymbolMeta(t.symbol).mintick || 0.01) * 10;
  for (const c of k.candles) {
    if (c.time + tfMs <= opened) continue;
    const hitSL = t.direction === -1 ? c.high >= t.sl : c.low <= t.sl;
    const hitTP = t.direction === -1 ? c.low <= t.tp : c.high >= t.tp;
    if (!hitSL && !hitTP) continue;
    const exit = hitSL ? t.sl : t.tp;
    const pips = ((exit - t.entry) * t.direction) / pip;
    return {
      status: pips > 0 ? "WIN" : "LOSS",
      pips: Math.abs(pips),
      closedAt: new Date(c.time),
      note: `settled from real candles (${hitSL ? "SL" : "TP"}) — this paper trade had no active manager`,
    };
  }
  return { status: "VOID", pips: null, closedAt: now, note: "void: unmanaged paper trade, SL/TP not reached — removed from the open book" };
}
