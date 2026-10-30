// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script v5 (subset) RUNTIME
//  Bar-by-bar evaluator with Pine series semantics:
//    • every variable is a series Box (sparse per-bar slots, `x[n]` history)
//    • `var` boxes carry their value across bars
//    • strategy.entry/exit/close calls are queued per bar and settled with
//      Pine's default fill model (orders fill on the NEXT bar open unless
//      the script sets process_orders_on_close=true)
//    • strategy.exit stop/limit are checked intrabar (conservative: when
//      both SL and TP fall inside one bar, the STOP wins — same rule the
//      built-in 3EL engine uses)
//  Everything the compiler cannot honestly support throws a PineError
//  naming the exact line — never a silent wrong result.
// ════════════════════════════════════════════════════════════════════════

import type { Candle } from "@/lib/halo/types";
import { parsePine, type Arg, type Expr, type Stmt, type Program, type Call } from "./parser";

export class PineError extends Error {
  constructor(
    msg: string,
    public line = 0,
    public col = 0
  ) {
    super(msg);
  }
}

// ── values ───────────────────────────────────────────────────────────────
export type PDraw = { __d: "line" | "label" | "box"; props: Record<string, unknown> };
export type PFuncVal = { __f: true; name: string };
export type PValue = number | boolean | string | PDraw | PFuncVal | PValue[] | null;

export function isNum(v: PValue): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function num(v: PValue, ctx: string): number {
  if (!isNum(v)) throw new PineError(`${ctx} expected a number (got ${typeName(v)}).`);
  return v;
}
function typeName(v: PValue): string {
  if (v === null) return "na";
  if (Array.isArray(v)) return "tuple";
  if (typeof v === "object") return (v as PDraw).__d ? (v as PDraw).__d : "function";
  return typeof v;
}

/** A Pine series variable — sparse per-bar value slots. */
class Box {
  vals: PValue[] = [];
  constructor(
    public carry: boolean, // `var` semantics: read falls back to the last written value
    public init: PValue = null
  ) {}
  private scanBack(bar: number): PValue {
    for (let i = Math.min(bar, this.vals.length - 1); i >= 0; i--) {
      const v = this.vals[i];
      if (v !== undefined) return v;
    }
    return this.init;
  }
  at(bar: number): PValue {
    if (this.carry) return this.scanBack(bar);
    const v = this.vals[bar];
    return v === undefined ? (this.vals.length === 0 ? this.init : null) : v;
  }
  hist(bar: number, n: number): PValue {
    const t = bar - n;
    if (n < 0 || t < 0) return null; // future reference → na
    if (this.carry) return this.scanBack(t);
    const v = this.vals[t];
    return v === undefined ? null : v;
  }
  write(bar: number, v: PValue): void {
    this.vals[bar] = v;
  }
}

type Scope = Map<string, Box>;

type ForControl = { brk: boolean; cont: boolean };
type R = PValue | ForControl;
const BRK: ForControl = { brk: true, cont: false };
const CONT: ForControl = { brk: false, cont: true };

// ── series helper state (per call-site) ──────────────────────────────────
class Window {
  buf: number[] = [];
  constructor(public len: number) {}
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.len) this.buf.shift();
  }
  get full(): boolean {
    return this.buf.length >= this.len;
  }
  sma(): number {
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
}
class EmaState {
  prev: number | null = null;
  seed: number[] = [];
  constructor(public len: number) {}
  private alpha(): number {
    return 2 / (this.len + 1);
  }
  next(v: number): number {
    if (this.prev === null) {
      this.seed.push(v);
      if (this.seed.length >= this.len) {
        this.prev = this.seed.reduce((a, b) => a + b, 0) / this.seed.length;
        this.seed = [];
      }
      return this.prev ?? v;
    }
    this.prev = v * this.alpha() + this.prev * (1 - this.alpha());
    return this.prev;
  }
}

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
  style: string; // shape name
  color: string;
  location: string;
  text: string;
}
export interface HLineMeta {
  price: number;
  color: string;
  style: string;
  title: string;
}

export interface PlanEntry {
  id: string;
  dir: 1 | -1;
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
}

export interface RuntimeOpts {
  mintick: number;
  ticker: string;
  tf: string;
  pipMult: number;
}

// ── colour helpers ───────────────────────────────────────────────────────
const NAMED_COLORS: Record<string, string> = {
  aqua: "#00BCD4", black: "#363A45", blue: "#2962FF", fuchsia: "#E040FB", gray: "#787B86",
  green: "#089981", lime: "#00E676", maroon: "#880E4F", navy: "#311B92", olive: "#808000",
  orange: "#FF9800", purple: "#9C27B0", red: "#F23645", silver: "#B2B5BE", teal: "#26A69A",
  white: "#FFFFFF", yellow: "#FFEB3B",
};
export function normalizeColor(c: PValue): string {
  if (typeof c !== "string") return "#2ECCFF";
  if (c.startsWith("#")) return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c.slice(0, 9);
  const named = NAMED_COLORS[c.toLowerCase()];
  return named ?? c;
}
function withTransp(color: PValue, transp: PValue): string {
  const base = normalizeColor(color).slice(0, 7);
  const t = transp === null ? 0 : num(transp, "color.new transp");
  const alpha = Math.max(0, Math.min(1, 1 - t / 100));
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

const TF_SEC: Record<string, number> = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "2h": 7200, "4h": 14400, "1d": 86400,
};

// ── the runtime ──────────────────────────────────────────────────────────
export class PineRuntime {
  program: Program;
  bar = -1;
  opts: RuntimeOpts;
  // namespaces
  global: Scope = new Map();
  private funcs = new Map<string, { params: string[]; body: Stmt[] }>();
  setState(key: string, make: () => unknown): unknown {
    return this.stateGet(key, make);
  }
  bOpen = new Box(false);
  bHigh = new Box(false);
  bLow = new Box(false);
  bClose = new Box(false);
  bVolume = new Box(false);
  bTime = new Box(false);
  bHl2 = new Box(false);
  bHlc3 = new Box(false);
  bOhlc4 = new Box(false);
  bPosSize = new Box(false);
  bPosAvg = new Box(false);
  bBarIdx = new Box(false);
  // plan (this bar's strategy calls)
  plan = { entries: [] as PlanEntry[], exits: [] as PlanExit[], closes: [] as string[], closeAll: false, cancels: [] as string[] };
  // pending fills (from the previous bar's plan — Pine next-bar-open model)
  private pendingEntries: PlanEntry[] = [];
  private pendingCloses: string[] = [];
  private pendingCloseAll = false;
  // persistent exit orders (from_entry → stop/limit); public shim
  exitOrders = new Map<string, { stop: number | null; limit: number | null }>();
  // simulated position (preview / backtest)
  simPos: SimTrade | null = null;
  simTrades: SimTrade[] = [];
  processOrdersOnClose = false;
  pyramiding = 0;
  /** live mode: pine-bot pins the REAL position so position_size reads truth */
  externalPos: { dir: 1 | -1 | 0; entry: number } | null = null;
  // outputs
  plots = new Map<string, { meta: PlotMeta; values: (number | null)[]; colors: (string | null)[] }>();
  shapes = new Map<string, { meta: PlotShapeMeta; marks: { bar: number; up: boolean; text: string; color: string }[] }>();
  hlines: HLineMeta[] = [];
  barAlerts: string[] = [];
  inputs: { id: string; kind: string; title: string; defval: PValue; minval?: number; maxval?: number; step?: number; options?: PValue[]; group?: string }[] = [];
  /** manual-signal series capture (indicator scripts) */
  capturedBool = new Map<string, boolean[]>(); // var name → per-bar bool
  pendingInputVar: string | null = null;
  drawingsCreated = 0;

  constructor(src: string, opts: RuntimeOpts) {
    this.opts = opts;
    try {
      this.program = parsePine(src);
    } catch (e) {
      if (e instanceof PineError) throw e;
      throw new PineError((e as Error).message);
    }
    this.installGlobals();
    if (this.program.decl) this.readDecl(this.program.decl);
  }

  private readDecl(decl: Call): void {
    for (const a of decl.args) {
      if (a.name === "process_orders_on_close") this.processOrdersOnClose = a.e.k === "bool" && a.e.v === true;
      if (a.name === "pyramiding") this.pyramiding = a.e.k === "num" ? a.e.v : 0;
    }
  }

  // ── environment ───────────────────────────────────────────────────────
  private installGlobals(): void {
    const g = this.global;
    g.set("open", this.bOpen);
    g.set("high", this.bHigh);
    g.set("low", this.bLow);
    g.set("close", this.bClose);
    g.set("volume", this.bVolume);
    g.set("time", this.bTime);
    g.set("time_close", this.bTime);
    g.set("hl2", this.bHl2);
    g.set("hlc3", this.bHlc3);
    g.set("ohlc4", this.bOhlc4);
    g.set("bar_index", this.bBarIdx);
    g.set("last_bar_index", this.bBarIdx);
    g.set("strategy.position_size", this.bPosSize);
    g.set("strategy.position_avg_price", this.bPosAvg);
    g.set("na", new Box(true, null));
    g.set("true", new Box(true, true));
    g.set("false", new Box(true, false));
  }

