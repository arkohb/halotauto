import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guardLicensed } from "@/lib/api-guard";
import { getKlines } from "@/lib/market";
import { getSymbolMeta } from "@/lib/market-symbols";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  ACTIVE TRADE · live snapshot for the Performance dashboard
//
//  One cheap GET that the dashboard polls every ~2s while open:
//    • the single OPEN trade (the one-trade-at-a-time book guarantees ≤1)
//    • its current market price (fresh cadence — same feed as the chart/EA)
//    • pip metadata so the browser computes floating P&L exactly like the
//      execution engine does: pips = ((price − entry) × dir) / (mintick × pipMult)
//  When nothing runs the answer is `{ active: false }` and the panel shows
//  the hunting state — the moment a trade fires it appears here and runs live.
// ════════════════════════════════════════════════════════════════════════

const OPEN_MODES = ["BOT", "TV", "SCAN", "SWEEP", "MANUAL"] as const;

async function pipMultOf(): Promise<number> {
  try {
    const row = await db.botConfig.findUnique({ where: { id: "main" } });
    if (row) {
      const cfg = JSON.parse(row.configJson) as { pipMult?: number };
      if (typeof cfg.pipMult === "number" && cfg.pipMult > 0) return cfg.pipMult;
    }
  } catch {
    // default stands
  }
  return 10;
}

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  const base = {
    active: false,
    trade: null,
    price: 0,
    mintick: 0,
    pipSize: 0,
    pipMult: 0,
    source: "",
    serverTime: Date.now(),
    scanPaused: false,
  };
  try {
    const trade = await db.trade.findFirst({
      where: { status: "OPEN", mode: { in: [...OPEN_MODES] } },
      orderBy: { openedAt: "desc" },
    });
    if (!trade) return NextResponse.json(base);

    const mintick = getSymbolMeta(trade.symbol).mintick ?? 0.01;
    const pipMult = await pipMultOf();
    let price = 0;
    let source = "";
    try {
      const { candles, source: src } = await getKlines(trade.symbol, trade.timeframe, 1, { fresh: true });
      price = candles[candles.length - 1]?.close ?? 0;
      source = src;
    } catch {
      price = 0; // feed hiccup — the panel keeps the last known price and marks the feed stale
    }

    return NextResponse.json({
      active: true,
      trade: {
        id: trade.id,
        symbol: trade.symbol,
        timeframe: trade.timeframe,
        dir: trade.direction,
        side: trade.direction === -1 ? "SELL" : "BUY",
        entry: trade.entry,
        sl: trade.sl,
        tp: trade.tp,
        mode: trade.mode,
        execMode: trade.execMode,
        openedAt: trade.openedAt.toISOString(),
        riskPips: Math.abs(trade.riskPips),
        rewardPips: Math.abs(trade.rewardPips),
      },
      price,
      mintick,
      pipSize: mintick * pipMult,
      pipMult,
      source,
      serverTime: Date.now(),
      scanPaused: true, // one trade at a time — scanning is parked while this runs
    });
  } catch (e) {
    return NextResponse.json({ ...base, error: (e as Error).message }, { status: 500 });
  }
}
