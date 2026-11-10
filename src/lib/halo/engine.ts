// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL ENGINE · TypeScript port of the PineScript v5 logic
//
//  ENTRY STRATEGY (v1.2 · WICK-LINE BREAK → RETURN):
//  SELL (resistance):  C1 bullish  →  C2 bearish
//  BUY  (support)   :  C1 bearish  →  C2 bullish
//  • C1 body close + C2 body open mark the equal level.
//  • The HIGHEST WICK of candle 1 & 2 (resistance) / LOWEST WICK (support)
//    is marked with a DOTTED line — the TRIGGER line (LevelSnapshot.ext).
//  • Candle 3 must BREAK beyond that dotted wick line, and the moment the
//    price COMES BACK to the dotted line the trade fires INSTANTLY —
//    entry is AT the dotted line, no delay, no bar-close wait (instant
//    mode evaluates the live candle on every feed tick).
//  • Same-bar SL+TP counts as SL (conservative).
//  • Pairs forming too close: only the farther one is kept.
//  • RANGE FILTER: when the market is RANGING and the marked support &
//    resistance are TOO CLOSE (S/R midpoint gap < rangeSepATR × ATR) the
//    fire is SKIPPED — the too-close level is burned, the skip is announced
//    (log + range_skip event → bot alert/voice), and the engine keeps
//    hunting for FRESH levels further away from the range to arm instead.
//  • focusCurrent (default ON, LEGACY mode only): a new C1/C2 pair REPLACES
//    older fresh levels on its OWN side — with levelPersist the new
//    lifecycle rule wins instead: armed levels REMAIN until touched & fired.
// ════════════════════════════════════════════════════════════════════════

import {
  Candle,
  EngineEvent,
  EngineSnapshot,
  FireEvent,
  HaloConfig,
  LevelSnapshot,
  LogEntry,
  ManageEvent,
  Side,
  Stats,
  TradeManagerCfg,
  TradeSnapshot,
} from "./types";
import { DEFAULT_CONFIG } from "./types";

interface InternalLevel {
  id: number;
  side: Side;
  top: number;
  bot: number;
  ext: number;
  c1Close: number;
  c2Open: number;
  b1Time: number;
  b2Time: number;
  b1Index: number;
  broke: boolean; // candle 3 already broke beyond the dotted line (break event fired once)
  brokeIndex: number | null; // bar index of the break — anchors the re-test window ("price never returned" removal)
}

interface EngineState {
  barIndex: number; // index of last processed CONFIRMED bar (-1 = none)
  lastBarTime: number; // open time of last confirmed bar (0 = none)
  prevBar: Candle | null;
  // ta.atr() state: RMA of True Range, seeded with SMA of first `atrLen` TRs
  atr: number | null;
  trSum: number;
  trCount: number;
  prevClose: number | null;
  levels: InternalLevel[]; // fresh levels, oldest → newest
  drawings: LevelSnapshot[]; // every recent level for the chart
  log: LogEntry[];
  nextId: number;
  firedLvlId: number | null;
  trade: TradeSnapshot | null;
  stats: Stats;
}

function freshState(): EngineState {
  return {
    barIndex: -1,
    lastBarTime: 0,
    prevBar: null,
    atr: null,
    trSum: 0,
    trCount: 0,
    prevClose: null,
    levels: [],
    drawings: [],
    log: [],
    nextId: 1,
    firedLvlId: null,
    trade: null,
    stats: {
      wins: 0,
      losses: 0,
      sumTP: 0,
      sumSL: 0,
      burned: 0,
      skipped: 0,
      tooClose: 0,
      rangeSkipped: 0,
      noReturnRemoved: 0,
      lastResult: { text: "—", kind: "none" },
    },
  };
}

/** Price formatting for log/alert strings (mintick-driven decimals). */
function fmtPxOf(pt: number, px: number): string {
  const d = pt > 0 && isFinite(pt) ? Math.min(8, Math.max(0, Math.round(-Math.log10(pt)))) : 2;
  return px.toFixed(d);
}

export class HaloEngine {
  cfg: HaloConfig;
  pt: number; // syminfo.mintick
  state: EngineState;
  /** EDGE Smart Trade Manager — null = classic fixed SL/TP behaviour */
  tm: TradeManagerCfg | null = null;

