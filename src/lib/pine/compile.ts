// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script v5 (subset) COMPILER
//  Parse + honest static validation + metadata extraction. Every script a
//  trader pastes either compiles cleanly (with a list of what it detected)
//  or fails with the exact line/col and a human explanation — never a
//  silent wrong result.
// ════════════════════════════════════════════════════════════════════════

import { parsePine, type Arg, type Call, type Expr, type Program, type Stmt } from "./parser";
import { PineError } from "./runtime";

export interface PineDiagnostic {
  line: number;
  col: number;
  msg: string;
}

export interface PineInputDef {
  id: string;
  kind: string;
  title: string;
  defval: number | boolean | string;
  minval?: number;
  maxval?: number;
  step?: number;
  options?: (number | string)[];
  group?: string;
}

export interface PinePlotDef {
  key: string;
  title: string;
  style: string;
  color?: string;
  lineWidth?: number;
}

export interface PineShapeDef {
  key: string;
  title: string;
  style: string;
  color?: string;
  location: string;
  text: string;
}

export interface CompiledPine {
  ok: boolean;
  kind: "strategy" | "indicator";
  name: string;
  overlay: boolean;
  processOrdersOnClose: boolean;
  pyramiding: number;
  inputs: PineInputDef[];
  plots: PinePlotDef[];
  shapes: PineShapeDef[];
  hlines: { price: number; title: string; color?: string }[];
  entryIds: string[];
  hasLong: boolean;
  hasShort: boolean;
  hasExitSLTP: boolean;
  hasClose: boolean;
  signalCandidates: string[];
  notes: string[]; // honest notes about tolerated-but-not-rendered features
  diagnostics: PineDiagnostic[];
}

export interface CompileResult {
  meta: CompiledPine;
  error: PineDiagnostic | null; // fatal parse error (compile stopped)
}

// ── supported-function tables (kept in sync with runtime.ts) ─────────────
const TA_FUNCS = new Set([
  "sma", "ema", "wma", "rma", "vwma", "hma", "rsi", "macd", "atr", "tr", "stdev", "dev",
  "variance", "bb", "bbw", "stoch", "highest", "lowest", "change", "mom", "roc",
  "crossover", "crossunder", "cross", "cum", "vwap", "wpr", "cci", "mfi", "obv",
  "linreg", "supertrend", "sar", "pivothigh", "pivotlow", "valuewhen", "barssince",
  "rising", "falling", "median", "percentrank", "sum",
]);
const MATH_FUNCS = new Set([
  "abs", "sqrt", "exp", "log", "log10", "sign", "floor", "ceil", "round", "pow",
  "max", "min", "avg", "sum", "todegrees", "toradians", "round_to_mintick", "pi",
]);
const STR_FUNCS = new Set([
  "tostring", "tonumber", "length", "contains", "startswith", "endswith", "lower",
  "upper", "trim", "substring", "replace", "repeat", "split",
]);
const ARR_FUNCS = new Set([
  "new_int", "new_float", "new_bool", "new_string", "new_color", "new_line", "new_label",
  "new_box", "new_array", "from", "size", "get", "set", "push", "pop", "shift", "unshift",
  "insert", "remove", "clear", "first", "last", "includes", "indexof", "lastindexof",
  "reverse", "slice", "copy", "join", "sort", "min", "max", "sum", "avg",
]);
const INPUT_FUNCS = new Set([
  "int", "float", "bool", "string", "color", "source", "time", "session", "price", "timeframe",
]);
const STRATEGY_FUNCS = new Set([
  "entry", "exit", "close", "close_all", "cancel", "cancel_all", "opentrades", "closedtrades",
  "position_size", "position_avg_price", "long", "short",
]);
const GLOBAL_FUNCS = new Set([
  "na", "nz", "fixnan", "plot", "plotshape", "plotchar", "plotarrow", "hline", "bgcolor",
  "barcolor", "fill", "alert", "alertcondition", "indicator", "strategy", "max_bars_back",
  "time", "year", "month", "dayofmonth", "hour", "minute", "dayofweek", "timestamp",
]);
const BUILTIN_VARS = new Set([
  "open", "high", "low", "close", "volume", "time", "time_close", "hl2", "hlc3", "ohlc4",
  "bar_index", "last_bar_index", "na", "true", "false",
]);
const CONST_NS = new Set([
  "color", "plot", "shape", "location", "size", "alert", "extend", "line", "label",
  "format", "display", "xloc", "yloc", "scale", "currency", "adjustment", "barstate",
  "math", "text",
]);
const BANNED_NS = new Set(["request", "ticker", "finance", "security", "earnings", "dividends", "splits", "quandl", "financial"]);

