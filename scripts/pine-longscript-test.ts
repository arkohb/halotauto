// ════════════════════════════════════════════════════════════════════════
//  PINE LONG-SCRIPT LOAD TESTS · run: bun scripts/pine-longscript-test.ts
//  Proves the Strategy Studio compiler honestly handles very large scripts:
//   ① a generated ~2,500-line strategy compiles AND trades on synthetic bars
//   ② per-bar latency stays live-trading safe (pine-bot evaluates each new
//      bar on the 2.5s tick — one bar must take milliseconds, not seconds)
//   ③ a 10,000-term or-chain parses/compiles/evaluates (iterative walkers)
//   ④ pathological nesting fails with a FRIENDLY error, not a stack crash
//   ⑤ oversized scripts get the honest limit message (chars + lines)
//   ⑥ an unbounded loop bomb is refused, never hangs
// ════════════════════════════════════════════════════════════════════════

import { compilePine } from "../src/lib/pine/compile";
import { PineRuntime } from "../src/lib/pine/runtime";
import { MAX_PINE_CHARS, MAX_PINE_LINES } from "../src/lib/pine/limits";
import { genLongScript } from "./pine-long-script-gen";
import type { Candle } from "../src/lib/halo/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

function synthCandles(n: number, base = 2400, amp = 12, period = 53): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2024, 0, 1);
  const px = (i: number) => base + amp * Math.sin((i / period) * Math.PI * 2) + (i % 23 === 0 ? amp * 0.3 : 0);
  for (let i = 0; i < n; i++) {
    const c = px(i);
    const o = px(i - 1);
    out.push({
      time: t,
      open: o,
      high: Math.max(o, c) + 0.9,
      low: Math.min(o, c) - 0.9,
      close: c,
      volume: 1200 + 250 * Math.cos(i / 9),
    });
    t += 5 * 60 * 1000;
  }
  return out;
}

console.log("═ PINE LONG-SCRIPT LOAD TESTS ═");

// ── ① ~2,500-line strategy compiles and trades ───────────────────────────
{
  const src = genLongScript(2500);
  const lines = src.split("\n").length;
  console.log(`\n① generated strategy: ${lines} lines, ${src.length.toLocaleString()} chars`);
  ok(lines >= 2450 && lines <= 2600, "generated script is ~2,500 lines", `${lines}`);
  const t0 = Date.now();
  const res = compilePine(src);
  const compileMs = Date.now() - t0;
  ok(res.error === null && res.meta.ok, "compiles cleanly", `${compileMs}ms`);
  ok(res.meta.kind === "strategy", "detected as auto-trading strategy");
  ok(res.meta.hasLong && res.meta.hasShort, "long + short entries detected");
  ok(res.meta.entryIds.includes("Long") && res.meta.entryIds.includes("Short"), "entry ids captured");
  ok(res.meta.hasExitSLTP, "strategy.exit SL/TP detected");
  ok(res.meta.inputs.length >= 140, "inputs extracted", `${res.meta.inputs.length}`);
  ok(res.meta.plots.length >= 3, "plots extracted", `${res.meta.plots.length}`);
  ok(res.meta.shapes.length === 2, "plotshapes extracted", `${res.meta.shapes.length}`);

  const t1 = Date.now();
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  const parseMs = Date.now() - t1;
  const candles = synthCandles(600);
  const t2 = Date.now();
  for (const c of candles) rt.processBar(c);
  const runMs = Date.now() - t2;
  ok(rt.simTrades.length > 0, "600-bar run produced simulated trades", `${rt.simTrades.length}`);
  ok(rt.plots.size >= 100 && [...rt.plots.values()].every((v) => v.values.length === 600), "every plot series filled for all 600 bars", `series=${rt.plots.size}`);
  ok(runMs < 15_000, "600-bar run time sane (<15s)", `${(runMs / 1000).toFixed(2)}s`);

  // ── ② per-bar latency (live tick path) ──
  let barMs = 0;
  const N = 120;
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    rt.processBar(synthCandles(1, 2400, 12, 53)[0]);
    barMs += Date.now() - t;
  }
  const avg = barMs / N;
  ok(avg < 60, "avg per-bar latency live-safe (<60ms)", `${avg.toFixed(2)}ms`);
  console.log(`\n   timings: parse ${parseMs}ms · compile ${compileMs}ms · 600-bar run ${(runMs / 1000).toFixed(2)}s · per-bar ${avg.toFixed(2)}ms`);
}

// ── ③ 10,000-term or-chain (iterative parse + compile + eval) ────────────
{
  const terms: string[] = [];
  for (let i = 0; i < 10_000; i++) terms.push(`ta.crossover(close, close[${(i % 50) + 1}])`);
  const src = `//@version=5\nindicator("Mega chain")\nmega = ${terms.join(" or ")}\nplot(mega ? 1 : 0)`;
  const res = compilePine(src);
  ok(res.error === null && res.meta.ok, "10,000-term or-chain compiles (no stack overflow)");
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "T", tf: "5m", pipMult: 10 });
  const candles = synthCandles(40);
  let threw = false;
  try {
    for (const c of candles) rt.processBar(c);
  } catch {
    threw = true;
  }
  ok(!threw, "10,000-term chain evaluates 40 bars (iterative runtime)");
}

// ── ④ pathological nesting → friendly error ──────────────────────────────
{
  const deep = "(".repeat(600) + "close" + ")".repeat(600);
  const src = `//@version=5\nindicator("Deep")\nv = ${deep}\nplot(v)`;
  const res = compilePine(src);
  ok(res.error !== null && res.error.msg.includes("nested more than 400 levels") && res.error.line > 0, "over-deep nesting fails with the friendly depth error", res.error?.msg.slice(0, 90) ?? "no error");
}

// ── ⑤ oversized scripts get the honest limit message ─────────────────────
{
  const filler = "// pad\n";
  const huge = "//@version=5\nindicator(\"Big\")\n" + "x = close + 1\n".repeat(MAX_PINE_LINES); // > 8,000 lines
  const res = compilePine(huge);
  ok(res.error !== null && res.error.msg.includes(`${MAX_PINE_LINES.toLocaleString()} lines`), "over-line script rejected with the limit message", res.error?.msg.slice(0, 90) ?? "no error");
  const wide = "//@version=5\nindicator(\"Wide\")\n" + `// ${"x".repeat(MAX_PINE_CHARS)}\n`;
  const res2 = compilePine(wide);
  ok(res2.error !== null && res2.error.msg.includes(`${MAX_PINE_CHARS.toLocaleString()} chars`), "over-char script rejected with the limit message", res2.error?.msg.slice(0, 90) ?? "no error");
  void filler;
}

// ── ⑥ loop bomb is refused, never hangs ──────────────────────────────────
{
  const src = `//@version=5
indicator("Bomb")
s = 0.0
for i = 0 to 1000000
    for j = 0 to 1000000
        s := s + 1
plot(s)`;
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "T", tf: "5m", pipMult: 10 });
  const t0 = Date.now();
  let msg = "";
  try {
    rt.processBar(synthCandles(1)[0]);
  } catch (e) {
    msg = (e as Error).message;
  }
  const ms = Date.now() - t0;
  ok(msg.includes("refusing to hang") || msg.includes("budget"), "loop bomb refused with a clear error", msg.slice(0, 90));
  ok(ms < 12_000, "loop bomb refusal is fast", `${ms}ms`);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
