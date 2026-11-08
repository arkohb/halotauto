// ── BEST INDICATORS LIBRARY · compile + runtime smoke test ──────────────────
// Every library entry must:
//   1. compile clean through the REAL HALO Pine compiler
//   2. be a strategy() with both long and short entries (bot-tradeable)
//   3. run over 320 synthetic bars without a runtime error
//   4. produce plots, and for the library as a whole: real simulated trades
// Run: bun scripts/test-pine-library.ts
import { compilePine, PineRuntime } from "@/lib/pine";
import { LIBRARY } from "@/lib/pine/library-sources";
import type { Candle } from "@/lib/halo/types";

let failures = 0;
const fail = (name: string, msg: string) => {
  failures++;
  console.error(`  ✗ ${name}: ${msg}`);
};

// deterministic PRNG (mulberry32) → reproducible runs
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 320 bars: chop → strong up-trend → chop → strong down-trend → chop.
 *  Every regime-switch pattern gives trend/momentum systems something to bite on. */
function synthCandles(): Candle[] {
  const r = rng(20261105);
  const out: Candle[] = [];
  let px = 2350; // gold-ish level
  let drift = 0;
  const tfMs = 5 * 60 * 1000;
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0) - 320 * tfMs;
  for (let i = 0; i < 320; i++) {
    if (i < 70) drift = 0; // chop
    else if (i < 150) drift = 0.55; // up
    else if (i < 175) drift = 0; // top chop
    else if (i < 255) drift = -0.6; // down
    else drift = 0.05; // settle
    const vol = 1.6 + r() * 1.2;
    const o = px;
    const c = px + drift + (r() - 0.5) * vol * 2;
    const h = Math.max(o, c) + r() * vol;
    const l = Math.min(o, c) - r() * vol;
    out.push({ time: t0 + i * tfMs, open: o, high: h, low: l, close: c, volume: 800 + r() * 900 });
    px = c;
  }
  return out;
}

const candles = synthCandles();
console.log(`Library: ${LIBRARY.length} indicators · ${candles.length} synthetic bars\n`);

let totalTrades = 0;
let totalMarkers = 0;

for (const item of LIBRARY) {
  console.log(`▸ ${item.name}`);
  // 1 + 2 · compile gate
  const res = compilePine(item.source);
  if (res.error) {
    fail(item.name, `fatal compile ${res.error.line}:${res.error.col} — ${res.error.msg}`);
    continue;
  }
  const m = res.meta;
  if (!m.ok) {
    fail(item.name, `compile not ok — ${m.diagnostics.map((d) => `L${d.line}:${d.col} ${d.msg}`).join(" | ")}`);
    continue;
  }
  if (m.kind !== "strategy") {
    fail(item.name, `kind=${m.kind}, expected strategy (bot must trade it)`);
    continue;
  }
  if (!m.hasLong || !m.hasShort) {
    fail(item.name, `hasLong=${m.hasLong} hasShort=${m.hasShort} — both directions required`);
    continue;
  }
  // 3 + 4 · runtime smoke over synthetic bars
  try {
    const rt = new PineRuntime(item.source, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
    for (const c of candles) {
      rt.externalPos = rt.simPos ? { dir: rt.simPos.dir, entry: rt.simPos.entry } : { dir: 0, entry: 0 };
      rt.processBar(c);
    }
    const plotVals = [...rt.plots.values()].map((p) => p.values.filter((v) => v !== null).length);
    const emptyPlots = [...rt.plots.values()].filter((p) => p.values.every((v) => v === null)).length;
    const markers = [...rt.shapes.values()].reduce((a, s) => a + s.marks.length, 0);
    const trades = rt.simTrades.length;
    const closed = rt.simTrades.filter((t) => t.exit !== null).length;
    totalTrades += trades;
    totalMarkers += markers;
    if (emptyPlots > 0) fail(item.name, `${emptyPlots} plot(s) produced NO values over 320 bars`);
    if (markers === 0) fail(item.name, "no BUY/SELL markers fired over the full trend/chop cycle");
    if (trades === 0) fail(item.name, "simulator recorded ZERO trades — signals never reach the entry plan");
    if (trades > 0 && closed === 0) fail(item.name, `${trades} entries but none closed (SL/TP/exits never trigger)`);
    console.log(`  ✓ plots=${m.plots.length} (non-empty ${plotVals.filter((n) => n > 0).length}) · shapes=${m.shapes.length} · hlines=${m.hlines.length} · inputs=${m.inputs.length} · markers=${markers} · trades=${trades} (closed ${closed})`);
  } catch (e) {
    const err = e as Error & { line?: number };
    fail(item.name, `runtime ${err.line ? `@L${err.line} ` : ""}${err.message}`);
  }
}

console.log(`\nTotal simulated entries across library: ${totalTrades} · total markers: ${totalMarkers}`);
if (failures > 0) {
  console.error(`\nFAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log("ALL LIBRARY INDICATORS PASS");