const SIGNAL_NAME_RE = /(long|short|buy|sell|bull|bear|signal|entry|exit)/i;

class Ctx {
  decls: string[] = [];
  funcs: string[] = [];
  diagnostics: PineDiagnostic[] = [];
  meta: CompiledPine;
  notes: string[] = [];
  constructor(kind: "indicator" | "strategy") {
    this.meta = {
      ok: false,
      kind,
      name: "",
      overlay: kind === "strategy",
      processOrdersOnClose: false,
      pyramiding: 0,
      inputs: [],
      plots: [],
      shapes: [],
      hlines: [],
      entryIds: [],
      hasLong: false,
      hasShort: false,
      hasExitSLTP: false,
      hasClose: false,
      signalCandidates: [],
      notes: [],
      diagnostics: [],
    };
  }
  err(msg: string, line: number, col: number): void {
    this.diagnostics.push({ line, col, msg });
  }
  hasErrors(): boolean {
    return this.diagnostics.length > 0;
  }
}

function memberPath(e: Expr): string {
  if (e.k === "ident") return e.name;
  if (e.k === "member") return `${memberPath(e.obj)}.${e.name}`;
  return "";
}

function litStr(a: Arg | undefined): string | undefined {
  return a && a.e.k === "str" ? a.e.v : undefined;
}
function litNum(a: Arg | undefined): number | undefined {
  return a && a.e.k === "num" ? a.e.v : undefined;
}
function litBool(a: Arg | undefined): boolean | undefined {
  return a && a.e.k === "bool" ? a.e.v : undefined;
}

/** rough static type inference for manual-signal candidates */
function inferBool(e: Expr, boolVars: Set<string>): boolean {
  switch (e.k) {
    case "bool":
      return true;
    case "na":
      return false;
    case "unary":
      return e.op === "not" || inferBool(e.e, boolVars);
    case "bin":
      return ["==", "!=", "<", "<=", ">", ">=", "and", "or"].includes(e.op) ||
        (inferBool(e.l, boolVars) && inferBool(e.r, boolVars));
    case "ternary":
      return inferBool(e.a, boolVars) && inferBool(e.b, boolVars);
    case "call": {
      const p = memberPath(e.callee);
      return /^(ta\.)?(crossover|crossunder|cross|rising|falling)$/.test(p);
    }
    case "ident":
      return boolVars.has(e.name);
    default:
      return false;
  }
}

