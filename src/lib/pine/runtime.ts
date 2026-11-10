// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script RUNTIME (v4 / v5 / v6)
//  Bar-by-bar evaluator with TradingView series semantics:
//    • every variable is a series Box (per-bar slots, `x[n]` history)
//    • `var` / `varip` boxes carry their value across bars
//    • every user-function CALL SITE owns its own series context, so
//      `f(x) => ta.ema(x, 10)` called twice keeps two independent EMAs
//      (exactly like TradingView)
//    • `expr[n]` works on ANY expression (calls, fields, arithmetic)
//    • request.security() on a higher timeframe runs the WHOLE script on
//      that timeframe's candles (built from the chart feed), returning the
//      value of the last confirmed higher-timeframe bar — TradingView's
//      non-repainting lookahead_off behaviour
//    • strategy.entry/exit/close are queued per bar and filled with Pine's
//      default model (next bar open unless process_orders_on_close=true);
//      strategy.exit stop/limit/profit/loss are checked intrabar
//      (conservative: when both fall inside one bar the STOP wins)
// ════════════════════════════════════════════════════════════════════════

import type { Candle } from "@/lib/halo/types";
import { parsePine, type Arg, type Call, type Expr, type FuncDecl, type Program, type Stmt, type TypeDecl, type EnumDecl } from "./parser";
import { PINE_BAR_BUDGET_MS } from "./limits";
import {
  PineError, applyBin, addVal, subVal, mulVal, divVal, modVal, truthy, eqVal, isNum, isDraw, isUdt, isMap, isMatrix,
  bucketStart, bucketEnd, haloTfSec, tvTfSec, normalizeColor,
  type PValue, type PDraw, type PUdt, type PEnum,
} from "./values";
import { callBuiltin, builtinVar, constantValue, computeTaVars, CAST_FUNCS, V4_ALIASES } from "./builtins";

export { PineError, normalizeColor };
export type { PValue, PDraw };

/** A Pine series variable — per-bar value slots (trimmed for long live runs). */
export class Box {
  vals: PValue[] = [];
  off = 0;
  constructor(
    public carry: boolean,
    public init: PValue = null
  ) {}
  private scanBack(i: number): PValue {
    for (let j = Math.min(i, this.vals.length - 1); j >= 0; j--) {
      const v = this.vals[j];
      if (v !== undefined) return v;
    }
    return this.init;
  }
  at(bar: number): PValue {
    const i = bar - this.off;
    if (this.carry) return this.scanBack(i);
    const v = this.vals[i];
    return v === undefined ? (this.vals.length === 0 ? this.init : null) : v;
  }
  hist(bar: number, n: number): PValue {
    if (n < 0 || bar - n < 0) return null;
    const i = bar - n - this.off;
    if (i < 0) return null;
    if (this.carry) return this.scanBack(i);
    const v = this.vals[i];
    return v === undefined ? null : v;
  }
  write(bar: number, v: PValue): void {
    if (this.vals.length === 0 && this.off === 0 && bar > 0) this.off = bar; // dense storage from the first write
    const i = bar - this.off;
    if (i < 0) return; // never rewrite history before the first slot
    if (i > this.vals.length) {
      // keep the array dense (holes would push V8 into slow dictionary mode)
      const fill: PValue | undefined = this.carry ? this.at(bar - 1) : undefined;
      while (this.vals.length < i) this.vals.push(fill as PValue);
    }
    this.vals[i] = v;
    if (this.vals.length > 12000) {
      // keep the last 6000 bars of history (Pine's max_bars_back is 5000)
      const keepFrom = this.vals.length - 6000;
      this.vals = this.vals.slice(keepFrom);
      this.off += keepFrom;
    }
  }
}

/** lexical scope */
class Env {
  vars = new Map<string, Box>();
  constructor(public parent: Env | null) {}
  get(name: string): Box | null {
    const own = this.vars.get(name);
    if (own) return own;
    let e = this.parent;
    while (e) {
      const b = e.vars.get(name);
      if (b) return b;
      e = e.parent;
    }
    return null;
  }
}

/** series context: per call-path state (one per user-function call site) */
export class Cx {
  st = new Map<number, unknown>();
  kids = new Map<number, Cx>();
}

// ── public result types (consumed by preview / backtest / pine-bot) ──────
export interface PlotMeta {
  key: string;
  title: string;
  style: string;
  color: string;
  lineWidth: number;
  editableColor: boolean;
}
export interface PlotShapeMeta {
  key: string;
  title: string;
  style: string;
  color: string;
  location: string;
  text: string;
}
export interface HLineMeta {
  key?: string;
  price: number;
  color: string;
  style: string;
  title: string;
}
export interface PlanEntry {
  id: string;
  dir: 1 | -1;
  limit?: number | null;
  stop?: number | null;
}
export interface PlanExit {
  orderId: string;
  fromEntry: string;
  stop: number | null;
  limit: number | null;
}
export interface SimTrade {
  dir: 1 | -1;
  entry: number;
  entryTime: number;
  entryBar: number;
  exit: number | null;
  exitTime: number | null;
  sl: number | null;
  tp: number | null;
  reason: "sl" | "tp" | "close" | "reverse" | null;
  entryId: string;
  exitBar?: number | null;
}
export interface RuntimeOpts {
  mintick: number;
  ticker: string;
  tf: string;
  pipMult: number;
  /** exchange timezone (IANA); defaults from the symbol class */
  timezone?: string;
  /** input overrides keyed by variable name or input title */
  inputs?: Record<string, PValue>;
}
export interface ExitOrder {
  stop: number | null;
  limit: number | null;
  profitTicks?: number | null;
  lossTicks?: number | null;
}

interface SecFeed {
  tfSec: number;
  rt: PineRuntime;
  agg: Candle | null;
  aggStart: number;
  done: boolean;
  completedAt: number;
}

const FLOW_BREAK = 1;
const FLOW_CONTINUE = 2;
const MAX_CALL_DEPTH = 200;

