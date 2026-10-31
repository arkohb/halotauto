// ════════════════════════════════════════════════════════════════════════
//  LEVEL LIFECYCLE + TRADE LOCK UNIT TEST · deterministic synthetic candles
//  Proves the new strategy rules end-to-end at the engine level:
//   A. A level that is NEVER touched or broken REMAINS armed past the legacy
//      expiry (no expiry, no replacement).
//   B. A level that IS broken and whose price NEVER RETURNS to the dotted
//      line is REMOVED after the re-test window (level_removed event,
//      stats.noReturnRemoved, honest log message) — the engine hunts fresh.
//   C. A broken level whose price DOES return within the window FIRES at
//      the dotted line.
//   D. When a trade FIRES, ALL other armed levels are deleted, no new
//      levels arm while the trade runs, and arming RESUMES after TP/SL.
//   E. LEGACY mode (levelPersist=false) keeps exact v1.2 behaviour
//      (expiry, burn-on-break-close, focusCurrent culling).
//   F. GLOBAL TRADE LOCK helpers: engage wipes every participant board,
//      only the holder may process, release only from the holder.
// ════════════════════════════════════════════════════════════════════════

import { HaloEngine } from "../src/lib/halo/engine";
import type { Candle, HaloConfig } from "../src/lib/halo/types";
import {
  clearAllArmedLevels,
  engageTradeLock,
  getTradeLock,
  isLockHolder,
  maybeReleaseLock,
  registerLockParticipant,
} from "../src/lib/trade-lock";

let t = 1_700_000_000_000;
function bar(o: number, c: number, h: number, l: number): Candle {
  return { time: (t += 300_000), open: o, high: h, low: l, close: c, volume: 0 };
}

const BASE: HaloConfig = {
  atrLen: 5,
  bodyMinATR: 0.3, // small-body bars never form C1/C2 pairs (keeps sequences isolated)
  pairTolATR: 1,
  minSepATR: 0.5,
  maxLevels: 3,
  expiryBars: 5,
  levelPersist: true,
  retestBars: 3,
  rangeFilter: false,
  rangeSepATR: 1,
  focusCurrent: true,
  sigMode: "barclose",
  breakATR: 0,
  eqTolATR: 0.5,
  minWickATR: 0,
  wickInside: false,
  slMode: "points",
  slPts: 200, // wide SL band (2.0) so a running trade survives nearby test bars
  slBufPts: 0,
  slATRm: 1.5,
  rrMult: 2,
  pipMult: 1,
};

// warm-up: six calm bullish bars, TR ≈ 1.1 each → ATR ≈ 1.1
const WARM: Candle[] = Array.from({ length: 6 }, (_, i) => {
  const o = 100 + i * 0.1;
  return bar(o, o + 0.1, o + 0.6, o - 0.5);
});

// resistance C1/C2 pair at ~101.95 mid — dotted trigger line at 102.4
const R_PAIR: Candle[] = [bar(101.0, 102.0, 102.3, 100.9), bar(101.9, 101.0, 102.4, 100.8)];
// support C1/C2 pair at ~100.65 mid — dotted trigger line at 100.4
const S_PAIR: Candle[] = [bar(101.2, 100.6, 101.3, 100.4), bar(100.7, 101.1, 101.2, 100.5)];
// small bear spacer — never forms a pair, never breaks anything
const SPACER = bar(101.1, 101.0, 101.3, 100.8);

// quiet bull-only bars (bodies below bodyMin → no C1/C2 pairs can form)
function quiet(from: number, n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const o = from + (i % 2) * 0.05;
    return bar(o, o + 0.1, o + 0.3, o - 0.3);
  });
}

// BREAK bar: bear (no pair with the bear C2), pierces 102.4, closes FAR above
// the return tolerance even after the bar's own ATR spike (tol ≈ 0.69 → 103.09)
const BREAK_NO_RETURN = bar(103.4, 103.3, 103.5, 103.1);
const BREAK = bar(103.4, 103.3, 103.5, 103.1);
// the price comes back to the dotted line → fires at it
const RETURN = bar(103.0, 102.6, 103.2, 102.3);

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
function feed(eng: HaloEngine, candles: Candle[]): string[] {
  const out: string[] = [];
  for (const c of candles) for (const e of eng.processBar(c, true)) out.push(e.type);
  return out;
}

