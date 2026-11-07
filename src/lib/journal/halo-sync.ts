// ══════════════════════════════════════════════════════════════════════════
//  HALO bot trades → Performance Journal
//
//  Every closed HALO trade (bot, scanner sweep, TradingView alert — paper or
//  live) is copied into the viewer's journal as source "HALO". HALO books
//  results in PIPS, not money, so these rows carry currency "PIPS" and
//  netPnl = signed pips — never an invented dollar amount. (The journal
//  already keeps currencies apart and flags mixed selections.)
//  One installation = one customer (Decision A), so every user of the
//  installation sees the installation's bot book. Idempotent upserts on
//  extKey "halo:{tradeId}".
// ══════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { getSymbolMeta } from "@/lib/market-symbols";

const MIN_GAP_MS = 10_000;
const gSync = globalThis as unknown as { __haloJournalSync?: Map<string, number> };
const lastRun = (gSync.__haloJournalSync ??= new Map<string, number>());

const SOURCE_LABEL: Record<string, string> = {
  BOT: "HALO 3EL bot",
  SWEEP: "HALO all-pairs scanner",
  SCAN: "HALO scanner",
  TV: "TradingView alert",
};

export async function syncHaloTrades(userId: string, force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - (lastRun.get(userId) ?? 0) < MIN_GAP_MS) return 0;
  lastRun.set(userId, now);

  const trades = await db.trade.findMany({
    where: { status: { in: ["WIN", "LOSS"] }, closedAt: { not: null } },
    orderBy: { closedAt: "asc" },
  });
  if (trades.length === 0) return 0;

  const ops = trades.map((t) => {
    const meta = getSymbolMeta(t.symbol);
    const pip = (meta.mintick > 0 ? meta.mintick : 0.01) * 10;
    const signed = (t.status === "WIN" ? 1 : -1) * Math.abs(t.resultPips ?? 0);
    const exitPrice = t.entry + t.direction * signed * pip;
    const riskPrice = t.sl ? Math.abs(t.entry - t.sl) : null;
    const closedAt = t.closedAt!;
    const data = {
      source: "HALO",
      brokerKind: t.execMode === "LIVE" ? t.brokerKind : "paper",
      brokerAccount: "",
      brokerLabel: `${SOURCE_LABEL[t.mode] ?? t.mode} · ${t.execMode === "LIVE" ? "LIVE" : "PAPER"}`,
      positionId: t.brokerOrderId ?? "",
      symbol: t.symbol,
      direction: t.direction === -1 ? "SELL" : "BUY",
      volume: 0,
      entryPrice: t.entry,
      exitPrice,
      sl: t.sl || null,
      tp: t.tp || null,
      openedAt: t.openedAt,
      closedAt,
      durationMin: Math.max(0, Math.round((closedAt.getTime() - t.openedAt.getTime()) / 60_000)),
      grossProfit: signed,
      netPnl: signed,
      currency: "PIPS",
      riskPrice,
      rMultiple: riskPrice && riskPrice > 0 ? ((exitPrice - t.entry) * t.direction) / riskPrice : null,
      strategy: "HALO 3EL",
      timeframe: t.timeframe,
      status: "CLOSED",
    };
    return db.journalTrade.upsert({
      where: { userId_extKey: { userId, extKey: `halo:${t.id}` } },
      create: { userId, extKey: `halo:${t.id}`, ...data },
      // keep the trader's own notes / review / tags on re-sync
      update: data,
    });
  });
  await db.$transaction(ops);
  return ops.length;
}