  private stateGet(key: string, make?: () => unknown): unknown {
    let s = this.states.get(key);
    if (s === undefined && make) {
      s = make();
      this.states.set(key, s);
    }
    return s;
  }

  private lookup(name: string, scopes: Scope[]): Box | null {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const b = scopes[i].get(name);
      if (b) return b;
    }
    return null;
  }

  private states = new Map<string, unknown>(); // per call-site helper state
  private varBoxes = new Map<string, Box>(); // `var` boxes by node key

  barTime(): number {
    const t = this.bTime.at(this.bar);
    return isNum(t) ? t : Date.now();
  }

  // ── bar processing ────────────────────────────────────────────────────
  processBar(c: Candle, opts?: { confirmed?: boolean }): void {
    this.bar++;
    this.barAlerts = [];
    this.plan = { entries: [], exits: [], closes: [], closeAll: false, cancels: [] };
    const b = this.bar;
    const vol = c.volume ?? 0;
    this.bOpen.write(b, c.open);
    this.bHigh.write(b, c.high);
    this.bLow.write(b, c.low);
    this.bClose.write(b, c.close);
    this.bVolume.write(b, vol);
    this.bTime.write(b, c.time);
    this.bHl2.write(b, (c.high + c.low) / 2);
    this.bHlc3.write(b, (c.high + c.low + c.close) / 3);
    this.bOhlc4.write(b, (c.open + c.high + c.low + c.close) / 4);
    this.bBarIdx.write(b, b);
    const pos = this.currentPos();
    this.bPosSize.write(b, pos.dir);
    this.bPosAvg.write(b, pos.dir === 0 ? null : pos.entry);

    // 1 · pending orders from the previous bar fill at THIS bar's open
    this.applyPending(c.open);
    // 2 · intrabar SL/TP of the open position (conservative: stop first)
    if (!this.processOrdersOnClose) this.checkStops(c);
    // 3 · run the script for this bar
    this.execBody(this.program.body, [this.global]);
    // 4 · queue this bar's plan for execution (default: NEXT bar open)
    this.pendingEntries = this.plan.entries;
    this.pendingCloses = this.plan.closes;
    this.pendingCloseAll = this.plan.closeAll;
    // 5 · process_orders_on_close scripts fill at this bar's close
    if (this.processOrdersOnClose) {
      this.applyPending(c.close);
      this.checkStops(c);
    }
  }

  private currentPos(): { dir: 1 | -1 | 0; entry: number } {
    if (this.externalPos) return this.externalPos;
    if (this.simPos) return { dir: this.simPos.dir, entry: this.simPos.entry };
    return { dir: 0, entry: 0 };
  }

  private applyPending(open: number): void {
    // closes / reversals first
    if (this.pendingCloseAll || this.pendingCloses.length > 0) this.simClose(open, "close");
    for (const en of this.pendingEntries) {
      const pos = this.currentPos();
      if (pos.dir === en.dir) {
        if (this.pyramiding === 0) continue; // default pyramiding=0 → no adds
      } else if (pos.dir !== 0) {
        this.simClose(open, "reverse");
      }
      const exit = this.exitOrders.get(en.id) ?? this.exitOrders.get("") ?? null;
      const sl = exit?.stop ?? null;
      const tp = exit?.limit ?? null;
      this.simPos = { dir: en.dir, entry: open, entryTime: this.barTime(), entryBar: this.bar, exit: null, exitTime: null, sl, tp, reason: null, entryId: en.id };
      // one-shot exits consumed
      if (exit) this.exitOrders.delete(en.id);
      break; // netting: one position at a time
    }
    this.pendingEntries = [];
    this.pendingCloses = [];
    this.pendingCloseAll = false;
  }

  private simClose(px: number, reason: SimTrade["reason"]): void {
    if (!this.simPos) return;
    this.simPos.exit = px;
    this.simPos.exitTime = this.barTime();
    this.simPos.reason = reason;
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
      px = isLong ? Math.min(c.open, p.sl) : Math.max(c.open, p.sl); // gap → open
    } else if (p.tp !== null && ((isLong && c.high >= p.tp) || (!isLong && c.low <= p.tp))) {
      hit = "tp";
      px = isLong ? Math.max(c.open, p.tp) : Math.min(c.open, p.tp);
    }
    if (hit) this.simClose(px, hit);
  }

  // ══════════════════════════ statement execution ══════════════════════════
  private execBody(body: Stmt[], scopes: Scope[]): R {
    let last: PValue = null;
    for (const st of body) {
      const r = this.execStmt(st, scopes);
      if (r === BRK || r === CONT) return r;
      last = r as PValue;
    }
    return last;
  }

  private execStmt(st: Stmt, scopes: Scope[]): R {
    const bar = this.bar;
    switch (st.k) {
      case "varDecl": {
        const key = `${st.id}`;
        if (st.isVar) {
          let box = this.varBoxes.get(key);
          if (!box) {
            const v = this.evalExpr(st.init, scopes);
            box = new Box(true, v);
            box.write(bar, v);
            this.varBoxes.set(key, box);
          } else if (box.vals[bar] === undefined) {
            box.write(bar, box.at(bar)); // carry current into this bar
          }
          scopes[scopes.length - 1].set(st.name, box);
          this.maybeCaptureBool(st.name, box);
          return box.at(bar);
        }
        const v = this.evalExpr(st.init, scopes);
        const box = new Box(false, v);
        box.write(bar, v);
        scopes[scopes.length - 1].set(st.name, box);
        this.maybeCaptureBool(st.name, box);
        return v;
      }
      case "reassign": {
        const box = this.lookup(st.name, scopes);
        if (!box) throw new PineError(`Variable "${st.name}" was never declared.`, st.line, st.col);
        if (st.op === ":=") {
          const v = this.evalExpr(st.e, scopes);
          box.write(bar, v);
          this.maybeCaptureBool(st.name, box);
          return v;
        }
        const cur = box.at(bar);
        const v = this.evalExpr(st.e, scopes);
        const out =
          st.op === "+=" ? addVal(cur, v)
          : st.op === "-=" ? subVal(cur, v)
          : st.op === "*=" ? mulVal(cur, v)
          : st.op === "/=" ? divVal(cur, v)
          : st.op === "%=" ? modVal(cur, v)
          : v;
        box.write(bar, out);
        this.maybeCaptureBool(st.name, box);
        return out;
      }
      case "tuple": {
        const v = this.evalExpr(st.init, scopes);
        if (!Array.isArray(v)) throw new PineError("The right side of a [a, b, …] assignment must be a tuple (e.g. from ta.macd).", st.line, st.col);
        if (v.length !== st.names.length) throw new PineError(`Tuple length mismatch — expected ${st.names.length} values, got ${v.length}.`, st.line, st.col);
        st.names.forEach((nm, i) => {
          let box: Box;
          if (st.isDecl) {
            box = new Box(false, v[i]);
            scopes[scopes.length - 1].set(nm, box);
          } else {
            const found = this.lookup(nm, scopes);
            if (!found) throw new PineError(`Variable "${nm}" was never declared.`, st.line, st.col);
            box = found;
          }
          box.write(bar, v[i]);
        });
        return v;
      }
      case "if": {
        let last: R = null;
        for (const br of st.branches) {
          if (br.cond === null || this.truthy(this.evalExpr(br.cond, scopes))) {
            last = this.execBody(br.body, [...scopes, new Map()]);
            break;
          }
        }
        return last;
      }
      case "for": {
        const from = this.evalExpr(st.from, scopes);
        const to = this.evalExpr(st.to, scopes);
        if (!isNum(from) || !isNum(to)) return null;
        let step = st.step ? this.evalExpr(st.step, scopes) : null;
        if (!isNum(step) || step === 0) step = from <= to ? 1 : -1;
        const child = new Map<string, Box>();
        const sc = [...scopes, child];
        const loopBox = new Box(false, from);
        child.set(st.varName, loopBox);
        let guard = 0;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          if (++guard > 20000) throw new PineError("for loop exceeded 20,000 iterations — refusing to hang.", st.line, st.col);
          loopBox.write(bar, i);
          const r = this.execBody(st.body, sc);
          if (r === BRK) break;
        }
        return null;
      }
      case "while": {
        let guard = 0;
        while (this.truthy(this.evalExpr(st.cond, scopes))) {
          if (++guard > 20000) throw new PineError("while loop exceeded 20,000 iterations — refusing to hang.", st.line, st.col);
          const r = this.execBody(st.body, [...scopes, new Map()]);
          if (r === BRK) break;
        }
        return null;
      }
      case "func": {
        this.funcs.set(st.name, { params: st.params, body: st.body });
        return null;
      }
      case "expr":
        return this.evalExpr(st.e, scopes);
      case "break":
        return BRK;
      case "continue":
        return CONT;
    }
  }
  private maybeCaptureBool(name: string, box: Box): void {
    if (this.capturedBool.has(name)) {
      const arr = this.capturedBool.get(name)!;
      const v = box.at(this.bar);
      arr[this.bar] = typeof v === "boolean" ? v : false;
    }
  }

  /** start capturing the named boolean series (manual signal mapping) */
  captureBools(names: string[]): void {
    this.capturedBool = new Map(names.map((n) => [n, []]));
  }

  private truthy(v: PValue): boolean {
    return v === true;
  }

  // ══════════════════════════ expression evaluation ══════════════════════════
  private evalExpr(e: Expr, scopes: Scope[]): PValue {
    switch (e.k) {
      case "num":
        return e.v;
      case "str":
        return e.v;
      case "color":
        return e.v;
      case "bool":
        return e.v;
      case "na":
        return null;
      case "ident": {
        // namespace constants
        const c = this.constant(e.name);
        if (c !== undefined) return c;
        const box = this.lookup(e.name, scopes);
        if (box) return box.at(this.bar);
        throw new PineError(`Unknown identifier "${e.name}".`, e.line, e.col);
      }
      case "unary": {
        const v = this.evalExpr(e.e, scopes);
        if (e.op === "not") return !this.truthy(v);
        if (v === null) return null;
        return e.op === "-" ? -num(v, "unary -") : num(v, "unary +");
      }
      case "bin":
        return this.evalBin(e.op, e, scopes);
      case "ternary":
        return this.truthy(this.evalExpr(e.c, scopes)) ? this.evalExpr(e.a, scopes) : this.evalExpr(e.b, scopes);
      case "ifexpr": {
        let last: PValue = null;
        for (const br of e.branches) {
          if (br.cond === null || this.truthy(this.evalExpr(br.cond, scopes))) {
            const r = this.execBody(br.body, [...scopes, new Map()]);
            last = r === BRK || r === CONT ? null : (r as PValue);
            break;
          }
        }
        return last;
      }
      case "arrlit":
        return e.items.map((it) => this.evalExpr(it, scopes));
      case "hist": {
        const n = this.evalExpr(e.n, scopes);
        const target = e.e;
        if (target.k === "ident") {
          const box = this.lookup(target.name, scopes);
          if (box) return box.hist(this.bar, isNum(n) ? Math.round(n) : 1);
          const c = this.constant(target.name);
          if (c !== undefined) return c; // constant[1] == constant
          throw new PineError(`Unknown identifier "${target.name}".`, target.line, target.col);
        }
        // expression history: evaluate the series expression at bar-n
        const off = isNum(n) ? Math.round(n) : 1;
        if (off === 0) return this.evalExpr(target, scopes);
        if (off < 0) return null;
        // replay-free approximation is not allowed — only direct series boxes
        // and captured built-ins support true history; other expressions get na
        return this.exprHistory(target, off, scopes);
      }
      case "member":
        return this.evalMember(e, scopes);
      case "call":
        return this.evalCall(e, scopes);
    }
  }

  private exprHistory(target: Expr, off: number, scopes: Scope[]): PValue {
    void scopes;
    // member chains like strategy.position_size[1] — mapped global boxes
    // (bPosSize is written every bar) give true history
    if (target.k === "member") {
      const full = this.fullMember(target);
      const box = this.global.get(full);
      if (box) return box.hist(this.bar, off);
      return null;
    }
    if (target.k === "ident") {
      const c = this.constant(target.name);
      if (c !== undefined) return c;
    }
    return null;
  }

  private fullMember(m: { obj: Expr; name: string }): string {
    if (m.obj.k === "ident") return `${m.obj.name}.${m.name}`;
    if (m.obj.k === "member") return `${this.fullMember(m.obj)}.${m.name}`;
    return "";
  }

  private memberPath(m: Expr): string {
    if (m.k === "ident") return m.name;
    if (m.k === "member") return `${this.memberPath(m.obj)}.${m.name}`;
    return "";
  }

  private evalBin(op: string, e: { l: Expr; r: Expr; line: number; col: number }, scopes: Scope[]): PValue {
    if (op === "and" || op === "or") {
      const l = this.evalExpr(e.l, scopes);
      const lb = this.truthy(l);
      if (op === "and" && !lb) return false;
      if (op === "or" && lb) return true;
      return this.truthy(this.evalExpr(e.r, scopes));
    }
    const l = this.evalExpr(e.l, scopes);
    const r = this.evalExpr(e.r, scopes);
    switch (op) {
      case "==": return eqVal(l, r);
      case "!=": return !eqVal(l, r);
      case "<": return cmpVal(l, r, (a, b) => a < b);
      case "<=": return cmpVal(l, r, (a, b) => a <= b);
      case ">": return cmpVal(l, r, (a, b) => a > b);
      case ">=": return cmpVal(l, r, (a, b) => a >= b);
      case "+": return addVal(l, r);
      case "-": return subVal(l, r);
      case "*": return mulVal(l, r);
      case "/": return divVal(l, r);
      case "%": return modVal(l, r);
      default:
        throw new PineError(`Unsupported operator "${op}".`, e.line, e.col);
    }
  }

  private constant(name: string): PValue | undefined {
    switch (name) {
      case "strategy.long": return 1;
      case "strategy.short": return -1;
      case "math.pi": return Math.PI;
      case "barstate.isconfirmed":
      case "barstate.isclosed":
        return true; // the runtime processes confirmed bars only
      case "barstate.isnew":
      case "barstate.isrealtime":
        return false;
      case "barstate.ishistory":
        return true;
      case "syminfo.mintick":
        return this.opts.mintick;
      case "syminfo.ticker":
      case "syminfo.tickerid":
        return this.opts.ticker;
      case "syminfo.type":
        return "forex";
      case "timeframe.period":
        return this.opts.tf;
      case "na":
        return null;
      default:
        return this.staticConst(name);
    }
  }

  private staticConst(name: string): PValue | undefined {
    // color.* / plot.style_* / shape.* / location.* / size.* / alert.* / extend.* / line.style_* / format.*
    if (name.startsWith("color.")) {
      const c = name.slice(6);
      if (c === "new" || c === "rgb") return undefined; // functions
      return NAMED_COLORS[c] ?? undefined;
    }
    if (name.startsWith("plot.style_")) return name.slice(11);
    if (name.startsWith("shape.")) return name.slice(6);
    if (name.startsWith("location.")) return name.slice(9);
    if (name.startsWith("size.")) return name.slice(5);
    if (name.startsWith("alert.freq_")) return name.slice(11);
    if (name.startsWith("extend.")) return name.slice(7);
    if (name.startsWith("line.style_")) return name.slice(11);
    if (name.startsWith("label.style_")) return name.slice(12);
    if (name.startsWith("format.")) return name.slice(7);
    if (name.startsWith("display.")) return "all";
    if (name.startsWith("xloc.")) return name.slice(5);
    if (name.startsWith("yloc.")) return name.slice(5);
    if (name.startsWith("scale.")) return name.slice(6);
    if (name.startsWith("currency.")) return name.slice(9);
    if (name.startsWith("adjustment.")) return name.slice(11);
    if (name.startsWith("division.")) return name.slice(9);
    return undefined;
  }

  private evalMember(m: { obj: Expr; name: string; line: number; col: number }, scopes: Scope[]): PValue {
    const path = this.fullMember(m);
    // 1 · namespace constant (strategy.long, color.red, barstate.isconfirmed…)
    const c = this.constant(path);
    if (c !== undefined) return c;
    // 2 · built-in series (strategy.position_size, strategy.position_avg_price)
    const box = this.global.get(path);
    if (box) return box.at(this.bar);
    // 3 · drawing-object property / method-style object
    const obj = this.evalExpr(m.obj, scopes);
    if (obj && typeof obj === "object" && "__d" in obj) return ((obj as PDraw).props[m.name] as PValue) ?? null;
    throw new PineError(`"${path}" is not available in the HALO Pine runtime.`, m.line, m.col);
  }

  // ══════════════════════════ calls ══════════════════════════════════════════
  private evalArgs(args: Arg[], scopes: Scope[]): { pos: PValue[]; named: Record<string, PValue> } {
    const pos: PValue[] = [];
    const named: Record<string, PValue> = {};
    for (const a of args) {
      const v = this.evalExpr(a.e, scopes);
      if (a.name) named[a.name] = v;
      else pos.push(v);
    }
    return { pos, named };
  }

  private evalCall(e: Call, scopes: Scope[]): PValue {
    const callee = e.callee;
    // method-style call: obj.f(x) → f(obj, x)
    if (callee.k === "member" && callee.obj.k !== "ident") {
      const obj = this.evalExpr(callee.obj, scopes);
      const { pos, named } = this.evalArgs(e.args, scopes);
      return this.builtinCall(callee.name, [obj, ...pos], named, e);
    }
    if (callee.k === "member" && callee.obj.k === "ident") {
      const ns = callee.obj.name;
      const fn = `${ns}.${callee.name}`;
      const { pos, named } = this.evalArgs(e.args, scopes);
      return this.builtinCall(fn, pos, named, e);
    }
    if (callee.k === "ident") {
      const name = callee.name;
      const uf = this.funcs.get(name);
      if (uf) {
        const { pos } = this.evalArgs(e.args, scopes);
        if (pos.length !== uf.params.length) {
          throw new PineError(`Function ${name}() expects ${uf.params.length} argument(s), got ${pos.length}.`, e.line, e.col);
        }
        const child = new Map<string, Box>();
        uf.params.forEach((p, i) => {
          const b = new Box(false, pos[i]);
          b.write(this.bar, pos[i]);
          child.set(p, b);
        });
        const before = this.pendingInputVar;
        this.pendingInputVar = null;
        const out = this.execBody(uf.body, [this.global, child]);
        this.pendingInputVar = before;
        return out === BRK || out === CONT || out === undefined ? null : (out as PValue);
      }
      const { pos, named } = this.evalArgs(e.args, scopes);
      return this.builtinCall(name, pos, named, e);
    }
    throw new PineError("This expression cannot be called.", e.line, e.col);
  }

  // (builtinCall implemented in builtins module — attached below)
  private builtinCall(fn: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
    return callBuiltin(this, fn, pos, named, site);
  }
}

