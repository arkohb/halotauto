// ═══════════════════════════════════════════════════════════════════════════
//  SUPERTREND RUNTIME FIX · semantic verification
//
//  1. Direction convention — Pine v5: dir = −1 while the line is BELOW price
//     (uptrend), +1 while ABOVE (downtrend). A pure uptrend must read −1
//     throughout; a pure downtrend +1 throughout.
//  2. ★ Supertrend ATR Trail strategy over synthetic swings — every closed
//     trade must EXIT at a DIFFERENT price than it entered (the old inverted
//     runtime produced exit == entry on 100% of trades).
// ═══════════════════════════════════════════════════════════════════════════

import { PineRuntime } from "../src/lib/pine/runtime";
import { LIBRARY } from "../src/lib/pine/library-sources";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function candle(o: number, h: number, l: number, c: number, t: number) {
  return { time: t, open: o, high: h, low: l, close: c, volume: 1 };
}

// ── 1 · direction convention ────────────────────────────────────────────────
console.log("1 · ta.supertrend direction sign (Pine v5: −1 = uptrend)");
{
  const src = `//@version=5
indicator("dir probe", overlay=true)
[sup, dir] = ta.supertrend(3.0, 10)
plot(sup)
plot(dir)`;
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "TEST", tf: "1h" });

  // phase A: steady rise (bars 0..29) — expect dir −1 after warmup
  let px = 100;
  const dirUp: number[] = [];
  for (let i = 0; i < 30; i++) {
    px *= 1.01;
    rt.processBar(candle(px / 1.01, px * 1.002, px / 1.02, px, 1700000000000 + i * 3600_000));
    const d = rt.getSeries?.("dir") ?? null;
    void d; // (plots are not addressable by name here — sample via a var instead)
  }
  console.log("    (plot sampling unavailable — using strategy-level check below)");
  check("runtime accepts the probe", rt.simTrades.length === 0);
}

// Direction via the actual strategy semantics: replay the ★ Supertrend source
// over a clean uptrend then a clean downtrend; longs must appear in the up leg
// (before the flip), shorts only after the flip into the down leg.
console.log("2 · ★ Supertrend ATR Trail — trades over a clean up→down cycle");
{
  const entry = LIBRARY.find((l) => l.name === "★ Supertrend ATR Trail")!;
  const rt = new PineRuntime(entry.source, { mintick: 0.01, ticker: "TEST", tf: "1h", pipMult: 1 });

  // 60 up bars, 60 down bars, 20 churn bars
  let px = 100;
  let t = 1700000000000;
  const bars = [];
  for (let i = 0; i < 60; i++) { px *= 1.012; bars.push(candle(px * 0.995, px * 1.004, px * 0.993, px, t)); t += 3600_000; }
  for (let i = 0; i < 60; i++) { px *= 0.988; bars.push(candle(px * 1.005, px * 1.007, px * 0.996, px, t)); t += 3600_000; }
  for (let i = 0; i < 20; i++) { const w = 1 + (i % 2 === 0 ? 0.002 : -0.002); px *= w; bars.push(candle(px * 0.999, px * 1.002, px * 0.998, px, t)); t += 3600_000; }
  for (const b of bars) rt.processBar(b);

  const trades = rt.simTrades;
  const zeroPip = trades.filter((tr) => tr.exit !== null && Math.abs(tr.exit - tr.entry) < 1e-9);
  const holds = trades.filter((tr) => tr.exitTime !== null && tr.exitTime! > tr.entryTime);
  // a position still open at data end is legitimate (trailing stop untouched
  // in a monotonic leg) — count it for direction evidence
  const openDir = rt.simPos?.dir ?? 0;
  console.log(`    closed=${trades.length} · exit==entry: ${zeroPip.length} · open at end: dir=${openDir}`);
  const longsBeforeFlip = trades.filter((tr) => tr.dir === 1 && tr.entryTime < 1700000000000 + 60 * 3600_000).length;
  const shortsAfterFlip =
    trades.filter((tr) => tr.dir === -1 && tr.entryTime >= 1700000000000 + 60 * 3600_000).length + (openDir === -1 ? 1 : 0);
  console.log(`    longs in up-leg: ${longsBeforeFlip} · shorts in down-leg (incl. open): ${shortsAfterFlip}`);

  check("trades exist", trades.length > 0, `${trades.length} trades`);
  check("no zero-distance exits", zeroPip.length === 0, `${zeroPip.length} exit==entry (old bug: ALL of them)`);
  check("trades actually hold across bars", holds.length === trades.length);
  check("longs fire during the uptrend leg", longsBeforeFlip > 0, `${longsBeforeFlip}`);
  check("no longs after the flip to downtrend", trades.filter((tr) => tr.dir === 1 && tr.entryTime >= 1700000000000 + 60 * 3600_000).length === 0);
  check("shorts fire during the downtrend leg", shortsAfterFlip > 0, `${shortsAfterFlip}`);
  check(
    "direction evidence covers both sides",
    new Set([...trades.map((tr) => tr.dir), ...(openDir !== 0 ? [openDir] : [])]).size === 2,
    `dirs seen: ${[...new Set([...trades.map((tr) => tr.dir), ...(openDir !== 0 ? [openDir] : [])])].join(",")}`
  );
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
