// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script COMPILER (v4 / v5 / v6)
//  Parse + static validation + metadata extraction + a short dry run on
//  synthetic candles. Names are validated against the SAME tables the
//  runtime dispatches on, so a script that compiles is a script that runs.
//  Every script either compiles cleanly (with notes on what is accepted but
//  not drawn on the HALO chart) or fails with the exact line/col and a
//  human explanation — the same way TradingView's editor reports errors.
// ════════════════════════════════════════════════════════════════════════

import { parsePine, type Arg, type Bin, type Expr, type Program, type Stmt } from "./parser";
import { PineSyntaxError } from "./lexer";
import { PineError } from "./values";
import { MAX_PINE_CHARS, MAX_PINE_LINES, pineLimitMessage } from "./limits";
import { FUNC_NAMES, VAR_NAMES, V4_ALIASES, CAST_FUNCS, isConstantPath } from "./builtins";
import { TA_SIGS, TA_VARS } from "./ta";
import { PineRuntime } from "./runtime";

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
  notes: string[]; // honest notes about accepted-but-not-rendered features
  diagnostics: PineDiagnostic[];
  version?: number;
}

export interface CompileResult {
  meta: CompiledPine;
  error: PineDiagnostic | null; // fatal parse error (compile stopped)
}

const SIGNAL_NAME_RE = /(long|short|buy|sell|bull|bear|signal|entry|exit)/i;
const NOTE_DRAW = "Drawing objects (line/label/box) run for script logic but are NOT rendered on the HALO chart.";
const NOTE_TABLE = "Tables, bgcolor, barcolor and fill run normally but are not drawn on the HALO chart.";

class Ctx {
  diagnostics: PineDiagnostic[] = [];
  notes: string[] = [];
  meta: CompiledPine;
  funcs = new Set<string>();
  methods = new Set<string>();
  types = new Set<string>();
  enums = new Map<string, Set<string>>();
  imports = new Map<string, string>();
  globals = new Set<string>();
  version = 5;
  constructor(kind: "indicator" | "strategy") {
    this.meta = {
      ok: false, kind, name: "", overlay: kind === "strategy", processOrdersOnClose: false, pyramiding: 0,
      inputs: [], plots: [], shapes: [], hlines: [], entryIds: [], hasLong: false, hasShort: false,
      hasExitSLTP: false, hasClose: false, signalCandidates: [], notes: [], diagnostics: [],
    };
  }
  err(msg: string, line: number, col: number): void {
    if (this.diagnostics.length < 50) this.diagnostics.push({ line, col, msg });
  }
  note(n: string): void {
    if (!this.notes.includes(n)) this.notes.push(n);
  }
}

function memberPath(e: Expr): string {
  if (e.k === "ident") return e.name;
  if (e.k === "member") {
    const p = memberPath(e.obj);
    return p ? `${p}.${e.name}` : "";
  }
  return "";
}
function rootName(e: Expr): string | null {
  let x = e;
  while (x.k === "member") x = x.obj;
  return x.k === "ident" ? x.name : null;
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
    case "bool": return true;
    case "na": return false;
    case "unary": return e.op === "not" || inferBool(e.e, boolVars);
    case "ternary": return inferBool(e.a, boolVars) && inferBool(e.b, boolVars);
    case "bin": {
      switch (e.op) {
        case "==": case "!=": case "<": case "<=": case ">": case ">=":
          return true;
        case "and":
          return inferBool(e.l, boolVars) && inferBool(e.r, boolVars);
        case "or": {
          const spine: Expr[] = [];
          let cur: Expr = e;
          while (cur.k === "bin" && (cur as Bin).op === "or") {
            spine.push((cur as Bin).r);
            cur = (cur as Bin).l;
          }
          if (inferBool(cur, boolVars)) return true;
          for (let i = spine.length - 1; i >= 0; i--) if (inferBool(spine[i], boolVars)) return true;
          return false;
        }
        default:
          return inferBool(e.l, boolVars) && inferBool(e.r, boolVars);
      }
    }
    case "call": {
      const p = memberPath(e.callee);
      return /^(ta\.)?(crossover|crossunder|cross|rising|falling)$/.test(p) || p === "na" || /^str\.(contains|startswith|endswith)$/.test(p) || p === "timeframe.change";
    }
    case "hist": return inferBool(e.e, boolVars);
    case "ident": return boolVars.has(e.name);
    default: return false;
  }
}

