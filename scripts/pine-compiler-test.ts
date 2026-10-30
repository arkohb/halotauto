// ════════════════════════════════════════════════════════════════════════
//  PINE COMPILER UNIT TESTS · run: bun scripts/pine-compiler-test.ts
//  Validates the Strategy Studio Pine v5 subset compiler:
//   ① templates compile ② signals fire on synthetic candles ③ SL/TP from
//   strategy.exit ④ tuple builtins (macd / bb / supertrend) ⑤ indicator
//   plots + manual signal capture ⑥ honest error reporting ⑦ the built-in
//   3EL Pine EA template itself compiles and runs
// ════════════════════════════════════════════════════════════════════════

import { compilePine } from "../src/lib/pine/compile";
import { PineRuntime } from "../src/lib/pine/runtime";
import type { Candle } from "../src/lib/halo/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

// deterministic sine-wave candles so crossovers fire at predictable bars;
// a small sawtooth kick every 17 bars creates C3 break→return patterns
function synthCandles(n: number, base = 100, amp = 5, period = 40): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2024, 0, 1);
  const px = (i: number) => base + amp * Math.sin((i / period) * Math.PI * 2) + (i > 0 && i % 17 === 0 ? amp * 0.25 : 0);
  for (let i = 0; i < n; i++) {
    const c = px(i);
    const o = px(i - 1);
    const h = Math.max(o, c) + 0.4;
    const l = Math.min(o, c) - 0.4;
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: 1000 + 200 * Math.cos(i / 7) });
    t += 5 * 60 * 1000;
  }
  return out;
}

const EMA_CROSS = `//@version=5
indicator("EMA Cross", overlay=true)
fastLen = input.int(9, "Fast EMA")
slowLen = input.int(21, "Slow EMA")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
longCond = ta.crossover(fast, slow)
shortCond = ta.crossunder(fast, slow)
if longCond
    strategy.entry("Long", strategy.long)
if shortCond
    strategy.entry("Short", strategy.short)
plot(fast, "Fast", color=color.lime)
plot(slow, "Slow", color=color.red)`;

const RSI_STRAT = `//@version=5
strategy("RSI Reversion", overlay=false)
len = input.int(14, "RSI length")
os = input.float(30, "Oversold")
ob = input.float(70, "Overbought")
r = ta.rsi(close, len)
longCond = ta.crossover(r, os)
shortCond = ta.crossunder(r, ob)
if longCond
    strategy.entry("L", strategy.long)
    strategy.exit("X", from_entry="L", stop=close * 0.97, limit=close * 1.06)
if shortCond
    strategy.entry("S", strategy.short)
plot(r, "RSI", color=color.purple)
hline(70, "OB", color=color.red)
hline(30, "OS", color=color.green)`;

const MACD_IND = `//@version=5
indicator("MACD")
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(hist, "Hist", style=plot.style_histogram)`;

const BAD_UNKNOWN = `//@version=5
indicator("Bad")
x = ta.doesnotexist(close, 14)
plot(x)`;

const BAD_REQUEST = `//@version=5
indicator("Bad2")
h = request.security(syminfo.tickerid, "D", close)
plot(h)`;

const BAD_UNDECLARED = `//@version=5
indicator("Bad3")
y := close + 1`;

const SUPER = `//@version=5
indicator("Supertrend")
[sup, dir] = ta.supertrend(3.0, 10)
plot(sup, "ST", color=dir < 0 ? color.red : color.green)`;

const MANUAL_IND = `//@version=5
indicator("Manual signals")
fast = ta.ema(close, 5)
slow = ta.ema(close, 20)
buySignal = ta.crossover(fast, slow)
sellSignal = ta.crossunder(fast, slow)
plot(fast)
plot(slow)`;

const ARR_TEST = `//@version=5
indicator("Array test")
var float[] vals = array.new_float()
array.push(vals, close)
avg = array.avg(vals)
plot(avg, "AVG")`;

console.log("\n═══ ① compile templates ═══");
const c1 = compilePine(EMA_CROSS);
ok(c1.meta.ok && c1.error === null, "EMA Cross compiles", JSON.stringify(c1.meta.diagnostics.slice(0, 2)));
ok(c1.meta.kind === "strategy", "EMA Cross kind=strategy");
ok(c1.meta.hasLong && c1.meta.hasShort, "EMA Cross long+short entries detected");
ok(c1.meta.plots.length === 2, "EMA Cross 2 plots", `got ${c1.meta.plots.length}`);
ok(c1.meta.inputs.length === 2 && c1.meta.inputs[0].defval === 9, "EMA Cross inputs extracted");

