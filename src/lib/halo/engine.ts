// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL ENGINE · TypeScript port of the PineScript v5 logic
//
//  SELL (resistance):  C1 bullish  →  C2 bearish
//  BUY  (support)   :  C1 bearish  →  C2 bullish
//  • C1 body close + C2 body open mark the equal level.
//  • Level stays FRESH (untouched) until candle 3.
//  • C3 wicks THROUGH the line, comes back, body sits on the line
//    (equal level) while leaving a wick → SELL at resistance / BUY at support.
//  • Same-bar SL+TP counts as SL (conservative, as 2CRB).
//  • Pairs forming too close: only the farther one is kept.
//  • focusCurrent (default ON): a new C1/C2 pair REPLACES every older fresh
//    level — the EA follows only the CURRENT signal, never stale ones.
// ════════════════════════════════════════════════════════════════════════

import {
  Candle,
  EngineEvent,
  EngineSnapshot,
  FireEvent,
  HaloConfig,
  LevelSnapshot,
  LogEntry,
  Side,
  Stats,
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
      lastResult: { text: "—", kind: "none" },
    },
  };
}

export class HaloEngine {
  cfg: HaloConfig;
  pt: number; // syminfo.mintick
  state: EngineState;

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
   * Process one bar. `confirmed = barstate.isconfirmed`.
   * Section order matches the PineScript exactly:
   *   1. manage open trade  2. C3 check  3. fire  4. detect new C1/C2
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
    const minWk = cfg.minWickATR * a;
    const bodyTop = Math.max(bar.open, bar.close);
    const bodyBot = Math.min(bar.open, bar.close);
    const isInstant = cfg.sigMode === "instant";
    const canFire = confirmed || isInstant;

    // ═════════════ 1. MANAGE OPEN TRADE ═════════════
    if (s.trade && bar.time > s.trade.entryTime) {
      const t = s.trade;
      const hitSL = t.dir === -1 ? bar.high >= t.sl : bar.low <= t.sl;
      const hitTP = t.dir === -1 ? bar.low <= t.tp : bar.high >= t.tp;
      if (hitSL || hitTP) {
        if (hitSL) {
          // same-bar SL + TP counts as SL (conservative)
          const p = Math.abs(t.entry - t.sl) / this.pip;
          s.stats.losses += 1;
          s.stats.sumSL += p;
          s.stats.lastResult = { text: `SL HIT  −${p.toFixed(1)} pips`, kind: "loss" };
          this.pushLog({ time: bar.time, kind: "loss", dir: t.dir, pips: p, entry: t.entry });
          ev.push({ type: "loss", pips: p, entry: t.entry, sl: t.sl, tp: t.tp, time: bar.time, message: `HALO 3EL SL HIT −${p.toFixed(1)} pips` });
        } else {
          const p = Math.abs(t.tp - t.entry) / this.pip;
          s.stats.wins += 1;
          s.stats.sumTP += p;
          s.stats.lastResult = { text: `TP HIT  +${p.toFixed(1)} pips`, kind: "win" };
          this.pushLog({ time: bar.time, kind: "win", dir: t.dir, pips: p, entry: t.entry });
          ev.push({ type: "win", pips: p, entry: t.entry, sl: t.sl, tp: t.tp, time: bar.time, message: `HALO 3EL TP HIT +${p.toFixed(1)} pips` });
        }
        s.trade = null;
      }
    }

    // ═════════════ 2. CANDLE 3 CHECK ON FRESH LEVELS ═════════════
    let fireDir: Side | 0 = 0;
    let fireEntry = 0;
    let fireExt = 0;
    let fireL: InternalLevel | null = null;

    for (let i = s.levels.length - 1; i >= 0; i--) {
      const L = s.levels[i];
      let remove = false;
      let isFire = false;

      if (curIndex - L.b1Index > cfg.expiryBars) {
        remove = true;
        this.markLevel(L.id, "burned", bar.time);
        ev.push({ type: "expired", id: L.id });
      } else {
        const touched = L.side === -1 ? bar.high >= L.bot : bar.low <= L.top;
        if (touched && atrOK) {
          const broke = L.side === -1 ? bar.high >= L.top + brk : bar.low <= L.bot - brk;
          const edge = L.side === -1 ? bodyTop : bodyBot;
          const eqLvl = edge >= L.bot - eqTol && edge <= L.top + eqTol;
          const back = L.side === -1 ? bar.close <= L.top + eqTol : bar.close >= L.bot - eqTol;
          const wickOK = L.side === -1 ? bar.high - bodyTop >= minWk : bodyBot - bar.low >= minWk;
          const inside = !cfg.wickInside || (L.side === -1 ? bar.high < L.ext : bar.low > L.ext);
          const ok = broke && eqLvl && back && wickOK && inside;
          if (ok && canFire) {
            if (!s.trade && fireDir === 0) {
              fireDir = L.side;
              fireEntry = L.side === -1 ? L.top : L.bot;
              fireExt = L.side === -1 ? bar.high : bar.low;
              fireL = L;
              isFire = true;
            } else {
              s.stats.skipped += 1;
              ev.push({ type: "skipped" });
            }
            remove = true;
          } else if (confirmed) {
            // touched but no valid C3 → no longer fresh
            s.stats.burned += 1;
            ev.push({ type: "burned" });
            remove = true;
          }
        }
      }

      if (remove) {
        this.markLevel(L.id, isFire ? "fired" : "burned", bar.time);
        s.levels.splice(i, 1);
      }
    }

    // ═════════════ 3. FIRE TRADE ═════════════
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
        slModeLabel: cfg.slMode === "points" ? "Fixed points" : cfg.slMode === "atr" ? "ATR" : "C3 wick + buffer",
      };
      s.firedLvlId = fireL.id;
      const msg = `HALO 3EL ${dir === -1 ? "SELL" : "BUY"} · Entry ${fireEntry} · SL ${sl} · TP ${tp}`;
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
      };
      ev.push(fireEv);
    }

    // ═════════════ 4. DETECT NEW C1 / C2 PAIR ═════════════
    if (confirmed) {
      const p1 = s.prevBar;
      if (p1 && atrOK) {
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
            // cap fresh levels per side (drop oldest)
            let cnt = 0;
            for (const O of s.levels) if (O.side === newSide) cnt += 1;
            if (cnt >= cfg.maxLevels) {
              for (let j = 0; j < s.levels.length; j++) {
                if (s.levels[j].side === newSide) {
                  this.markLevel(s.levels[j].id, "burned", bar.time);
                  s.levels.splice(j, 1);
                  break;
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

            // ── FOCUS CURRENT SIGNAL ── the new pair is now THE signal:
            // every older fresh level is discarded (burned) so the EA
            // never acts on stale levels and the chart stays clean.
            if (cfg.focusCurrent) {
              for (let j = s.levels.length - 1; j >= 0; j--) {
                const O = s.levels[j];
                if (O.id === lvl.id) continue;
                this.markLevel(O.id, "burned", bar.time);
                s.levels.splice(j, 1);
                ev.push({ type: "expired", id: O.id });
              }
            }
            ev.push({ type: "level", id, side: lvl.side });
          }
        }
      }
      s.prevBar = { ...bar };
      s.barIndex = curIndex;
      s.lastBarTime = bar.time;
    }

    return ev;
  }

  /** Manually close the open trade at `price` (market close). Returns the close event. */
  forceClose(price: number, time: number): EngineEvent[] {
    const s = this.state;
    const t = s.trade;
    if (!t) return [];
    const pips = ((price - t.entry) * t.dir) / this.pip;
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
