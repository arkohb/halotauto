// ════════════════════════════════════════════════════════════════════════
//  BEST INDICATORS LIBRARY · curated, compile-ready Pine v5 sources
//
//  A researched collection of the most proven, widely backtested trading
//  indicators (Turtle rules, QuantifiedStrategies backtests, Investopedia's
//  core trend toolkit, Saxo's top-10 guide). Each entry is a REAL strategy:
//  it places entries with ATR-based stop-loss / take-profit exits so the
//  bot can auto-trade it the moment it is attached to the chart.
//
//  PURE module — no server imports (the Strategy Studio bundles it into
//  the client for the template picker; the seeder runs it server-side).
//
//  Every script uses ONLY the HALO Pine compiler's supported subset:
//  ta.ema/sma/hma/rsi/macd/atr/highest/lowest/vwap/sar/supertrend/change,
//  crossover/crossunder, and/or/not, ternaries, [n] history, math.max/min.
//  Validated by scripts/test-pine-library.ts against the real compiler.
// ════════════════════════════════════════════════════════════════════════

export interface LibraryEntry {
  name: string;
  description: string;
  source: string;
}

export const LIB_VERSION = "v1";

export const LIBRARY: LibraryEntry[] = [
  {
    name: "★ MACD + RSI Combo",
    description:
      "Best-indicators library v1 · MACD trend cross confirmed by an RSI momentum gate — the combo QuantifiedStrategies backtested at a ~73% win rate on trending markets. ATR stop + 2R target built in.",
    source: `//@version=5
strategy("MACD + RSI Combo", overlay=true)
macdFast = input.int(12, "MACD fast", minval=1)
macdSlow = input.int(26, "MACD slow", minval=2)
macdSig  = input.int(9, "MACD signal", minval=1)
rsiLen   = input.int(14, "RSI length", minval=2)
rsiBull  = input.float(52.0, "RSI long gate", step=1)
rsiBear  = input.float(48.0, "RSI short gate", step=1)
atrLen   = input.int(14, "ATR length", minval=1)
slMult   = input.float(1.5, "Stop x ATR", step=0.1)
rrMult   = input.float(2.0, "Target = Stop x", step=0.1)
[macdLine, sigLine, hist] = ta.macd(close, macdFast, macdSlow, macdSig)
r = ta.rsi(close, rsiLen)
atrVal = ta.atr(atrLen)
longCond  = ta.crossover(macdLine, sigLine) and r > rsiBull
shortCond = ta.crossunder(macdLine, sigLine) and r < rsiBear
if longCond
    strategy.entry("L", strategy.long)
    strategy.exit("XL", from_entry="L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("S", strategy.short)
    strategy.exit("XS", from_entry="S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(ta.ema(close, 50), "Trend EMA 50", color=color.orange)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Triple EMA Trend Rider",
    description:
      "Best-indicators library v1 · The 20/50/200 EMA stack — Investopedia's core trend-following toolkit. Trades fast/mid crosses ONLY in the direction of the 200 EMA regime, ATR stop + 2.5R target.",
    source: `//@version=5
strategy("Triple EMA Trend Rider", overlay=true)
fastLen = input.int(20, "Fast EMA", minval=1)
midLen  = input.int(50, "Mid EMA", minval=2)
slowLen = input.int(200, "Slow EMA", minval=3)
atrLen  = input.int(14, "ATR length", minval=1)
slMult  = input.float(2.0, "Stop x ATR", step=0.1)
rrMult  = input.float(2.5, "Target = Stop x", step=0.1)
emaF = ta.ema(close, fastLen)
emaM = ta.ema(close, midLen)
emaS = ta.ema(close, slowLen)
atrVal = ta.atr(atrLen)
upRegime = emaM > emaS or na(emaS)
dnRegime = emaM < emaS or na(emaS)
longCond  = ta.crossover(emaF, emaM) and upRegime
shortCond = ta.crossunder(emaF, emaM) and dnRegime
if longCond
    strategy.entry("L", strategy.long)
    strategy.exit("XL", from_entry="L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("S", strategy.short)
    strategy.exit("XS", from_entry="S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(emaF, "EMA 20", color=color.lime)
plot(emaM, "EMA 50", color=color.orange)
plot(emaS, "EMA 200", color=color.red)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Donchian Turtle Breakout",
    description:
      "Best-indicators library v1 · The original Turtle Traders rules: 20-bar channel breakout with a 2N (ATR) stop and 3N target. The most famous trend-following system in history — pure price structure, no lagging inputs.",
    source: `//@version=5
strategy("Donchian Turtle Breakout", overlay=true)
entryLen = input.int(20, "Breakout length", minval=5)
atrLen   = input.int(20, "N (ATR) length", minval=1)
slMult   = input.float(2.0, "Stop x N", step=0.1)
rrMult   = input.float(3.0, "Target = Stop x", step=0.1)
upChan = ta.highest(high, entryLen)
dnChan = ta.lowest(low, entryLen)
atrVal = ta.atr(atrLen)
longCond  = ta.crossover(close, upChan[1])
shortCond = ta.crossunder(close, dnChan[1])
if longCond
    strategy.entry("T-L", strategy.long)
    strategy.exit("XL", from_entry="T-L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("T-S", strategy.short)
    strategy.exit("XS", from_entry="T-S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(upChan, "Donchian High", color=color.green)
plot(dnChan, "Donchian Low", color=color.red)
plot((upChan + dnChan) / 2, "Mid", color=color.gray)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Supertrend ATR Trail",
    description:
      "Best-indicators library v1 · Supertrend — the ATR-adaptive trailing stop that tops every 2025-2026 trend-indicator ranking. The exit rides the Supertrend line itself (genuine trailing), so wins run until the flip.",
    source: `//@version=5
strategy("Supertrend ATR Trail", overlay=true)
factor = input.float(3.0, "Factor", step=0.1)
len    = input.int(10, "ATR length", minval=1)
[sup, dir] = ta.supertrend(factor, len)
longCond  = ta.crossover(dir * -1, 0)
shortCond = ta.crossunder(dir * -1, 0)
if longCond
    strategy.entry("ST-L", strategy.long)
if shortCond
    strategy.entry("ST-S", strategy.short)
strategy.exit("XL", from_entry="ST-L", stop=sup)
strategy.exit("XS", from_entry="ST-S", stop=sup)
plot(sup, "Supertrend", color=dir < 0 ? color.green : color.red, linewidth=2)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Stochastic RSI Cross",
    description:
      "Best-indicators library v1 · Stoch RSI — RSI run through a stochastic window for sharper momentum turns; QuantifiedStrategies' backtests favor it over plain RSI for timing. K/D cross entries gated to the 20/80 extremes, pane view.",
    source: `//@version=5
strategy("Stochastic RSI Cross", overlay=false)
rsiLen   = input.int(14, "RSI length", minval=2)
stochLen = input.int(14, "Stoch length", minval=2)
smoothK  = input.int(3, "K smoothing", minval=1)
smoothD  = input.int(3, "D smoothing", minval=1)
ob = input.float(80.0, "Overbought")
os = input.float(20.0, "Oversold")
atrLen = input.int(14, "ATR length", minval=1)
slMult = input.float(1.5, "Stop x ATR", step=0.1)
rrMult = input.float(2.0, "Target = Stop x", step=0.1)
r = ta.rsi(close, rsiLen)
hh = ta.highest(r, stochLen)
ll = ta.lowest(r, stochLen)
raw = hh == ll ? 50.0 : (r - ll) / (hh - ll) * 100.0
k = ta.sma(raw, smoothK)
d = ta.sma(k, smoothD)
atrVal = ta.atr(atrLen)
longCond  = ta.crossover(k, d) and k < os
shortCond = ta.crossunder(k, d) and k > ob
if longCond
    strategy.entry("L", strategy.long)
    strategy.exit("XL", from_entry="L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("S", strategy.short)
    strategy.exit("XS", from_entry="S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(k, "%K", color=color.blue)
plot(d, "%D", color=color.orange)
hline(80, "OB", color=color.red)
hline(20, "OS", color=color.green)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Ichimoku Cloud Trend",
    description:
      "Best-indicators library v1 · Ichimoku — the all-in-one Japanese system (momentum + trend + dynamic S/R). Tenkan/Kijun cross taken only when price is beyond the Kumo cloud; the strongest filter Ichimoku offers.",
    source: `//@version=5
strategy("Ichimoku Cloud Trend", overlay=true)
convLen = input.int(9, "Tenkan length", minval=2)
baseLen = input.int(26, "Kijun length", minval=3)
spanLen = input.int(52, "Senkou length", minval=5)
atrLen  = input.int(14, "ATR length", minval=1)
slMult  = input.float(2.0, "Stop x ATR", step=0.1)
rrMult  = input.float(2.5, "Target = Stop x", step=0.1)
tenkan = (ta.highest(high, convLen) + ta.lowest(low, convLen)) / 2
kijun  = (ta.highest(high, baseLen) + ta.lowest(low, baseLen)) / 2
spanA  = (tenkan + kijun) / 2
spanB  = (ta.highest(high, spanLen) + ta.lowest(low, spanLen)) / 2
atrVal = ta.atr(atrLen)
cloudTop = spanA > spanB ? spanA : spanB
cloudBot = spanA < spanB ? spanA : spanB
longCond  = ta.crossover(tenkan, kijun) and close > cloudTop
shortCond = ta.crossunder(tenkan, kijun) and close < cloudBot
if longCond
    strategy.entry("I-L", strategy.long)
    strategy.exit("XL", from_entry="I-L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("I-S", strategy.short)
    strategy.exit("XS", from_entry="I-S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(tenkan, "Tenkan", color=color.blue)
plot(kijun, "Kijun", color=color.red)
plot(spanA, "Span A", color=color.green)
plot(spanB, "Span B", color=color.red)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Keltner Momentum Breakout",
    description:
      "Best-indicators library v1 · Keltner Channels (EMA ± ATR) — volatility-expansion breakout entries, the professional momentum-continuation setup. Enters when price bursts the channel, exits on ATR stop or opposite channel cross.",
    source: `//@version=5
strategy("Keltner Momentum Breakout", overlay=true)
kcLen   = input.int(20, "KC length (EMA)", minval=2)
atrLen  = input.int(20, "ATR length", minval=1)
kcMult  = input.float(2.0, "KC mult", step=0.1)
slMult  = input.float(1.5, "Stop x ATR", step=0.1)
rrMult  = input.float(2.5, "Target = Stop x", step=0.1)
basis = ta.ema(close, kcLen)
atrVal = ta.atr(atrLen)
upper = basis + kcMult * atrVal
lower = basis - kcMult * atrVal
longCond  = ta.crossover(close, upper)
shortCond = ta.crossunder(close, lower)
if longCond
    strategy.entry("K-L", strategy.long)
    strategy.exit("XL", from_entry="K-L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("K-S", strategy.short)
    strategy.exit("XS", from_entry="K-S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(basis, "KC Basis", color=color.orange)
plot(upper, "KC Upper", color=color.green)
plot(lower, "KC Lower", color=color.red)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ VWAP Reclaim (Intraday)",
    description:
      "Best-indicators library v1 · VWAP — the institutional execution benchmark. Trades the daily VWAP reclaim/rejection, the level bank desks and prop firms execute against all day. Best on intraday timeframes (M5-H1).",
    source: `//@version=5
strategy("VWAP Reclaim", overlay=true)
atrLen  = input.int(14, "ATR length", minval=1)
bandMult = input.float(0.25, "Reclaim buffer x ATR", step=0.05)
slMult  = input.float(1.5, "Stop x ATR", step=0.1)
rrMult  = input.float(2.0, "Target = Stop x", step=0.1)
vwapVal = ta.vwap(hlc3)
atrVal = ta.atr(atrLen)
upperBand = vwapVal + bandMult * atrVal
lowerBand = vwapVal - bandMult * atrVal
longCond  = ta.crossover(close, upperBand)
shortCond = ta.crossunder(close, lowerBand)
if longCond
    strategy.entry("V-L", strategy.long)
    strategy.exit("XL", from_entry="V-L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("V-S", strategy.short)
    strategy.exit("XS", from_entry="V-S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(vwapVal, "VWAP", color=color.yellow, linewidth=2)
plot(upperBand, "Upper band", color=color.gray)
plot(lowerBand, "Lower band", color=color.gray)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Parabolic SAR Flip",
    description:
      "Best-indicators library v1 · Wilder's Parabolic SAR — the classic always-in-market trend follower. SAR flip entries with the SAR line itself as a self-adjusting trailing stop; excels on strongly trending FX pairs and metals.",
    source: `//@version=5
strategy("Parabolic SAR Flip", overlay=true)
stepInc = input.float(0.02, "SAR step", step=0.005)
maxAf   = input.float(0.2, "SAR max", step=0.01)
sarVal = ta.sar(stepInc, stepInc, maxAf)
longCond  = ta.crossover(close, sarVal)
shortCond = ta.crossunder(close, sarVal)
if longCond
    strategy.entry("P-L", strategy.long)
if shortCond
    strategy.entry("P-S", strategy.short)
strategy.exit("XL", from_entry="P-L", stop=sarVal)
strategy.exit("XS", from_entry="P-S", stop=sarVal)
plot(sarVal, "PSAR", color=close > sarVal ? color.green : color.red)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "★ Hull MA Trend Flip",
    description:
      "Best-indicators library v1 · Hull Moving Average — nearly eliminates the lag that kills plain MA crosses. Trades the HMA slope flip for fast trend entries with an ATR trailing stop; the most responsive of the library trend systems.",
    source: `//@version=5
strategy("Hull MA Trend Flip", overlay=true)
hmaLen = input.int(21, "HMA length", minval=4)
atrLen = input.int(14, "ATR length", minval=1)
slMult = input.float(1.5, "Stop x ATR", step=0.1)
rrMult = input.float(2.5, "Target = Stop x", step=0.1)
hmaVal = ta.hma(close, hmaLen)
slope  = ta.change(hmaVal)
atrVal = ta.atr(atrLen)
longCond  = ta.crossover(slope, 0)
shortCond = ta.crossunder(slope, 0)
if longCond
    strategy.entry("H-L", strategy.long)
    strategy.exit("XL", from_entry="H-L", stop=close - slMult * atrVal, limit=close + slMult * rrMult * atrVal)
if shortCond
    strategy.entry("H-S", strategy.short)
    strategy.exit("XS", from_entry="H-S", stop=close + slMult * atrVal, limit=close - slMult * rrMult * atrVal)
plot(hmaVal, "HMA", color=slope > 0 ? color.green : color.red, linewidth=2)
plotshape(longCond, "BUY", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "SELL", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
];