const V3_VARS = new Set(["n", "tickerid", "ticker", "period", "interval", "isintraday", "isdwm", "isdaily", "isweekly", "ismonthly"]);
function isKnownVarPath(p: string, version: number): boolean {
  return VAR_NAMES.has(p) || isConstantPath(p, version) || (version <= 3 && V3_VARS.has(p));
}

export function compilePine(srcRaw: string): CompileResult {
  const src = srcRaw ?? "";
  const declGuess: "indicator" | "strategy" = /^\s*strategy\s*\(/m.test(src) ? "strategy" : "indicator";
  const ctx = new Ctx(declGuess);

  if (src.trim().length === 0) {
    return { meta: ctx.meta, error: { line: 1, col: 1, msg: "The script is empty — paste a Pine indicator() or strategy() script." } };
  }
  const lineCount = src.replace(/\r\n?/g, "\n").split("\n").length;
  if (src.length > MAX_PINE_CHARS || lineCount > MAX_PINE_LINES) {
    return { meta: ctx.meta, error: { line: 1, col: 1, msg: pineLimitMessage(src.length, lineCount) } };
  }

  let program: Program;
  try {
    program = parsePine(src);
  } catch (e) {
    if (e instanceof PineError || e instanceof PineSyntaxError) {
      return { meta: ctx.meta, error: { line: e.line, col: e.col, msg: e.message } };
    }
    return { meta: ctx.meta, error: { line: 0, col: 0, msg: `Parse failed: ${(e as Error).message}` } };
  }
  ctx.version = program.version;
  ctx.meta.version = program.version;

  // declaration metadata
  if (!program.decl) {
    ctx.err("Missing the script declaration — start the script with indicator(\"…\") or strategy(\"…\").", 1, 1);
  } else {
    const d = program.decl;
    const named = (n: string) => d.args.find((a) => a.name === n);
    ctx.meta.name = litStr(named("title")) ?? litStr(d.args.find((a) => !a.name)) ?? "Untitled";
    const ov = litBool(named("overlay")) ?? litBool(d.args.filter((a) => !a.name)[2]);
    ctx.meta.overlay = ov ?? ctx.meta.kind === "strategy";
    ctx.meta.processOrdersOnClose = litBool(named("process_orders_on_close")) ?? false;
    ctx.meta.pyramiding = litNum(named("pyramiding")) ?? 0;
    if (litBool(named("calc_on_every_tick")) === true) ctx.note("calc_on_every_tick=true is ignored — the HALO runtime evaluates confirmed bars only (Pine bar-close standard).");
    if (program.declKind === "library") ctx.note("This is a library script — it compiles, but libraries produce no plots or trades on their own.");
  }

  // hoisted names (functions, methods, types, enums, imports, top-level variables)
  const collectGlobals = (body: Stmt[]) => {
    for (const st of body) {
      if (st.k === "func") (st.isMethod ? ctx.methods : ctx.funcs).add(st.name);
      else if (st.k === "typeDecl") ctx.types.add(st.name);
      else if (st.k === "enumDecl") ctx.enums.set(st.name, new Set(st.fields.map((f) => f.name)));
      else if (st.k === "import") ctx.imports.set(st.alias, st.path);
      else if (st.k === "varDecl") ctx.globals.add(st.name);
      else if (st.k === "tuple" && st.isDecl) st.names.forEach((n) => ctx.globals.add(n));
    }
  };
  collectGlobals(program.body);

  const boolVars = new Set<string>();
  walkBody(program.body, ctx, new Set<string>(), boolVars, false);

  if (ctx.diagnostics.length === 0) {
    // short dry run on synthetic candles — catches runtime faults before the
    // trader attaches the script (time-boxed; never blocks a heavy script)
    const dry = dryRun(src);
    if (dry) ctx.err(dry.msg, dry.line, dry.col);
  }

  ctx.meta.notes = ctx.notes;
  if (ctx.diagnostics.length === 0) {
    ctx.meta.ok = true;
    if (ctx.meta.kind === "indicator" && (ctx.meta.entryIds.length > 0 || ctx.meta.hasClose)) ctx.meta.kind = "strategy";
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

// ── dry run ──────────────────────────────────────────────────────────────
function synth(n: number): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  let s = 1234567;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let px = 2000;
  const t0 = Date.UTC(2026, 0, 5, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = px + Math.sin(i / 9) * 2 + (r() - 0.5) * 4;
    const h = Math.max(o, c) + r() * 2;
    const l = Math.min(o, c) - r() * 2;
    out.push({ time: t0 + i * 300000, open: o, high: h, low: l, close: c, volume: 500 + r() * 1000 });
    px = c;
  }
  return out;
}
function dryRun(src: string): PineDiagnostic | null {
  const started = Date.now();
  try {
    const rt = new PineRuntime(src, { mintick: 0.01, ticker: "XAUUSD", tf: "5m", pipMult: 10 });
    rt.budgetMs = 1500;
    const bars = synth(320);
    rt.knownLastBar = bars.length - 1; // exercise `if barstate.islast` branches too
    for (const c of bars) {
      rt.processBar(c);
      if (Date.now() - started > 900) break;
    }
  } catch (e) {
    if (e instanceof PineError) {
      if (/^runtime\.error/.test(e.message) || /budget/.test(e.message)) return null;
      return { line: e.line, col: e.col, msg: e.message };
    }
    const pe = e as { message?: string; line?: number; col?: number };
    if (pe && typeof pe.line === "number") return { line: pe.line, col: pe.col ?? 0, msg: pe.message ?? "Runtime error" };
    return { line: 0, col: 0, msg: `Runtime check failed: ${(e as Error)?.message ?? e}` };
  }
  return null;
}

// ── static walker ────────────────────────────────────────────────────────
function walkBody(body: Stmt[], ctx: Ctx, scope: Set<string>, boolVars: Set<string>, inFunc: boolean): void {
  for (const st of body) walkStmt(st, ctx, scope, boolVars, inFunc);
}

function inScope(name: string, ctx: Ctx, scope: Set<string>): boolean {
  return scope.has(name) || ctx.globals.has(name);
}

function walkStmt(st: Stmt, ctx: Ctx, scope: Set<string>, boolVars: Set<string>, inFunc: boolean): void {
  switch (st.k) {
    case "varDecl": {
      walkExpr(st.init, ctx, scope, boolVars);
      const init: Expr = st.init;
      if (init.k === "call") {
        const p = memberPath(init.callee);
        const m = /^input(?:\.(\w+))?$/.exec(p);
        if (m) {
          const kind0 = m[1] ?? "input";
          const named = (nm: string) => init.args.find((a) => a.name === nm);
          const posArgs = init.args.filter((a) => !a.name);
          const defArg = named("defval") ?? posArgs[0];
          const defval =
            defArg?.e.k === "num" ? defArg.e.v
            : defArg?.e.k === "bool" ? defArg.e.v
            : defArg?.e.k === "str" ? defArg.e.v
            : defArg?.e.k === "color" ? defArg.e.v
            : defArg?.e.k === "ident" ? defArg.e.name
            : 0;
          let kind = kind0;
          if (kind === "input") kind = typeof defval === "boolean" ? "bool" : typeof defval === "string" ? (defArg?.e.k === "ident" ? "source" : "string") : "float";
          if (["int", "float", "bool", "string", "color", "source", "timeframe", "session", "symbol", "price", "time", "text_area", "enum"].includes(kind)) {
            const opt = named("options");
            ctx.meta.inputs.push({
              id: st.name,
              kind,
              title: litStr(named("title")) ?? litStr(posArgs[1]) ?? st.name,
              defval: defval as number | boolean | string,
              minval: litNum(named("minval")) ?? (kind === "int" || kind === "float" ? litNum(posArgs[2]) : undefined),
              maxval: litNum(named("maxval")) ?? (kind === "int" || kind === "float" ? litNum(posArgs[3]) : undefined),
              step: litNum(named("step")),
              options: opt && opt.e.k === "arrlit" ? opt.e.items.map((x) => (x.k === "num" ? x.v : x.k === "str" ? x.v : "")) : undefined,
              group: litStr(named("group")),
            });
          }
        }
      }
      if (!inFunc) {
        if (inferBool(st.init, boolVars) || st.type === "bool") boolVars.add(st.name);
        else boolVars.delete(st.name);
      }
      scope.add(st.name);
      break;
    }
    case "reassign":
      walkExpr(st.e, ctx, scope, boolVars);
      if (st.target.k === "member") {
        walkExpr(st.target.obj, ctx, scope, boolVars);
      } else if (!inScope(st.name, ctx, scope)) {
        ctx.err(`"${st.name}" is assigned with := before being declared. Declare it first (e.g. ${st.name} = value).`, st.line, st.col);
      }
      break;
    case "tuple": {
      walkExpr(st.init, ctx, scope, boolVars);
      if (st.init.k === "call" && memberPath(st.init.callee) === "ta.supertrend" && st.names.length === 2) boolVars.add(st.names[1]);
      for (const nm of st.names) {
        if (st.isDecl) scope.add(nm);
        else if (!inScope(nm, ctx, scope)) ctx.err(`"${nm}" is assigned before being declared.`, st.line, st.col);
      }
      break;
    }
    case "if":
      for (const br of st.branches) {
        if (br.cond) walkExpr(br.cond, ctx, scope, boolVars);
        walkBody(br.body, ctx, new Set(scope), boolVars, inFunc);
      }
      break;
    case "for": {
      walkExpr(st.from, ctx, scope, boolVars);
      walkExpr(st.to, ctx, scope, boolVars);
      if (st.step) walkExpr(st.step, ctx, scope, boolVars);
      walkBody(st.body, ctx, new Set([...scope, st.varName]), boolVars, inFunc);
      break;
    }
    case "forin": {
      walkExpr(st.iter, ctx, scope, boolVars);
      const s2 = new Set([...scope, st.itemName]);
      if (st.idxName) s2.add(st.idxName);
      walkBody(st.body, ctx, s2, boolVars, inFunc);
      break;
    }
    case "while":
      walkExpr(st.cond, ctx, scope, boolVars);
      walkBody(st.body, ctx, new Set(scope), boolVars, inFunc);
      break;
    case "func": {
      const fs = new Set<string>();
      for (const p of st.params) {
        if (p.def) walkExpr(p.def, ctx, scope, boolVars);
        fs.add(p.name);
      }
      walkBody(st.body, ctx, fs, boolVars, true);
      break;
    }
    case "typeDecl":
      for (const f of st.fields) if (f.def) walkExpr(f.def, ctx, scope, boolVars);
      break;
    case "expr":
      walkExpr(st.e, ctx, scope, boolVars);
      break;
    default:
      break;
  }
}

function walkExpr(e: Expr, ctx: Ctx, scope: Set<string>, boolVars: Set<string>): void {
  switch (e.k) {
    case "ident": {
      const n = e.name;
      if (inScope(n, ctx, scope) || isKnownVarPath(n, ctx.version)) return;
      if (ctx.funcs.has(n) || FUNC_NAMES.has(n)) {
        ctx.err(`"${n}" is a function — call it with parentheses, e.g. ${n}(…).`, e.line, e.col);
        return;
      }
      if (ctx.types.has(n) || ctx.enums.has(n)) return;
      ctx.err(`Undeclared identifier "${n}" — declare it before use, or check the spelling.`, e.line, e.col);
      return;
    }
    case "unary":
      walkExpr(e.e, ctx, scope, boolVars);
      return;
    case "bin": {
      const spine: Expr[] = [];
      let cur: Expr = e;
      while (cur.k === "bin") {
        spine.push((cur as Bin).r);
        cur = (cur as Bin).l;
      }
      walkExpr(cur, ctx, scope, boolVars);
      for (let i = spine.length - 1; i >= 0; i--) walkExpr(spine[i], ctx, scope, boolVars);
      return;
    }
    case "ternary":
      walkExpr(e.c, ctx, scope, boolVars);
      walkExpr(e.a, ctx, scope, boolVars);
      walkExpr(e.b, ctx, scope, boolVars);
      return;
    case "ifexpr":
      for (const br of e.branches) {
        if (br.cond) walkExpr(br.cond, ctx, scope, boolVars);
        walkBody(br.body, ctx, new Set(scope), boolVars, true);
      }
      return;
    case "switch":
      if (e.subject) walkExpr(e.subject, ctx, scope, boolVars);
      for (const cs of e.cases) {
        if (cs.cond) walkExpr(cs.cond, ctx, scope, boolVars);
        walkBody(cs.body, ctx, new Set(scope), boolVars, true);
      }
      return;
    case "loopexpr":
      walkStmt(e.stmt, ctx, scope, boolVars, true);
      return;
    case "hist":
      walkExpr(e.e, ctx, scope, boolVars);
      walkExpr(e.n, ctx, scope, boolVars);
      return;
    case "arrlit":
      for (const it of e.items) walkExpr(it, ctx, scope, boolVars);
      return;
    case "member": {
      const root = rootName(e);
      const isChain = root !== null && (e.obj.k === "ident" || e.obj.k === "member");
      if (!isChain || inScope(root!, ctx, scope)) {
        walkExpr(e.obj, ctx, scope, boolVars);
        return;
      }
      const p = memberPath(e);
      const en = ctx.enums.get(root!);
      if (en) {
        if (e.obj.k === "ident" && !en.has(e.name)) ctx.err(`Enum ${root} has no field "${e.name}".`, e.line, e.col);
        return;
      }
      if (ctx.imports.has(root!)) {
        ctx.err(`"${p}" comes from the imported library "${ctx.imports.get(root!)}". The HALO compiler cannot download TradingView libraries — paste the library's functions into the script.`, e.line, e.col);
        return;
      }
      if (isKnownVarPath(p, ctx.version)) return;
      if (root === "ta") {
        const m = p.slice(3);
        if (TA_SIGS[m] && !TA_VARS.includes(m)) ctx.err(`ta.${m} must be called as a function, e.g. ta.${m}(close, 14).`, e.line, e.col);
        else ctx.err(`"${p}" is not a TradingView variable.`, e.line, e.col);
        return;
      }
      if (root === "color") {
        ctx.err(`"${p}" is not a TradingView color — use color.red, color.new(…), color.rgb(…) or a #hex literal.`, e.line, e.col);
        return;
      }
      if (FUNC_NAMES.has(p)) {
        ctx.err(`"${p}" is a function — call it with parentheses.`, e.line, e.col);
        return;
      }
      ctx.err(`"${p}" is not available in the HALO Pine runtime.`, e.line, e.col);
      return;
    }
    case "call": {
      const callee = e.callee;
      // report call errors at the START of the function name (like TradingView)
      let head: Expr = callee;
      while (head.k === "member") head = head.obj;
      const at = { line: head.line, col: head.col };
      e = { ...e, line: at.line, col: at.col };
      if (callee.k === "ident") {
        const fn = callee.name;
        if (!(ctx.funcs.has(fn) || FUNC_NAMES.has(fn) || CAST_FUNCS.has(fn) || V4_ALIASES[fn] !== undefined)) {
          if (inScope(fn, ctx, scope)) ctx.err(`"${fn}" is a variable, not a function.`, e.line, e.col);
          else ctx.err(`Could not find function "${fn}()" — declare it, or check the spelling.`, e.line, e.col);
          return;
        }
        if (!ctx.funcs.has(fn)) extractCallMeta(fn, e, ctx);
        else if (fn !== "security") void 0;
        if (fn === "security" || V4_ALIASES[fn] === "request.security") securityNotes(e, ctx);
        walkArgs(e.args, ctx, scope, boolVars);
        return;
      }
      if (callee.k === "member") {
        const root = rootName(callee);
        const isChain = root !== null && (callee.obj.k === "ident" || callee.obj.k === "member");
        if (!isChain || inScope(root!, ctx, scope)) {
          // method call on a value
          walkExpr(callee.obj, ctx, scope, boolVars);
          walkArgs(e.args, ctx, scope, boolVars);
          return;
        }
        const p = memberPath(callee);
        const objPath = memberPath(callee.obj);
        if (ctx.types.has(objPath) && (callee.name === "new" || callee.name === "copy")) {
          walkArgs(e.args, ctx, scope, boolVars);
          return;
        }
        if (ctx.imports.has(root!)) {
          ctx.err(`"${p}()" comes from the imported library "${ctx.imports.get(root!)}". The HALO compiler cannot download TradingView libraries — paste the library's functions into the script.`, e.line, e.col);
          return;
        }
        if (!FUNC_NAMES.has(p)) {
          if (root === "ta") ctx.err(`ta.${p.slice(3)} is not a TradingView function.`, e.line, e.col);
          else if (isKnownVarPath(p, ctx.version)) ctx.err(`${p} is a value, not a function — drop the parentheses.`, e.line, e.col);
          else ctx.err(`Could not find function "${p}()" — it is not a TradingView built-in (or not available in the HALO runtime).`, e.line, e.col);
          return;
        }
        extractCallMeta(p, e, ctx);
        walkArgs(e.args, ctx, scope, boolVars);
        return;
      }
      walkExpr(callee, ctx, scope, boolVars);
      walkArgs(e.args, ctx, scope, boolVars);
      return;
    }
    default:
      return;
  }
}

function walkArgs(args: Arg[], ctx: Ctx, scope: Set<string>, boolVars: Set<string>): void {
  for (const a of args) walkExpr(a.e, ctx, scope, boolVars);
}

function securityNotes(e: { args: Arg[] }, ctx: Ctx): void {
  const posArgs = e.args.filter((a) => !a.name);
  const sym = e.args.find((a) => a.name === "symbol") ?? posArgs[0];
  if (sym) {
    const p = memberPath(sym.e);
    const isChart = p === "syminfo.tickerid" || p === "syminfo.ticker" || (sym.e.k === "str" && sym.e.v === "");
    if (!isChart) ctx.note("request.security() on another symbol reads the chart symbol's data — HALO's feed carries one symbol per chart.");
  }
  ctx.note("request.security() on a higher timeframe runs the script on candles built from the chart feed (TradingView's non-repainting behaviour); lower timeframes use the chart timeframe.");
}

function extractCallMeta(fnRaw: string, e: { args: Arg[]; line: number; col: number }, ctx: Ctx): void {
  const fn = V4_ALIASES[fnRaw] && !FUNC_NAMES.has(fnRaw) ? V4_ALIASES[fnRaw] : fnRaw;
  const named = (n: string) => e.args.find((a) => a.name === n);
  const posArgs = e.args.filter((a) => !a.name);
  if (fn === "request.security") securityNotes(e, ctx);
  else if (/^request\.(financial|quandl|economic|dividends|earnings|splits|seed)$/.test(fn)) ctx.note(`${fn}() needs TradingView's external data and returns na on HALO.`);
  else if (fn === "strategy.entry" || fn === "strategy.order") {
    const idArg = named("id") ?? posArgs[0];
    if (idArg && idArg.e.k === "str") ctx.meta.entryIds.push(idArg.e.v);
    const dirArg = named("direction") ?? posArgs[1];
    if (dirArg) {
      const scan = (x: Expr): void => {
        if (x.k === "member") {
          const dp = memberPath(x);
          if (dp === "strategy.long") ctx.meta.hasLong = true;
          if (dp === "strategy.short") ctx.meta.hasShort = true;
        }
        if (x.k === "bool") { if (x.v) ctx.meta.hasLong = true; else ctx.meta.hasShort = true; }
        if (x.k === "ternary") { scan(x.a); scan(x.b); }
        if (x.k === "bin") { scan(x.l); scan(x.r); }
        if (x.k === "unary") scan(x.e);
        if (x.k === "num") { if (x.v === 1) ctx.meta.hasLong = true; if (x.v === -1) ctx.meta.hasShort = true; }
      };
      scan(dirArg.e);
    }
  } else if (fn === "strategy.exit") {
    if (e.args.some((a) => a.name === "stop" || a.name === "limit" || a.name === "profit" || a.name === "loss") || posArgs.length >= 6) ctx.meta.hasExitSLTP = true;
    if (e.args.some((a) => a.name?.startsWith("trail_"))) ctx.note("strategy.exit trailing stops (trail_*) are accepted; the HALO simulator applies the fixed stop/limit only.");
  } else if (fn === "strategy.close" || fn === "strategy.close_all") {
    ctx.meta.hasClose = true;
  } else if (/^(line|label|box|polyline|linefill)\./.test(fn)) {
    ctx.note(NOTE_DRAW);
  } else if (/^table\./.test(fn) || fn === "bgcolor" || fn === "barcolor" || fn === "fill") {
    ctx.note(NOTE_TABLE);
  } else if (fn === "plot") {
    const title = litStr(named("title")) ?? litStr(posArgs[1]) ?? `Plot ${ctx.meta.plots.length + 1}`;
    const style = named("style") ?? posArgs[4];
    ctx.meta.plots.push({
      key: `plot${ctx.meta.plots.length}`,
      title,
      style: style && style.e.k === "member" ? style.e.name.replace(/^style_/, "") : "line",
      lineWidth: litNum(named("linewidth")),
    });
  } else if (fn === "plotshape" || fn === "plotchar" || fn === "plotarrow") {
    const title = litStr(named("title")) ?? litStr(posArgs[1]) ?? `${fn} ${ctx.meta.shapes.length + 1}`;
    const styleArg = named("style") ?? (fn === "plotshape" ? posArgs[2] : undefined);
    const locArg = named("location") ?? (fn !== "plotarrow" ? posArgs[3] : undefined);
    ctx.meta.shapes.push({
      key: `shape${ctx.meta.shapes.length}`,
      title,
      style: styleArg && styleArg.e.k === "member" ? styleArg.e.name.replace(/^shape_/, "") : fn === "plotchar" ? "circle" : fn === "plotarrow" ? "arrow" : "xcross",
      location: locArg && locArg.e.k === "member" ? locArg.e.name : "abovebar",
      text: litStr(named("text")) ?? "",
    });
  } else if (fn === "hline") {
    const price = litNum(named("price") ?? posArgs[0]);
    if (price !== undefined) ctx.meta.hlines.push({ price, title: litStr(named("title")) ?? litStr(posArgs[1]) ?? "" });
  }
}