// ── value arithmetic with Pine na propagation ────────────────────────────
function eqVal(l: PValue, r: PValue): boolean {
  if (l === null || r === null) return false;
  if (typeof l === "number" && typeof r === "number") return l === r;
  return l === r;
}
function cmpVal(l: PValue, r: PValue, cmp: (a: number, b: number) => boolean): boolean {
  if (!isNum(l) || !isNum(r)) return false; // na comparisons → false
  return cmp(l, r);
}
function addVal(l: PValue, r: PValue): PValue {
  if (typeof l === "string" || typeof r === "string") return l === null || r === null ? null : `${l}${r}`;
  if (!isNum(l) || !isNum(r)) return null;
  return l + r;
}
function subVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r)) return null;
  return l - r;
}
function mulVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r)) return null;
  return l * r;
}
function divVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r) || r === 0) return null;
  return l / r;
}
function modVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r) || r === 0) return null;
  return l % r;
}

// ══════════════════════════ builtins ══════════════════════════════════════
type BuiltinFn = (rt: PineRuntime, pos: PValue[], named: Record<string, PValue>, site: Call) => PValue;

function nArg(pos: PValue[], i: number, def: number | null = null): number | null {
  const v = pos[i];
  if (v === undefined) return def;
  return isNum(v) ? v : def;
}
function sArg(pos: PValue[], i: number, def: string | null = null): string | null {
  const v = pos[i];
  if (v === undefined) return def;
  return typeof v === "string" ? v : def;
}