// ── A: never touched / never broken → REMAINS past the legacy expiry ──────
{
  const eng = new HaloEngine({ ...BASE }, 0.01); // expiryBars=5 would kill it in legacy mode
  const evs = feed(eng, [...WARM, ...R_PAIR, ...quiet(101, 10)]);
  const snap = eng.snapshot();
  check("A. unbroken level survives 10 bars (expiry ignored)", snap.levels.length === 1, `levels ${snap.levels.length}`);
  check("A1. no expired event in persist mode", !evs.includes("expired"), evs.join(","));
  check("A2. level still armed at ext 102.4", snap.levels[0]?.ext === 102.4, `ext ${snap.levels[0]?.ext}`);
}

// ── B: broken + price never returns → REMOVED after the re-test window ────
{
  const eng = new HaloEngine({ ...BASE }, 0.01); // retestBars=3
  const evs = feed(eng, [...WARM, ...R_PAIR, BREAK_NO_RETURN, ...quiet(103.3, 4)]);
  const snap = eng.snapshot();
  check("B. level_removed event fires", evs.includes("level_removed"), evs.join(","));
  check("B1. stats.noReturnRemoved === 1", snap.stats.noReturnRemoved === 1, String(snap.stats.noReturnRemoved));
  check("B2. board is empty after removal", snap.levels.length === 0, `levels ${snap.levels.length}`);
  const msg = snap.log.find((l) => l.message?.includes("never returned"))?.message ?? "";
  check("B3. log states the honest reason", msg.length > 0, msg.slice(0, 80));
}

// ── C: broken + returns within the window → FIRES at the dotted line ──────
{
  const eng = new HaloEngine({ ...BASE }, 0.01);
  const evs = feed(eng, [...WARM, ...R_PAIR, BREAK, RETURN]);
  const snap = eng.snapshot();
  check("C. break→return fires within the re-test window", evs.includes("fire") && snap.trade !== null, evs.join(","));
  check("C1. entry is AT the dotted line (102.4)", snap.trade?.entry === 102.4, `entry ${snap.trade?.entry}`);
  check("C2. no removal counted", snap.stats.noReturnRemoved === 0);
}

// ── D: fire wipes the board, arming frozen during the trade, resumes ──────
{
  const eng = new HaloEngine({ ...BASE }, 0.01);
  const evs = feed(eng, [...WARM, ...R_PAIR, ...S_PAIR, SPACER, BREAK, RETURN]);
  let snap = eng.snapshot();
  check("D. trade fired (SELL off the resistance trigger)", snap.trade?.dir === -1, evs.join(","));
  check("D1. ALL armed levels deleted at fire (support wiped too)", snap.levels.length === 0, `levels ${snap.levels.length}`);
  // a fresh pair forms while the trade runs → NOT armed (SL 104.4 / TP 98.4 stays intact)
  const evs2 = feed(eng, [bar(102.5, 103.5, 103.7, 102.4), bar(103.4, 102.6, 103.6, 102.5)]);
  snap = eng.snapshot();
  check("D2. no arming while the trade runs", snap.levels.length === 0 && !evs2.includes("level"), `levels ${snap.levels.length} evs ${evs2.join(",")}`);
  // TP hit (SELL tp = 98.4; bar stays below SL 104.4)
  const evs3 = feed(eng, [bar(99.0, 98.0, 99.2, 97.8)]);
  snap = eng.snapshot();
  check("D3. TP closes the trade", evs3.includes("win") && snap.trade === null, evs3.join(","));
  // scanning re-activates: pairs arm again
  const evs4 = feed(eng, [bar(103.5, 104.5, 104.7, 103.4), bar(104.4, 103.6, 104.6, 103.5)]);
  snap = eng.snapshot();
  check("D4. arming resumes after TP/SL", snap.levels.length > 0 && evs4.includes("level"), `levels ${snap.levels.length} evs ${evs4.join(",")}`);
}