function defaultTimezone(ticker: string): string {
  const t = ticker.toUpperCase();
  if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|LTC)/.test(t) || /USDT$/.test(t)) return "Etc/UTC";
  if (/^(V\d|R_|1HZ|BOOM|CRASH|STEP|JD|R\d)/.test(t)) return "Etc/UTC";
  return "America/New_York";
}

// ── the runtime ──────────────────────────────────────────────────────────
export class PineRuntime {
  program: Program;
  src: string;
  version: number;
  bar = -1;
  opts: RuntimeOpts;
  tfSec: number;
  timezone: string;
  isSecondary = false;
  /** index of the final bar when the whole series is known up front (preview /
   *  backtest) — makes barstate.islast and last_bar_index exact */
  knownLastBar: number | null = null;

  // global scope + series contexts
  globalEnv = new Env(null);
  rootCx = new Cx();
  cx: Cx = this.rootCx;
  funcs = new Map<string, FuncDecl>();
  methods = new Map<string, FuncDecl[]>();
  types = new Map<string, TypeDecl>();
  enums = new Map<string, Map<string, PEnum>>();
  imports = new Map<string, string>();
  private flow = 0;
  private callDepth = 0;

  // built-in series
  bOpen = new Box(false);
  bHigh = new Box(false);
  bLow = new Box(false);
  bClose = new Box(false);
  bVolume = new Box(false);
  bTime = new Box(false);
  bTimeClose = new Box(false);
  bHl2 = new Box(false);
  bHlc3 = new Box(false);
  bOhlc4 = new Box(false);
  bHlcc4 = new Box(false);
  bPosSize = new Box(false);
  bPosAvg = new Box(false);
  bBarIdx = new Box(false);
  taVars = new Map<string, Box>();
  candles: Candle[] = [];

  // strategy plan (this bar's strategy calls)
  plan = { entries: [] as PlanEntry[], exits: [] as PlanExit[], closes: [] as string[], closeAll: false, cancels: [] as string[] };
  private pendingEntries: PlanEntry[] = [];
  private pendingCloses: string[] = [];
  private pendingCloseAll = false;
  /** resting limit/stop entry orders (strategy.entry with limit= / stop=) */
  restingEntries = new Map<string, PlanEntry>();
  exitOrders = new Map<string, ExitOrder>();
  simPos: SimTrade | null = null;
  simTrades: SimTrade[] = [];
  processOrdersOnClose = false;
  pyramiding = 0;
  initialCapital = 1000000;
  externalPos: { dir: 1 | -1 | 0; entry: number } | null = null;

  // outputs
  plots = new Map<string, { meta: PlotMeta; values: (number | null)[]; colors: (string | null)[] }>();
  shapes = new Map<string, { meta: PlotShapeMeta; marks: { bar: number; up: boolean; text: string; color: string }[] }>();
  hlines: HLineMeta[] = [];
  /** bgcolor() per bar (last call on a bar wins) */
  bgColors: (string | null)[] = [];
  /** fill() between two plots / hlines, colour per bar */
  fills = new Map<number, { a: string; b: string; colors: (string | null)[] }>();
  private hlineSites = new Set<number>();
  /** true when this hline() call site was already registered (hlines are static) */
  hlineSitesHas(id: number): boolean {
    if (this.hlineSites.has(id)) return true;
    this.hlineSites.add(id);
    return false;
  }
  barAlerts: string[] = [];
  inputs: { id: string; kind: string; title: string; defval: PValue; minval?: number; maxval?: number; step?: number; options?: PValue[]; group?: string }[] = [];
  inputSites = new Map<number, PValue>();
  capturedBool = new Map<string, boolean[]>();
  pendingInputVar: string | null = null;
  drawingsCreated = 0;
  drawLists: Record<string, PDraw[]> = { line: [], label: [], box: [], table: [], linefill: [], polyline: [] };
  drawLimits: Record<string, number> = { line: 50, label: 50, box: 50, polyline: 50, table: 1000, linefill: 500 };
  logs: string[] = [];

  // request.security
  private feeds = new Map<number, SecFeed>();
  secRecords = new Map<number, { v: PValue; la?: PValue }>();

  private deadline = 0;
  private stmtTick = 0;
  /** per-bar wall-clock budget (the compiler's dry run uses a shorter one) */
  budgetMs = PINE_BAR_BUDGET_MS;

  constructor(src: string, opts: RuntimeOpts, internal?: { program: Program; secondaryTfSec: number }) {
    this.opts = opts;
    this.src = src;
    if (internal) {
      this.program = internal.program;
      this.isSecondary = true;
      this.tfSec = internal.secondaryTfSec;
    } else {
      try {
        this.program = parsePine(src);
      } catch (e) {
        if (e instanceof PineError) throw e;
        const pe = e as { message: string; line?: number; col?: number };
        throw new PineError(pe.message, pe.line ?? 0, pe.col ?? 0);
      }
      this.tfSec = haloTfSec(opts.tf);
    }
    this.version = this.program.version;
    this.timezone = opts.timezone ?? defaultTimezone(opts.ticker || "");
    this.hoist(this.program.body);
    if (this.program.decl) this.readDecl(this.program.decl);
  }

  /** functions, methods, types, enums and imports are visible script-wide */
  private hoist(body: Stmt[]): void {
    for (const st of body) {
      if (st.k === "func") {
        if (st.isMethod) {
          const list = this.methods.get(st.name) ?? [];
          list.push(st);
          this.methods.set(st.name, list);
        } else this.funcs.set(st.name, st);
      } else if (st.k === "typeDecl") this.types.set(st.name, st);
      else if (st.k === "enumDecl") this.registerEnum(st);
      else if (st.k === "import") this.imports.set(st.alias, st.path);
    }
  }
  private registerEnum(st: EnumDecl): void {
    const m = new Map<string, PEnum>();
    for (const f of st.fields) m.set(f.name, { __e: st.name, k: f.name, title: f.title ?? f.name });
    this.enums.set(st.name, m);
  }