function callBuiltin(rt: PineRuntime, fn: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const bar = rt.bar;
  const key = `s${site.id}`;

  // ── namespaces ────────────────────────────────────────────────────────
  if (fn.startsWith("ta.")) return taCall(rt, fn.slice(3), pos, named, site, key);
  if (fn.startsWith("math.")) return mathCall(rt, fn.slice(5), pos, named, site);
  if (fn.startsWith("str.")) return strCall(rt, fn.slice(4), pos, named, site);
  if (fn.startsWith("array.")) return arrCall(rt, fn.slice(6), pos, named, site);
  if (fn.startsWith("input.")) return inputCall(rt, fn.slice(6), pos, named, site);
  if (fn.startsWith("strategy.")) return strategyCall(rt, fn.slice(9), pos, named, site);
  if (fn.startsWith("color.")) return colorCall(rt, fn.slice(6), pos, site);
  if (fn.startsWith("timeframe.")) return tfCall(rt, fn.slice(10), pos, site);
  if (fn.startsWith("line.") || fn.startsWith("label.") || fn.startsWith("box.")) return drawCall(rt, fn, pos, site);

  switch (fn) {
    // ── core built-ins ──
    case "na":
      return pos.length > 0 ? pos[0] === null : true;
    case "nz": {
      const v = pos[0];
      if (v === null) return pos.length > 1 ? pos[1] : 0;
      return v;
    }
    case "fixnan": {
      const st = rt.setState(key, () => ({ last: null as PValue })) as { last: PValue };
      const v = pos[0];
      if (v !== null) st.last = v;
      return st.last;
    }
    case "plot":
      return doPlot(rt, pos, named, site);
    case "plotshape":
    case "plotchar":
      return doPlotShape(rt, pos, named, site, fn === "plotchar" ? String(pos[1] ?? "•") : undefined);
    case "plotarrow":
      return doPlotArrow(rt, pos, site);
    case "hline": {
      const price = nArg(pos, 0);
      if (price === null) return null;
      rt.hlines.push({
        price,
        color: named.color !== undefined ? normalizeColor(named.color) : "#6485AB",
        style: typeof named.lineStyle === "string" ? named.lineStyle : "solid",
        title: typeof named.title === "string" ? named.title : sArg(pos, 1) ?? "",
      });
      return null;
    }
    case "bgcolor":
      return null; // accepted, not rendered
    case "fill":
      return null;
    case "alert":
      if (typeof pos[0] === "string") rt.barAlerts.push(pos[0]);
      return null;
    case "alertcondition": {
      if (pos[0] === true) rt.barAlerts.push(typeof pos[2] === "string" ? pos[2] : typeof pos[1] === "string" ? pos[1] : "alertcondition");
      return null;
    }
    case "barcolor":
      return null;
    case "indicator":
    case "strategy":
      return null; // declaration — already read
    case "max_bars_back":
      return null;
    case "time": {
      if (pos.length === 0) return rt.bTime.at(bar);
      return rt.bTime.at(bar); // timeframe arg ignored (chart TF only)
    }
    case "year": case "month": case "dayofmonth": case "hour": case "minute": case "dayofweek": {
      const t = pos.length > 0 ? num(pos[0], fn) : rt.barTime();
      const d = new Date(t);
      switch (fn) {
        case "year": return d.getUTCFullYear();
        case "month": return d.getUTCMonth() + 1;
        case "dayofmonth": return d.getUTCDate();
        case "hour": return d.getUTCHours();
        case "minute": return d.getUTCMinutes();
        default: return d.getUTCDay();
      }
    }
    case "timestamp": {
      // timestamp(str) ignored → current bar time
      return rt.barTime();
    }
    default:
      throw new PineError(
        `"${fn}" is not supported by the HALO Pine compiler. Supported: ta.* (sma, ema, wma, rma, rsi, macd, atr, stdev, bb, crossover, crossunder, cross, highest, lowest, change, supertrend, …), math.*, str.*, array.*, input.*, strategy.*, color.*, plot/plotshape/hline, alert/alertcondition.`,
        site.line,
        site.col
      );
  }
}

