// Price guard (Decision B) self-test — pure logic, no network, no DB.
//   npx tsx scripts/price-guard-selftest.ts
import { evaluateDeviation, evaluateFeed } from "@/lib/price-guard";
import type { Candle } from "@/lib/halo/types";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};

const now = Date.UTC(2026, 10, 2, 12, 0, 0);
const tfMs = 60_000;
const bars = (n: number, lastTime: number, px = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: lastTime - (n - 1 - i) * tfMs, open: px, high: px + 0.5, low: px - 0.5, close: px }));
const fresh = bars(30, now - 20_000);

// ── feed checks ──
const r = (x: ReturnType<typeof evaluateFeed>): string => (x.ok ? "ok" : x.reason);
ok(evaluateFeed({ source: "binance", candles: fresh, tfMs, now }).ok, "fresh real feed → allowed");
ok(r(evaluateFeed({ source: "simulator", candles: fresh, tfMs, now })).startsWith("simulated"), "simulated prices → refused");
ok(r(evaluateFeed({ source: "binance", stale: true, candles: fresh, tfMs, now })).startsWith("stale"), "refresh failed (cached candles) → refused");
ok(r(evaluateFeed({ source: "yahoo", candles: bars(30, now - 3 * 3_600_000), tfMs, now })).startsWith("stale"), "newest candle 3 h old (market closed) → refused");
ok(evaluateFeed({ source: "binance", candles: bars(30, now - tfMs - 60_000), tfMs, now }).ok, "just-closed bar within grace → allowed");
ok(r(evaluateFeed({ source: "binance", candles: [], tfMs, now })) === "no price data", "missing quote (no candles) → refused");
const nan = fresh.slice(); nan[nan.length - 1] = { ...nan[nan.length - 1], close: NaN };
ok(r(evaluateFeed({ source: "binance", candles: nan, tfMs, now })) === "invalid price data", "NaN price → refused");
const zero = fresh.slice(); zero[zero.length - 1] = { ...zero[zero.length - 1], close: 0 };
ok(r(evaluateFeed({ source: "binance", candles: zero, tfMs, now })) === "invalid price data", "zero price → refused");
const neg = fresh.slice(); neg[neg.length - 1] = { ...neg[neg.length - 1], close: -5 };
ok(r(evaluateFeed({ source: "binance", candles: neg, tfMs, now })) === "invalid price data", "negative price → refused");
const inv = fresh.slice(); inv[inv.length - 1] = { ...inv[inv.length - 1], high: 90, low: 110 };
ok(r(evaluateFeed({ source: "binance", candles: inv, tfMs, now })) === "invalid price data", "high < low → refused");
ok(r(evaluateFeed({ source: "binance", candles: bars(30, now + 10 * 60_000), tfMs, now })).includes("future"), "candle time in the future → refused");
const feedAtr = evaluateFeed({ source: "binance", candles: fresh, tfMs, now });
ok(feedAtr.ok && feedAtr.atr !== null && Math.abs(feedAtr.atr - 1) < 1e-9, "ATR computed from the feed (=1.0 for these bars)");

// ── live-quote deviation ──
const d = (x: ReturnType<typeof evaluateDeviation>): string => (x.ok ? "ok" : x.reason);
const base = { entry: 100, atr: 1, now };
ok(d(evaluateDeviation({ ...base, dir: 1, quote: { bid: 99.9, ask: 100.1, time: now }, maxDeviationAtr: null })).includes("not configured"), "threshold not set → live order refused");
ok(evaluateDeviation({ ...base, dir: 1, quote: { bid: 99.9, ask: 100.1, time: now }, maxDeviationAtr: 0.3 }).ok, "BUY: ask 0.10 ATR away, limit 0.30 → allowed");
ok(d(evaluateDeviation({ ...base, dir: 1, quote: { bid: 100.4, ask: 100.5, time: now }, maxDeviationAtr: 0.3 })).includes("0.50 ATR"), "price moved: ask 0.50 ATR away → refused");
ok(d(evaluateDeviation({ ...base, dir: -1, quote: { bid: 99.5, ask: 100.0, time: now }, maxDeviationAtr: 0.3 })).includes("99.5"), "SELL checks the bid (bid 0.50 ATR away → refused)");
ok(evaluateDeviation({ ...base, dir: -1, quote: { bid: 99.8, ask: 101, time: now }, maxDeviationAtr: 0.3 }).ok, "SELL: bid 0.20 ATR away → allowed (ask ignored)");
ok(d(evaluateDeviation({ ...base, dir: 1, quote: null, maxDeviationAtr: 0.3 })).startsWith("no quote"), "broker quote unavailable → refused");
ok(d(evaluateDeviation({ ...base, dir: 1, quote: { bid: 99.9 }, maxDeviationAtr: 0.3 })).startsWith("invalid quote"), "quote missing the needed side → refused");
ok(d(evaluateDeviation({ ...base, dir: 1, quote: { ask: 0, time: now }, maxDeviationAtr: 0.3 })).startsWith("invalid quote"), "zero quote → refused");
ok(d(evaluateDeviation({ ...base, dir: 1, quote: { ask: 100, time: now - 60_000 }, maxDeviationAtr: 0.3 })).includes("stale"), "broker quote 60 s old → refused");
ok(d(evaluateDeviation({ entry: 100, atr: null, now, dir: 1, quote: { ask: 100, time: now }, maxDeviationAtr: 0.3 })).includes("ATR"), "no ATR → refused (cannot size the limit)");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