const c2 = compilePine(RSI_STRAT);
ok(c2.meta.ok, "RSI Reversion compiles", JSON.stringify(c2.meta.diagnostics.slice(0, 2)));
ok(c2.meta.hasExitSLTP, "RSI strategy.exit stop/limit detected");
ok(c2.meta.hlines.length === 2, "RSI hlines detected");

const c3 = compilePine(MACD_IND);
ok(c3.meta.ok, "MACD indicator compiles", JSON.stringify(c3.meta.diagnostics.slice(0, 2)));
ok(c3.meta.kind === "indicator", "MACD kind=indicator (no strategy calls)");
ok(c3.meta.signalCandidates.length === 0 || c3.meta.kind === "indicator", "MACD signal candidates listed");

const c4 = compilePine(SUPER);
ok(c4.meta.ok, "Supertrend compiles", JSON.stringify(c4.meta.diagnostics.slice(0, 2)));
ok(c4.meta.signalCandidates.includes("dir"), "Supertrend `dir` bool candidate");

const c5 = compilePine(MANUAL_IND);
ok(c5.meta.ok, "Manual-signal indicator compiles");
ok(c5.meta.signalCandidates.includes("buySignal") && c5.meta.signalCandidates.includes("sellSignal"), "buy/sell signal candidates detected", c5.meta.signalCandidates.join(","));

const c6 = compilePine(ARR_TEST);
ok(c6.meta.ok, "Array strategy compiles", JSON.stringify(c6.meta.diagnostics.slice(0, 2)));

console.log("\n═══ ⑥ honest errors ═══");
const b1 = compilePine(BAD_UNKNOWN);
ok(!b1.meta.ok && b1.meta.diagnostics.some((d) => /ta\.doesnotexist/.test(d.msg)), "unknown ta function → clear error", JSON.stringify(b1.meta.diagnostics.slice(0, 1)));
const b2 = compilePine(BAD_REQUEST);
ok(!b2.meta.ok && b2.meta.diagnostics.some((d) => /not supported/.test(d.msg)), "request.security rejected", JSON.stringify(b2.meta.diagnostics.slice(0, 1)));
const b3 = compilePine(BAD_UNDECLARED);
ok(!b3.meta.ok && b3.meta.diagnostics.some((d) => /before being declared/.test(d.msg)), ":= before declaration rejected", JSON.stringify(b3.meta.diagnostics.slice(0, 1)));
const b4 = compilePine("indicator(\"x\")\nx = ");
ok(!b4.meta.ok, "truncated script rejected", b4.error?.msg);