  private readDecl(decl: Call): void {
    for (const a of decl.args) {
      const lit = a.e.k === "num" ? a.e.v : a.e.k === "bool" ? a.e.v : null;
      if (a.name === "process_orders_on_close") this.processOrdersOnClose = lit === true;
      if (a.name === "pyramiding" && typeof lit === "number") this.pyramiding = lit;
      if (a.name === "initial_capital" && typeof lit === "number") this.initialCapital = lit;
      if (a.name === "max_lines_count" && typeof lit === "number") this.drawLimits.line = lit;
      if (a.name === "max_labels_count" && typeof lit === "number") this.drawLimits.label = lit;
      if (a.name === "max_boxes_count" && typeof lit === "number") this.drawLimits.box = lit;
      if (a.name === "max_polylines_count" && typeof lit === "number") this.drawLimits.polyline = lit;
    }
  }

  setState(key: string, make: () => unknown): unknown {
    // legacy string-keyed helper state (kept for API compatibility)
    const k = hashKey(key);
    let s = this.cx.st.get(k);
    if (s === undefined) {
      s = make();
      this.cx.st.set(k, s);
    }
    return s;
  }
  /** per-call-site helper state in the CURRENT series context */
  siteState<T>(id: number, make: () => T): T {
    let s = this.cx.st.get(id) as T | undefined;
    if (s === undefined) {
      s = make();
      this.cx.st.set(id, s);
    }
    return s;
  }

  barTime(): number {
    const t = this.bTime.at(this.bar);
    return isNum(t) ? t : Date.now();
  }

  // ── bar processing ────────────────────────────────────────────────────
  processBar(c: Candle, _opts?: { confirmed?: boolean }): void {
    this.bar++;
    this.deadline = Date.now() + this.budgetMs;
    this.stmtTick = 0;
    this.barAlerts = [];
    this.plan = { entries: [], exits: [], closes: [], closeAll: false, cancels: [] };
    const b = this.bar;
    const vol = c.volume ?? 0;
    this.candles.push(c);
    if (this.candles.length > 12000) this.candles.splice(0, 6000);
    this.bOpen.write(b, c.open);
    this.bHigh.write(b, c.high);
    this.bLow.write(b, c.low);
    this.bClose.write(b, c.close);
    this.bVolume.write(b, vol);
    this.bTime.write(b, c.time);
    this.bTimeClose.write(b, c.time + this.tfSec * 1000);
    this.bHl2.write(b, (c.high + c.low) / 2);
    this.bHlc3.write(b, (c.high + c.low + c.close) / 3);
    this.bOhlc4.write(b, (c.open + c.high + c.low + c.close) / 4);
    this.bHlcc4.write(b, (c.high + c.low + 2 * c.close) / 4);
    this.bBarIdx.write(b, b);
    this.cx = this.rootCx;
    computeTaVars(this);

    if (!this.isSecondary) {
      for (const f of this.feeds.values()) this.feedCandle(f, c);
      const pos = this.currentPos();
      this.bPosSize.write(b, pos.dir);
      this.bPosAvg.write(b, pos.dir === 0 ? null : pos.entry);
      // 1 · pending orders from the previous bar fill at THIS bar's open
      this.applyPending(c.open);
      this.checkResting(c);
      // 2 · intrabar SL/TP of the open position (conservative: stop first)
      if (!this.processOrdersOnClose) this.checkStops(c);
      const pos2 = this.currentPos();
      this.bPosSize.write(b, pos2.dir);
      this.bPosAvg.write(b, pos2.dir === 0 ? null : pos2.entry);
    } else {
      this.bPosSize.write(b, 0);
      this.bPosAvg.write(b, null);
    }

    // 3 · run the script for this bar
    this.cx = this.rootCx;
    this.flow = 0;
    this.callDepth = 0;
    this.execBody(this.program.body, this.globalEnv);
    this.flow = 0;

    // manual-signal capture (global variables, one slot per bar)
    for (const [name, arr] of this.capturedBool) {
      const box = this.globalEnv.vars.get(name);
      const v = box ? box.at(b) : null;
      arr[b] = v === true;
    }
    if (this.isSecondary) return;

    // 4 · update the open position's exits from this bar's strategy.exit calls
    this.refreshExits();
    // 5 · queue this bar's plan for execution (default: NEXT bar open)
    this.pendingEntries = this.plan.entries.filter((e) => {
      if (e.limit != null || e.stop != null) {
        this.restingEntries.set(e.id, e);
        return false;
      }
      return true;
    });
    this.pendingCloses = this.plan.closes;
    this.pendingCloseAll = this.plan.closeAll;
    // 6 · process_orders_on_close scripts fill at this bar's close
    if (this.processOrdersOnClose) {
      this.applyPending(c.close);
      this.refreshExits();
      this.checkStops(c);
    }
  }

  // ── strategy simulation ───────────────────────────────────────────────
  currentPos(): { dir: 1 | -1 | 0; entry: number } {
    if (this.externalPos) return this.externalPos;
    if (this.simPos) return { dir: this.simPos.dir, entry: this.simPos.entry };
    return { dir: 0, entry: 0 };
  }

  private exitFor(id: string): ExitOrder | null {
    return this.exitOrders.get(id) ?? this.exitOrders.get("") ?? null;
  }
  private levels(ex: ExitOrder | null, dir: 1 | -1, entry: number): { sl: number | null; tp: number | null } {
    if (!ex) return { sl: null, tp: null };
    const mt = this.opts.mintick || 0.01;
    let sl = ex.stop;
    let tp = ex.limit;
    if (sl === null && isNum(ex.lossTicks)) sl = entry - dir * ex.lossTicks * mt;
    if (tp === null && isNum(ex.profitTicks)) tp = entry + dir * ex.profitTicks * mt;
    return { sl, tp };
  }

  private openSim(dir: 1 | -1, id: string, px: number): void {
    const { sl, tp } = this.levels(this.exitFor(id), dir, px);
    this.simPos = { dir, entry: px, entryTime: this.barTime(), entryBar: this.bar, exit: null, exitTime: null, sl, tp, reason: null, entryId: id };
  }

