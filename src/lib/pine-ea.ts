// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL · PINE EA SOURCE (TradingView attachment)
//  The same 3-Candle Equal Level engine as the app, compiled as a Pine v5
//  strategy. When the user attaches it to a TradingView chart and creates
//  an alert with the HALO webhook URL, every C3 fire posts a signed JSON
//  payload to /api/webhook/tv → routed to the linked broker account.
//  __HALO_SECRET__ is replaced with the user's webhook secret at copy-time.
// ════════════════════════════════════════════════════════════════════════

export const PINE_EA_TEMPLATE = `//@version=5
// ════════════════════════════════════════════════════════════════
//  HALO 3-CANDLE EQUAL LEVEL [3EL] · EA   v1.2  © Ant · HALO Suite
//  ENTRY: the highest wick of candle 1 & 2 is marked with a DOTTED
//  line. Candle 3 BREAKS that wick line and the moment price COMES
//  BACK to the dotted line, the trade fires instantly.
//  HOW TO ATTACH TO A TRADINGVIEW CHART:
//   1. Pine Editor → paste this script → "Add to chart"
//   2. Paste your HALO webhook secret into "Webhook secret" (done below)
//   3. Create an ALERT on this strategy → Notification: Webhook URL
//      → paste the HALO Webhook URL from the EA ATTACH card
//   4. Done — every C3 fire streams to your HALO linked account
// ════════════════════════════════════════════════════════════════
strategy("HALO 3-Candle Equal Level [3EL] · EA", "HALO 3EL EA", overlay=true, initial_capital=10000, currency=currency.USD, max_lines_count=500, pyramiding=0, calc_on_every_tick=true)

// ── Webhook ──
secretIn = input.string("__HALO_SECRET__", "HALO webhook secret", group="Webhook")

// ── Signal ──
atrLen     = input.int(14, "ATR length", minval=1, group="Signal")
bodyMinATR = input.float(0.0, "Min body size (xATR)", minval=0, step=0.05, group="Signal")
pairTolATR = input.float(0.25, "C1·C2 gap tolerance (xATR)", minval=0, step=0.05, group="Signal")
minSepATR  = input.float(0.5, "Min level separation (xATR)", minval=0, step=0.05, group="Signal")
rangeFilter = input.bool(true, "Range filter — skip when support & resistance are too close (ranging)", group="Signal")
rangeSepATR = input.float(1.0, "Range filter · min support↔resistance separation (xATR)", minval=0.1, step=0.1, group="Signal")
maxLevels  = input.int(3, "Max fresh levels per side", minval=1, maxval=10, group="Signal")
levelPersist = input.bool(true, "Levels persist — a level never touched or broken remains until it is touched and fired", group="Signal")
retestBars = input.int(24, "Re-test window after a break (bars)", minval=1, group="Signal")
expiryBars = input.int(150, "Level expiry (bars · legacy mode only)", minval=5, group="Signal")
sigMode    = input.string("Instant", "Trigger mode", options=["Instant", "Bar close"], group="Signal")

// ── C3 trigger filter (wick-line break → return) ──
breakATR   = input.float(0.02, "Break beyond dotted wick line (xATR)", minval=0, step=0.01, group="C3 filter")
eqTolATR   = input.float(0.10, "Return-to-line tolerance (xATR)", minval=0, step=0.01, group="C3 filter")

// ── Risk ──
slMode   = input.string("Break extreme + buffer", "Stop-loss mode", options=["Break extreme + buffer", "Fixed points", "ATR"], group="Risk")
slPts    = input.int(1000, "SL · fixed points", minval=1, group="Risk")
slBufPts = input.int(0, "SL · buffer points (break mode)", minval=0, group="Risk")
slATRm   = input.float(1.5, "SL · ATR multiple", minval=0.1, step=0.1, group="Risk")
rrMult   = input.float(3.0, "Take-profit (R multiple)", minval=0.1, step=0.1, group="Risk")
pipMult  = input.int(10, "Pip = mintick x", minval=1, group="Risk")

a      = ta.atr(atrLen)
atrOK  = not na(a) and a > 0
isInstant = sigMode == "Instant"
canFire   = barstate.isconfirmed or isInstant
pt  = syminfo.mintick
pip = pt * pipMult

eqTol   = eqTolATR * a
brk     = breakATR * a

// ── level memory (side, zone top/bot, dotted wick line, C1 index, drawings) ──
var L_SIDE = array.new_int()
var L_TOP  = array.new_float()
var L_BOT  = array.new_float()
var L_EXT  = array.new_float()
var L_IDX  = array.new_int()
var L_BROKE = array.new_bool()
var L_BIDX  = array.new_int()
var L_LN   = array.new_line()
var L_WK   = array.new_line()

// ── webhook JSON payload ──
js(x) => str.tostring(x, format.mintick)
tvMsg(action, dirTxt, px, slp, tpp, rp) => '{"secret":"' + secretIn + '","strategy":"HALO3EL","action":"' + action + '","symbol":"' + syminfo.ticker + '","tf":"' + timeframe.period + '","price":' + js(px) + ',"sl":' + js(slp) + ',"tp":' + js(tpp) + ',"riskPips":' + str.tostring(rp, "#.##") + ',"comment":"HALO 3EL ' + dirTxt + '"}'

// ── entry / SL / TP visuals while a trade runs ──
var float curEn = na
var float curSl = na
var float curTp = na
justClosed = strategy.position_size == 0 and strategy.position_size[1] != 0
if justClosed
    curEn := na
    curSl := na
    curTp := na
    alert(tvMsg("close", "CLOSE", close, 0.0, 0.0, 0.0), alert.freq_all)
plot(curEn, "ENTRY", color=#787B86, style=plot.style_linebr, linewidth=2)
plot(curSl, "SL", color=#F23645, style=plot.style_linebr)
plot(curTp, "TP", color=#089981, style=plot.style_linebr)

// ═══ 1 · C3 CHECK — WICK-LINE BREAK → RETURN (mirror of the HALO engine) ═══
float fireEntry = na
int   fireDir   = 0
float fireExt   = na
line  fireLn    = na
line  fireWk    = na

if array.size(L_SIDE) > 0
    for i = array.size(L_SIDE) - 1 to 0
        side = array.get(L_SIDE, i)
        ext  = array.get(L_EXT, i)
        b1i  = array.get(L_IDX, i)
        bool remove = false
        bool brkFlag = array.get(L_BROKE, i)
        if not levelPersist and bar_index - b1i > expiryBars
            remove := true
        else if levelPersist and brkFlag and bar_index - array.get(L_BIDX, i) > retestBars
            // LEVEL LIFECYCLE: the level BROKE the dotted line but the price
            // NEVER CAME BACK for entry within the re-test window → remove
            // it and hunt a fresh level instead. A level that is never
            // touched or broken never reaches this branch — it REMAINS.
            remove := true
        else
            // BREAK beyond the dotted wick line (C1/C2 extreme)
            broke = side == -1 ? high >= ext + brk : low <= ext - brk
            if broke and atrOK
                if not brkFlag
                    array.set(L_BROKE, i, true)
                    array.set(L_BIDX, i, bar_index)
                // RETURN to the dotted line → fire instantly
                back = side == -1 ? close <= ext + eqTol : close >= ext - eqTol
                if back and canFire and na(fireEntry) and strategy.position_size == 0
                    // RANGE FILTER — when the market is RANGING and the marked
                    // support & resistance are TOO CLOSE (midpoint gap <
                    // rangeSepATR × ATR) the trade is SKIPPED: the too-close
                    // level is burned and fresh levels further away arm later.
                    float minGap = na
                    if array.size(L_SIDE) > 0
                        for j = 0 to array.size(L_SIDE) - 1
                            if array.get(L_SIDE, j) != side
                                g = math.abs((array.get(L_TOP, j) + array.get(L_BOT, j)) / 2 - (array.get(L_TOP, i) + array.get(L_BOT, i)) / 2)
                                if na(minGap) or g < minGap
                                    minGap := g
                    if rangeFilter and not na(minGap) and minGap < rangeSepATR * a
                        remove := true
                    else
                        fireDir   := side
                        fireEntry := ext
                        fireExt   := side == -1 ? high : low
                        fireLn    := array.get(L_LN, i)
                        fireWk    := array.get(L_WK, i)
                        remove    := true
                else if barstate.isconfirmed and not levelPersist
                    remove := true
        if remove
            line.delete(array.get(L_LN, i))
            line.delete(array.get(L_WK, i))
            array.remove(L_SIDE, i)
            array.remove(L_TOP, i)
            array.remove(L_BOT, i)
            array.remove(L_EXT, i)
            array.remove(L_IDX, i)
            array.remove(L_BROKE, i)
            array.remove(L_BIDX, i)
            array.remove(L_LN, i)
            array.remove(L_WK, i)

// ═══ 2 · FIRE TRADE + WEBHOOK ALERT (entry AT the dotted line) ═══
if not na(fireEntry) and atrOK
    risk = slMode == "Fixed points" ? slPts * pt : slMode == "ATR" ? slATRm * a : math.abs(fireExt - fireEntry) + slBufPts * pt
    risk := math.max(risk, pt)
    slP = fireEntry - fireDir * risk
    tpP = fireEntry + fireDir * rrMult * risk
    eId = fireDir == -1 ? "3EL-S" : "3EL-L"
    dirTxt = fireDir == -1 ? "SELL" : "BUY"
    strategy.entry(eId, fireDir == -1 ? strategy.short : strategy.long, comment="HALO 3EL " + dirTxt)
    strategy.exit("3EL-X", from_entry=eId, stop=slP, limit=tpP)
    curEn := fireEntry
    curSl := slP
    curTp := tpP
    if not na(fireLn)
        line.set_x2(fireLn, bar_index)
        line.set_extend(fireLn, extend.none)
    if not na(fireWk)
        line.set_x2(fireWk, bar_index)
        line.set_extend(fireWk, extend.none)
    alert(tvMsg(fireDir == -1 ? "sell" : "buy", dirTxt, fireEntry, slP, tpP, risk / pip), alert.freq_all)
    // LEVEL LIFECYCLE — ALL armed levels are deleted the moment a trade
    // fires; nothing new arms until the position closes (TP or SL), then
    // the EA scans again.
    if levelPersist and array.size(L_SIDE) > 0
        for i = array.size(L_SIDE) - 1 to 0
            line.delete(array.get(L_LN, i))
            line.delete(array.get(L_WK, i))
            array.remove(L_SIDE, i)
            array.remove(L_TOP, i)
            array.remove(L_BOT, i)
            array.remove(L_EXT, i)
            array.remove(L_IDX, i)
            array.remove(L_BROKE, i)
            array.remove(L_BIDX, i)
            array.remove(L_LN, i)
            array.remove(L_WK, i)

// ═══ 3 · DETECT NEW C1 / C2 EQUAL-LEVEL PAIR (confirmed bars) ═══
// LEVEL LIFECYCLE: while a trade runs nothing new is armed — the board
// stays empty until TP/SL, then scanning re-activates.
if barstate.isconfirmed and atrOK and (not levelPersist or strategy.position_size == 0)
    c1Bull = close[1] > open[1]
    c1Bear = close[1] < open[1]
    c2Bull = close > open
    c2Bear = close < open
    bodiesOK = math.abs(close[1] - open[1]) >= bodyMinATR * a and math.abs(close - open) >= bodyMinATR * a
    gapOK    = math.abs(close[1] - open) <= pairTolATR * a
    newSide  = c1Bull and c2Bear ? -1 : c1Bear and c2Bull ? 1 : 0
    if newSide != 0 and bodiesOK and gapOK
        nTop = math.max(close[1], open)
        nBot = math.min(close[1], open)
        nMid = (nTop + nBot) / 2
        nExt = newSide == -1 ? math.max(high, high[1]) : math.min(low, low[1])
        sep  = minSepATR * a
        bool keepNew = true
        if array.size(L_SIDE) > 0
            for i = 0 to array.size(L_SIDE) - 1
                if array.get(L_SIDE, i) == newSide and math.abs((array.get(L_TOP, i) + array.get(L_BOT, i)) / 2 - nMid) < sep
                    farther = newSide == -1 ? nTop > array.get(L_TOP, i) : nBot < array.get(L_BOT, i)
                    if not farther
                        keepNew := false
        if keepNew
            if array.size(L_SIDE) > 0
                for i = array.size(L_SIDE) - 1 to 0
                    if array.get(L_SIDE, i) == newSide and math.abs((array.get(L_TOP, i) + array.get(L_BOT, i)) / 2 - nMid) < sep
                        line.delete(array.get(L_LN, i))
                        line.delete(array.get(L_WK, i))
                        array.remove(L_SIDE, i)
                        array.remove(L_TOP, i)
                        array.remove(L_BOT, i)
                        array.remove(L_EXT, i)
                        array.remove(L_IDX, i)
                        array.remove(L_BROKE, i)
                        array.remove(L_BIDX, i)
                        array.remove(L_LN, i)
                        array.remove(L_WK, i)
            cnt = 0
            if array.size(L_SIDE) > 0
                for i = 0 to array.size(L_SIDE) - 1
                    if array.get(L_SIDE, i) == newSide
                        cnt += 1
            if cnt >= maxLevels
                if levelPersist
                    // LEVEL LIFECYCLE: armed levels REMAIN — the side is at
                    // cap, so the NEW formation is rejected, never the old
                    // levels ("a level which is never touched or broken
                    // remains until it is touched and fired").
                    keepNew := false
                else
                    for i = 0 to array.size(L_SIDE) - 1
                        if array.get(L_SIDE, i) == newSide
                            line.delete(array.get(L_LN, i))
                            line.delete(array.get(L_WK, i))
                            array.remove(L_SIDE, i)
                            array.remove(L_TOP, i)
                            array.remove(L_BOT, i)
                            array.remove(L_EXT, i)
                            array.remove(L_IDX, i)
                            array.remove(L_BROKE, i)
                            array.remove(L_BIDX, i)
                            array.remove(L_LN, i)
                            array.remove(L_WK, i)
                            break
        if keepNew
            lnCol = newSide == -1 ? color.new(#F23645, 25) : color.new(#089981, 25)
            ln = line.new(bar_index - 1, nMid, bar_index + 20, nMid, color=lnCol, width=2, extend=extend.right)
            // the DOTTED TRIGGER line — highest wick of candle 1 & 2
            wk = line.new(bar_index - 1, nExt, bar_index + 20, nExt, color=color.new(#D4AF37, 15), width=1, style=line.style_dotted, extend=extend.right)
            array.push(L_SIDE, newSide)
            array.push(L_TOP, nTop)
            array.push(L_BOT, nBot)
            array.push(L_EXT, nExt)
            array.push(L_IDX, bar_index - 1)
            array.push(L_BROKE, false)
            array.push(L_BIDX, 0)
            array.push(L_LN, ln)
            array.push(L_WK, wk)
`;

/** Pine EA source with the user's webhook secret embedded. */
export function buildPineEa(secret: string): string {
  return PINE_EA_TEMPLATE.replace("__HALO_SECRET__", secret || "PASTE-YOUR-HALO-SECRET");
}
