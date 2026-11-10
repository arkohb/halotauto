// ════════════════════════════════════════════════════════════════════════
//  TRADINGVIEW PARITY CORPUS · run: npx tsx scripts/pine-tv-corpus-test.ts
//  Real-world TradingView indicator idioms (v4, v5, v6) must compile with
//  ZERO errors and run over 600 bars without a runtime fault. Covers:
//  request.security (HTF + lookahead), switch, UDTs + methods, enums,
//  generics (array.new<T>), maps, matrices, for…in, tables, line/label/box
//  drawing, line wrapping, typed/default function params, str.format,
//  color.from_gradient, timeframe/session/time functions, v4 study()/
//  security()/iff(), v3 bare colours, strategy() with profit/loss ticks.
//  Plus numeric parity checks against TradingView's reference formulas.
// ════════════════════════════════════════════════════════════════════════
import { compilePine } from "../src/lib/pine/compile";
import { PineRuntime } from "../src/lib/pine/runtime";
import type { Candle } from "../src/lib/halo/types";

let pass = 0;
let fail = 0;
const ok = (c: boolean, name: string, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

function candles(n: number, tfMin = 5): Candle[] {
  let s = 99;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const out: Candle[] = [];
  let px = 2300;
  const t0 = Date.UTC(2026, 9, 5, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = px + Math.sin(i / 23) * 3 + (r() - 0.5) * 6;
    out.push({ time: t0 + i * tfMin * 60000, open: o, high: Math.max(o, c) + r() * 3, low: Math.min(o, c) - r() * 3, close: c, volume: 400 + r() * 900 });
    px = c;
  }
  return out;
}

const CORPUS: Record<string, string> = {
  "MTF EMA + request.security + fill + bgcolor": `//@version=5
indicator("MTF EMA Cloud", shorttitle="MTF", overlay=true, max_labels_count=500)
tf      = input.timeframe("60", "Higher timeframe")
lenFast = input.int(20, "Fast", minval=1, group="EMAs")
lenSlow = input.int(50, "Slow", minval=1, group="EMAs")
src     = input.source(close, "Source")
fastLtf = ta.ema(src, lenFast)
slowLtf = ta.ema(src, lenSlow)
htfFast = request.security(syminfo.tickerid, tf, ta.ema(close, lenFast), barmerge.gaps_off, barmerge.lookahead_off)
[htfHigh, htfLow] = request.security(syminfo.tickerid, "D", [high[1], low[1]], lookahead=barmerge.lookahead_on)
pF = plot(fastLtf, "Fast", color=color.new(color.teal, 0), linewidth=2)
pS = plot(slowLtf, "Slow", color=color.new(color.orange, 0))
fill(pF, pS, color = fastLtf > slowLtf ? color.new(color.green, 85) : color.new(color.red, 85), title="Cloud")
plot(htfFast, "HTF Fast", color.yellow, 2, plot.style_stepline)
plot(htfHigh, "PDH", color=color.gray, style=plot.style_circles)
plot(htfLow, "PDL", color=color.gray, style=plot.style_circles)
bgcolor(ta.crossover(fastLtf, slowLtf) ? color.new(color.lime, 80) : na)
alertcondition(ta.crossover(fastLtf, slowLtf), "Bull cross", "Fast crossed above slow on {{ticker}}")`,

  "Supertrend with switch + line wrapping": `//@version=5
indicator("ST Pro", overlay = true)
atrPeriod = input.int(10, "ATR Length")
factor    = input.float(3.0, "Factor", step = 0.1)
maType    = input.string("EMA", "MA type", options = ["SMA", "EMA", "WMA", "RMA", "HMA", "VWMA"])
maLen     = input.int(50, "MA length")
ma(src, len, type) =>
    switch type
        "SMA"  => ta.sma(src, len)
        "EMA"  => ta.ema(src, len)
        "WMA"  => ta.wma(src, len)
        "RMA"  => ta.rma(src, len)
        "HMA"  => ta.hma(src, len)
        => ta.vwma(src, len)
[supertrend, direction] = ta.supertrend(factor, atrPeriod)
trendMa = ma(close, maLen, maType)
bullish = direction < 0 and
     close > trendMa and
     ta.rsi(close, 14) > 50
bearish = direction > 0 and close < trendMa
upTrend = plot(direction < 0 ? supertrend : na, "Up", color.green, style=plot.style_linebr)
downTrend = plot(direction < 0 ? na : supertrend, "Down", color.red, style=plot.style_linebr)
bodyMiddle = plot((open + close) / 2, display=display.none)
fill(bodyMiddle, upTrend, color.new(color.green, 90), fillgaps=false)
plotshape(bullish and not bullish[1], "Buy", shape.labelup, location.belowbar, color.green, text="BUY", textcolor=color.white, size=size.small)
plotshape(bearish and not bearish[1], "Sell", shape.labeldown, location.abovebar, color.red, text="SELL", textcolor=color.white, size=size.small)`,

  "UDT + methods + array<Type> + for-in": `//@version=5
indicator("Pivot Levels UDT", overlay=true, max_lines_count=200)
type Pivot
    float price
    int   bar
    bool  isHigh = true
    line  ln = na

method extend(Pivot this, int toBar) =>
    if not na(this.ln)
        this.ln.set_x2(toBar)
    this

method touched(Pivot p, float hi, float lo) =>
    hi >= p.price and lo <= p.price

leftBars  = input.int(5, "Left")
rightBars = input.int(5, "Right")
var array<Pivot> pivots = array.new<Pivot>()
ph = ta.pivothigh(high, leftBars, rightBars)
pl = ta.pivotlow(low, leftBars, rightBars)
if not na(ph)
    p = Pivot.new(ph, bar_index - rightBars, true)
    p.ln := line.new(p.bar, p.price, bar_index, p.price, color=color.red, extend=extend.none)
    pivots.unshift(p)
if not na(pl)
    pivots.unshift(Pivot.new(pl, bar_index - rightBars, false, line.new(bar_index - rightBars, pl, bar_index, pl, color=color.green)))
if pivots.size() > 20
    old = pivots.pop()
    line.delete(old.ln)
int touchedCount = 0
for [i, pv] in pivots
    pv.extend(bar_index)
    if pv.touched(high, low)
        touchedCount += 1
for pv in pivots
    pv.price := pv.price
plot(touchedCount, "Touched", display=display.data_window)
plot(pivots.size() > 0 ? pivots.first().price : na, "Last pivot", color.purple)`,

  "Table dashboard + str.format + map": `//@version=5
indicator("Dashboard", overlay=true)
var table dash = table.new(position.top_right, 2, 4, bgcolor=color.new(color.black, 20), border_width=1)
rsi = ta.rsi(close, 14)
[macdLine, sigLine, _] = ta.macd(close, 12, 26, 9)
var map<string, float> stats = map.new<string, float>()
stats.put("rsi", rsi)
stats.put("atr", ta.atr(14))
trendTxt = close > ta.sma(close, 200) ? "Bull" : "Bear"
if barstate.islast
    table.cell(dash, 0, 0, "RSI", text_color=color.white)
    table.cell(dash, 1, 0, str.format("{0,number,#.##}", stats.get("rsi")), text_color=rsi > 70 ? color.red : rsi < 30 ? color.green : color.white)
    table.cell(dash, 0, 1, "MACD")
    table.cell(dash, 1, 1, str.tostring(macdLine, "#.####"))
    table.cell(dash, 0, 2, "Trend")
    table.cell(dash, 1, 2, trendTxt, bgcolor = trendTxt == "Bull" ? color.new(color.green, 60) : color.new(color.red, 60))
    table.cell_set_text(dash, 0, 3, "ATR " + str.tostring(stats.get("atr"), format.mintick))
plot(rsi, "RSI", display=display.none)`,

  "Order blocks with boxes + labels": `//@version=5
indicator("Order Blocks", overlay=true, max_boxes_count=100, max_labels_count=100)
sens = input.float(0.28, "Sensitivity", minval=0.01, step=0.01) / 100
var box[] bullBoxes = array.new_box()
var label lastLbl = na
roc = (open - open[4]) / open[4] * 100
bullOB = ta.crossover(roc, sens)
bearOB = ta.crossunder(roc, -sens)
if bullOB
    lo = ta.lowest(low, 5)
    b = box.new(bar_index - 4, high[4], bar_index, lo, border_color=color.green, bgcolor=color.new(color.green, 85), extend=extend.right)
    array.push(bullBoxes, b)
    label.delete(lastLbl)
    lastLbl := label.new(bar_index, low, "OB", style=label.style_label_up, color=color.green, textcolor=color.white, size=size.tiny)
if array.size(bullBoxes) > 0
    for i = array.size(bullBoxes) - 1 to 0
        bx = array.get(bullBoxes, i)
        if close < box.get_bottom(bx)
            box.delete(bx)
            array.remove(bullBoxes, i)
plotshape(bearOB, "Bear OB", shape.triangledown, location.abovebar, color.red)`,

  "Squeeze momentum (linreg, var colors)": `//@version=5
indicator(title="Squeeze Momentum", shorttitle="SQZ")
length = input(20, title="BB Length")
mult = input(2.0, title="BB MultFactor")
lengthKC = input(20, title="KC Length")
multKC = input(1.5, title="KC MultFactor")
useTrueRange = input(true, title="Use TrueRange (KC)")
source = close
basis = ta.sma(source, length)
dev = multKC * ta.stdev(source, length)
upperBB = basis + dev
lowerBB = basis - dev
ma = ta.sma(source, lengthKC)
range_1 = useTrueRange ? ta.tr : high - low
rangema = ta.sma(range_1, lengthKC)
upperKC = ma + rangema * multKC
lowerKC = ma - rangema * multKC
sqzOn = lowerBB > lowerKC and upperBB < upperKC
sqzOff = lowerBB < lowerKC and upperBB > upperKC
noSqz = sqzOn == false and sqzOff == false
val = ta.linreg(source - math.avg(math.avg(ta.highest(high, lengthKC), ta.lowest(low, lengthKC)), ta.sma(close, lengthKC)), lengthKC, 0)
iff_1 = val > nz(val[1]) ? color.lime : color.green
iff_2 = val < nz(val[1]) ? color.red : color.maroon
bcolor = val > 0 ? iff_1 : iff_2
scolor = noSqz ? color.blue : sqzOn ? color.black : color.gray
plot(val, color=bcolor, style=plot.style_histogram, linewidth=4)
plot(0, color=scolor, style=plot.style_cross, linewidth=2)`,

  "Functions with typed + default params, multiple call sites": `//@version=5
indicator("Typed funcs", overlay=false)
smoothed(float src, simple int len = 14, string kind = "ema") =>
    float out = na
    if kind == "ema"
        out := ta.ema(src, len)
    else
        out := ta.sma(src, len)
    out
zscore(series float x, int n) =>
    m = ta.sma(x, n)
    s = ta.stdev(x, n)
    s == 0 ? 0.0 : (x - m) / s
a = smoothed(close)
b = smoothed(close, 50)
c = smoothed(src = hl2, len = 30, kind = "sma")
z = zscore(close, 20)
plot(a - b, "Spread")
plot(c, "C")
plot(z, "Z", color = z > 2 ? color.red : z < -2 ? color.green : color.gray)
hline(2, "Upper", color.red, hline.style_dashed)
hline(-2, "Lower", color.green, hline.style_dotted)`,

  "Divergence: pivots + valuewhen + barssince": `//@version=5
indicator("RSI Divergence", overlay=false)
len = input.int(14, "RSI Period", minval=1)
lbR = input(5, "Pivot Lookback Right")
lbL = input(5, "Pivot Lookback Left")
rangeUpper = input(60, "Max of Lookback Range")
rangeLower = input(5, "Min of Lookback Range")
osc = ta.rsi(close, len)
plot(osc, "RSI", color=#2962FF)
hline(50, "Middle", color=color.new(#787B86, 50))
plFound = na(ta.pivotlow(osc, lbL, lbR)) ? false : true
phFound = na(ta.pivothigh(osc, lbL, lbR)) ? false : true
_inRange(cond) =>
    bars = ta.barssince(cond == true)
    rangeLower <= bars and bars <= rangeUpper
oscHL = osc[lbR] > ta.valuewhen(plFound, osc[lbR], 1) and _inRange(plFound[1])
priceLL = low[lbR] < ta.valuewhen(plFound, low[lbR], 1)
bullCond = priceLL and oscHL and plFound
plot(plFound ? osc[lbR] : na, offset=-lbR, title="Regular Bullish", linewidth=2, color=(bullCond ? color.green : color.new(color.white, 100)))
plotshape(bullCond ? osc[lbR] : na, offset=-lbR, title="Bull Label", text=" Bull ", style=shape.labelup, location=location.absolute, color=color.green, textcolor=color.white)`,

  "v6 enum + input.enum + bool strictness": `//@version=6
indicator("v6 enum", overlay=true)
enum MaKind
    ema = "Exponential"
    sma = "Simple"
    wma
kind = input.enum(MaKind.ema, "MA kind")
len = input.int(21, "Length")
ma = switch kind
    MaKind.ema => ta.ema(close, len)
    MaKind.sma => ta.sma(close, len)
    MaKind.wma => ta.wma(close, len)
bool above = close > ma
var int streak = 0
streak := above ? streak + 1 : 0
plot(ma, "MA " + str.tostring(kind), color = above ? color.lime : color.red)
plotchar(streak > 10, "Streak", "★", location.top, color.yellow)`,

  "Sessions, time(), timestamp, timeframe.change": `//@version=5
indicator("Sessions", overlay=true)
sess = input.session("0930-1600", "NY session")
inSess = not na(time(timeframe.period, sess, "America/New_York"))
asia = not na(time(timeframe.period, "1800-0300:1234567"))
newDay = timeframe.change("D")
var float dayOpen = na
if newDay
    dayOpen := open
startT = timestamp("America/New_York", 2026, 1, 1, 0, 0)
afterStart = time >= startT
isMonday = dayofweek == dayofweek.monday
bgcolor(inSess ? color.new(color.blue, 90) : asia ? color.new(color.purple, 92) : na)
plot(dayOpen, "Day open", color.white, style=plot.style_stepline)
plot(timeframe.isintraday and afterStart ? hour : na, "Hour", display=display.data_window)
plotchar(isMonday and newDay, "Mon", "M", location.top)`,

  "v4 study() + security() + iff()": `//@version=4
study("Old school", overlay=true)
len = input(14, type=input.integer, title="Length")
src = input(close, title="Source", type=input.source)
res = input("D", type=input.resolution, title="HTF")
dailyClose = security(syminfo.tickerid, res, close[1], lookahead=barmerge.lookahead_on)
emaV = ema(src, len)
up = crossover(emaV, sma(src, len * 2))
dn = crossunder(emaV, sma(src, len * 2))
col = iff(emaV > emaV[1], color.green, color.red)
plot(emaV, color=col, linewidth=2, transp=0)
plot(dailyClose, color=color.gray, style=plot.style_stepline)
plotshape(up, style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(dn, style=shape.triangledown, location=location.abovebar, color=color.red)
alertcondition(up, title="Up", message="EMA up")`,

  "v3 bare colors": `//@version=3
study("V3", overlay=true)
fast = ema(close, 9)
slow = ema(close, 21)
plot(fast, color=fast > slow ? lime : red, linewidth=2)
plot(slow, color=orange)
plotshape(crossover(fast, slow), style=shape.arrowup, location=location.belowbar, color=green)`,

  "Strategy: profit/loss ticks, position history, closedtrades": `//@version=5
strategy("Ticks strat", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10, pyramiding=0, commission_type=strategy.commission.percent, commission_value=0.04)
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long, comment="L")
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short, comment="S")
strategy.exit("XL", "Long", profit=800, loss=400)
strategy.exit("XS", "Short", profit=800, loss=400)
wasFlat = strategy.position_size[1] == 0
lastProfit = strategy.closedtrades > 0 ? strategy.closedtrades.profit(strategy.closedtrades - 1) : 0.0
plot(strategy.equity, "Equity", display=display.data_window)
plot(lastProfit, "Last profit", display=display.data_window)
plotchar(wasFlat and strategy.position_size != 0, "Entered", "•", location.bottom)`,

  "Matrix + array helpers + math": `//@version=5
indicator("Matrix stats")
var matrix<float> m = matrix.new<float>(0, 3)
m.add_row(m.rows(), array.from(close, high, low))
if m.rows() > 50
    m.remove_row(0)
float[] closes = m.col(0)
avgC = closes.avg()
med = array.median(closes)
sd = array.stdev(closes)
rank = array.percentrank(closes, closes.size() - 1)
plot(avgC, "Avg")
plot(med, "Median")
plot(sd, "Stdev")
plot(math.round(rank, 2), "Rank")
plot(math.max(math.abs(close - open), 0.0001) * math.pow(2, 1) + math.sqrt(math.e), "Mix", display=display.none)`,

  "Gradient colors, color.r/g/b, if-expression, while": `//@version=5
indicator("Gradient RSI")
r = ta.rsi(close, 14)
c = color.from_gradient(r, 30, 70, color.red, color.green)
plot(r, "RSI", c, 2)
label txt = na
level = if r > 70
    "OB"
else if r < 30
    "OS"
else
    "Mid"
i = 0
s = 0.0
while i < 10
    s += close[i]
    i += 1
red = color.r(c)
plot(s / 10, "Avg10", display = display.none)
plot(red, "Red channel", display = display.none)
plotchar(level == "OB", "OB", "▼", location.top, color.red)`,

  "Multi-line ternary + na handling + nz + fixnan": `//@version=5
indicator("Ternary chains", overlay=true)
atr = ta.atr(14)
band =
     close > open ? high + atr :
     close < open ? low - atr :
     hl2
ph = ta.pivothigh(3, 3)
lastPh = fixnan(ph)
smooth = nz(ta.ema(close, 200), close)
plot(band, "Band", color.aqua)
plot(lastPh, "Last PH", color.red, style = plot.style_stepline)
plot(smooth, "Smooth")`,

  "Label/line chart.point API (v5.x)": `//@version=5
indicator("Points", overlay = true, max_lines_count = 100)
var line trend = na
p1 = chart.point.from_index(bar_index - 10, low[10])
p2 = chart.point.now(low)
if bar_index % 20 == 0
    trend := line.new(p1, p2, color = color.yellow, width = 2)
lbl = label.new(chart.point.now(high), "H", style = label.style_label_down)
label.delete(lbl[1])
y = na(trend) ? na : trend.get_price(bar_index)
plot(y, "Trend price", color.yellow)`,

  "Volume-weighted indicators + ta vars": `//@version=5
indicator("Volume pack")
plot(ta.obv, "OBV")
plot(ta.accdist, "A/D")
plot(ta.vwap, "VWAP", display=display.none)
plot(ta.mfi(hlc3, 14), "MFI")
plot(ta.cmo(close, 9), "CMO")
[diplus, diminus, adx] = ta.dmi(14, 14)
plot(adx, "ADX")
[mid, up, lo] = ta.kc(close, 20, 1.5)
plot(ta.alma(close, 9, 0.85, 6), "ALMA")
plot(ta.tsi(close, 13, 25), "TSI")
plot(ta.cci(hlc3, 20), "CCI")
plot(ta.wpr(14), "W%R")
plot(ta.stoch(close, high, low, 14), "Stoch")
plot(ta.correlation(close, volume, 20), "Corr")
plot(ta.percentile_linear_interpolation(close, 20, 90), "P90")
plot(ta.highestbars(high, 20), "HB")
plot(ta.sar(0.02, 0.02, 0.2), "SAR")
plot(ta.swma(close), "SWMA")`,

  "v4 ATR trailing stop (UT-Bot style, iff chains, heikinashi)": `//@version=4
study(title="ATR Trail Bot", overlay = true)
keyV = input(1,     title = "Key value (sensitivity)")
atrP = input(10,    title = "ATR period")
useHa = input(false, title = "Signals from Heikin Ashi candles")
xATR  = atr(atrP)
nLoss = keyV * xATR
src = useHa ? security(heikinashi(syminfo.tickerid), timeframe.period, close, lookahead = false) : close
trail = 0.0
trail := iff(src > nz(trail[1], 0) and src[1] > nz(trail[1], 0), max(nz(trail[1]), src - nLoss),
   iff(src < nz(trail[1], 0) and src[1] < nz(trail[1], 0), min(nz(trail[1]), src + nLoss),
   iff(src > nz(trail[1], 0), src - nLoss, src + nLoss)))
pos = 0
pos :=	iff(src[1] < nz(trail[1], 0) and src > nz(trail[1], 0), 1,
   iff(src[1] > nz(trail[1], 0) and src < nz(trail[1], 0), -1, nz(pos[1], 0)))
xcolor = pos == -1 ? color.red: pos == 1 ? color.green : color.blue
emaV   = ema(src,1)
above = crossover(emaV, trail)
below = crossover(trail, emaV)
buy  = src > trail and above
sell = src < trail and below
barbuy  = src > trail
plotshape(buy,  title = "Buy",  text = 'Buy',  style = shape.labelup,   location = location.belowbar, color= color.green, textcolor = color.white, transp = 0, size = size.tiny)
plotshape(sell, title = "Sell", text = 'Sell', style = shape.labeldown, location = location.abovebar, color= color.red,   textcolor = color.white, transp = 0, size = size.tiny)
barcolor(barbuy ? color.green : na)
alertcondition(buy,  "UT Long",  "UT Long")
alertcondition(sell, "UT Short", "UT Short")`,

  "v3 tickerid/period variables": `//@version=3
study("v3 vars", overlay=true)
d = security(tickerid, "D", close[1], lookahead=barmerge.lookahead_on)
plot(isintraday ? d : na, color=gray)
plot(n % 2 == 0 ? close : na, color=blue, style=linebr)`,

  "SMC-style structure (UDT, methods, boxes, labels, alerts)": `//@version=5
indicator("Structure Map", "SMAP", overlay = true, max_labels_count = 500, max_boxes_count = 500, max_lines_count = 500)
//---------------------------------------------------------------------------------------------------------------------}
// SETTINGS
//---------------------------------------------------------------------------------------------------------------------{
swingLen   = input.int(10, "Swing length", minval = 3, group = "Structure")
showOB     = input.bool(true, "Order blocks", group = "Blocks", inline = "ob")
obCount    = input.int(5, "", minval = 1, group = "Blocks", inline = "ob")
bullCss    = input.color(#089981, "Bullish", group = "Style")
bearCss    = input.color(#F23645, "Bearish", group = "Style")
modeOpt    = input.string("Historical", "Mode", options = ["Historical", "Present"], group = "Structure")
//---------------------------------------------------------------------------------------------------------------------}
// TYPES
//---------------------------------------------------------------------------------------------------------------------{
type swing
    float price  = na
    int   barIdx = na
    bool  crossed = false

type orderBlock
    float top
    float btm
    int   loc
    box   bx
    int   bias

method update(swing s, float p, int i) =>
    s.price   := p
    s.barIdx  := i
    s.crossed := false
    s

method draw(orderBlock ob, color css) =>
    ob.bx := box.new(ob.loc, ob.top, last_bar_index, ob.btm, border_color = na, bgcolor = color.new(css, 80), extend = extend.right)
    ob

var swing top = swing.new()
var swing btm = swing.new()
var array<orderBlock> obs = array.new<orderBlock>()
var int trend = 0
//---------------------------------------------------------------------------------------------------------------------}
// DETECTION
//---------------------------------------------------------------------------------------------------------------------{
detect(len) =>
    var os = 0
    upper = ta.highest(len)
    lower = ta.lowest(len)
    os := high[len] > upper ? 0 : low[len] < lower ? 1 : os[1]
    topV = os == 0 and os[1] != 0 ? high[len] : 0
    btmV = os == 1 and os[1] != 1 ? low[len] : 0
    [topV, btmV]

[t, b] = detect(swingLen)
if t != 0
    top.update(t, bar_index - swingLen)
if b != 0
    btm.update(b, bar_index - swingLen)

bullBos = ta.crossover(close, top.price) and not top.crossed
bearBos = ta.crossunder(close, btm.price) and not btm.crossed

if bullBos
    top.crossed := true
    trend := 1
    label.new(int(math.avg(bar_index, top.barIdx)), top.price, trend == 1 ? "BOS" : "CHoCH", color = color(na), textcolor = bullCss, style = label.style_label_down, size = size.small)
    line.new(top.barIdx, top.price, bar_index, top.price, color = bullCss, style = line.style_dashed)
    if showOB
        minIdx = ta.lowestbars(low, math.max(1, bar_index - top.barIdx))
        ob = orderBlock.new(high[1], low[1], bar_index - 1, na, 1)
        obs.unshift(ob.draw(bullCss))
if bearBos
    btm.crossed := true
    trend := -1
    label.new(bar_index, btm.price, "BOS", color = color(na), textcolor = bearCss, style = label.style_label_up)

if obs.size() > obCount
    old = obs.pop()
    old.bx.delete()

// mitigation
for [i, ob] in obs
    if close < ob.btm and ob.bias == 1
        ob.bx.set_bgcolor(color.new(color.gray, 90))

zoneBull = obs.size() > 0 ? obs.get(0).top : na
plot(modeOpt == "Historical" ? zoneBull : na, "Last OB top", bullCss, style = plot.style_linebr)
bgcolor(trend == 1 ? color.new(bullCss, 95) : trend == -1 ? color.new(bearCss, 95) : na)
alertcondition(bullBos, "Bullish BOS", "Bullish structure break")
alertcondition(bearBos, "Bearish BOS", "Bearish structure break")`,
};

console.log("═══ TradingView corpus: compile + 600-bar run ═══");
const data = candles(600);
for (const [name, src] of Object.entries(CORPUS)) {
  const c = compilePine(src);
  const errs = c.error ? [c.error] : c.meta.diagnostics;
  ok(c.meta.ok && !c.error, `${name} — compiles`, errs.slice(0, 2).map((d) => `L${d.line}:${d.col} ${d.msg}`).join(" | "));
  if (!c.meta.ok) continue;
  try {
    const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
    const t0 = Date.now();
    for (const k of data) rt.processBar(k);
    const plotted = [...rt.plots.values()].filter((p) => p.values.some((v) => v !== null)).length;
    ok(true, `${name} — runs 600 bars (${Date.now() - t0}ms, ${plotted}/${rt.plots.size} plots with data, ${rt.simTrades.length} trades)`);
  } catch (e) {
    const pe = e as { message: string; line?: number };
    ok(false, `${name} — runs 600 bars`, `L${pe.line ?? "?"} ${pe.message}`);
  }
}

// ── numeric parity with TradingView's reference formulas ─────────────────
console.log("\n═══ numeric parity ═══");
{
  const src = `//@version=5
indicator("parity")
plot(ta.rsi(close, 14), "rsi")
plot(ta.atr(14), "atr")
plot(ta.wma(close, 10), "wma")
plot(ta.ema(close, 10), "ema")
plot(ta.rma(close, 10), "rma")`;
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  const d = data.slice(0, 200);
  for (const k of d) rt.processBar(k);
  const get = (t: string) => [...rt.plots.values()].find((p) => p.meta.title === t)!.values;
  // reference implementations (TradingView Pine reference pseudo-code)
  const closes = d.map((k) => k.close);
  const rma = (xs: (number | null)[], n: number) => {
    const out: (number | null)[] = [];
    let prev: number | null = null;
    const win: (number | null)[] = [];
    for (const x of xs) {
      win.push(x);
      if (prev === null) {
        const w = win.slice(-n);
        prev = w.length === n && w.every((v) => v !== null) ? (w as number[]).reduce((a, b) => a + b, 0) / n : null;
      } else if (x !== null) prev = (x + (n - 1) * prev) / n;
      out.push(prev);
    }
    return out;
  };
  const ups = closes.map((c, i) => (i === 0 ? null : Math.max(c - closes[i - 1], 0)));
  const dns = closes.map((c, i) => (i === 0 ? null : Math.max(closes[i - 1] - c, 0)));
  const ru = rma(ups, 14), rd = rma(dns, 14);
  const refRsi = ru.map((u, i) => (u === null || rd[i] === null ? null : rd[i] === 0 ? 100 : 100 - 100 / (1 + u / rd[i]!)));
  const rsi = get("rsi");
  const maxDiff = (a: (number | null)[], b: (number | null)[]) => Math.max(...a.map((v, i) => (v === null || b[i] === null ? (v === b[i] ? 0 : 999) : Math.abs(v - (b[i] as number)))));
  ok(maxDiff(rsi, refRsi) < 1e-9, "ta.rsi = RMA-based TradingView RSI", String(maxDiff(rsi, refRsi)));
  ok(rsi[13] === null && rsi[14] !== null, "ta.rsi first value on bar 14 (like TradingView)", `${rsi[13]} / ${rsi[14]}`);
  const trs = d.map((k, i) => (i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - d[i - 1].close), Math.abs(k.low - d[i - 1].close))));
  ok(maxDiff(get("atr"), rma(trs, 14)) < 1e-9, "ta.atr = RMA(true range)");
  const refWma = closes.map((_, i) => {
    if (i < 9) return null;
    let n = 0, den = 0;
    for (let j = 0; j < 10; j++) { const w = 10 - j; n += closes[i - j] * w; den += w; }
    return n / den;
  });
  ok(maxDiff(get("wma"), refWma) < 1e-9, "ta.wma weights the newest bar highest");
  const ema = get("ema");
  const sma10 = closes.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  ok(ema[8] === null && Math.abs((ema[9] as number) - sma10) < 1e-9, "ta.ema seeds with SMA(len) on bar len-1");
  ok(Math.abs((ema[10] as number) - ((2 / 11) * closes[10] + (9 / 11) * sma10)) < 1e-9, "ta.ema recursion alpha = 2/(len+1)");
  const rmaV = get("rma");
  ok(Math.abs((rmaV[10] as number) - ((1 / 10) * closes[10] + (9 / 10) * sma10)) < 1e-9, "ta.rma recursion alpha = 1/len (≠ EMA)");
}

