// ════════════════════════════════════════════════════════════════════════
//  RANGE FILTER UNIT TEST · deterministic synthetic candles
//  Proves the v1.2 strategy change end-to-end at the engine level:
//   1. Ranging market + marked S/R too close  → trade SKIPPED, level burned,
//      skip announced (log entry + range_skip event with the reason).
//   2. Same sequence with the filter OFF      → the trade FIRES (the filter
//      is what blocked it, nothing else changed).
//   3. After the skip, a FRESH pair far from the range forms → it ARMS and
//      its break→return FIRES normally ("find one further away").
//   4. stats.rangeSkipped counts every refusal; lastResult states it.
// ════════════════════════════════════════════════════════════════════════

import { HaloEngine } from "../src/lib/halo/engine";
import type { Candle, HaloConfig } from "../src/lib/halo/types";

let t = 1_700_000_000_000;
function bar(o: number, c: number, h: number, l: number): Candle {
  return { time: (t += 300_000), open: o, high: h, low: l, close: c, volume: 0 };
}

const BASE: HaloConfig = {
  atrLen: 5,
  bodyMinATR: 0,
  pairTolATR: 1,
  minSepATR: 0.5,
  maxLevels: 3,
  expiryBars: 150,
  levelPersist: true,
  retestBars: 24,
  rangeFilter: true,
  rangeSepATR: 2.0,
  focusCurrent: true,
  sigMode: "barclose",
  breakATR: 0,
  eqTolATR: 0.5,
  minWickATR: 0,
  wickInside: false,
  slMode: "points",
  slPts: 10,
  slBufPts: 0,
  slATRm: 1.5,
  rrMult: 2,
  pipMult: 1,
};

// warm-up: six calm bullish bars, TR = 1.0 each → ATR ≈ 1.0
const WARM: Candle[] = Array.from({ length: 6 }, (_, i) => {
  const o = 100 + i * 0.1;
  return bar(o, o + 0.1, o + 0.6, o - 0.5);
});

// resistance C1/C2 pair at ~101.5 mid (ext 102.4) + support C1/C2 pair at
// ~100.65 mid (ext 100.4) → S/R midpoint gap ≈ 0.85 — far below 2×ATR
const BOX: Candle[] = [
  bar(101.0, 102.0, 102.3, 100.9), // R1 bull
  bar(101.9, 101.0, 102.4, 100.8), // R2 bear → resistance level
  bar(101.2, 100.6, 101.3, 100.4), // S1 bear
  bar(100.7, 101.1, 101.2, 100.5), // S2 bull → support level
];

// C3 that breaks the resistance wick line (102.4) and returns to it
const TRIGGER: Candle[] = [bar(101.3, 102.5, 103.0, 101.2)];

// after the skip: a FRESH resistance pair far above (~106.5 mid, gap ≈ 5.9 ≈
// 3.8×ATR — comfortably further away from the range) + its break→return
const FAR: Candle[] = [
  bar(105.5, 107.0, 107.2, 105.3), // N1 bull
  bar(106.9, 106.0, 107.3, 105.7), // N2 bear → new resistance level
  bar(106.2, 107.6, 108.2, 106.0), // C3 break & return → must FIRE
];

function run(rangeFilter: boolean) {
  const eng = new HaloEngine({ ...BASE, rangeFilter }, 0.01);
  const events: string[] = [];
  let atrAtTrigger = 0;
  for (const c of [...WARM, ...BOX, ...TRIGGER]) {
    const evs = eng.processBar(c, true);
    for (const e of evs) events.push(e.type);
    atrAtTrigger = eng.snapshot().atr ?? 0;
  }
  return { eng, events, atrAtTrigger };
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// ── 1+2: differential — filter ON skips, filter OFF fires ────────────────
const on = run(true);
const off = run(false);

const skipEv = on.eng
  .snapshot()
  .log.filter((l) => l.kind === "skip");
const gotSkip = on.events.includes("range_skip");
const noTrade = on.eng.snapshot().trade === null;
const skipCounted = on.eng.snapshot().stats.rangeSkipped === 1;
const msgOK = skipEv.length > 0 && /RANGING/i.test(skipEv[0].message ?? "") && /too close for entry/i.test(skipEv[0].message ?? "");
check("1. ranging + S/R too close → range_skip event", gotSkip, on.events.join(","));
check("1a. no trade opened", noTrade);
check("1b. stats.rangeSkipped === 1", skipCounted);
check("1c. log entry states the reason", msgOK, skipEv[0]?.message?.slice(0, 90));
check(
  "1d. lastResult states the skip",
  /RANGE SKIP/.test(on.eng.snapshot().stats.lastResult.text),
  on.eng.snapshot().stats.lastResult.text
);
check("2. filter OFF → same setup FIRES", off.events.includes("fire") && !off.events.includes("range_skip"), off.events.join(","));

// gap really was below the threshold when the trigger arrived
const gapAtr = Math.abs(101.5 - 100.65) / on.atrAtTrigger;
check("1e. measured S/R gap < rangeSepATR", gapAtr < 2.0, `gap ${gapAtr.toFixed(2)}×ATR (atr ${on.atrAtTrigger.toFixed(3)})`);

// ── 3: fresh level further away arms and trades after the skip ───────────
const events3: string[] = [];
for (const c of FAR) {
  const evs = on.eng.processBar(c, true);
  for (const e of evs) events3.push(e.type);
}
const snap3 = on.eng.snapshot();
check("3. fresh far level fires after the skip", events3.includes("fire") && snap3.trade !== null, events3.join(","));
check("3a. it entered at the NEW far trigger (107.3)", snap3.trade?.entry === 107.3, `entry ${snap3.trade?.entry}`);
check("3b. still exactly 1 range skip", snap3.stats.rangeSkipped === 1);

// ── 4: no false skips when only ONE side is armed ─────────────────────────
const eng4 = new HaloEngine({ ...BASE }, 0.01);
const evs4: string[] = [];
for (const c of [...WARM, ...BOX.slice(0, 2), ...TRIGGER]) {
  for (const e of eng4.processBar(c, true)) evs4.push(e.type);
}
check("4. single-side armed (no box) trades normally", evs4.includes("fire") && !evs4.includes("range_skip"), evs4.join(","));

console.log(failures === 0 ? "\nALL RANGE-FILTER TESTS GREEN" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