  constructor(cfg: HaloConfig, mintick: number) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.pt = mintick > 0 ? mintick : 0.01;
    this.state = freshState();
  }

  get pip(): number {
    // pip = syminfo.mintick * pipMult
    return this.pt * this.cfg.pipMult;
  }

  clone(): HaloEngine {
    const e = new HaloEngine(this.cfg, this.pt);
    e.state = structuredClone(this.state);
    e.tm = this.tm;
    return e;
  }

  /** True Range (first bar: high - low). */
  private trOf(bar: Candle): number {
    const pc = this.state.prevClose;
    if (pc === null) return bar.high - bar.low;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - pc), Math.abs(bar.low - pc));
  }

  /** Commit ATR with this confirmed bar (Pine ta.atr semantics). */
  private commitAtr(bar: Candle): number | null {
    const s = this.state;
    const len = Math.max(1, Math.round(this.cfg.atrLen));
    const tr = this.trOf(bar);
    if (s.atr === null) {
      s.trSum += tr;
      s.trCount += 1;
      if (s.trCount >= len) s.atr = s.trSum / len;
    } else {
      s.atr = (s.atr * (len - 1) + tr) / len;
    }
    s.prevClose = bar.close;
    return s.atr;
  }

  /** ATR including the live (unconfirmed) bar without committing state. */
  private liveAtr(bar: Candle): number | null {
    const s = this.state;
    const len = Math.max(1, Math.round(this.cfg.atrLen));
    if (s.atr === null) return null;
    const tr = this.trOf(bar);
    return (s.atr * (len - 1) + tr) / len;
  }

  private markLevel(id: number, state: "fired" | "burned", endTime: number): void {
    const d = this.state.drawings.find((x) => x.id === id);
    if (d && d.state === "fresh") {
      d.state = state;
      d.endTime = endTime;
    }
  }

  private pushLog(e: LogEntry): void {
    this.state.log.push(e);
    if (this.state.log.length > 60) this.state.log.splice(0, this.state.log.length - 60);
  }

  /**
   * TRADE LOCK helper — burn EVERY fresh armed level at once. Called when a
   * trade fires anywhere in the app: "all armed levels are deleted until a
   * running trade hit TP or SL, then scanning activates". Returns how many
   * levels were cleared.
   */
  clearArmedLevels(time: number): number {
    const s = this.state;
    const n = s.levels.length;
    for (const L of s.levels) this.markLevel(L.id, "burned", time);
    if (n > 0) s.levels = [];
    return n;
  }

  /**
   * RANGE FILTER helper — the closest OPPOSITE-side fresh level to `L`
   * (midpoint distance, same convention as the minSepATR crowd check).
   * A tight support↔resistance box means the market is ranging and the
   * marked S/R are too close for a worthwhile entry.
   */
  private rangeGapOf(L: InternalLevel): { gap: number; opp: InternalLevel } | null {
    let best: { gap: number; opp: InternalLevel } | null = null;
    for (const O of this.state.levels) {
      if (O.id === L.id || O.side === L.side) continue;
      const gap = Math.abs((O.top + O.bot) / 2 - (L.top + L.bot) / 2);
      if (!best || gap < best.gap) best = { gap, opp: O };
    }
    return best;
  }

  /**
   * EDGE · Smart Trade Manager step on a confirmed bar that did NOT close the
   * trade: break-even → partial close → trailing stop. Stops only ever move
   * in the trade's favour. Runs after the SL/TP check, so the new stop
   * applies from the NEXT bar (no same-bar look-ahead).
   */
  private manageTrade(t: TradeSnapshot, bar: Candle, atr: number, ev: EngineEvent[]): void {
    const tm = this.tm!;
    if (t.origSl === undefined) t.origSl = t.sl;
    const R = Math.abs(t.entry - t.origSl);
    if (!(R > 0)) return;
    const fav = t.dir === 1 ? bar.high : bar.low;
    t.bestPx = t.bestPx === undefined ? fav : t.dir === 1 ? Math.max(t.bestPx, fav) : Math.min(t.bestPx, fav);
    const runR = ((t.bestPx - t.entry) * t.dir) / R;
    const better = (a: number, b: number): boolean => (t.dir === 1 ? a > b : a < b);
    const px = (v: number): string => fmtPxOf(this.pt, v);
    const push = (m: Omit<ManageEvent, "type" | "dir" | "entry" | "time">): void => {
      ev.push({ type: "manage", dir: t.dir, entry: t.entry, time: bar.time, ...m });
    };

    if (tm.beAtR > 0 && !t.beDone && runR >= tm.beAtR) {
      const be = t.entry + t.dir * Math.max(0, tm.beOffsetR) * R;
      t.beDone = true;
      if (better(be, t.sl)) {
        const prev = t.sl;
        t.sl = be;
        push({ action: "breakeven", sl: be, prevSl: prev, message: `Stop moved to break-even ${px(be)} (trade ran ${runR.toFixed(2)}R)` });
      }
    }

    if (tm.partialAtR > 0 && !t.partialDone && runR >= tm.partialAtR) {
      const frac = Math.min(0.9, Math.max(0.01, tm.partialPct / 100));
      const closePx = t.entry + t.dir * tm.partialAtR * R;
      const pips = ((closePx - t.entry) * t.dir) / this.pip;
      t.partialDone = true;
      t.partialFrac = frac;
      t.partialPips = pips;
      push({ action: "partial", sl: t.sl, prevSl: t.sl, frac, price: closePx, pips, message: `Closed ${Math.round(frac * 100)}% at ${px(closePx)} (+${pips.toFixed(1)} pips, ${tm.partialAtR}R)` });
    }

    if (tm.trailStartR > 0 && atr > 0 && runR >= tm.trailStartR) {
      const trail = t.bestPx - t.dir * tm.trailATR * atr;
      t.trailOn = true;
      if (better(trail, t.sl) && better(t.tp, trail)) {
        const prev = t.sl;
        t.sl = trail;
        push({ action: "trail", sl: trail, prevSl: prev, message: `Trailing stop raised to ${px(trail)}` });
      }
    }
  }

  /**
   * Process one bar. `confirmed = barstate.isconfirmed`.
   * Section order matches the PineScript exactly:
   *   1. manage open trade  2. C3 break→return check  3. fire  4. detect new C1/C2
   */
  processBar(bar: Candle, confirmed: boolean): EngineEvent[] {
    const s = this.state;
    const cfg = this.cfg;
    const ev: EngineEvent[] = [];
    const curIndex = s.barIndex + 1; // live bar and next confirmed bar share this index

    const atr = confirmed ? this.commitAtr(bar) : this.liveAtr(bar);
    const atrOK = atr !== null && isFinite(atr) && atr > 0;
    const a = atrOK ? (atr as number) : 0;
    const eqTol = cfg.eqTolATR * a;
    const brk = cfg.breakATR * a;
    const isInstant = cfg.sigMode === "instant";
    const canFire = confirmed || isInstant;

    // ═════════════ 1. MANAGE OPEN TRADE ═════════════
    if (s.trade && bar.time > s.trade.entryTime) {
      const t = s.trade;
      const hitSL = t.dir === -1 ? bar.high >= t.sl : bar.low <= t.sl;
      const hitTP = t.dir === -1 ? bar.low <= t.tp : bar.high >= t.tp;
      if (hitSL || hitTP) {
        // same-bar SL + TP counts as SL (conservative). The exit is signed so
        // a stop the trade manager moved to break-even / into profit books
        // correctly; partial closes are blended into the net result.
        const exitPx = hitSL ? t.sl : t.tp;
        const managed = hitSL && (t.beDone || t.trailOn) === true;
        const exitPips = ((exitPx - t.entry) * t.dir) / this.pip;
        const frac = t.partialDone ? (t.partialFrac ?? 0) : 0;
        const net = frac * (t.partialPips ?? 0) + (1 - frac) * exitPips;
        const p = Math.abs(net);
        const label = hitSL ? (managed ? "MANAGED STOP" : "SL HIT") : "TP HIT";
        if (net <= 0) {
          s.stats.losses += 1;
          s.stats.sumSL += p;
          s.stats.lastResult = { text: `${label}  −${p.toFixed(1)} pips`, kind: "loss" };
          this.pushLog({ time: bar.time, kind: "loss", dir: t.dir, pips: p, entry: t.entry });
          ev.push({ type: "loss", pips: p, entry: t.entry, sl: t.sl, tp: t.tp, time: bar.time, message: `HALO 3EL ${label} −${p.toFixed(1)} pips`, reason: hitSL ? (managed ? "managed" : "sl") : "tp", exitPx });
        } else {
          s.stats.wins += 1;
          s.stats.sumTP += p;
          s.stats.lastResult = { text: `${label}  +${p.toFixed(1)} pips`, kind: "win" };
          this.pushLog({ time: bar.time, kind: "win", dir: t.dir, pips: p, entry: t.entry });
          ev.push({ type: "win", pips: p, entry: t.entry, sl: t.sl, tp: t.tp, time: bar.time, message: `HALO 3EL ${label} +${p.toFixed(1)} pips`, reason: hitSL ? "managed" : "tp", exitPx });
        }
        s.trade = null;
      } else if (confirmed && this.tm?.enabled) {
        this.manageTrade(t, bar, a, ev);
      }
    }

    // ═════════════ 2. CANDLE 3 CHECK — WICK-LINE BREAK → RETURN ═════════════
    // The dotted TRIGGER line is the C1/C2 wick extreme (L.ext: the highest
    // wick of candle 1 & 2 on a resistance side, the lowest on a support
    // side). The trade fires the instant candle 3 BREAKS beyond that dotted
    // line AND the price COMES BACK to it:
    //   broke : side −1 → bar.high ≥ ext + brk    |  side +1 → bar.low ≤ ext − brk
    //   back  : side −1 → bar.close ≤ ext + eqTol |  side +1 → bar.close ≥ ext − eqTol
    // In instant mode both sides are evaluated intrabar on the LIVE candle
    // every feed tick — the fire is immediate, without waiting for close.
    let fireDir: Side | 0 = 0;
    let fireEntry = 0;
    let fireExt = 0;
    let fireL: InternalLevel | null = null;

    for (let i = s.levels.length - 1; i >= 0; i--) {
      const L = s.levels[i];
      let remove = false;
      let isFire = false;

      if (!cfg.levelPersist && curIndex - L.b1Index > cfg.expiryBars) {
        // LEGACY expiry (levelPersist OFF): fixed bar-count expiry for every fresh level
        remove = true;
        this.markLevel(L.id, "burned", bar.time);
        ev.push({ type: "expired", id: L.id });
      } else if (
        cfg.levelPersist &&
        L.broke &&
        L.brokeIndex !== null &&
        curIndex - L.brokeIndex > Math.max(1, Math.round(cfg.retestBars))
      ) {
        // LEVEL LIFECYCLE: the level BROKE the dotted line but the price
        // NEVER CAME BACK to it for entry within the re-test window —
        // remove it and hunt a fresh level instead. (A level that is never
        // touched or broken never reaches this branch: it REMAINS armed
        // until it is touched and fired.)
        s.stats.noReturnRemoved += 1;
        const msg = `Level removed — ${L.side === -1 ? "resistance" : "support"} ${fmtPxOf(this.pt, L.ext)} broke the dotted line but the price never returned for entry within ${Math.round(cfg.retestBars)} bars. Hunting a fresh level.`;
        this.pushLog({ time: bar.time, kind: "skip", dir: L.side, pips: 0, entry: L.ext, message: msg });
        ev.push({ type: "level_removed", id: L.id, side: L.side, ext: L.ext, reason: "no_return", time: bar.time });
        this.markLevel(L.id, "burned", bar.time);
        remove = true;
      } else {
        // BREAK beyond the dotted wick line (C1/C2 extreme)
        const broke = L.side === -1 ? bar.high >= L.ext + brk : bar.low <= L.ext - brk;
        if (broke && atrOK) {
          if (!L.broke) {
            // FIRST tick beyond the dotted trigger line — the bot announces
            // this loudly ("candle 3 is breaking…") exactly once per level.
            L.broke = true;
            L.brokeIndex = curIndex;
            ev.push({
              type: "break",
              id: L.id,
              side: L.side,
              ext: L.ext,
              price: L.side === -1 ? bar.high : bar.low,
              time: bar.time,
            });
          }
          // RETURN to the dotted line → fire instantly
          const back = L.side === -1 ? bar.close <= L.ext + eqTol : bar.close >= L.ext - eqTol;
          if (back && canFire) {
            if (!s.trade && fireDir === 0) {
              // ── RANGE FILTER · ranging market + marked S/R too close ──
              // An armed support AND resistance sit closer than
              // rangeSepATR×ATR apart: the break→return is chop inside a
              // tight box, not a setup. Skip the trade, burn the too-close
              // level, announce WHY, and keep hunting for fresh levels
              // further away from the range (a far-enough fresh pair arms
              // and trades as usual).
              const rg = cfg.rangeFilter ? this.rangeGapOf(L) : null;
              if (rg && rg.gap < cfg.rangeSepATR * a) {
                const gapPips = rg.gap / this.pip;
                const minPips = (cfg.rangeSepATR * a) / this.pip;
                const sup = L.side === 1 ? L : rg.opp;
                const res = L.side === -1 ? L : rg.opp;
                const msg =
                  `Skipped ${L.side === -1 ? "SELL" : "BUY"} — market is RANGING: the marked support ${fmtPxOf(this.pt, sup.ext)} and resistance ${fmtPxOf(
                    this.pt,
                    res.ext
                  )} are only ${gapPips.toFixed(1)} pips apart (min ${minPips.toFixed(1)}). Too close for entry — hunting fresh levels further from the range.`;
                s.stats.rangeSkipped += 1;
                s.stats.lastResult = {
                  text: `RANGE SKIP · S/R ${gapPips.toFixed(1)}p < ${minPips.toFixed(1)}p`,
                  kind: "none",
                };
                this.pushLog({ time: bar.time, kind: "skip", dir: L.side, pips: gapPips, entry: L.ext, message: msg });
                ev.push({
                  type: "range_skip",
                  dir: L.side,
                  entry: L.ext,
                  gapPips,
                  minGapPips: minPips,
                  supportPx: sup.ext,
                  resistancePx: res.ext,
                  time: bar.time,
                  message: msg,
                });
              } else {
                fireDir = L.side;
                fireEntry = L.ext; // entry AT the dotted trigger line
                fireExt = L.side === -1 ? bar.high : bar.low; // C3 break extreme
                fireL = L;
                isFire = true;
              }
            } else {
              s.stats.skipped += 1;
              ev.push({ type: "skipped" });
            }
            remove = true;
          } else if (confirmed) {
            // broke the wick line but never returned by bar close → spent.
            // LEGACY (levelPersist OFF) only — with the new lifecycle the
            // level stays armed awaiting the return within the re-test
            // window (checked at the top of this loop).
            if (!cfg.levelPersist) {
              s.stats.burned += 1;
              ev.push({ type: "burned" });
              remove = true;
            }
          }
        }
      }

      if (remove) {
        this.markLevel(L.id, isFire ? "fired" : "burned", bar.time);
        s.levels.splice(i, 1);
      }
    }

    // ═════════════ 3. FIRE TRADE (instantly, at the dotted line) ═════════════
    if (fireDir !== 0 && fireL && atrOK) {
      const dir = fireDir as Side;
      let risk =
        cfg.slMode === "points"
          ? cfg.slPts * this.pt
          : cfg.slMode === "atr"
            ? cfg.slATRm * a
            : Math.abs(fireExt - fireEntry) + cfg.slBufPts * this.pt;
      risk = Math.max(risk, this.pt);
      const sl = fireEntry - dir * risk;
      const tp = fireEntry + dir * cfg.rrMult * risk;
      s.trade = {
        dir,
        entry: fireEntry,
        sl,
        tp,
        risk,
        riskPips: risk / this.pip,
        rewardPips: (cfg.rrMult * risk) / this.pip,
        entryTime: bar.time,
        ext: fireExt,
        levelTop: fireL.top,
        levelBot: fireL.bot,
        trigger: fireL.ext,
        slModeLabel: cfg.slMode === "points" ? "Fixed points" : cfg.slMode === "atr" ? "ATR" : "Break extreme + buffer",
      };
      s.firedLvlId = fireL.id;
      if (cfg.levelPersist) {
        // ALL ARMED LEVELS ARE DELETED the moment a trade fires — the board
        // stays empty until the running trade hits TP or SL, then scanning
        // (level detection) re-activates. Backtests replay the same rule.
        this.clearArmedLevels(bar.time);
      }
      const msg = `HALO 3EL ${dir === -1 ? "SELL" : "BUY"} · WICK-LINE BREAK→RETURN · Entry ${fireEntry} · SL ${sl} · TP ${tp}`;
      this.pushLog({ time: bar.time, kind: "fire", dir, pips: 0, entry: fireEntry });
      const fireEv: FireEvent = {
        type: "fire",
        dir,
        entry: fireEntry,
        sl,
        tp,
        risk,
        riskPips: risk / this.pip,
        rewardPips: (cfg.rrMult * risk) / this.pip,
        levelTop: fireL.top,
        levelBot: fireL.bot,
        ext: fireExt,
        time: bar.time,
        message: msg,
        levelTime: fireL.b2Time,
      };
      ev.push(fireEv);
    }

    // ═════════════ 4. DETECT NEW C1 / C2 PAIR ═════════════
    if (confirmed) {
      // LEVEL LIFECYCLE: while a trade is running the engine does NOT arm
      // new levels — the board stays empty until TP/SL, then scanning
      // re-activates ("…until a running trade hit TP or SL, then scanning
      // activates"). prevBar tracking continues so detection resumes
      // seamlessly on the close.
      const armingLocked = cfg.levelPersist && s.trade !== null;
      const p1 = s.prevBar;
      if (p1 && atrOK && !armingLocked) {
        const c1Bull = p1.close > p1.open;
        const c1Bear = p1.close < p1.open;
        const c2Bull = bar.close > bar.open;
        const c2Bear = bar.close < bar.open;
        const bodiesOK =
          Math.abs(p1.close - p1.open) >= cfg.bodyMinATR * a && Math.abs(bar.close - bar.open) >= cfg.bodyMinATR * a;
        const gapOK = Math.abs(p1.close - bar.open) <= cfg.pairTolATR * a;

        let newSide: Side | 0 = 0;
        if (c1Bull && c2Bear) newSide = -1;
        else if (c1Bear && c2Bull) newSide = 1;

        if (newSide !== 0 && bodiesOK && gapOK) {
          const nTop = Math.max(p1.close, bar.open);
          const nBot = Math.min(p1.close, bar.open);
          const nMid = (nTop + nBot) / 2;
          const nExt = newSide === -1 ? Math.max(bar.high, p1.high) : Math.min(bar.low, p1.low);
          const sep = cfg.minSepATR * a;
          let keepNew = true;

          for (const O of s.levels) {
            if (O.side === newSide && Math.abs((O.top + O.bot) / 2 - nMid) < sep) {
              const newFarther = newSide === -1 ? nTop > O.top : nBot < O.bot;
              if (!newFarther) {
                keepNew = false;
                break;
              }
            }
          }

          if (!keepNew) {
            s.stats.tooClose += 1;
          } else {
            // new pair is the farther one → drop the closer, crowded levels
            for (let j = s.levels.length - 1; j >= 0; j--) {
              const O = s.levels[j];
              if (O.side === newSide && Math.abs((O.top + O.bot) / 2 - nMid) < sep) {
                this.markLevel(O.id, "burned", bar.time);
                s.levels.splice(j, 1);
                s.stats.tooClose += 1;
              }
            }
            // cap fresh levels per side: LEGACY burns the oldest armed
            // level; the new lifecycle KEEPS armed levels ("a level which
            // is never touched or broken remains until it is touched and
            // fired") and instead REJECTS the new formation while the side
            // is at cap.
            let cnt = 0;
            for (const O of s.levels) if (O.side === newSide) cnt += 1;
            if (cnt >= cfg.maxLevels) {
              if (cfg.levelPersist) {
                s.stats.tooClose += 1;
                keepNew = false;
              } else {
                for (let j = 0; j < s.levels.length; j++) {
                  if (s.levels[j].side === newSide) {
                    this.markLevel(s.levels[j].id, "burned", bar.time);
                    s.levels.splice(j, 1);
                    break;
                  }
                }
              }
            }
            const id = s.nextId++;
            const lvl: InternalLevel = {
              id,
              side: newSide as Side,
              top: nTop,
              bot: nBot,
              ext: nExt,
              c1Close: p1.close,
              c2Open: bar.open,
              b1Time: p1.time,
              b2Time: bar.time,
              b1Index: curIndex - 1,
              broke: false,
              brokeIndex: null,
            };
            s.levels.push(lvl);
            s.drawings.push({
              id,
              side: lvl.side,
              top: lvl.top,
              bot: lvl.bot,
              ext: lvl.ext,
              c1Close: lvl.c1Close,
              c2Open: lvl.c2Open,
              b1Time: lvl.b1Time,
              b2Time: lvl.b2Time,
              b1Index: lvl.b1Index,
              endTime: null,
              state: "fresh",
            });
            if (s.drawings.length > 30) s.drawings.splice(0, s.drawings.length - 30);

            // ── FOCUS CURRENT SIGNAL (per side · LEGACY ONLY) ── with the
            // new level lifecycle the armed levels REMAIN until touched and
            // fired, so focusCurrent's replace-older-levels culling only
            // applies when levelPersist is OFF.
            if (cfg.focusCurrent && !cfg.levelPersist) {
              for (let j = s.levels.length - 1; j >= 0; j--) {
                const O = s.levels[j];
                if (O.id === lvl.id || O.side !== lvl.side) continue;
                this.markLevel(O.id, "burned", bar.time);
                s.levels.splice(j, 1);
                ev.push({ type: "expired", id: O.id });
              }
            }
            ev.push({ type: "level", id, side: lvl.side, top: lvl.top, bot: lvl.bot, ext: lvl.ext });
          }
        }
      }
      s.prevBar = { ...bar };
      s.barIndex = curIndex;
      s.lastBarTime = bar.time;
    }

    return ev;
  }

  /**
   * Operator SL/TP amendment on the open trade (Quick Actions → MODIFY
   * SL/TP). Validation against the live price happens in the caller. The
   * ORIGINAL risk (origSl) is kept so R-based management and sizing stay
   * anchored to the trade as it fired. Returns false when flat.
   */
  amendStops(sl: number | null, tp: number | null): boolean {
    const t = this.state.trade;
    if (!t) return false;
    if (t.origSl === undefined) t.origSl = t.sl;
    if (sl !== null) t.sl = sl;
    if (tp !== null) t.tp = tp;
    return true;
  }

  /** Manually close the open trade at `price` (market close). Returns the close event. */
  forceClose(price: number, time: number): EngineEvent[] {
    const s = this.state;
    const t = s.trade;
    if (!t) return [];
    const exitPips = ((price - t.entry) * t.dir) / this.pip;
    const frac = t.partialDone ? (t.partialFrac ?? 0) : 0;
    const pips = frac * (t.partialPips ?? 0) + (1 - frac) * exitPips;
    const win = pips >= 0;
    if (win) {
      s.stats.wins += 1;
      s.stats.sumTP += Math.abs(pips);
      s.stats.lastResult = { text: `CLOSED  +${Math.abs(pips).toFixed(1)} pips`, kind: "win" };
    } else {
      s.stats.losses += 1;
      s.stats.sumSL += Math.abs(pips);
      s.stats.lastResult = { text: `CLOSED  −${Math.abs(pips).toFixed(1)} pips`, kind: "loss" };
    }
    this.pushLog({ time, kind: win ? "win" : "loss", dir: t.dir, pips: Math.abs(pips), entry: t.entry });
    const ev: EngineEvent = {
      type: win ? "win" : "loss",
      pips: Math.abs(pips),
      entry: t.entry,
      sl: t.sl,
      tp: t.tp,
      time,
      message: `HALO 3EL MANUAL CLOSE ${win ? "+" : "−"}${Math.abs(pips).toFixed(1)} pips`,
      reason: "manual",
      exitPx: price,
    };
    s.trade = null;
    return [ev];
  }

  snapshot(): EngineSnapshot {
    const s = this.state;
    const fresh: LevelSnapshot[] = s.levels.map((L) => ({
      id: L.id,
      side: L.side,
      top: L.top,
      bot: L.bot,
      ext: L.ext,
      c1Close: L.c1Close,
      c2Open: L.c2Open,
      b1Time: L.b1Time,
      b2Time: L.b2Time,
      b1Index: L.b1Index,
      endTime: null,
      state: "fresh",
    }));
    return {
      barIndex: s.barIndex,
      lastBarTime: s.lastBarTime,
      atr: s.atr,
      levels: fresh,
      drawings: s.drawings,
      log: s.log,
      trade: s.trade,
      stats: s.stats,
    };
  }
}
