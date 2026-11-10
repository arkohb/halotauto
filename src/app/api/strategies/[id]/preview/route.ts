// ════════════════════════════════════════════════════════════════════════
//  /api/strategies/[id]/preview · compile + run over REAL market history
//  Returns plot series (chart overlay), trade markers, a real simulated
//  trade list with win/loss stats, and the boolean series eligible as
//  manual signals. Nothing synthetic — the same live feed the EA uses.
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { guardLicensed } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { PineRuntime, compilePine, exportDrawings, type CompiledPine } from "@/lib/pine";
import { LIBRARY } from "@/lib/pine/library-sources";
import { getKlines, getSymbolMeta, tfSec } from "@/lib/market";
import { TIMEFRAMES } from "@/lib/market-symbols";
import { metaOf, toSummary } from "@/lib/strategy-store";
import type { Candle } from "@/lib/halo/types";
import type { PineStrategy } from "@prisma/client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const { id } = await ctx.params;
  try {
    // ── resolve the script ──
    //   "builtin:<n>" → the ★ best-indicators library shipped in the bundle
    //   (compiled straight from its source — no DB row needed, so the Strategy
    //   Lab can chart ANY built-in indicator the moment it is selected)
    //   anything else  → a saved PineStrategy row
    const libMatch = /^builtin:(\d+)$/.exec(id);
    let row: PineStrategy | null = null;
    let pineSource = "";
    let displayName = "";
    let meta: CompiledPine | null = null;
    if (libMatch) {
      const idx = Number(libMatch[1]);
      const entry = idx >= 0 && idx < LIBRARY.length ? LIBRARY[idx] : null;
      if (!entry) {
        return NextResponse.json({ ok: false, error: "Library indicator not found — pick another from the ★ list." }, { status: 404 });
      }
      const c = compilePine(entry.source);
      if (c.error) {
        return NextResponse.json({ ok: false, error: `This library indicator failed to compile: ${c.error.msg}` }, { status: 400 });
      }
      meta = c.meta;
      pineSource = entry.source;
      displayName = entry.name;
    } else {
      row = await db.pineStrategy.findUnique({ where: { id } });
      if (!row) return NextResponse.json({ ok: false, error: "Strategy not found." }, { status: 404 });
      meta = metaOf(row);
      pineSource = row.pineSource;
      displayName = row.name;
    }

    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol") || "XAUUSD";
    const tfRaw = url.searchParams.get("tf") || "5m";
    const tf = (TIMEFRAMES as readonly string[]).includes(tfRaw) ? tfRaw : "5m";
    const limit = Math.min(600, Math.max(60, Number(url.searchParams.get("limit")) || 400));

    const { candles, source } = await getKlines(symbol, tf, limit, { deep: true });
    if (candles.length < 30) {
      return NextResponse.json({ ok: false, error: `Not enough history for ${symbol} ${tf} (got ${candles.length} candles from ${source}).` }, { status: 502 });
    }

    const candidates = meta?.signalCandidates ?? (row ? toSummary(row).signalCandidates : []);
    const rt = new PineRuntime(pineSource, { mintick: getSymbolMeta(symbol).mintick, ticker: symbol, tf, pipMult: 10 });
    if (candidates.length > 0) rt.captureBools(candidates);

    const now = Date.now();
    const secMs = tfSec(tf) * 1000;
    const confirmed: Candle[] = [];
    rt.knownLastBar = candles.filter((c) => c.time + secMs <= now).length - 1;
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

    // ── the indicator's INPUT PARAMETERS with their resolved values ──
    // Shown on the chart rail ("PARAMETERS" card) so the trader sees the
    // exact settings the attached indicator is trading with. Pine executes
    // the script body on EVERY bar, so input() registers a record per bar —
    // AND the per-bar records get fresh ids (input_<n>), so dedupe by TITLE
    // (first record wins; defval is identical anyway).
    // source-type inputs (close/open/…) and series values render as "series".
    const seenInput = new Set<string>();
    const inputs: { title: string; value: string }[] = [];
    for (const i of rt.inputs) {
      const k = i.title || i.id;
      if (seenInput.has(k)) continue;
      seenInput.add(k);
      let value: string;
      const v = i.defval;
      if (v === null || v === undefined) value = "—";
      else if (typeof v === "number") value = Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
      else if (typeof v === "boolean") value = v ? "true" : "false";
      else if (Array.isArray(v)) value = "[…]";
      else if (typeof v === "object") value = "series";
      else value = String(v);
      inputs.push({ title: k, value });
    }

    return NextResponse.json({
      ok: true,
      kind: meta?.kind ?? "indicator",
      name: displayName,
      symbol,
      tf,
      source, // feed source stamp — honest provenance
      bars: confirmed.length,
      plots,
      markers: markers.slice(0, 200),
      hlines: meta?.hlines ?? [],
      inputs,
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
      overlay: meta?.overlay ?? true,
      // lines / boxes / labels / tables / fill / bgcolor — drawn on the chart canvas
      drawings: exportDrawings(rt, confirmed.map((c) => c.time), confirmed.map((c) => c.high), confirmed.map((c) => c.low), secMs),
    });
  } catch (e) {
    const msg = (e as Error).message || "Preview failed.";
    const line = (e as { line?: number }).line;
    return NextResponse.json({ ok: false, error: line ? `Runtime error at line ${line}: ${msg}` : msg }, { status: 400 });
  }
}