  private applyPending(px: number): void {
    if (this.pendingCloseAll || this.pendingCloses.length > 0) {
      const p = this.simPos;
      if (p && (this.pendingCloseAll || this.pendingCloses.some((id) => id === "" || id === p.entryId))) this.simClose(px, "close");
    }
    for (const en of this.pendingEntries) {
      const pos = this.currentPos();
      if (pos.dir === en.dir) {
        if (this.pyramiding === 0) continue; // default pyramiding=0 → no adds
      } else if (pos.dir !== 0) {
        this.simClose(px, "reverse");
      }
      this.openSim(en.dir, en.id, px);
      break; // netting: one position at a time
    }
    this.pendingEntries = [];
    this.pendingCloses = [];
    this.pendingCloseAll = false;
  }

  private checkResting(c: Candle): void {
    for (const [id, en] of this.restingEntries) {
      const pos = this.currentPos();
      if (pos.dir === en.dir && this.pyramiding === 0) continue;
      let fill: number | null = null;
      if (en.limit != null) {
        if (en.dir === 1 && c.low <= en.limit) fill = Math.min(c.open, en.limit);
        if (en.dir === -1 && c.high >= en.limit) fill = Math.max(c.open, en.limit);
      } else if (en.stop != null) {
        if (en.dir === 1 && c.high >= en.stop) fill = Math.max(c.open, en.stop);
        if (en.dir === -1 && c.low <= en.stop) fill = Math.min(c.open, en.stop);
      }
      if (fill !== null) {
        if (pos.dir !== 0 && pos.dir !== en.dir) this.simClose(fill, "reverse");
        this.openSim(en.dir, id, fill);
        this.restingEntries.delete(id);
        break;
      }
    }
  }

  private refreshExits(): void {
    const p = this.simPos;
    if (!p) return;
    const ex = this.exitOrders.get(p.entryId) ?? this.exitOrders.get("");
    if (!ex) return;
    const { sl, tp } = this.levels(ex, p.dir, p.entry);
    if (sl !== null) p.sl = sl;
    if (tp !== null) p.tp = tp;
  }

  private simClose(px: number, reason: SimTrade["reason"]): void {
    if (!this.simPos) return;
    this.simPos.exit = px;
    this.simPos.exitTime = this.barTime();
    this.simPos.exitBar = this.bar;
    this.simPos.reason = reason;
    this.exitOrders.delete(this.simPos.entryId);
    this.simTrades.push(this.simPos);
    this.simPos = null;
  }

  private checkStops(c: Candle): void {
    const p = this.simPos;
    if (!p) return;
    const isLong = p.dir === 1;
    let hit: "sl" | "tp" | null = null;
    let px = 0;
    if (p.sl !== null && ((isLong && c.low <= p.sl) || (!isLong && c.high >= p.sl))) {
      hit = "sl";
      px = isLong ? Math.min(c.open, p.sl) : Math.max(c.open, p.sl);
    } else if (p.tp !== null && ((isLong && c.high >= p.tp) || (!isLong && c.low <= p.tp))) {
      hit = "tp";
      px = isLong ? Math.max(c.open, p.tp) : Math.min(c.open, p.tp);
    }
    if (hit) this.simClose(px, hit);
  }

  // ── request.security (higher-timeframe context) ───────────────────────
  private feedCandle(f: SecFeed, c: Candle): void {
    const b = bucketStart(c.time, f.tfSec);
    if (f.agg && b !== f.aggStart && !f.done) {
      f.rt.processBar(f.agg);
      f.done = true;
      f.completedAt = this.bar;
    }
    if (!f.agg || b !== f.aggStart) {
      f.agg = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
      f.aggStart = b;
      f.done = false;
    } else {
      f.agg.high = Math.max(f.agg.high, c.high);
      f.agg.low = Math.min(f.agg.low, c.low);
      f.agg.close = c.close;
      f.agg.volume = (f.agg.volume ?? 0) + (c.volume ?? 0);
    }
    if (!f.done && c.time + this.tfSec * 1000 >= bucketEnd(b, f.tfSec)) {
      f.rt.processBar(f.agg);
      f.done = true;
      f.completedAt = this.bar;
    }
  }

  private makeFeed(tfSec: number): SecFeed {
    const rt = new PineRuntime(this.src, { ...this.opts, tf: `${Math.round(tfSec / 60)}m` }, { program: this.program, secondaryTfSec: tfSec });
    rt.timezone = this.timezone;
    const f: SecFeed = { tfSec, rt, agg: null, aggStart: -1, done: false, completedAt: -1 };
    this.feeds.set(tfSec, f);
    // backfill from the chart history (including the current bar)
    const saveBar = this.bar;
    const hist = this.candles;
    const startBar = saveBar - (hist.length - 1);
    for (let i = 0; i < hist.length; i++) {
      this.bar = startBar + i;
      this.feedCandle(f, hist[i]);
    }
    this.bar = saveBar;
    return f;
  }

  private security(e: Call, env: Env): PValue {
    const sig = ["symbol", "timeframe", "expression", "gaps", "lookahead", "ignore_invalid_symbol", "currency", "calc_bars_count"];
    const argExpr = (i: number): Expr | null => {
      const named = e.args.find((a) => a.name === sig[i]);
      if (named) return named.e;
      const posArgs = e.args.filter((a) => !a.name);
      return posArgs[i]?.e ?? null;
    };
    const exprNode = argExpr(2);
    if (!exprNode) return null;
    const tfV = argExpr(1) ? this.evalExpr(argExpr(1)!, env) : "";
    const gapsV = argExpr(3) ? this.evalExpr(argExpr(3)!, env) : null;
    const laV = argExpr(4) ? this.evalExpr(argExpr(4)!, env) : null;
    const tfS = tvTfSec(typeof tfV === "string" ? tfV : "") ?? this.tfSec;

    if (this.isSecondary) {
      if (tfS !== this.tfSec) return null; // nested different timeframe — not needed by the chart
      const v = this.evalExpr(exprNode, env);
      this.secRecords.set(e.id, { v, la: this.lookaheadValue(exprNode, env) });
      return v;
    }
    if (tfS <= this.tfSec) return this.evalExpr(exprNode, env); // same / lower timeframe → chart context
    if (!this.feeds.has(tfS) && this.feeds.size >= 8) {
      throw new PineError("request.security: more than 8 different timeframes requested.", e.line, e.col);
    }
    const f = this.feeds.get(tfS) ?? this.makeFeed(tfS);
    const rec = f.rt.secRecords.get(e.id);
    const completedNow = f.completedAt === this.bar;
    const lookOn = laV === "lookahead_on" || laV === true;
    const gapsOn = gapsV === "gaps_on" || gapsV === true;
    if (gapsOn && !completedNow) return null;
    if (!rec) return null;
    if (lookOn && rec.la !== undefined && !completedNow) return rec.la;
    return rec.v;
  }

