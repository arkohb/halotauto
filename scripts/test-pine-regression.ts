// ── PINE RUNTIME REGRESSION · protects the runtime fixes ────────────────────
// Covers: the 5 starter templates (they predate the library) plus explicit
// checks for the semantics touched by the runtime changes:
//   · plain-decl [n] history (persistent series boxes)
//   · `var` carry semantics (unchanged)
//   · loops with reassign + dynamic close[i] history
//   · SAR actually flips; HMA returns values
// Run: bun scripts/test-pine-regression.ts
import { PineRuntime, compilePine } from "@/lib/pine";
import type { Candle } from "@/lib/halo/types";

let failures = 0;
const fail = (name: string, msg: string) => {
  failures++;
  console.error(`  ✗ ${name}: ${msg}`);
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function synthCandles(): Candle[] {
  const r = rng(777);
  const out: Candle[] = [];
  let px = 100;
  let drift = 0;
  const tfMs = 5 * 60 * 1000;
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0) - 300 * tfMs;
  for (let i = 0; i < 300; i++) {
    if (i < 80) drift = 0;
    else if (i < 170) drift = 0.4;
    else if (i < 240) drift = -0.45;
    else drift = 0.03;
    const vol = 0.8 + r() * 0.6;
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

function run(name: string, source: string, opts: { minTrades?: number; bools?: string[] } = {}) {
  const res = compilePine(source);
  if (res.error || !res.meta.ok) {
    fail(name, `compile: ${res.error ? `${res.error.line}:${res.error.col} ${res.error.msg}` : res.meta.diagnostics.map((d) => d.msg).join("|")}`);
    return null;
  }
  try {
    const rt = new PineRuntime(source, { mintick: 0.01, ticker: "TEST", tf: "5m", pipMult: 10 });
    if (opts.bools) rt.captureBools(opts.bools);
    for (const c of candles) {
      rt.externalPos = rt.simPos ? { dir: rt.simPos.dir, entry: rt.simPos.entry } : { dir: 0, entry: 0 };
      rt.processBar(c);
    }
    const trades = rt.simTrades.length;
    if (opts.minTrades !== undefined && trades < opts.minTrades) {
      fail(name, `trades=${trades} < expected ${opts.minTrades}`);
    }
    return rt;
  } catch (e) {
    fail(name, `runtime: ${(e as Error).message}`);
    return null;
  }
}

console.log("▸ starter templates (pre-library surface)");
run("EMA Cross strategy", `//@version=5
strategy("My EMA Cross", overlay=true)
fastLen = input.int(9, "Fast EMA", minval=1)
slowLen = input.int(21, "Slow EMA", minval=2)
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
longCond  = ta.crossover(fast, slow)
shortCond = ta.crossunder(fast, slow)
if longCond
    strategy.entry("Long", strategy.long)
if shortCond
    strategy.entry("Short", strategy.short)
plot(fast, "Fast EMA", color=color.lime)
plot(slow, "Slow EMA", color=color.red)`, { minTrades: 1 });

run("RSI reversion with SL/TP", `//@version=5
strategy("RSI Reversion", overlay=false)
len = input.int(14, "RSI length")
os  = input.float(30, "Oversold")
ob  = input.float(70, "Overbought")
r = ta.rsi(close, len)
longCond  = ta.crossover(r, os)
shortCond = ta.crossunder(r, ob)
if longCond
    strategy.entry("L", strategy.long)
    strategy.exit("XL", from_entry="L", stop=close * 0.97, limit=close * 1.06)
if shortCond
    strategy.entry("S", strategy.short)
    strategy.exit("XS", from_entry="S", stop=close * 1.03, limit=close * 0.94)
plot(r, "RSI", color=color.purple)
hline(70, "OB", color=color.red)
hline(30, "OS", color=color.green)`, { minTrades: 1 });

run("MACD signal indicator", `//@version=5
indicator("MACD Signals")
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
longCond  = ta.crossover(macdLine, signalLine)
shortCond = ta.crossunder(macdLine, signalLine)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(hist, "Histogram", style=plot.style_histogram)
plotshape(longCond, "Bull", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "Bear", style=shape.triangledown, location=location.abovebar, color=color.red)`, { minTrades: 0 });

console.log("▸ semantics touched by the runtime fixes");

// plain-decl history — the box holding `prevClose` must equal close[1] on every bar
{
  const rt = run("decl[1] history", `//@version=5
strategy("hist", overlay=true)
prevClose = close[1]
delta = close - prevClose
if ta.crossover(delta, 0)
    strategy.entry("L", strategy.long)
if ta.crossunder(delta, 0)
    strategy.entry("S", strategy.short)`, { minTrades: 1, bools: ["delta"] });
  if (rt) {
    const last = candles.length - 1;
    // find the decl box whose series matches close shifted by exactly 1 bar
    let matched: string | null = null;
    let badVal: number | null | undefined;
    for (const [k, box] of rt.declBoxes) {
      const got = box.at(last);
      if (typeof got === "number" && Math.abs(got - candles[last - 1].close) < 1e-9) {
        matched = k;
        break;
      }
      badVal = typeof got === "number" ? got : null;
    }
    if (!matched) {
      fail("decl[1] history", `no decl box equals close[1] at last bar (saw ${badVal})`);
    } else {
      console.log(`  ✓ decl[1] returns the previous bar's real value (${matched})`);
    }
  }
}

// var carry + loop reassign + decl-based channel history (the Turtle pattern)
{
  const rt = run("var carry + loop hist", `//@version=5
strategy("loop", overlay=true)
var counter = 0.0
counter := counter + 1
runSum = 0.0
for i = 1 to 10
    runSum := runSum + close[i]
upChan = ta.highest(high, 20)
dnChan = ta.lowest(low, 20)
if ta.crossover(close, upChan[1])
    strategy.entry("L", strategy.long)
if ta.crossunder(close, dnChan[1])
    strategy.entry("S", strategy.short)
plot(counter, "cnt", color=color.red)
plot(runSum, "sum", color=color.blue)`, { minTrades: 1, bools: ["counter"] });
  if (rt) {
    const arr = rt.capturedBool.get("counter");
    const last = arr ? arr.length - 1 : -1;
    if (last !== candles.length - 1) fail("var carry + loop hist", `captured ${last + 1} bars, expected ${candles.length}`);
    else console.log(`  ✓ var captured on every bar (${last + 1})`);
  }
}

// SAR must flip in both directions over a trend/chop cycle
{
  const rt = run("SAR flips", `//@version=5
strategy("sar", overlay=true)
sarVal = ta.sar(0.02, 0.02, 0.2)
longCond  = ta.crossover(close, sarVal)
shortCond = ta.crossunder(close, sarVal)
if longCond
    strategy.entry("L", strategy.long)
if shortCond
    strategy.entry("S", strategy.short)`, { minTrades: 2, bools: ["longCond", "shortCond"] });
  if (rt) {
    const lf = (rt.capturedBool.get("longCond") ?? []).filter(Boolean).length;
    const sf = (rt.capturedBool.get("shortCond") ?? []).filter(Boolean).length;
    if (lf === 0 || sf === 0) fail("SAR flips", `longCond=${lf} shortCond=${sf} — SAR still stuck`);
    else console.log(`  ✓ SAR flips both ways (long ${lf}×, short ${sf}×)`);
  }
}

// HMA must produce values (was na-forever)
{
  const rt = run("HMA values", `//@version=5
indicator("hma")
h = ta.hma(close, 21)
plot(h, "HMA", color=color.green)`, { minTrades: 0 });
  if (rt) {
    const p = [...rt.plots.values()][0];
    const nonNull = p ? p.values.filter((v) => v !== null).length : 0;
    if (nonNull < 200) fail("HMA values", `only ${nonNull} non-null values`);
    else console.log(`  ✓ HMA produced ${nonNull} values`);
  }
}

if (failures > 0) {
  console.error(`\nFAILED — ${failures} problem(s)`);
  process.exit(1);
}
console.log("\nREGRESSION PASS");
