// ════════════════════════════════════════════════════════════════════════
//  EDGE vs BASELINE · one-click A/B backtest on the same real history
//  baseline = saved 3EL settings, fixed SL/TP, every fire taken, size 1
//  EDGE     = same settings + Signal Quality gate/sizing + Smart Trade
//             Manager + Capital Guardian (as configured in EDGE settings)
//  Plus the grade table: per-letter results over ALL baseline fires — does
//  a higher grade actually earn more on this market?
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { ensureBoot, getBot } from "@/lib/bot";
import { buildQualitySeries } from "@/lib/edge/quality";
import { loadEdge } from "@/lib/edge/settings";
import { confirmedOnly, gradeTable, runSim, summarize } from "@/lib/edge/simulate";
import type { HaloConfig } from "@/lib/halo/types";
import { getDeepHistory } from "@/lib/market-history";
import { tfSec } from "@/lib/market-symbols";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  symbol?: string;
  tf?: string;
  bars?: number;
  spreadPips?: number;
  cfg?: Partial<HaloConfig>;
}

export async function POST(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const body = (await req.json()) as Body;
    await ensureBoot();
    const bot = getBot();
    const symbol = (body.symbol ?? bot.symbol).toUpperCase().trim();
    const tf = body.tf ?? bot.tf;
    const bars = Math.min(100_000, Math.max(300, Math.round(Number(body.bars) || 5000)));
    const spreadPips = Math.min(100, Math.max(0, Number(body.spreadPips) || 0));
    const cfg: HaloConfig = { ...bot.cfg, ...(body.cfg ?? {}) };
    const edge = await loadEdge();

    const deep = await getDeepHistory({ symbol, tf, bars, fromMs: null });
    const tfMs = tfSec(tf) * 1000;
    const candles = confirmedOnly(deep.candles, tfMs);
    if (candles.length < 300 || deep.source === "simulator") {
      return NextResponse.json({ ok: false, code: "NO_LIVE_DATA", error: "Real market history is unavailable for this market right now — the comparison only runs on real prices." });
    }
    const series = buildQualitySeries(candles, tfMs);
    const mintick = deep.meta.mintick;

    const baseTrades = runSim(series, { cfg, mintick, spreadPips });
    const edgeTrades = runSim(series, {
      cfg,
      mintick,
      spreadPips,
      tm: edge.manager.enabled ? edge.manager : null,
      quality: edge.quality.enabled ? edge.quality : null,
      guardian: edge.guardian.enabled ? edge.guardian : null,
    });
    const baseline = summarize(baseTrades);
    const withEdge = summarize(edgeTrades);

    return NextResponse.json({
      ok: true,
      symbol,
      tf,
      bars: candles.length,
      source: deep.source,
      span: { from: candles[0].time, to: candles[candles.length - 1].time + tfMs },
      layers: {
        quality: edge.quality.enabled ? { minScore: edge.quality.minScore, gradeSizing: edge.quality.gradeSizing } : null,
        manager: edge.manager.enabled ? edge.manager : null,
        guardian: edge.guardian.enabled,
      },
      baseline: { summary: baseline.summary, curve: baseline.curve },
      edge: { summary: withEdge.summary, curve: withEdge.curve },
      gradeTable: gradeTable(baseTrades),
    });
  } catch (e) {
    const msg = (e as Error).message ?? "comparison failed";
    if (msg.startsWith("NO_LIVE_DATA") || msg.startsWith("Invalid symbol")) {
      return NextResponse.json({ ok: false, code: "NO_LIVE_DATA", error: msg });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