// ── ta.* ─────────────────────────────────────────────────────────────────
function taCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call, key: string): PValue {
  const bar = rt.bar;
  const src = pos[0] ?? null;
  const len = nArg(pos, 1);

  // stateful single-value indicators get their series through per-site buffers
  const seriesState = (bufLen: number) => rt.setState(`${key}:buf`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };

  const pushSrc = (): { buf: (number | null)[] } => {
    const st = seriesState(0);
    st.buf.push(isNum(src) ? src : null);
    if (st.buf.length > 5000) st.buf.shift();
    return st;
  };
  const win = (st: { buf: (number | null)[] }, n: number): number[] | null => {
    if (st.buf.length < n) return null;
    const w = st.buf.slice(-n);
    return w.some((x) => x === null) ? null : (w as number[]);
  };
  const histAt = (st: { buf: (number | null)[] }, off: number): number | null => {
    const i = st.buf.length - 1 - off;
    return i >= 0 ? st.buf[i] : null;
  };

  switch (name) {
    case "tr": {
      const prev = rt.bClose.hist(bar, 1);
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), pc = prev;
      if (!isNum(h) || !isNum(l)) return null;
      if (!isNum(pc)) return h - l;
      return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    case "atr": {
      // ta.atr(length) — the length is the FIRST (only) argument
      const alen = nArg(pos, 0, 14)!;
      if (!alen) return null;
      const st = rt.setState(`${key}:atr`, () => ({ ema: new EmaState(Math.round(alen)), prevClose: null as number | null })) as { ema: EmaState; prevClose: number | null };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), pc = st.prevClose;
      st.prevClose = isNum(rt.bClose.at(bar)) ? (rt.bClose.at(bar) as number) : st.prevClose;
      if (!isNum(h) || !isNum(l)) return null;
      const tr = !isNum(pc) ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      const out = st.ema.next(tr);
      return out;
    }
    case "sma": case "wma": case "stdev": case "dev": case "variance": case "median": case "percentrank": case "sum": {
      if (!len || len <= 0) return null;
      const st = pushSrc();
      const w = win(st, Math.round(len));
      if (!w) return null;
      switch (name) {
        case "sma": return w.reduce((a, b) => a + b, 0) / w.length;
        case "sum": return w.reduce((a, b) => a + b, 0);
        case "wma": {
          const d = w.length;
          let num1 = 0, den = 0;
          for (let i = 0; i < d; i++) { const wt = d - i; num1 += w[i] * wt; den += wt; }
          return num1 / den;
        }
        case "stdev": case "variance": {
          const mean = w.reduce((a, b) => a + b, 0) / w.length;
          const v = w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length;
          return name === "variance" ? v : Math.sqrt(v);
        }
        case "dev": {
          const mean = w.reduce((a, b) => a + b, 0) / w.length;
          return w.reduce((a, b) => a + Math.abs(b - mean), 0) / w.length;
        }
        case "median": {
          const s = [...w].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
        }
        default: {
          // percentrank
          const cur = w[w.length - 1];
          const below = w.filter((x) => x < cur).length;
          return (below / (w.length - 1 || 1)) * 100;
        }
      }
    }
    case "ema": case "rma": case "vwma": case "hma": {
      if (!len || len <= 0) return null;
      const st = pushSrc();
      if (name === "vwma") {
        // vwma(src, len) = sma(src*vol)/sma(vol)
        const vs = rt.setState(`${key}:vol`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
        vs.buf.push(isNum(rt.bVolume.at(bar)) ? (rt.bVolume.at(bar) as number) : null);
        const wN = win(st, Math.round(len));
        const wV = win(vs, Math.round(len));
        if (!wN || !wV) return null;
        const sv = wV.reduce((a, b) => a + b, 0);
        return sv === 0 ? null : wN.reduce((a, b) => a + b, 0) / sv;
      }
      if (name === "hma") {
        const half = Math.max(1, Math.round(len / 2));
        const sq = Math.max(1, Math.round(Math.sqrt(len)));
        const wFull = win(st, Math.round(len));
        const stHalf = rt.setState(`${key}:hmaHalf`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
        const wHalf = win(stHalf, half);
        if (!wFull || !wHalf) return null;
        const wmaOf = (w: number[]) => {
          const d = w.length;
          let n1 = 0, dn = 0;
          for (let i = 0; i < d; i++) { const wt = d - i; n1 += w[i] * wt; dn += wt; }
          return n1 / dn;
        };
        const diff = 2 * wmaOf(wHalf) - wmaOf(wFull);
        const stD = rt.setState(`${key}:hmaDiff`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
        stD.buf.push(diff);
        const wD = win(stD, sq);
        return wD ? wmaOf(wD) : null;
      }
      const em = rt.setState(`${key}:${name}`, () => new EmaState(Math.round(len))) as EmaState;
      const w = win(st, Math.round(len));
      if (name === "ema") {
        return w ? em.next(w[w.length - 1]) : null;
      }
      // rma: Wilder smoothing (alpha = 1/len)
      if (w) return em.next(w[w.length - 1]);
      return null;
    }
    case "rsi": {
      if (!len || len <= 0) return null;
      const st = rt.setState(`${key}:rsi`, () => ({ up: new EmaState(Math.round(len)), dn: new EmaState(Math.round(len)), prev: null as number | null })) as { up: EmaState; dn: EmaState; prev: number | null };
      if (!isNum(src)) return null;
      let out: number | null = null;
      if (st.prev !== null) {
        const ch = src - st.prev;
        const up = Math.max(ch, 0);
        const dn = Math.max(-ch, 0);
        const au = st.up.next(up);
        const ad = st.dn.next(dn);
        out = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);
      }
      st.prev = src;
      return out;
    }
    case "macd": {
      const fast = nArg(pos, 1, 12)!, slow = nArg(pos, 2, 26)!, sig = nArg(pos, 3, 9)!;
      const st = rt.setState(`${key}:macd`, () => ({ f: new EmaState(fast), s: new EmaState(slow), sig: new EmaState(sig), buf: [] as (number | null)[] })) as { f: EmaState; s: EmaState; sig: EmaState; buf: (number | null)[] };
      if (!isNum(src)) { st.buf.push(null); return null; }
      const mf = st.f.next(src);
      const ms = st.s.next(src);
      const line = st.f.prev !== null && st.s.prev !== null ? mf - ms : null;
      st.buf.push(line);
      const sigIn = line !== null ? st.sig.next(line) : null;
      const signal = st.sig.prev !== null && line !== null ? sigIn : null;
      const hist = line !== null && signal !== null ? line - signal : null;
      return [line, signal, hist];
    }
    case "bb": {
      const mult = nArg(pos, 2, 2)!;
      if (!len) return null;
      const st = pushSrc();
      const w = win(st, Math.round(len));
      if (!w) return null;
      const mean = w.reduce((a, b) => a + b, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
      return [mean, mean + mult * sd, mean - mult * sd];
    }
    case "bbw": {
      const mult = nArg(pos, 2, 2)!;
      if (!len) return null;
      const st = pushSrc();
      const w = win(st, Math.round(len));
      if (!w) return null;
      const mean = w.reduce((a, b) => a + b, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / w.length);
      return mean === 0 ? null : (2 * mult * sd) / mean;
    }
    case "stoch": {
      const cL = nArg(pos, 3, nArg(pos, 1, 14)!)!;
      if (!cL) return null;
      const st = rt.setState(`${key}:stoch`, () => ({ buf: [] as { h: number; l: number; c: number }[] })) as { buf: { h: number; l: number; c: number }[] };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), c = rt.bClose.at(bar);
      if (!isNum(h) || !isNum(l) || !isNum(c)) return null;
      st.buf.push({ h, l, c });
      if (st.buf.length > cL) st.buf.shift();
      if (st.buf.length < cL) return null;
      const hh = Math.max(...st.buf.map((x) => x.h));
      const ll = Math.min(...st.buf.map((x) => x.l));
      return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
    }
    case "highest": case "lowest": {
      // highest(len) → of high; highest(src, len)
      let useLen = len;
      let series: PValue = src;
      if (pos.length === 1 && isNum(src)) {
        useLen = src;
        series = null;
      }
      if (!useLen) return null;
      const st = rt.setState(`${key}:${name}`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
      let v: number | null;
      if (series === null) {
        const hh = rt.bHigh.at(bar), ll = rt.bLow.at(bar);
        v = name === "highest" ? (isNum(hh) ? hh : null) : isNum(ll) ? ll : null;
      } else v = isNum(series) ? series : null;
      st.buf.push(v);
      if (st.buf.length > useLen) st.buf.shift();
      if (st.buf.length < useLen || st.buf.some((x) => x === null)) return null;
      const nums = st.buf as number[];
      return name === "highest" ? Math.max(...nums) : Math.min(...nums);
    }
    case "change": case "mom": {
      const off = len ?? 1;
      const st = pushSrc();
      const cur = histAt(st, 0);
      const past = histAt(st, Math.round(off));
      if (cur === null || past === null) return null;
      return cur - past;
    }
    case "roc": {
      const off = len ?? 1;
      const st = pushSrc();
      const cur = histAt(st, 0);
      const past = histAt(st, Math.round(off));
      if (cur === null || past === null || past === 0) return null;
      return ((cur - past) / past) * 100;
    }
    case "crossover": case "crossunder": case "cross": {
      const a = pos[0], b = pos[1] ?? null;
      const sa = rt.setState(`${key}:x_a`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
      const sb = rt.setState(`${key}:x_b`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
      sa.buf.push(isNum(a) ? a : null);
      sb.buf.push(isNum(b) ? b : null);
      if (sa.buf.length > 4) sa.buf.shift();
      if (sb.buf.length > 4) sb.buf.shift();
      if (sa.buf.length < 2 || sb.buf.length < 2) return false;
      const a0 = sa.buf[sa.buf.length - 1], a1 = sa.buf[sa.buf.length - 2];
      const b0 = sb.buf[sb.buf.length - 1], b1 = sb.buf[sb.buf.length - 2];
      if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
      if (name === "crossover") return a1 <= b1 && a0 > b0;
      if (name === "crossunder") return a1 >= b1 && a0 < b0;
      return (a1 <= b1 && a0 > b0) || (a1 >= b1 && a0 < b0);
    }
    case "cum": {
      const st = rt.setState(`${key}:cum`, () => ({ s: 0 })) as { s: number };
      if (isNum(src)) st.s += src;
      return st.s;
    }
    case "vwap": {
      const st = rt.setState(`${key}:vwap`, () => ({ day: -1, pv: 0, vv: 0 })) as { day: number; pv: number; vv: number };
      const t = new Date(rt.barTime());
      const day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      const tp = rt.bHlc3.at(bar);
      const v = rt.bVolume.at(bar);
      if (day !== st.day) { st.day = day; st.pv = 0; st.vv = 0; }
      if (isNum(tp) && isNum(v)) { st.pv += tp * v; st.vv += v; }
      return st.vv > 0 ? st.pv / st.vv : null;
    }
    case "wpr": {
      if (!len) return null;
      const st = rt.setState(`${key}:wpr`, () => ({ buf: [] as { h: number; l: number; c: number }[] })) as { buf: { h: number; l: number; c: number }[] };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), c = rt.bClose.at(bar);
      if (!isNum(h) || !isNum(l) || !isNum(c)) return null;
      st.buf.push({ h, l, c });
      if (st.buf.length > len) st.buf.shift();
      if (st.buf.length < len) return null;
      const hh = Math.max(...st.buf.map((x) => x.h));
      const ll = Math.min(...st.buf.map((x) => x.l));
      return hh === ll ? -50 : ((hh - c) / (hh - ll)) * -100;
    }
    case "cci": {
      if (!len) return null;
      const st = rt.setState(`${key}:cci`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
      st.buf.push(isNum(rt.bHlc3.at(bar)) ? (rt.bHlc3.at(bar) as number) : null);
      if (st.buf.length > len) st.buf.shift();
      if (st.buf.length < len || st.buf.some((x) => x === null)) return null;
      const w = st.buf as number[];
      const mean = w.reduce((a, b) => a + b, 0) / w.length;
      const md = w.reduce((a, b) => a + Math.abs(b - mean), 0) / w.length;
      return md === 0 ? 0 : (w[w.length - 1] - mean) / (0.015 * md);
    }
    case "mfi": {
      if (!len) return null;
      const st = rt.setState(`${key}:mfi`, () => ({ buf: [] as { pos: number; neg: number }[], prev: null as number | null })) as { buf: { pos: number; neg: number }[]; prev: number | null };
      const tp = rt.bHlc3.at(bar), v = rt.bVolume.at(bar);
      if (!isNum(tp) || !isNum(v)) return null;
      if (st.prev !== null) {
        const flow = (tp - st.prev) * v;
        st.buf.push({ pos: flow > 0 ? flow : 0, neg: flow < 0 ? -flow : 0 });
        if (st.buf.length > len) st.buf.shift();
      }
      st.prev = tp;
      if (st.buf.length < len) return null;
      const p = st.buf.reduce((a, b) => a + b.pos, 0);
      const ng = st.buf.reduce((a, b) => a + b.neg, 0);
      return ng === 0 ? 100 : 100 - 100 / (1 + p / ng);
    }
    case "obv": {
      const st = rt.setState(`${key}:obv`, () => ({ s: 0, prev: null as number | null })) as { s: number; prev: number | null };
      const c = rt.bClose.at(bar), v = rt.bVolume.at(bar);
      if (isNum(c) && isNum(v) && st.prev !== null) st.s += c > st.prev ? v : c < st.prev ? -v : 0;
      if (isNum(c)) st.prev = c;
      return st.s;
    }
    case "linreg": {
      const off = nArg(pos, 2, 0)!;
      if (!len) return null;
      const st = pushSrc();
      const w = win(st, Math.round(len));
      if (!w) return null;
      const d = w.length;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let i = 0; i < d; i++) { sx += i; sy += w[i]; sxy += i * w[i]; sxx += i * i; }
      const slope = (d * sxy - sx * sy) / (d * sxx - sx * sx || 1);
      const inter = (sy - slope * sx) / d;
      return inter + slope * (d - 1 - off);
    }
    case "supertrend": {
      const factor = nArg(pos, 0, 3)!;
      const alen = nArg(pos, 1, 10)!;
      const st = rt.setState(`${key}:st`, () => ({ atr: new EmaState(alen), prevClose: null as number | null, dir: 1, st: null as number | null, ub: null as number | null, lb: null as number | null })) as { atr: EmaState; prevClose: number | null; dir: 1 | -1; st: number | null; ub: number | null; lb: number | null };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), c = rt.bClose.at(bar);
      if (!isNum(h) || !isNum(l) || !isNum(c)) return [null, 0];
      const pc = st.prevClose;
      st.prevClose = c;
      const tr = !isNum(pc) ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      const a = st.atr.next(tr);
      if (st.atr.prev === null) return [null, 0];
      const hl2 = (h + l) / 2;
      let ub = hl2 + factor * a;
      let lb = hl2 - factor * a;
      const prevClose1 = rt.bClose.hist(bar, 1);
      if (st.ub !== null && (isNum(prevClose1) ? prevClose1 : c) <= st.ub) ub = Math.min(ub, st.ub);
      if (st.lb !== null && (isNum(prevClose1) ? prevClose1 : c) >= st.lb) lb = Math.max(lb, st.lb);
      st.ub = ub;
      st.lb = lb;
      const prevSt = st.st;
      if (prevSt === null) st.dir = 1;
      else if (prevSt === st.ub) st.dir = c > ub ? 1 : -1;
      else if (prevSt === st.lb) st.dir = c < lb ? -1 : 1;
      else st.dir = c > (prevSt ?? c) ? 1 : -1;
      st.st = st.dir === 1 ? lb : ub;
      return [st.st, st.dir];
    }
    case "sar": {
      const st = rt.setState(`${key}:sar`, () => ({ dir: 1, af: 0, ep: null as number | null, sar: null as number | null })) as { dir: 1 | -1; af: number; ep: number | null; sar: number | null };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar);
      if (!isNum(h) || !isNum(l)) return null;
      const inc = nArg(pos, 1, 0.02)!, mx = nArg(pos, 2, 0.2)!;
      if (st.sar === null) {
        st.dir = 1;
        st.sar = l;
        st.ep = h;
        st.af = inc;
        return st.sar;
      }
      let sar = st.sar + st.af * ((st.ep ?? h) - st.sar);
      if (st.dir === 1) {
        const prevLow = rt.bLow.hist(bar, 1);
        sar = Math.min(sar, l, isNum(prevLow) ? prevLow : l);
        if (h > (st.ep ?? h)) { st.ep = h; st.af = Math.min(mx, st.af + inc); }
        if (l < sar) { st.dir = -1; sar = st.ep ?? h; st.ep = l; st.af = inc; }
      } else {
        const prevHigh = rt.bHigh.hist(bar, 1);
        sar = Math.max(sar, h, isNum(prevHigh) ? prevHigh : h);
        if (l < (st.ep ?? l)) { st.ep = l; st.af = Math.min(mx, st.af + inc); }
        if (h > sar) { st.dir = 1; sar = st.ep ?? l; st.ep = h; st.af = inc; }
      }
      st.sar = sar;
      return sar;
    }
    case "pivothigh": case "pivotlow": {
      // (src, l, r) or (l, r)
      const isHigh = name === "pivothigh";
      let series: PValue;
      let left: number, right: number;
      if (pos.length >= 3) {
        series = pos[0];
        left = nArg(pos, 1, 5)!;
        right = nArg(pos, 2, 5)!;
      } else {
        series = isHigh ? rt.bHigh.at(bar) : rt.bLow.at(bar);
        left = nArg(pos, 0, 5)!;
        right = nArg(pos, 1, 5)!;
      }
      const st = rt.setState(`${key}:${name}`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
      st.buf.push(isNum(series) ? series : null);
      if (st.buf.length > left + right + 1) st.buf.shift();
      if (st.buf.length < left + right + 1) return null;
      const cand = st.buf[left];
      if (cand === null) return null;
      const others = st.buf.filter((_, i) => i !== left);
      return isHigh ? others.every((x) => x !== null && x < cand) ? cand : null : others.every((x) => x !== null && x > cand) ? cand : null;
    }
    case "valuewhen": {
      const cond = pos[0] === true;
      const st = rt.setState(`${key}:vw`, () => ({ hits: [] as (number | null)[] })) as { hits: (number | null)[] };
      if (cond) st.hits.push(isNum(pos[1]) ? pos[1] : null);
      const occ = Math.max(0, Math.round(nArg(pos, 2, 0)!));
      const idx = st.hits.length - 1 - occ;
      return idx >= 0 ? st.hits[idx] : null;
    }
    case "barssince": {
      const st = rt.setState(`${key}:bs`, () => ({ n: null as number | null })) as { n: number | null };
      st.n = st.n === null ? null : st.n + 1;
      if (pos[0] === true) st.n = 0;
      return st.n;
    }
    case "rising": case "falling": {
      if (!len) return false;
      const st = pushSrc();
      const w = win(st, Math.round(len) + 1);
      if (!w) return false;
      for (let i = 1; i < w.length; i++) {
        if (name === "rising" ? !(w[i] > w[i - 1]) : !(w[i] < w[i - 1])) return false;
      }
      return true;
    }
    default:
      throw new PineError(`ta.${name} is not supported yet. Supported: sma, ema, wma, rma, vwma, hma, rsi, macd, atr, tr, stdev, dev, variance, bb, bbw, stoch, highest, lowest, change, mom, roc, crossover, crossunder, cross, cum, vwap, wpr, cci, mfi, obv, linreg, supertrend, sar, pivothigh, pivotlow, valuewhen, barssince, rising, falling, median, percentrank, sum.`, site.line, site.col);
  }
}

function mathCall(rt: PineRuntime, name: string, pos: PValue[], _named: Record<string, PValue>, site: Call): PValue {
  const a = pos.map((v) => (isNum(v) ? v : null));
  const one = (f: (x: number) => number): PValue => (a[0] === null ? null : f(a[0]));
  switch (name) {
    case "abs": return one(Math.abs);
    case "sqrt": return one(Math.sqrt);
    case "exp": return one(Math.exp);
    case "log": return one(Math.log);
    case "log10": return one(Math.log10);
    case "sign": return one(Math.sign);
    case "floor": return one(Math.floor);
    case "ceil": return one(Math.ceil);
    case "round": {
      if (a[0] === null) return null;
      const d = a[1] ?? 0;
      return d > 0 ? Math.round(a[0] * 10 ** d) / 10 ** d : Math.round(a[0]);
    }
    case "pow": return a[0] === null || a[1] === null ? null : a[0] ** a[1];
    case "max": {
      const nums = a.filter((x): x is number => x !== null);
      return nums.length ? Math.max(...nums) : null;
    }
    case "min": {
      const nums = a.filter((x): x is number => x !== null);
      return nums.length ? Math.min(...nums) : null;
    }
    case "avg": {
      const nums = a.filter((x): x is number => x !== null);
      return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
    }
    case "sum": {
      // math.sum(source, length)
      const len = a[1];
      if (len === null) return null;
      const st = rt.setState(`s${site.id}:msum`, () => ({ buf: [] as (number | null)[] })) as { buf: (number | null)[] };
      st.buf.push(a[0]);
      if (st.buf.length > len) st.buf.shift();
      if (st.buf.length < len || st.buf.some((x) => x === null)) return null;
      return (st.buf as number[]).reduce((x, y) => x + y, 0);
    }
    case "todegrees": return one((x) => (x * 180) / Math.PI);
    case "toradians": return one((x) => (x * Math.PI) / 180);
    case "round_to_mintick": {
      if (a[0] === null) return null;
      const mt = rt.opts.mintick;
      return Math.round(a[0] / mt) * mt;
    }
    default:
      throw new PineError(`math.${name} is not supported.`, site.line, site.col);
  }
}

function strCall(_rt: PineRuntime, name: string, pos: PValue[], _named: Record<string, PValue>, site: Call): PValue {
  const toStr = (v: PValue): string => {
    if (v === null) return "NaN";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(10)));
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  };
  switch (name) {
    case "tostring": {
      const v = pos[0];
      if (v === null) return "NaN";
      if (typeof v === "number" && pos.length > 1) {
        const f = pos[1];
        if (f === "mintick") return v.toFixed(2);
        if (typeof f === "string") {
          const m = /\.(\#+)$/.exec(f);
          return v.toFixed(m ? m[1].length : 2);
        }
      }
      return toStr(v);
    }
    case "tonumber": {
      const v = pos[0];
      if (typeof v !== "string") return isNum(v) ? v : null;
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    }
    case "length": return typeof pos[0] === "string" ? pos[0].length : null;
    case "contains": return typeof pos[0] === "string" && typeof pos[1] === "string" ? pos[0].includes(pos[1]) : false;
    case "startswith": return typeof pos[0] === "string" && typeof pos[1] === "string" ? pos[0].startsWith(pos[1]) : false;
    case "endswith": return typeof pos[0] === "string" && typeof pos[1] === "string" ? pos[0].endsWith(pos[1]) : false;
    case "lower": return typeof pos[0] === "string" ? pos[0].toLowerCase() : null;
    case "upper": return typeof pos[0] === "string" ? pos[0].toUpperCase() : null;
    case "trim": return typeof pos[0] === "string" ? pos[0].trim() : null;
    case "substring": {
      if (typeof pos[0] !== "string") return null;
      const b = nArg(pos, 1, 0)!;
      const e = nArg(pos, 2, pos[0].length)!;
      return pos[0].slice(b, e);
    }
    case "replace": {
      if (typeof pos[0] !== "string" || typeof pos[1] !== "string") return null;
      return pos[0].split(pos[1]).join(typeof pos[2] === "string" ? pos[2] : "");
    }
    case "repeat": return typeof pos[0] === "string" ? pos[0].repeat(Math.max(0, nArg(pos, 1, 0)!)) : null;
    case "split": {
      if (typeof pos[0] !== "string" || typeof pos[1] !== "string") return null;
      return pos[0].split(pos[1]);
    }
    default:
      throw new PineError(`str.${name} is not supported.`, site.line, site.col);
  }
}

function arrCall(rt: PineRuntime, name: string, pos: PValue[], _named: Record<string, PValue>, site: Call): PValue {
  const a = pos[0];
  const asArr = (): PValue[] => {
    if (Array.isArray(a)) return a;
    throw new PineError(`array.${name} expected an array as the first argument.`, site.line, site.col);
  };
  switch (name) {
    case "new_int": case "new_float": case "new_bool": case "new_string": case "new_color": case "new_line": case "new_label": case "new_box": case "new_array": {
      const size = nArg(pos, 0, 0)!;
      const init = pos.length > 1 ? pos[1] : name.includes("int") || name.includes("float") ? 0 : name.includes("bool") ? false : name.includes("string") ? "" : null;
      return Array.from({ length: Math.max(0, Math.round(size)) }, () => (init !== null && typeof init === "object" ? init : init));
    }
    case "from": return [...pos];
    case "size": return Array.isArray(a) ? a.length : 0;
    case "get": return asArr()[Math.round(nArg(pos, 1, 0)!)] ?? null;
    case "set": {
      const arr = asArr();
      const i = Math.round(nArg(pos, 1, 0)!);
      if (i >= 0 && i < arr.length) arr[i] = pos[2] ?? null;
      return null;
    }
    case "push": {
      if (Array.isArray(a)) a.push(pos[1] ?? null);
      return null;
    }
    case "pop": {
      const arr = asArr();
      return arr.pop() ?? null;
    }
    case "shift": {
      const arr = asArr();
      return arr.shift() ?? null;
    }
    case "unshift": {
      if (Array.isArray(a)) a.unshift(pos[1] ?? null);
      return null;
    }
    case "insert": {
      const arr = asArr();
      const i = Math.round(nArg(pos, 1, 0)!);
      arr.splice(i, 0, pos[2] ?? null);
      return null;
    }
    case "remove": {
      const arr = asArr();
      const i = Math.round(nArg(pos, 1, 0)!);
      return arr.splice(i, 1)[0] ?? null;
    }
    case "clear": {
      if (Array.isArray(a)) a.length = 0;
      return null;
    }
    case "first": return asArr()[0] ?? null;
    case "last": {
      const arr = asArr();
      return arr[arr.length - 1] ?? null;
    }
    case "includes": return Array.isArray(a) ? a.some((x) => eqVal(x, pos[1] ?? null)) : false;
    case "indexof": {
      if (!Array.isArray(a)) return -1;
      for (let i = 0; i < a.length; i++) if (eqVal(a[i], pos[1] ?? null)) return i;
      return -1;
    }
    case "lastindexof": {
      if (!Array.isArray(a)) return -1;
      for (let i = a.length - 1; i >= 0; i--) if (eqVal(a[i], pos[1] ?? null)) return i;
      return -1;
    }
    case "reverse": {
      const arr = asArr();
      arr.reverse();
      return null;
    }
    case "slice": {
      const arr = asArr();
      return arr.slice(Math.round(nArg(pos, 1, 0)!), Math.round(nArg(pos, 2, arr.length)!));
    }
    case "copy": return Array.isArray(a) ? [...a] : null;
    case "join": return Array.isArray(a) ? a.map((x) => (x === null ? "NaN" : String(x))).join(typeof pos[1] === "string" ? pos[1] : ",") : null;
    case "sort": {
      const arr = asArr();
      arr.sort((x, y) => (isNum(x) && isNum(y) ? x - y : String(x).localeCompare(String(y))));
      return null;
    }
    case "min": case "max": case "sum": case "avg": {
      const arr = asArr().filter((x): x is number => isNum(x));
      if (!arr.length) return null;
      if (name === "min") return Math.min(...arr);
      if (name === "max") return Math.max(...arr);
      const s = arr.reduce((x, y) => x + y, 0);
      return name === "sum" ? s : s / arr.length;
    }
    default:
      throw new PineError(`array.${name} is not supported.`, site.line, site.col);
  }
}

function inputCall(rt: PineRuntime, kind: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const defval = pos.length > 0 ? pos[0] : kind === "bool" ? false : kind === "string" ? "" : kind === "color" ? "#2ECCFF" : 0;
  const rec = {
    id: rt.pendingInputVar ?? `input_${rt.inputs.length + 1}`,
    kind,
    title: typeof named.title === "string" ? named.title : typeof pos[1] === "string" ? pos[1] : rec_titleFallback(kind, rt.inputs.length),
    defval,
    minval: nArg(pos, 2) ?? (named.minval !== undefined && isNum(named.minval) ? named.minval : undefined),
    maxval: nArg(pos, 3) ?? (named.maxval !== undefined && isNum(named.maxval) ? named.maxval : undefined),
    step: named.step !== undefined && isNum(named.step) ? named.step : undefined,
    options: Array.isArray(named.options) ? named.options : undefined,
    group: typeof named.group === "string" ? named.group : undefined,
  };
  if (kind === "source") {
    // source inputs resolve to the named built-in series
    const s = typeof defval === "string" ? defval : "close";
    return rt.global.get(s)?.at(rt.bar) ?? null;
  }
  rt.inputs.push(rec);
  rt.pendingInputVar = null;
  return defval;
}
function rec_titleFallback(kind: string, i: number): string {
  return `${kind} ${i + 1}`;
}

function strategyCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const bar = rt.bar;
  switch (name) {
    case "entry": {
      const id = typeof pos[0] === "string" ? pos[0] : `E${rt.plan.entries.length + 1}`;
      const dirRaw = pos[1];
      const dir: 1 | -1 = dirRaw === -1 || dirRaw === "short" ? -1 : 1;
      rt.plan.entries.push({ id, dir });
      void named;
      return null;
    }
    case "exit": {
      const fromEntry = typeof named.from_entry === "string" ? named.from_entry : typeof pos[1] === "string" ? pos[1] : "";
      const stop = isNum(named.stop) ? named.stop : null;
      const limit = isNum(named.limit) ? named.limit : null;
      const orderId = typeof pos[0] === "string" ? pos[0] : `X${rt.plan.exits.length + 1}`;
      if (stop !== null || limit !== null) {
        rt.plan.exits.push({ orderId, fromEntry, stop, limit });
        // persist for the sim (last-written wins) — keyed by entry id or ""
        rt.exitOrders.set(fromEntry, { stop, limit });
      }
      return null;
    }
    case "close": {
      const id = typeof pos[0] === "string" ? pos[0] : "";
      rt.plan.closes.push(id);
      return null;
    }
    case "close_all":
      rt.plan.closeAll = true;
      return null;
    case "cancel": {
      const id = typeof pos[0] === "string" ? pos[0] : "";
      rt.plan.cancels.push(id);
      rt.exitOrders.delete(id);
      return null;
    }
    case "cancel_all":
      rt.exitOrders.clear();
      return null;
    case "opentrades":
      return rt.simPos ? 1 : 0;
    case "closedtrades":
      return rt.simTrades.length;
    default:
      throw new PineError(`strategy.${name} is not supported. Supported: entry, exit, close, close_all, cancel, cancel_all.`, site.line, site.col);
  }
  void bar;
}