  /** for `x[n]` / `[a[1], b[1]]` security expressions: the value one HTF bar later (lookahead_on) */
  private lookaheadValue(e: Expr, env: Env): PValue | undefined {
    const one = (x: Expr): PValue | undefined => {
      if (x.k !== "hist" || x.n.k !== "num" || x.n.v < 1) return undefined;
      const box = x.e.k === "ident" ? env.get(x.e.name) ?? this.seriesBox(x.e.name) : null;
      return box ? box.hist(this.bar, x.n.v - 1) : undefined;
    };
    if (e.k === "arrlit") {
      const out: PValue[] = [];
      for (const it of e.items) {
        const v = one(it);
        if (v === undefined) return undefined;
        out.push(v);
      }
      return out;
    }
    return one(e);
  }

  // ══════════════════════════ statements ══════════════════════════════════
  execBody(body: Stmt[], env: Env): PValue {
    let last: PValue = null;
    for (let i = 0; i < body.length; i++) {
      const st = body[i];
      if ((++this.stmtTick & 0x3ff) === 0 && Date.now() > this.deadline) {
        throw new PineError(
          `This bar's evaluation exceeded the ${this.budgetMs / 1000}s budget — the script is too heavy (unbounded loops or an extremely long body). Reduce the loop ranges or split the logic.`,
          st.line,
          st.col
        );
      }
      last = this.execStmt(st, env);
      if (this.flow) return last;
    }
    return last;
  }

  private declBox(id: number, carry: boolean, init: PValue): Box {
    let box = this.cx.st.get(id) as Box | undefined;
    if (!box) {
      box = new Box(carry, init);
      this.cx.st.set(id, box);
    }
    return box;
  }

