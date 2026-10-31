// ════════════════════════════════════════════════════════════════════════
//  VERIFY · bot announcer chain (run: bun scripts/verify-announcer.ts)
//  1. Engine emits ARMED (level) events WITH prices (top/bot/ext)
//  2. Engine emits BREAK (C3 breaks the dotted line) exactly once per level
//     — intrabar (instant trial) and on the confirmed bar (barclose mode)
//  3. RANGE SKIP still works after the change (regression guard)
//  4. Event bus: publish → subscriber, ring buffer, eventsSince
// ════════════════════════════════════════════════════════════════════════

import { HaloEngine } from "../src/lib/halo/engine";
import { DEFAULT_CONFIG, type Candle, type EngineEvent } from "../src/lib/halo/types";
import { publishBotEvent, subscribeBotEvents, botEventsSince } from "../src/lib/halo/event-bus";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const S = 60_000;
let t = 1_700_000_000_000;
function bar(open: number, close: number, high: number, low: number): Candle {
  t += S;
  return { time: t, open, high, low, close };
}

// ── 1+2. ARMED with prices + BREAK once (confirmed path) ────────────────
console.log("── engine · armed + break (barclose flow) ──");
{
  const eng = new HaloEngine({ ...DEFAULT_CONFIG, sigMode: "barclose", rangeFilter: false }, 0.01);
  // warm ATR with a gentle drift (14 bars)
  for (let i = 0; i < 20; i++) eng.processBar(bar(100 + i * 0.1, 100.6 + i * 0.1, 101 + i * 0.1, 99.6 + i * 0.1), true);

  // C1 bullish + C2 bearish at the same level → RESISTANCE armed
  const c1 = bar(102, 103, 103.2, 101.8); // bull body 1.0
  const ev1 = eng.processBar(c1, true);
  const c2 = bar(103, 102, 103.2, 101.8); // bear body 1.0, open = C1 close
  const ev2 = eng.processBar(c2, true);

  const armed = ev2.find((e): e is Extract<EngineEvent, { type: "level" }> => e.type === "level");
  check("armed event emitted", !!armed);
  check("armed side = resistance (-1)", armed?.side === -1);
  check("armed carries top/bot/ext prices", !!armed && armed.top === 103 && armed.bot === 103 && armed.ext === 103.2, `top=${armed?.top} bot=${armed?.bot} ext=${armed?.ext}`);
  check("armed id positive", !!armed && armed.id > 0);

  // C3 breaks above the dotted wick line (ext 103.2 + breakATR*ATR) but does NOT return
  const brkNeed = 103.2 + 0.02 * (eng as unknown as { state: { atr: number } }).state.atr!;
  const c3 = bar(102.5, 102.6, brkNeed + 0.5, 102.3); // high far above the line, close below it (no return beyond tolerance? close is below line → "back" true for resistance!)

  // careful: for resistance, "back" means close <= ext + eqTol → close 102.6 IS back.
  // To test break-without-return, keep the close ABOVE ext + eqTol:
  const c3up = bar(103.3, 103.9, brkNeed + 0.5, 103.1);
  const ev3 = eng.processBar(c3up, true);
  const brks = ev3.filter((e) => e.type === "break");
  check("break event emitted on first break", brks.length === 1, `n=${brks.length}`);
  const brk = brks[0] as Extract<EngineEvent, { type: "break" }> | undefined;
  check("break names the dotted line (ext)", brk?.ext === 103.2, `ext=${brk?.ext}`);
  check("break carries the break extreme", !!brk && brk.price === brkNeed + 0.5, `price=${brk?.price}`);
  check("no fire (never returned)", !ev3.some((e) => e.type === "fire"));
  check("level burned after break-without-return on confirmed bar", ev3.some((e) => e.type === "burned"));

  // a SECOND confirmed bar cannot re-announce the same break (level already gone)
  const ev4 = eng.processBar(bar(103.5, 104, 104.4, 103.2), true);
  check("no duplicate break after burn", !ev4.some((e) => e.type === "break"));
}