export function compilePine(srcRaw: string): CompileResult {
  const src = srcRaw ?? "";
  const declGuess: "indicator" | "strategy" = /^\s*strategy\s*\(/m.test(src) ? "strategy" : "indicator";
  const ctx = new Ctx(declGuess);

  if (src.trim().length === 0) {
    return { meta: ctx.meta, error: { line: 1, col: 1, msg: "The script is empty — paste a Pine v5 indicator() or strategy() script." } };
  }
  if (src.length > 60_000) {
    return { meta: ctx.meta, error: { line: 1, col: 1, msg: `Script too large (${src.length} chars) — the HALO compiler accepts up to 60,000.` } };
  }

  let program: Program;
  try {
    program = parsePine(src);
  } catch (e) {
    if (e instanceof PineError) {
      return { meta: ctx.meta, error: { line: e.line, col: e.col, msg: e.message } };
    }
    return { meta: ctx.meta, error: { line: 0, col: 0, msg: `Parse failed: ${(e as Error).message}` } };
  }

  // declaration metadata
  if (!program.decl) {
    ctx.err("Missing the script declaration — start the script with indicator(\"…\") or strategy(\"…\").", 1, 1);
  } else {
    ctx.meta.name = litStr(program.decl.args[0]) ?? "Untitled";
    const overlayArg = program.decl.args.find((a) => a.name === "overlay");
    const ov = litBool(overlayArg);
    ctx.meta.overlay = ov ?? (ctx.meta.kind === "strategy");
    ctx.meta.processOrdersOnClose = litBool(program.decl.args.find((a) => a.name === "process_orders_on_close")) ?? false;
    ctx.meta.pyramiding = litNum(program.decl.args.find((a) => a.name === "pyramiding")) ?? 0;
    if (program.decl.args.some((a) => a.name === "calc_on_every_tick" && litBool(a) === true)) {
      ctx.notes.push("calc_on_every_tick=true is ignored — the HALO runtime evaluates confirmed bars only (Pine bar-close standard).");
    }
  }

  const boolVars = new Set<string>();
  walkBody(program.body, ctx, new Set(ctx.decls), boolVars, false);
  ctx.meta.notes = ctx.notes;

  if (!ctx.hasErrors()) {
    ctx.meta.ok = true;
    // refine kind: strategy only if it actually places orders
    if (ctx.meta.kind === "indicator" && (ctx.meta.entryIds.length > 0 || ctx.meta.hasClose)) {
      ctx.meta.kind = "strategy";
    }
    // signal candidates: boolean globals, signal-like names first
    const scored = [...boolVars].sort((a, b) => {
      const am = SIGNAL_NAME_RE.test(a) ? 0 : 1;
      const bm = SIGNAL_NAME_RE.test(b) ? 0 : 1;
      return am - bm || a.localeCompare(b);
    });
    ctx.meta.signalCandidates = scored.slice(0, 24);
  }
  ctx.meta.diagnostics = ctx.diagnostics;
  return { meta: ctx.meta, error: null };
}

// ── static walker ────────────────────────────────────────────────────────
function walkBody(body: Stmt[], ctx: Ctx, scope: Set<string>, boolVars: Set<string>, inFunc: boolean): void {
  for (const st of body) walkStmt(st, ctx, scope, boolVars, inFunc);
}

function walkStmt(st: Stmt, ctx: Ctx, scope: Set<string>, boolVars: Set<string>, inFunc: boolean): void {
  switch (st.k) {
    case "varDecl": {
      walkExpr(st.init, ctx, scope, boolVars, inFunc, st.line, st.col);
      // input extraction
      const init: Expr = st.init;
      if (init.k === "call") {
        const p = memberPath(init.callee);
        const m = /^input\.(\w+)$/.exec(p);
        if (m && INPUT_FUNCS.has(m[1])) {
          const named = (nm: string) => init.args.find((a) => a.name === nm);
          const defvalArg = init.args[0];
          const defval =
            defvalArg?.e.k === "num" ? defvalArg.e.v
            : defvalArg?.e.k === "bool" ? defvalArg.e.v
            : defvalArg?.e.k === "str" ? defvalArg.e.v
            : defvalArg?.e.k === "color" ? defvalArg.e.v
            : 0;
          const kind = m[1] === "source" ? "source" : m[1];
          if (["int", "float", "bool", "string", "color", "source"].includes(kind)) {
            ctx.meta.inputs.push({
              id: st.name,
              kind,
              title: litStr(named("title")) ?? litStr(init.args[1]) ?? st.name,
              defval: defval as number | boolean | string,
              minval: litNum(named("minval")) ?? litNum(init.args[2]),
              maxval: litNum(named("maxval")) ?? litNum(init.args[3]),
              step: litNum(named("step")),
              options: named("options") && named("options")!.e.k === "call" ? undefined : undefined,
              group: litStr(named("group")),
            });
          }
        }
      }
      if (!inFunc) {
        // global declarations: track bool-ness in declaration order
        if (inferBool(st.init, boolVars)) boolVars.add(st.name);
        else boolVars.delete(st.name);
      }
      scope.add(st.name);
      break;
    }
    case "reassign":
      walkExpr(st.e, ctx, scope, boolVars, inFunc, st.line, st.col);
      if (!scope.has(st.name) && !BUILTIN_VARS.has(st.name)) {
        ctx.err(`"${st.name}" is assigned with := before being declared. Declare it first (e.g. name = value).`, st.line, st.col);
      }
      break;
    case "tuple": {
      walkExpr(st.init, ctx, scope, boolVars, inFunc, st.line, st.col);
      // ta.supertrend destructure: [st, dir] — the direction is a signal candidate
      if (st.init.k === "call" && memberPath(st.init.callee) === "ta.supertrend" && st.names.length === 2) {
        boolVars.add(st.names[1]);
      }
      for (const nm of st.names) {
        if (st.isDecl) scope.add(nm);
        else if (!scope.has(nm)) ctx.err(`"${nm}" is assigned before being declared.`, st.line, st.col);
      }
      break;
    }
    case "if":
      for (const br of st.branches) {
        if (br.cond) walkExpr(br.cond, ctx, scope, boolVars, inFunc, br.cond.line, br.cond.col);
        walkBody(br.body, ctx, new Set(scope), boolVars, inFunc);
      }
      break;
    case "for": {
      walkExpr(st.from, ctx, scope, boolVars, inFunc, st.from.line, st.from.col);
      walkExpr(st.to, ctx, scope, boolVars, inFunc, st.to.line, st.to.col);
      if (st.step) walkExpr(st.step, ctx, scope, boolVars, inFunc, st.step.line, st.step.col);
      walkBody(st.body, ctx, new Set([...scope, st.varName]), boolVars, inFunc);
      break;
    }
    case "while":
      walkExpr(st.cond, ctx, scope, boolVars, inFunc, st.cond.line, st.cond.col);
      walkBody(st.body, ctx, new Set(scope), boolVars, inFunc);
      break;
    case "func": {
      walkFunc(st.params, st.body, ctx, scope, boolVars);
      ctx.funcs.push(st.name);
      scope.add(st.name);
      break;
    }
    case "expr":
      walkExpr(st.e, ctx, scope, boolVars, inFunc, st.e.line, st.e.col);
      break;
    default:
      break;
  }
}

function walkFunc(params: string[], body: Stmt[], ctx: Ctx, outerScope: Set<string>, boolVars: Set<string>): void {
  // Pine: function bodies may reference globals declared BEFORE the function
  walkBody(body, ctx, new Set([...outerScope, ...params]), boolVars, true);
}

function walkExpr(
  e: Expr,
  ctx: Ctx,
  scope: Set<string>,
  boolVars: Set<string>,
  inFunc: boolean,
  line: number,
  col: number
): void {
  switch (e.k) {
    case "ident": {
      if (scope.has(e.name) || BUILTIN_VARS.has(e.name) || ctx.funcs.includes(e.name)) return;
      const p = e.name;
      if (p.includes(".")) {
        const ns = p.slice(0, p.indexOf("."));
        if (BANNED_NS.has(ns)) {
          ctx.err(`${ns}.* (external data requests) is not supported — the HALO compiler works offline on the chart feed.`, e.line, e.col);
          return;
        }
        if (ns === "ta" || ns === "strategy") {
          // used as a value (e.g. strategy.position_size)
          const member = p.slice(ns.length + 1);
          if (ns === "ta") {
            ctx.err(`ta.${member} must be called as a function, e.g. ta.${member}(close, 14).`, e.line, e.col);
          } else if (!STRATEGY_FUNCS.has(member)) {
            ctx.err(`strategy.${member} is not supported.`, e.line, e.col);
          }
          return;
        }
        if (CONST_NS.has(ns)) {
          const member = p.slice(ns.length + 1);
          if (ns === "math" && !MATH_FUNCS.has(member)) {
            ctx.err(`math.${member} is not supported.`, e.line, e.col);
          }
          return;
        }
        ctx.err(`"${p}" is not available in the HALO Pine runtime.`, e.line, e.col);
        return;
      }
      ctx.err(`Unknown identifier "${e.name}" — declare it before use, or check the spelling.`, e.line, e.col);
      return;
    }
    case "unary":
      walkExpr(e.e, ctx, scope, boolVars, inFunc, line, col);
      return;
    case "bin":
      walkExpr(e.l, ctx, scope, boolVars, inFunc, line, col);
      walkExpr(e.r, ctx, scope, boolVars, inFunc, line, col);
      return;
    case "ternary":
      walkExpr(e.c, ctx, scope, boolVars, inFunc, line, col);
      walkExpr(e.a, ctx, scope, boolVars, inFunc, line, col);
      walkExpr(e.b, ctx, scope, boolVars, inFunc, line, col);
      return;
    case "ifexpr":
      for (const br of e.branches) {
        if (br.cond) walkExpr(br.cond, ctx, scope, boolVars, inFunc, line, col);
        walkBody(br.body, ctx, new Set(scope), boolVars, inFunc);
      }
      return;
    case "hist":
      walkExpr(e.e, ctx, scope, boolVars, inFunc, line, col);
      walkExpr(e.n, ctx, scope, boolVars, inFunc, line, col);
      return;
    case "arrlit":
      for (const it of e.items) walkExpr(it, ctx, scope, boolVars, inFunc, line, col);
      return;
    case "member": {
      // namespace chains (strategy.long, color.red, ta.ema as a call target…)
      // resolve statically — only walk into real expressions (method-style)
      const isChain = e.obj.k === "ident" || e.obj.k === "member";
      if (!isChain) {
        walkExpr(e.obj, ctx, scope, boolVars, inFunc, line, col);
        return;
      }
      const p = memberPath(e);
      if (!p.includes(".")) return;
      const ns = p.slice(0, p.indexOf("."));
      const member = p.slice(ns.length + 1);
      if (BANNED_NS.has(ns)) {
        ctx.err(`${ns}.* (external data requests) is not supported — the HALO compiler works offline on the chart feed.`, e.line, e.col);
        return;
      }
      if (ns === "ta") {
        ctx.err(`ta.${member} must be called as a function, e.g. ta.${member}(close, 14).`, e.line, e.col);
        return;
      }
      if (ns === "strategy") {
        if (!STRATEGY_FUNCS.has(member)) ctx.err(`strategy.${member} is not supported.`, e.line, e.col);
        return;
      }
      if (ns === "math" && !MATH_FUNCS.has(member)) {
        ctx.err(`math.${member} is not supported.`, e.line, e.col);
        return;
      }
      if (!CONST_NS.has(ns) && ns !== "barstate" && ns !== "syminfo" && ns !== "timeframe") {
        ctx.err(`"${p}" is not available in the HALO Pine runtime.`, e.line, e.col);
      }
      return;
    }
    case "call": {
      const p = memberPath(e.callee);
      if (e.callee.k === "member" && e.callee.obj.k !== "ident") {
        // method-style: obj.f(...)
        walkExpr(e.callee.obj, ctx, scope, boolVars, inFunc, line, col);
        walkArgs(e.args, ctx, scope, boolVars, inFunc);
        return;
      }
      const ns = p.includes(".") ? p.slice(0, p.indexOf(".")) : "";
      const fn = p.includes(".") ? p.slice(p.indexOf(".") + 1) : p;
      if (BANNED_NS.has(ns)) {
        ctx.err(`${ns}.${fn} (external data requests) is not supported — the HALO compiler works offline on the chart feed.`, e.line, e.col);
        return;
      }
      if (ns === "ta") {
        if (!TA_FUNCS.has(fn)) {
          ctx.err(`ta.${fn} is not supported yet.`, e.line, e.col);
        }
      } else if (ns === "math") {
        if (!MATH_FUNCS.has(fn)) ctx.err(`math.${fn} is not supported.`, e.line, e.col);
      } else if (ns === "str") {
        if (!STR_FUNCS.has(fn)) ctx.err(`str.${fn} is not supported.`, e.line, e.col);
      } else if (ns === "array") {
        if (!ARR_FUNCS.has(fn)) ctx.err(`array.${fn} is not supported.`, e.line, e.col);
      } else if (ns === "input") {
        if (!INPUT_FUNCS.has(fn)) ctx.err(`input.${fn} is not supported.`, e.line, e.col);
      } else if (ns === "strategy") {
        if (!STRATEGY_FUNCS.has(fn)) {
          ctx.err(`strategy.${fn} is not supported.`, e.line, e.col);
        } else if (fn === "entry") {
          const idArg = e.args[0];
          if (idArg && idArg.e.k === "str") ctx.meta.entryIds.push(idArg.e.v);
          const dirArg = e.args[1];
          if (dirArg) {
            // direction may be direct (strategy.long) or conditional
            // (fireDir == -1 ? strategy.short : strategy.long) — scan the subtree
            const scan = (x: Expr): void => {
              if (x.k === "member") {
                const dp = memberPath(x);
                if (dp === "strategy.long") ctx.meta.hasLong = true;
                if (dp === "strategy.short") ctx.meta.hasShort = true;
              }
              if (x.k === "ternary") { scan(x.a); scan(x.b); }
              if (x.k === "bin") { scan(x.l); scan(x.r); }
              if (x.k === "unary") scan(x.e);
            };
            scan(dirArg.e);
            if (dirArg.e.k === "num" && dirArg.e.v === 1) ctx.meta.hasLong = true;
            if (dirArg.e.k === "num" && dirArg.e.v === -1) ctx.meta.hasShort = true;
          }
        } else if (fn === "exit") {
          if (e.args.some((a) => (a.name === "stop" || a.name === "limit"))) ctx.meta.hasExitSLTP = true;
        } else if (fn === "close" || fn === "close_all") {
          ctx.meta.hasClose = true;
        }
      } else if (ns === "color" || ns === "timeframe" || ns === "line" || ns === "label" || ns === "box") {
        if (ns === "line" || ns === "label" || ns === "box") {
          if (!ctx.notes.includes("Drawing objects (line/label/box) run for script logic but are NOT rendered on the HALO chart."))
            ctx.notes.push("Drawing objects (line/label/box) run for script logic but are NOT rendered on the HALO chart.");
        }
      } else if (ns === "barstate" || ns === "syminfo") {
        ctx.err(`${ns}.${fn} is a value, not a function — drop the parentheses.`, e.line, e.col);
        return;
      } else if (ns !== "") {
        ctx.err(`"${p}()" is not available in the HALO Pine runtime.`, e.line, e.col);
        return;
      } else {
        // global function
        if (!ctx.funcs.includes(fn) && !GLOBAL_FUNCS.has(fn)) {
          ctx.err(`Unknown function "${fn}()" — declare it above its first use, or check the supported list.`, e.line, e.col);
          return;
        }
        if (fn === "plot") {
          const title = litStr(e.args.find((a) => a.name === "title")) ?? litStr(e.args[1]) ?? `Plot ${ctx.meta.plots.length + 1}`;
          const style = e.args.find((a) => a.name === "style");
          ctx.meta.plots.push({
            key: `plot${ctx.meta.plots.length}`,
            title,
            style: style && style.e.k === "member" ? style.e.name.replace(/^style_/, "") : "line",
            color: e.args.find((a) => a.name === "color" && (a.e.k === "color" || a.e.k === "str" || a.e.k === "member" && memberPath(a.e).startsWith("color.")))
              ? undefined : undefined,
            lineWidth: litNum(e.args.find((a) => a.name === "linewidth")),
          });
        } else if (fn === "plotshape" || fn === "plotchar") {
          const title = litStr(e.args.find((a) => a.name === "title")) ?? litStr(e.args[1]) ?? `${fn} ${ctx.meta.shapes.length + 1}`;
          const styleArg = e.args.find((a) => a.name === "style");
          ctx.meta.shapes.push({
            key: `shape${ctx.meta.shapes.length}`,
            title,
            style: styleArg && styleArg.e.k === "member" ? styleArg.e.name.replace(/^shape_/, "") : fn === "plotchar" ? "circle" : "triangleup",
            color: undefined,
            location: "abovebar",
            text: litStr(e.args.find((a) => a.name === "text")) ?? "",
          });
        } else if (fn === "hline") {
          const price = litNum(e.args[0]);
          if (price !== undefined) {
            ctx.meta.hlines.push({
              price,
              title: litStr(e.args.find((a) => a.name === "title")) ?? litStr(e.args[1]) ?? "",
            });
          }
        }
      }
      walkArgs(e.args, ctx, scope, boolVars, inFunc);
      return;
    }
    default:
      return;
  }
}

function walkArgs(args: Arg[], ctx: Ctx, scope: Set<string>, boolVars: Set<string>, inFunc: boolean): void {
  for (const a of args) {
    walkExpr(a.e, ctx, scope, boolVars, inFunc, a.e.line, a.e.col);
  }
}