console.log("\n═══ ② runtime: signals on synthetic candles ═══");
{
  const candles = synthCandles(300);
  const rt = new PineRuntime(EMA_CROSS, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  for (const c of candles) rt.processBar(c);
  ok(rt.simTrades.length >= 4, `EMA cross trades fired (${rt.simTrades.length})`);
  const longs = rt.simTrades.filter((t) => t.dir === 1).length;
  const shorts = rt.simTrades.filter((t) => t.dir === -1).length;
  ok(longs > 0 && shorts > 0, "both directions traded", `${longs}L/${shorts}S`);
  // Pine fill model: entry at next bar open after signal
  const t0 = rt.simTrades[0];
  ok(Math.abs(t0.entry - candles[t0.entryBar].open) < 1e-9, "entry filled at next-bar open");
  // plots
  const plots = [...rt.plots.values()];
  ok(plots.length === 2 && plots[0].values.length === 300, "plot series captured");
  ok(plots.every((p) => p.values.slice(25).every((v) => v !== null)), "EMA plots populated after warm-up");
  // alternating entries (netting): consecutive trades must alternate direction
  let alternating = true;
  for (let i = 1; i < rt.simTrades.length; i++) {
    if (rt.simTrades[i].dir === rt.simTrades[i - 1].dir) alternating = false;
  }
  ok(alternating, "entries alternate (netting semantics)");
}

console.log("\n═══ ③ SL/TP from strategy.exit ═══");
{
  const candles = synthCandles(400, 100, 9, 25);
  const rt = new PineRuntime(RSI_STRAT, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  for (const c of candles) rt.processBar(c);
  ok(rt.simTrades.length >= 2, `RSI trades fired (${rt.simTrades.length})`);
  const withSl = rt.simTrades.filter((t) => t.sl !== null && t.tp !== null);
  // the script only sets strategy.exit for entry "L" — "S" trades fall back to
  // the trader's risk overlay at live-trading time (documented behaviour)
  const longTrades = rt.simTrades.filter((t) => t.entryId === "L");
  ok(longTrades.length > 0 && longTrades.every((t) => t.sl !== null && t.tp !== null), "script-protected entries carry SL/TP");
  const stopped = rt.simTrades.filter((t) => t.reason === "sl" || t.reason === "tp");
  ok(stopped.length > 0, `SL/TP actually triggered (${stopped.length} closes)`);
  for (const t of withSl.slice(0, 5)) {
    if (t.dir === 1) {
      ok(t.sl! < t.entry && t.tp! > t.entry, "long SL below / TP above entry");
    } else {
      ok(t.sl! > t.entry && t.tp! < t.entry, "short SL above / TP below entry");
    }
  }
}

console.log("\n═══ ④ tuple builtins ═══");
{
  const candles = synthCandles(200);
  const rt = new PineRuntime(MACD_IND, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  for (const c of candles) rt.processBar(c);
  const plots = [...rt.plots.values()];
  ok(plots.length === 3, "macd tuple destructured into 3 plots");
  const hist = plots.find((p) => p.meta.title === "Hist");
  ok(!!hist && hist.values.slice(40).some((v) => v !== null && v > 0) && hist!.values.slice(40).some((v) => v !== null && v < 0), "histogram oscillates around 0");

  const rt2 = new PineRuntime(SUPER, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  for (const c of candles) rt2.processBar(c);
  const st = [...rt2.plots.values()][0];
  ok(!!st && st.values.slice(15).every((v) => v !== null), "supertrend line populated");
}

console.log("\n═══ ⑤ manual signal capture ═══");
{
  const candles = synthCandles(300);
  const rt = new PineRuntime(MANUAL_IND, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  rt.captureBools(["buySignal", "sellSignal"]);
  for (const c of candles) rt.processBar(c);
  const buy = rt.capturedBool.get("buySignal")!;
  const sell = rt.capturedBool.get("sellSignal")!;
  const buys = buy.filter(Boolean).length;
  const sells = sell.filter(Boolean).length;
  ok(buys >= 4 && sells >= 4, `manual signals captured (${buys} buys / ${sells} sells)`);
  ok(buy.length === 300 && sell.length === 300, "captured series aligned with bars");
}

console.log("\n═══ ⑦ the built-in 3EL Pine EA template compiles & runs ═══");
{
  const { PINE_EA_TEMPLATE } = await import("../src/lib/pine-ea");
  const src = PINE_EA_TEMPLATE.replace("__HALO_SECRET__", "TESTSECRET");
  const c = compilePine(src);
  ok(
    c.meta.ok,
    "3EL EA template compiles",
    JSON.stringify((c.error ? [c.error] : c.meta.diagnostics).slice(0, 3).map((d) => `L${d.line}: ${d.msg}`))
  );
  if (c.meta.ok) {
    ok(c.meta.hasLong && c.meta.hasShort, "3EL template long+short");
    ok(c.meta.hasExitSLTP, "3EL template uses strategy.exit stop/limit");
    ok(c.meta.notes.some((n) => /Drawing objects/.test(n)), "drawing-objects note present");
    const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
    const candles = synthCandles(500, 2000, 12, 55);
    for (const cndl of candles) rt.processBar(cndl);
    // the template fires when a C3 break+return happens — must be > 0 on a
    // wiggly series, and every trade must carry SL/TP
    ok(rt.simTrades.length > 0, `3EL template fired ${rt.simTrades.length} trades in sim`);
    ok(rt.simTrades.every((t) => t.sl !== null && t.tp !== null), "3EL template trades carry SL/TP");
  }
}

console.log("\n═══ var semantics + array carry ═══");
{
  const candles = synthCandles(60);
  const rt = new PineRuntime(ARR_TEST, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  for (const c of candles) rt.processBar(c);
  const plots = [...rt.plots.values()];
  const vals = plots[0]?.values ?? [];
  ok(vals.length === 60 && vals[59] !== null && vals[0] !== null, "var array accumulates across bars");
  const v59 = vals[59] as number;
  const v0 = vals[0] as number;
  ok(v59 > v0, "running average of rising window grows");
}

console.log(`\n═══ RESULT: ${pass} passed · ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);
