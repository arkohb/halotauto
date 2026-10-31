// Live smoke test: Deriv pairs end-to-end (feed + deep history + quotes).
import { getKlines } from "../src/lib/market";
import { getDeepHistory } from "../src/lib/market-history";
import { resolveQuoteTarget } from "../src/lib/halo/actions";
import { resolveSymbol as resolveTv } from "../src/lib/tv-webhook";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} ${extra}`);
  }
}

// 1. live candles — synthetic (simulator, anchored near real Deriv price)
const v75 = await getKlines("V75", "5m", 50, { deep: true });
check("V75 candles >= 50", v75.candles.length >= 50, `${v75.candles.length}`);
check("V75 source simulator", v75.source === "simulator", v75.source);
const lastV75 = v75.candles[v75.candles.length - 1].close;
check("V75 price near anchor (30k-50k)", lastV75 > 30000 && lastV75 < 50000, `${lastV75}`);

// 2. BOOM1000 spike structure: over 100 M5 bars there must be visible spikes
const boom = await getKlines("BOOM1000", "5m", 120, { deep: true });
check("BOOM1000 candles", boom.candles.length >= 100, `${boom.candles.length}`);
const ranges = boom.candles.map((c) => (c.high - c.low) / c.close);
const maxRange = Math.max(...ranges);
const medRange = [...ranges].sort((a, b) => a - b)[Math.floor(ranges.length / 2)];
check("BOOM1000 spike >> normal bar", maxRange > medRange * 4, `max=${maxRange.toFixed(4)} med=${medRange.toFixed(4)}`);

// 3. CRASH500 downward spikes
const crash = await getKlines("CRASH500", "5m", 120, { deep: true });
const crashMin = Math.min(...crash.candles.map((c) => c.low));
const crashLast = crash.candles[crash.candles.length - 1].close;
check("CRASH500 candles", crash.candles.length >= 100);
check("CRASH500 near anchor (2k-4k)", crashLast > 2000 && crashLast < 4000, `${crashLast}`);
check("CRASH500 has drawdown spikes", (crashLast - crashMin) / crashLast > 0.02, `min=${crashMin}`);

// 4. STEP lattice: all closes divisible by 0.1 (within fp epsilon)
const step = await getKlines("STEP", "5m", 30, { deep: true });
check("STEP closes on 0.1 lattice", step.candles.every((c) => Math.abs(Math.round(c.close / 0.1) * 0.1 - c.close) < 1e-6));

// 5. US30 — real Yahoo data
try {
  const us30 = await getKlines("US30", "15m", 5, { deep: true });
  check("US30 yahoo source", us30.source === "yahoo", us30.source);
  check("US30 plausible price", us30.candles[us30.candles.length - 1].close > 20000, `${us30.candles[us30.candles.length - 1]?.close}`);
} catch (e) {
  console.error("US30 note:", (e as Error).message);
}

// 6. USDZAR — real Yahoo FX
try {
  const zar = await getKlines("USDZAR", "15m", 5, { deep: true });
  check("USDZAR plausible", zar.candles[zar.candles.length - 1].close > 5 && zar.candles[zar.candles.length - 1].close < 40, `${zar.candles[zar.candles.length - 1]?.close}`);
} catch (e) {
  console.error("USDZAR note:", (e as Error).message);
}

// 7. deep history — synthetic backtest path (2000 bars deterministic)
const deep = await getDeepHistory({ symbol: "V75", tf: "5m", bars: 2000 });
check("deep V75 source simulator", deep.source === "simulator", deep.source);
check("deep V75 2000 bars", deep.candles.length >= 1990, `${deep.candles.length}`);
check("deep V75 grid-aligned", deep.candles.every((c) => c.time % 300000 === 0));
check("deep V75 meta from catalog", deep.meta.id === "V75" && deep.meta.mintick === 0.01);

// 8. deep history — 1d synthetic (aggregate grid)
const deepD = await getDeepHistory({ symbol: "BOOM500", tf: "1d", bars: 300 });
check("deep BOOM500 1d bars", deepD.candles.length >= 290, `${deepD.candles.length}`);

// 9. quote targets — voice "what's the price of boom 1000"
const q1 = resolveQuoteTarget("boom 1000");
check("quote target boom1000", q1?.id === "BOOM1000", JSON.stringify(q1));
const q2 = resolveQuoteTarget("volatility 75");
check("quote target v75", q2?.id === "V75", JSON.stringify(q2));
const q3 = resolveQuoteTarget("us30");
check("quote target us30 → real DJI intel quote", q3?.id === "DJI", JSON.stringify(q3));
const q4 = resolveQuoteTarget("us500");
check("quote target us500 → real SPX intel quote", q4?.id === "SPX", JSON.stringify(q4));

// 10. TV webhook alert symbol resolution
check("tv alert DERIV:VOLATILITY_75_INDEX", resolveTv("DERIV:VOLATILITY_75_INDEX") === "V75");
check("tv alert DERIV:BOOM_1000_INDEX", resolveTv("DERIV:BOOM_1000_INDEX") === "BOOM1000");
check("tv alert OANDA:XAUUSD unchanged", resolveTv("OANDA:XAUUSD") === "XAUUSD");
check("tv alert EURUSD unchanged", resolveTv("EURUSD") === "EURUSD");
check("tv alert V75 plain", resolveTv("V75") === "V75");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