// ── E: LEGACY mode keeps exact v1.2 behaviour ─────────────────────────────
{
  const legacy = { ...BASE, levelPersist: false };
  const eng = new HaloEngine(legacy, 0.01);
  const evs = feed(eng, [...WARM, ...R_PAIR, ...quiet(101, 6)]);
  const snap = eng.snapshot();
  check("E1. legacy expiry still expires unbroken levels", evs.includes("expired") && snap.levels.length === 0, evs.join(","));

  const eng2 = new HaloEngine(legacy, 0.01);
  const evs2 = feed(eng2, [...WARM, ...R_PAIR, BREAK_NO_RETURN]);
  const snap2 = eng2.snapshot();
  check("E2. legacy burns a no-return break at bar close", evs2.includes("burned") && snap2.levels.length === 0 && !evs2.includes("level_removed"), evs2.join(","));

  // focusCurrent culling (legacy only): three same-side pairs → 1 remains
  const eng3 = new HaloEngine(legacy, 0.01);
  feed(eng3, [...WARM, ...R_PAIR, bar(105.5, 107.0, 107.2, 105.3), bar(106.9, 106.0, 107.3, 105.7), bar(110.5, 112.0, 112.2, 110.3), bar(111.9, 111.0, 112.3, 110.7)]);
  const resCount = eng3.snapshot().levels.filter((l) => l.side === -1).length;
  check("E3. legacy focusCurrent keeps only the newest same-side level", resCount === 1, `R levels ${resCount}`);

  // persist mode: the same three pairs stay armed (cap 3)
  const eng4 = new HaloEngine({ ...BASE }, 0.01);
  feed(eng4, [...WARM, ...R_PAIR, bar(105.5, 107.0, 107.2, 105.3), bar(106.9, 106.0, 107.3, 105.7), bar(110.5, 112.0, 112.2, 110.3), bar(111.9, 111.0, 112.3, 110.7)]);
  const resCount4 = eng4.snapshot().levels.filter((l) => l.side === -1).length;
  check("E4. persist mode keeps all three same-side levels", resCount4 === 3, `R levels ${resCount4}`);
}

// ── F: GLOBAL TRADE LOCK helpers ──────────────────────────────────────────
{
  let wipedA = 0;
  let wipedB = 0;
  registerLockParticipant({ key: "testA", clearLevels: () => { wipedA += 1; return 2; } });
  registerLockParticipant({ key: "testB", clearLevels: () => { wipedB += 1; return 0; } });
  check("F. no lock initially", getTradeLock() === null);
  engageTradeLock({ source: "SWEEP", symbol: "BTCUSDT", tf: "1h", dir: 1, entry: 100, sl: 99, tp: 102, tradeDbId: "t1", openedAt: Date.now() });
  const lock = getTradeLock();
  check("F1. lock engaged with the trade facts", lock?.symbol === "BTCUSDT" && lock.tf === "1h" && lock.source === "SWEEP");
  check("F2. every participant board wiped", wipedA === 1 && wipedB === 1);
  check("F3. holder keeps processing, others frozen", isLockHolder("SWEEP", "BTCUSDT", "1h") && !isLockHolder("BOT", "BTCUSDT", "1h") && !isLockHolder("SWEEP", "ETHUSDT", "1h"));
  maybeReleaseLock("BOT", "BTCUSDT", "1h", "win", 12);
  check("F4. release from a non-holder is a no-op", getTradeLock() !== null);
  maybeReleaseLock("SWEEP", "BTCUSDT", "1h", "win", 12);
  check("F5. release from the holder clears the lock", getTradeLock() === null);
  const n = clearAllArmedLevels();
  check("F6. manual board wipe reaches all participants", n === 2 && wipedA === 2 && wipedB === 2);
}

console.log(failures === 0 ? "\nALL LEVEL-LIFECYCLE TESTS GREEN" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