// ── 2b. BREAK intrabar (instant-mode live trial on a clone) ─────────────
console.log("── engine · break intrabar (instant trial) ──");
{
  const eng = new HaloEngine({ ...DEFAULT_CONFIG, sigMode: "instant", rangeFilter: false }, 0.01);
  for (let i = 0; i < 20; i++) eng.processBar(bar(200 + i * 0.1, 200.6 + i * 0.1, 201 + i * 0.1, 199.6 + i * 0.1), true);
  eng.processBar(bar(202, 203, 203.2, 201.8), true); // C1 bull
  const evArm = eng.processBar(bar(203, 202, 203.2, 201.8), true); // C2 bear → armed
  check("resistance armed (instant setup)", evArm.some((e) => e.type === "level"));

  const atr = (eng as unknown as { state: { atr: number } }).state.atr!;
  const brkNeed = 203.2 + 0.02 * atr;
  // live tick: wick far above the line, close above it (no return yet) → break, no fire
  const live: Candle = { time: t + S, open: 203.3, high: brkNeed + 0.4, low: 203.1, close: 203.8 };
  const evLive = eng.processBar(live, false);
  check("intrabar break event (live trial semantics)", evLive.some((e) => e.type === "break"));
  check("no intrabar fire without return", !evLive.some((e) => e.type === "fire"));

  // next tick: same bar still beyond the line → break NOT repeated
  const live2: Candle = { ...live, high: brkNeed + 0.6, close: 203.9 };
  const evLive2 = eng.processBar(live2, false);
  check("break announced exactly once per level", !evLive2.some((e) => e.type === "break"));

  // return to the line → fires instantly, and the fire follows the break
  const live3: Candle = { ...live, high: brkNeed + 0.2, close: 203.25 };
  const evLive3 = eng.processBar(live3, false);
  check("fire on return to the dotted line", evLive3.some((e) => e.type === "fire"));
}

// ── 3. RANGE SKIP regression (the #28 change still intact) ──────────────
console.log("── engine · range skip regression ──");
{
  const eng = new HaloEngine({ ...DEFAULT_CONFIG, sigMode: "instant", rangeFilter: true, rangeSepATR: 5 }, 0.01);
  for (let i = 0; i < 20; i++) eng.processBar(bar(300 + i * 0.1, 300.6 + i * 0.1, 301 + i * 0.1, 299.6 + i * 0.1), true);
  eng.processBar(bar(302, 303, 303.2, 301.8), true); // C1 bull
  eng.processBar(bar(303, 302, 303.2, 301.8), true); // C2 bear → resistance armed
  eng.processBar(bar(302, 301, 302.2, 300.8), true); // C1' bear
  eng.processBar(bar(301, 302, 302.2, 300.8), true); // C2' bull → support armed (close to resistance)
  const atr = (eng as unknown as { state: { atr: number } }).state.atr!;
  const brkNeed = 303.2 + 0.02 * atr;
  const live: Candle = { time: t + S, open: 303.3, high: brkNeed + 0.4, low: 303.1, close: 303.25 };
  const ev = eng.processBar(live, false);
  check("range_skip emitted (S/R too close)", ev.some((e) => e.type === "range_skip"));
  check("no fire when range-skipped", !ev.some((e) => e.type === "fire"));
  const skip = ev.find((e) => e.type === "range_skip") as Extract<EngineEvent, { type: "range_skip" }>;
  check("skip message mentions ranging + too close", /RANGING/.test(skip.message) && /Too close for entry/.test(skip.message));
}

// ── 4. event bus ─────────────────────────────────────────────────────────
console.log("── event bus ──");
{
  const got: string[] = [];
  const un = subscribeBotEvents((e) => got.push(`${e.kind}:${e.seq}`));
  publishBotEvent({ kind: "armed", prio: "low", symbol: "XAUUSD", tf: "5m", time: Date.now(), title: "T1", spoken: "s1" });
  publishBotEvent({ kind: "break", prio: "high", symbol: "XAUUSD", tf: "5m", time: Date.now(), title: "T2", spoken: "s2" });
  check("subscriber received both", got.length === 2, got.join(","));
  const since = botEventsSince(1);
  check("eventsSince resumes after seq", since.length === 1 && since[0].kind === "break");
  un();
  publishBotEvent({ kind: "fire", prio: "high", symbol: "X", tf: "5m", time: Date.now(), title: "T3", spoken: "s3" });
  check("unsubscribe works", got.length === 2);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