function colorCall(_rt: PineRuntime, name: string, pos: PValue[], site: Call): PValue {
  if (name === "new") return withTransp(pos[0] ?? "#2ECCFF", pos[1] ?? 0);
  if (name === "rgb") {
    const r = nArg(pos, 0, 0)!, g = nArg(pos, 1, 0)!, b = nArg(pos, 2, 0)!;
    const t = nArg(pos, 3, 0)!;
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(1 - t / 100).toFixed(3)})`;
  }
  throw new PineError(`color.${name} is not supported.`, site.line, site.col);
}

function tfCall(_rt: PineRuntime, name: string, pos: PValue[], site: Call): PValue {
  if (name === "in_seconds") {
    const tf = typeof pos[0] === "string" ? pos[0] : "";
    return TF_SEC[tf] ?? 300;
  }
  if (name === "period") return "";
  throw new PineError(`timeframe.${name} is not supported.`, site.line, site.col);
}

function drawCall(rt: PineRuntime, fn: string, pos: PValue[], site: Call): PValue {
  const [ns, name] = [fn.slice(0, fn.indexOf(".")), fn.slice(fn.indexOf(".") + 1)];
  void ns;
  if (name === "new") {
    rt.drawingsCreated++;
    const kind = fn.startsWith("line") ? "line" : fn.startsWith("label") ? "label" : "box";
    const props: Record<string, unknown> = {};
    if (kind === "line") {
      props.x1 = pos[0] ?? null; props.y1 = pos[1] ?? null; props.x2 = pos[2] ?? null; props.y2 = pos[3] ?? null;
      if (pos[4] !== undefined) props.color = normalizeColor(pos[4]);
      if (pos[5] !== undefined) props.style = pos[5];
      if (pos[6] !== undefined) props.width = pos[6];
      if (pos[7] !== undefined) props.extend = pos[7];
    } else if (kind === "label") {
      props.x = pos[0] ?? null; props.y = pos[1] ?? null; props.text = typeof pos[2] === "string" ? pos[2] : "";
    } else {
      props.left = pos[0] ?? null; props.top = pos[1] ?? null; props.right = pos[2] ?? null; props.bottom = pos[3] ?? null;
    }
    for (const [k, v] of Object.entries(site ? {} : {})) props[k] = v;
    return { __d: kind, props } as PDraw;
  }
  if (name === "delete") {
    if (pos[0] && typeof pos[0] === "object" && "__d" in pos[0]) (pos[0] as PDraw).props.__deleted = true;
    return null;
  }
  // setters: set_x2(v), set_xy(x, y), set_color(v) …
  if (name.startsWith("set_") && pos[0] && typeof pos[0] === "object" && "__d" in pos[0]) {
    const d = pos[0] as PDraw;
    const attr = name.slice(4);
    if (attr === "xy") { d.props.x = pos[1] ?? null; d.props.y = pos[2] ?? null; }
    else if (attr === "xywh") { /* box */ d.props.left = pos[1] ?? null; d.props.top = pos[2] ?? null; }
    else if (attr === "points") { d.props.x1 = pos[1] ?? null; d.props.y1 = pos[2] ?? null; d.props.x2 = pos[3] ?? null; d.props.y2 = pos[4] ?? null; }
    else d.props[attr] = pos[1] ?? null;
    return null;
  }
  // getters: get_x2() …
  if (name.startsWith("get_") && pos[0] && typeof pos[0] === "object" && "__d" in pos[0]) {
    const d = pos[0] as PDraw;
    return (d.props[name.slice(4)] as PValue) ?? null;
  }
  if (name === "get_price") return null;
  if (name === "copy") return pos[0];
  return null;
}

// ── plot capture ─────────────────────────────────────────────────────────
function doPlot(rt: PineRuntime, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const key = `p${site.id}`;
  let meta = rt.plots.get(key);
  if (!meta) {
    meta = {
      meta: {
        key,
        title: typeof named.title === "string" ? named.title : typeof pos[1] === "string" ? pos[1] : `Plot ${rt.plots.size + 1}`,
        style: typeof named.style === "string" ? named.style : "line",
        color: named.color !== undefined ? normalizeColor(named.color) : "#2ECCFF",
        lineWidth: named.linewidth !== undefined && isNum(named.linewidth) ? named.linewidth : 2,
        editableColor: named.color !== undefined,
      },
      values: [],
      colors: [],
    };
    rt.plots.set(key, meta);
  }
  const v = pos[0];
  // fill gaps for bars where the plot statement didn't run
  while (meta.values.length < rt.bar) {
    meta.values.push(null);
    meta.colors.push(null);
  }
  meta.values.push(isNum(v) ? v : null);
  meta.colors.push(named.color !== undefined ? normalizeColor(named.color) : null);
  return v;
}

function doPlotShape(rt: PineRuntime, pos: PValue[], named: Record<string, PValue>, site: Call, charOverride?: string): PValue {
  const key = `s${site.id}`;
  let meta = rt.shapes.get(key);
  if (!meta) {
    meta = {
      meta: {
        key,
        title: typeof named.title === "string" ? named.title : typeof pos[1] === "string" ? pos[1] : `Shape ${rt.shapes.size + 1}`,
        style: typeof named.style === "string" ? named.style : charOverride ?? "triangleup",
        color: named.color !== undefined ? normalizeColor(named.color) : "#2ECCFF",
        location: typeof named.location === "string" ? named.location : "absolute",
        text: typeof named.text === "string" ? named.text : charOverride ?? "",
      },
      marks: [],
    };
    rt.shapes.set(key, meta);
  }
  if (pos[0] === true) {
    meta.marks.push({
      bar: rt.bar,
      up: !/down|below/.test(meta.meta.style + meta.meta.location),
      text: meta.meta.text,
      color: meta.meta.color,
    });
  }
  return null;
}

function doPlotArrow(rt: PineRuntime, pos: PValue[], site: Call): PValue {
  const key = `a${site.id}`;
  let meta = rt.shapes.get(key);
  if (!meta) {
    meta = {
      meta: { key, title: `Arrow ${rt.shapes.size + 1}`, style: "arrow", color: "#2ECCFF", location: "absolute", text: "" },
      marks: [],
    };
    rt.shapes.set(key, meta);
  }
  const v = pos[0];
  if (isNum(v) && v !== 0) {
    meta.marks.push({ bar: rt.bar, up: v > 0, text: "", color: v > 0 ? "#089981" : "#F23645" });
  }
  return null;
}