// ── per-call-site function state ─────────────────────────────────────────
{
  const src = `//@version=5
indicator("ctx")
f(x) => ta.ema(x, 5)
a = f(close)
b = f(close * 2)
plot(b - 2 * a, "zero")`;
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  for (const k of data.slice(0, 60)) rt.processBar(k);
  const v = [...rt.plots.values()][0].values.slice(10);
  ok(v.every((x) => x !== null && Math.abs(x) < 1e-6), "each user-function call site keeps its own ta.ema state");
}

// ── request.security values ──────────────────────────────────────────────
{
  const src = `//@version=5
indicator("sec")
h1 = request.security(syminfo.tickerid, "60", close)
pdh = request.security(syminfo.tickerid, "60", high[1], lookahead = barmerge.lookahead_on)
plot(h1, "h1")
plot(pdh, "pdh")`;
  const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
  const d = data.slice(0, 120);
  for (const k of d) rt.processBar(k);
  const h1 = [...rt.plots.values()][0].values;
  const pdh = [...rt.plots.values()][1].values;
  // 5m bars, hour buckets: bar 11 is the last bar of hour 0 → its close is the hour close
  ok(h1[11] === d[11].close, "HTF close becomes available on the last chart bar of the hour", `${h1[11]} vs ${d[11].close}`);
  ok(h1[12] === d[11].close && h1[22] === d[11].close, "…and holds until the next hour closes (no repaint)");
  const hourHigh0 = Math.max(...d.slice(0, 12).map((k) => k.high));
  ok(pdh[12] === hourHigh0 && pdh[20] === hourHigh0, "lookahead_on + high[1] = previous hour's high from the hour's first bar", `${pdh[12]} vs ${hourHigh0}`);
}

// ── honest errors still work ─────────────────────────────────────────────
{
  const bad1 = compilePine(`//@version=5\nindicator("x")\nplot(ta.nosuch(close, 3))`);
  ok(!bad1.meta.ok && /ta\.nosuch/.test(bad1.meta.diagnostics[0]?.msg ?? ""), "unknown ta function → clear error", bad1.meta.diagnostics[0]?.msg);
  const bad2 = compilePine(`//@version=5\nindicator("x")\nplot(closee)`);
  ok(!bad2.meta.ok && /closee/.test(bad2.meta.diagnostics[0]?.msg ?? "") && bad2.meta.diagnostics[0].line === 3, "typo'd identifier → line 3 error", bad2.meta.diagnostics[0]?.msg);
  const bad3 = compilePine(`//@version=5\nindicator("x")\nif close > open\nplot(close)`);
  ok(!!bad3.error, "missing indented block → syntax error", bad3.error?.msg);
  const bad4 = compilePine(`//@version=5\nindicator("x")\nplot(color.gren)`);
  ok(!bad4.meta.ok, "misspelt colour → error", bad4.meta.diagnostics[0]?.msg);
}

console.log(`\n═══ RESULT: ${pass} passed · ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);