  private execStmt(st: Stmt, env: Env): PValue {
    const bar = this.bar;
    switch (st.k) {
      case "varDecl": {
        if (st.init.k === "call") {
          const p = this.memberPath(st.init.callee);
          if (p.startsWith("input")) this.pendingInputVar = st.name;
        }
        if (st.isVar) {
          let box = this.cx.st.get(st.id) as Box | undefined;
          if (!box) {
            const v = this.coerceDecl(st.type, this.evalExpr(st.init, env));
            box = new Box(true, v);
            box.write(bar, v);
            this.cx.st.set(st.id, box);
          } else if (box.vals[bar - box.off] === undefined) {
            box.write(bar, box.at(bar));
          }
          env.vars.set(st.name, box);
          return box.at(bar);
        }
        const v = this.coerceDecl(st.type, this.evalExpr(st.init, env));
        const box = this.declBox(st.id, false, v);
        box.write(bar, v);
        env.vars.set(st.name, box);
        return v;
      }
      case "reassign": {
        const rhs = this.evalExpr(st.e, env);
        if (st.target.k === "member") {
          const obj = this.evalExpr(st.target.obj, env);
          if (isUdt(obj)) {
            const cur = obj.f[st.target.name] ?? null;
            const out = combine(st.op, cur, rhs);
            obj.f[st.target.name] = out;
            return out;
          }
          if (obj === null) return null; // field of an na object — ignored
          throw new PineError(`Cannot assign to "${this.memberPath(st.target)}".`, st.line, st.col);
        }
        const box = env.get(st.name);
        if (!box) throw new PineError(`Variable "${st.name}" was never declared.`, st.line, st.col);
        const out = st.op === ":=" ? rhs : combine(st.op, box.at(bar), rhs);
        box.write(bar, out);
        return out;
      }
      case "tuple": {
        const v = this.evalExpr(st.init, env);
        const arr = Array.isArray(v) ? v : st.names.map(() => null);
        st.names.forEach((nm, i) => {
          if (nm === "_") return;
          let box: Box;
          if (st.isDecl) {
            box = this.declBox(st.id * 64 + i + 1e9, false, arr[i] ?? null);
            env.vars.set(nm, box);
          } else {
            const found = env.get(nm);
            if (!found) throw new PineError(`Variable "${nm}" was never declared.`, st.line, st.col);
            box = found;
          }
          box.write(bar, arr[i] ?? null);
        });
        return v;
      }
      case "if": {
        for (const br of st.branches) {
          if (br.cond === null || truthy(this.evalExpr(br.cond, env))) {
            return this.execBody(br.body, new Env(env));
          }
        }
        return null;
      }
      case "for": {
        const from = this.evalExpr(st.from, env);
        const to = this.evalExpr(st.to, env);
        if (!isNum(from) || !isNum(to)) return null;
        let step = st.step ? this.evalExpr(st.step, env) : null;
        if (!isNum(step) || step === 0) step = from <= to ? 1 : -1;
        else step = from <= to ? Math.abs(step) : -Math.abs(step);
        const child = new Env(env);
        const loopBox = new Box(false, from);
        child.vars.set(st.varName, loopBox);
        let guard = 0;
        let last: PValue = null;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          if (++guard > 100000) throw new PineError("for loop exceeded 100,000 iterations — refusing to hang.", st.line, st.col);
          loopBox.write(bar, i);
          last = this.execBody(st.body, new Env(child));
          if (this.flow === FLOW_BREAK) { this.flow = 0; break; }
          if (this.flow === FLOW_CONTINUE) this.flow = 0;
        }
        return last;
      }
      case "forin": {
        const it = this.evalExpr(st.iter, env);
        const child = new Env(env);
        const idxBox = new Box(false, 0);
        const itemBox = new Box(false, null);
        if (st.idxName) child.vars.set(st.idxName, idxBox);
        child.vars.set(st.itemName, itemBox);
        let last: PValue = null;
        const entries: [PValue, PValue][] = Array.isArray(it)
          ? it.map((v, i) => [i, v] as [PValue, PValue])
          : isMap(it)
            ? [...it.__map.entries()].map(([k, v]) => [k as PValue, v] as [PValue, PValue])
            : isMatrix(it)
              ? it.__mx.map((row, i) => [i, row] as [PValue, PValue])
              : [];
        let guard = 0;
        for (const [k, v] of entries) {
          if (++guard > 100000) throw new PineError("for…in loop exceeded 100,000 iterations.", st.line, st.col);
          idxBox.write(bar, k);
          itemBox.write(bar, v);
          last = this.execBody(st.body, new Env(child));
          if (this.flow === FLOW_BREAK) { this.flow = 0; break; }
          if (this.flow === FLOW_CONTINUE) this.flow = 0;
        }
        return last;
      }
      case "while": {
        let guard = 0;
        let last: PValue = null;
        while (truthy(this.evalExpr(st.cond, env))) {
          if (++guard > 100000) throw new PineError("while loop exceeded 100,000 iterations — refusing to hang.", st.line, st.col);
          last = this.execBody(st.body, new Env(env));
          if (this.flow === FLOW_BREAK) { this.flow = 0; break; }
          if (this.flow === FLOW_CONTINUE) this.flow = 0;
        }
        return last;
      }
      case "func":
        if (st.isMethod) {
          const list = this.methods.get(st.name) ?? [];
          if (!list.includes(st)) { list.push(st); this.methods.set(st.name, list); }
        } else this.funcs.set(st.name, st);
        return null;
      case "typeDecl":
        this.types.set(st.name, st);
        return null;
      case "enumDecl":
        if (!this.enums.has(st.name)) this.registerEnum(st);
        return null;
      case "import":
        this.imports.set(st.alias, st.path);
        return null;
      case "expr":
        return this.evalExpr(st.e, env);
      case "break":
        this.flow = FLOW_BREAK;
        return null;
      case "continue":
        this.flow = FLOW_CONTINUE;
        return null;
    }
  }

  /** typed declarations: `int x = 2.7` stays as written (Pine would reject); `bool b = na` → false in v6 */
  private coerceDecl(type: string | undefined, v: PValue): PValue {
    if (!type) return v;
    const t = type.replace(/^(series|simple|const|input)\s*/, "");
    if (t === "bool" && v === null && this.version >= 6) return false;
    return v;
  }

  /** start capturing the named boolean series (manual signal mapping) */
  captureBools(names: string[]): void {
    this.capturedBool = new Map(names.map((n) => [n, []]));
  }

  // ══════════════════════════ expressions ══════════════════════════════════
  memberPath(m: Expr): string {
    const c = m as Expr & { _p?: string };
    if (c._p !== undefined) return c._p;
    let out = "";
    if (m.k === "ident") out = m.name;
    else if (m.k === "member") {
      const p = this.memberPath(m.obj);
      out = p ? `${p}.${m.name}` : "";
    }
    c._p = out;
    return out;
  }
  private rootName(m: Expr): string | null {
    const c = m as Expr & { _r?: string | null };
    if (c._r !== undefined) return c._r;
    let x = m;
    while (x.k === "member") x = x.obj;
    c._r = x.k === "ident" ? x.name : null;
    return c._r;
  }

  /** built-in series boxes (history-capable) */
  seriesBox(name: string): Box | null {
    switch (name) {
      case "open": return this.bOpen;
      case "high": return this.bHigh;
      case "low": return this.bLow;
      case "close": return this.bClose;
      case "volume": return this.bVolume;
      case "time": return this.bTime;
      case "time_close": return this.bTimeClose;
      case "hl2": return this.bHl2;
      case "hlc3": return this.bHlc3;
      case "ohlc4": return this.bOhlc4;
      case "hlcc4": return this.bHlcc4;
      case "bar_index": return this.bBarIdx;
      case "strategy.position_size": return this.bPosSize;
      case "strategy.position_avg_price": return this.bPosAvg;
      default:
        return this.taVars.get(name) ?? null;
    }
  }

  evalExpr(e: Expr, env: Env): PValue {
    switch (e.k) {
      case "num": return e.v;
      case "str": return e.v;
      case "color": return e.v;
      case "bool": return e.v;
      case "na": return null;
      case "ident": {
        const box = env.get(e.name);
        if (box) return box.at(this.bar);
        const sb = this.seriesBox(e.name);
        if (sb) return sb.at(this.bar);
        const v = builtinVar(this, e.name);
        if (v !== undefined) return v;
        const c = constantValue(e.name, this.version);
        if (c !== undefined) return c;
        throw new PineError(`Unknown identifier "${e.name}".`, e.line, e.col);
      }
      case "unary": {
        const v = this.evalExpr(e.e, env);
        if (e.op === "not") return !truthy(v);
        if (v === null) return null;
        if (!isNum(v)) return null;
        return e.op === "-" ? -v : v;
      }
      case "bin":
        return this.evalBin(e, env);
      case "ternary":
        return truthy(this.evalExpr(e.c, env)) ? this.evalExpr(e.a, env) : this.evalExpr(e.b, env);
      case "ifexpr": {
        for (const br of e.branches) {
          if (br.cond === null || truthy(this.evalExpr(br.cond, env))) {
            const r = this.execBody(br.body, new Env(env));
            return this.flow ? null : r;
          }
        }
        return null;
      }
      case "switch": {
        const subj: PValue = e.subject ? this.evalExpr(e.subject, env) : null;
        let dflt: Stmt[] | null = null;
        for (const cs of e.cases) {
          if (cs.cond === null) { dflt = cs.body; continue; }
          const cv = this.evalExpr(cs.cond, env);
          const hit = e.subject ? (subj !== null && cv !== null && (subj === cv || (isEnumEq(subj, cv)))) : truthy(cv);
          if (hit) return this.execBody(cs.body, new Env(env));
        }
        return dflt ? this.execBody(dflt, new Env(env)) : null;
      }
      case "loopexpr":
        return this.execStmt(e.stmt, env);
      case "arrlit":
        return e.items.map((it) => this.evalExpr(it, env));
      case "hist":
        return this.evalHist(e.e, e.n, e.id, env);
      case "member":
        return this.evalMember(e, env);
      case "call":
        return this.evalCall(e, env);
    }
  }

  private evalHist(target: Expr, nExpr: Expr, id: number, env: Env): PValue {
    const nv = this.evalExpr(nExpr, env);
    if (!isNum(nv)) return null;
    const n = Math.round(nv);
    if (target.k === "ident") {
      const box = env.get(target.name) ?? this.seriesBox(target.name);
      if (box) return box.hist(this.bar, n);
    } else if (target.k === "member") {
      const p = this.memberPath(target);
      const root = this.rootName(target);
      if (p && root && !env.get(root)) {
        const box = this.seriesBox(p);
        if (box) return box.hist(this.bar, n);
      }
    }
    // generic expression history: record the expression's value every bar
    const v = this.evalExpr(target, env);
    const box = this.declBox(id, false, null);
    box.write(this.bar, v);
    return n === 0 ? v : box.hist(this.bar, n);
  }

  private evalBin(e: { l: Expr; r: Expr; op: string; line: number; col: number }, env: Env): PValue {
    // long operator chains evaluate ITERATIVELY down the left spine
    const spine: { op: string; r: Expr }[] = [];
    let node = e as unknown as { k?: string; op?: string; l: Expr; r: Expr };
    spine.push({ op: e.op, r: e.r });
    node = e.l as unknown as typeof node;
    while (node.k === "bin") {
      spine.push({ op: node.op as string, r: node.r });
      node = node.l as unknown as typeof node;
    }
    let acc = this.evalExpr(node as unknown as Expr, env);
    for (let i = spine.length - 1; i >= 0; i--) {
      const seg = spine[i];
      if (seg.op === "and") acc = truthy(acc) ? truthy(this.evalExpr(seg.r, env)) : false;
      else if (seg.op === "or") acc = truthy(acc) ? true : truthy(this.evalExpr(seg.r, env));
      else acc = applyBin(seg.op, acc, this.evalExpr(seg.r, env), e.line, e.col);
    }
    return acc;
  }

  private evalMember(m: { obj: Expr; name: string; line: number; col: number; id: number }, env: Env): PValue {
    const root = this.rootName(m as unknown as Expr);
    if (root !== null && !env.get(root)) {
      const path = this.memberPath(m as unknown as Expr);
      // enum field
      const en = this.enums.get(root);
      if (en && m.obj.k === "ident") {
        const v = en.get(m.name);
        if (v) return v;
        throw new PineError(`Enum ${root} has no field "${m.name}".`, m.line, m.col);
      }
      if (path) {
        const sb = this.seriesBox(path);
        if (sb) return sb.at(this.bar);
        const v = builtinVar(this, path);
        if (v !== undefined) return v;
        const c = constantValue(path, this.version);
        if (c !== undefined) return c;
        if (this.imports.has(root)) {
          throw new PineError(`"${path}" comes from the imported library "${this.imports.get(root)}", which the HALO compiler cannot download — paste the library's functions into the script.`, m.line, m.col);
        }
        throw new PineError(`"${path}" is not available in the HALO Pine runtime.`, m.line, m.col);
      }
    }
    const obj = this.evalExpr(m.obj, env);
    return fieldOf(obj, m.name);
  }

  // ══════════════════════════ calls ═══════════════════════════════════════
  evalArgs(args: Arg[], env: Env): { pos: PValue[]; named: Record<string, PValue> } {
    const pos: PValue[] = [];
    const named: Record<string, PValue> = {};
    for (const a of args) {
      const v = this.evalExpr(a.e, env);
      if (a.name) named[a.name] = v;
      else pos.push(v);
    }
    return { pos, named };
  }

  private evalCall(e: Call, env: Env): PValue {
    const callee = e.callee;
    if (callee.k === "ident") {
      const name = callee.name;
      const uf = this.funcs.get(name);
      if (uf) return this.callUser(uf, e, env, undefined);
      if (name === "security") return this.security(e, env);
      const alias = V4_ALIASES[name];
      if (alias === "request.security") return this.security(e, env);
      const { pos, named } = this.evalArgs(e.args, env);
      if (CAST_FUNCS.has(name)) return castValue(name, pos[0] ?? null);
      return callBuiltin(this, alias ?? name, pos, named, e);
    }
    if (callee.k === "member") {
      const root = this.rootName(callee);
      const isChain = callee.obj.k === "ident" || callee.obj.k === "member";
      if (isChain && root !== null && !env.get(root)) {
        const path = this.memberPath(callee);
        const objPath = this.memberPath(callee.obj);
        // UDT constructor / static copy
        const ty = this.types.get(objPath);
        if (ty) {
          if (callee.name === "new") return this.newUdt(ty, e, env);
          if (callee.name === "copy") {
            const { pos } = this.evalArgs(e.args, env);
            return copyUdt(pos[0] ?? null);
          }
        }
        if (this.imports.has(root)) {
          throw new PineError(`"${path}()" comes from the imported library "${this.imports.get(root)}", which the HALO compiler cannot download — paste the library's functions into the script.`, e.line, e.col);
        }
        if (path === "request.security") return this.security(e, env);
        // a user method called namespace-style (rare) → fall through to builtins
        const { pos, named } = this.evalArgs(e.args, env);
        return callBuiltin(this, path, pos, named, e);
      }
      // method call on a value: obj.f(…)
      const obj = this.evalExpr(callee.obj, env);
      return this.callMethod(obj, callee.name, e, env);
    }
    throw new PineError("This expression cannot be called.", e.line, e.col);
  }

  private callMethod(obj: PValue, name: string, e: Call, env: Env): PValue {
    const list = this.methods.get(name);
    if (list && list.length) {
      const tn = valueTypeName(obj);
      const fd = list.find((m) => typeMatches(m.recvType, tn, obj)) ?? (list.length === 1 ? list[0] : list.find((m) => !m.recvType) ?? list[0]);
      return this.callUser(fd, e, env, obj);
    }
    const { pos, named } = this.evalArgs(e.args, env);
    const args = [obj, ...pos];
    if (Array.isArray(obj)) return callBuiltin(this, `array.${name}`, args, named, e);
    if (isMap(obj)) return callBuiltin(this, `map.${name}`, args, named, e);
    if (isMatrix(obj)) return callBuiltin(this, `matrix.${name}`, args, named, e);
    if (isDraw(obj)) return callBuiltin(this, `${obj.__d}.${name}`, args, named, e);
    if (isUdt(obj)) {
      if (name === "copy") return copyUdt(obj);
      if (obj.__t === "chart.point") return callBuiltin(this, `chart.point.${name}`, args, named, e);
      throw new PineError(`Type ${obj.__t} has no method "${name}".`, e.line, e.col);
    }
    if (obj === null) {
      // method on an na object (e.g. an unset line): Pine is lenient for delete/set_*
      return null;
    }
    if (typeof obj === "string") return callBuiltin(this, `str.${name}`, args, named, e);
    throw new PineError(`"${name}()" cannot be called on a ${valueTypeName(obj)} value.`, e.line, e.col);
  }

  private callUser(fd: FuncDecl, e: Call, env: Env, recv: PValue | undefined): PValue {
    // evaluate arguments in the CALLER's context
    const pos: PValue[] = recv !== undefined ? [recv] : [];
    const named: Record<string, PValue> = {};
    for (const a of e.args) {
      const v = this.evalExpr(a.e, env);
      if (a.name) named[a.name] = v;
      else pos.push(v);
    }
    if (pos.length > fd.params.length) {
      throw new PineError(`Function ${fd.name}() takes ${fd.params.length} argument(s), got ${pos.length}.`, e.line, e.col);
    }
    if (++this.callDepth > MAX_CALL_DEPTH) {
      this.callDepth = 0;
      throw new PineError(`Function ${fd.name}() recursed too deeply — Pine does not allow recursive functions.`, e.line, e.col);
    }
    const parentCx = this.cx;
    let child = parentCx.kids.get(e.id);
    if (!child) {
      child = new Cx();
      parentCx.kids.set(e.id, child);
    }
    const fenv = new Env(this.globalEnv);
    this.cx = child;
    try {
      fd.params.forEach((p, i) => {
        let v: PValue;
        if (i < pos.length) v = pos[i];
        else if (p.name in named) v = named[p.name];
        else if (p.def) v = this.evalExpr(p.def, fenv);
        else v = null;
        const box = this.declBox(-(i + 1), false, v);
        box.write(this.bar, v);
        fenv.vars.set(p.name, box);
      });
      const before = this.pendingInputVar;
      this.pendingInputVar = null;
      const out = this.execBody(fd.body, fenv);
      this.pendingInputVar = before;
      this.flow = 0;
      return out === undefined ? null : out;
    } finally {
      this.cx = parentCx;
      this.callDepth--;
    }
  }

  private newUdt(ty: TypeDecl, e: Call, env: Env): PUdt {
    const { pos, named } = this.evalArgs(e.args, env);
    const f: Record<string, PValue> = {};
    ty.fields.forEach((fd, i) => {
      if (i < pos.length) f[fd.name] = pos[i];
      else if (fd.name in named) f[fd.name] = named[fd.name];
      else if (fd.def) f[fd.name] = this.evalExpr(fd.def, env);
      else f[fd.name] = null;
    });
    return { __t: ty.name, f };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────
function hashKey(s: string): number {
  // negative keys never collide with node ids (positive) — string legacy keys
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return -1e6 - Math.abs(h);
}

function combine(op: string, cur: PValue, v: PValue): PValue {
  switch (op) {
    case "+=": return addVal(cur, v);
    case "-=": return subVal(cur, v);
    case "*=": return mulVal(cur, v);
    case "/=": return divVal(cur, v);
    case "%=": return modVal(cur, v);
    default: return v;
  }
}

function isEnumEq(a: PValue, b: PValue): boolean {
  return !!a && !!b && typeof a === "object" && typeof b === "object" && "__e" in a && "__e" in b && (a as PEnum).__e === (b as PEnum).__e && (a as PEnum).k === (b as PEnum).k;
}

export function fieldOf(obj: PValue, name: string): PValue {
  if (obj === null) return null;
  if (isUdt(obj)) return obj.f[name] ?? null;
  if (isDraw(obj)) return (obj.props[name] as PValue) ?? null;
  if (Array.isArray(obj) && name === "size") return obj.length;
  return null;
}

function copyUdt(v: PValue): PValue {
  if (!isUdt(v)) return v;
  return { __t: v.__t, f: { ...v.f } };
}

function valueTypeName(v: PValue): string {
  if (v === null) return "na";
  if (Array.isArray(v)) return "array";
  if (isMap(v)) return "map";
  if (isMatrix(v)) return "matrix";
  if (isDraw(v)) return v.__d;
  if (isUdt(v)) return v.__t;
  if (typeof v === "object" && "__e" in v) return (v as PEnum).__e;
  return typeof v === "number" ? "float" : typeof v === "boolean" ? "bool" : "string";
}

function typeMatches(recv: string | undefined, tn: string, v: PValue): boolean {
  if (!recv) return false;
  const r = recv.replace(/^(series|simple|const)\s*/, "");
  if (r === tn) return true;
  if (tn === "array" && (r.startsWith("array") || r.endsWith("[]"))) return true;
  if (tn === "map" && r.startsWith("map")) return true;
  if (tn === "matrix" && r.startsWith("matrix")) return true;
  if (tn === "float" && (r === "int" || r === "float")) return typeof v === "number";
  return false;
}

function castValue(name: string, v: PValue): PValue {
  switch (name) {
    case "int": return isNum(v) ? Math.trunc(v) : null;
    case "float": return isNum(v) ? v : null;
    case "bool": return v === null ? false : truthy(v);
    case "string": return v === null ? null : typeof v === "string" ? v : String(v);
    default: return v; // color(na), line(na), label(na), box(na), table(na)…
  }
}

export { eqVal };
