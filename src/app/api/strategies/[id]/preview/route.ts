// ════════════════════════════════════════════════════════════════════════
//  /api/strategies/[id]/preview · compile + run over REAL market history
//  Returns plot series (chart overlay), trade markers, a real simulated
//  trade list with win/loss stats, and the boolean series eligible as
//  manual signals. Nothing synthetic — the same live feed the EA uses.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PineRuntime } from "@/lib/pine";
import { getKlines, getSymbolMeta, tfSec } from "@/lib/market";
import { TIMEFRAMES } from "@/lib/market-symbols";
import { metaOf, toSummary } from "@/lib/strategy-store";
import type { Candle } from "@/lib/halo/types";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const { id } = await ctx.params;
  try {
    const row = await db.pineStrategy.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "Strategy not found." }, { status: 404 });

    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol") || "XAUUSD";
    const tfRaw = url.searchParams.get("tf") || "5m";
    const tf = (TIMEFRAMES as readonly string[]).includes(tfRaw) ? tfRaw : "5m";
    const limit = Math.min(600, Math.max(60, Number(url.searchParams.get("limit")) || 400));

    const { candles, source } = await getKlines(symbol, tf, limit, { deep: true });
    if (candles.length < 30) {
      return NextResponse.json({ ok: false, error: `Not enough history for ${symbol} ${tf} (got ${candles.length} candles from ${source}).` }, { status: 502 });
    }

    const meta = metaOf(row);
    const candidates = meta?.signalCandidates ?? toSummary(row).signalCandidates;
    const rt = new PineRuntime(row.pineSource, { mintick: getSymbolMeta(symbol).mintick, ticker: symbol, tf, pipMult: 10 });
    if (candidates.length > 0) rt.captureBools(candidates);

    const now = Date.now();
    const secMs = tfSec(tf) * 1000;
    const confirmed: Candle[] = [];
    for (const c of candles) {
      if (c.time + secMs <= now) {
        rt.externalPos = rt.simPos ? { dir: rt.simPos.dir, entry: rt.simPos.entry } : { dir: 0, entry: 0 };
        rt.processBar(c);
        confirmed.push(c);
      }
    }

    // ── plots aligned to bar times ──
    const plots = [...rt.plots.values()].map((p) => ({
      key: p.meta.key,
      title: p.meta.title,
      style: p.meta.style,
      color: p.meta.color,
      lineWidth: p.meta.lineWidth,
      overlay: meta?.overlay ?? true,
      data: (p.values
        .map((v, i) => (v === null || i >= confirmed.length ? null : { time: confirmed[i].time, value: v, color: p.colors[i] ?? undefined }))
        .filter((x) => x !== null)) as { time: number; value: number; color?: string }[],
    }));

    // ── shape markers → buy/sell arrows ──
    const markers = [...rt.shapes.values()].flatMap((s) =>
      s.marks
        .filter((m) => m.bar < confirmed.length)
        .map((m) => ({ time: confirmed[m.bar].time, up: m.up, text: m.text, color: m.color, title: s.meta.title }))
    );

    // ── simulated trades (Pine fill model: next-bar-open entries, intrabar SL/TP) ──
    const pip = getSymbolMeta(symbol).mintick * 10;
    const trades = rt.simTrades.map((t) => ({
      dir: t.dir,
      entryId: t.entryId,
      entryTime: t.entryTime,
      entry: t.entry,
      exitTime: t.exitTime,
      exit: t.exit,
      sl: t.sl,
      tp: t.tp,
      reason: t.reason,
      resultPips: t.exit !== null ? ((t.exit - t.entry) * t.dir) / pip : null,
    }));
    const closed = trades.filter((t) => t.resultPips !== null);
    const wins = closed.filter((t) => (t.resultPips ?? 0) >= 0).length;

    // ── boolean series eligible as manual signals ──
    const booleanSeries = candidates.filter((name) => {
      const arr = rt.capturedBool.get(name);
      return arr && arr.some(Boolean);
    });

    return NextResponse.json({
      ok: true,
      kind: meta?.kind ?? "indicator",
      name: row.name,
      symbol,
      tf,
      source, // feed source stamp — honest provenance
      bars: confirmed.length,
      plots,
      markers: markers.slice(0, 200),
      hlines: meta?.hlines ?? [],
      trades: trades.slice(-80),
      stats: {
        trades: trades.length,
        closed: closed.length,
        wins,
        losses: closed.length - wins,
        winRate: closed.length ? Math.round((wins / closed.length) * 100) : null,
        netPips: closed.reduce((a, t) => a + (t.resultPips ?? 0), 0),
      },
      booleanSeries,
      notes: meta?.notes ?? [],
    });
  } catch (e) {
    const msg = (e as Error).message || "Preview failed.";
    const line = (e as { line?: number }).line;
    return NextResponse.json({ ok: false, error: line ? `Runtime error at line ${line}: ${msg}` : msg }, { status: 400 });
  }
}
