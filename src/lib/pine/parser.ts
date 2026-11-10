// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script PARSER (v4 / v5 / v6 grammar)
//  Recursive-descent parser producing the AST the runtime evaluates.
//  Covers the full TradingView statement grammar: typed declarations
//  (series/simple/const qualifiers, array<T>, map<K,V>, T[], UDT types),
//  var/varip, tuples, if/else, switch, for/to/by, for…in, while,
//  functions with typed/default parameters, methods, user-defined types,
//  enums, imports and generic constructors (array.new<float>()).
//  Every node carries line/col so compile errors point at the exact spot.
// ════════════════════════════════════════════════════════════════════════

import { PineSyntaxError, pineVersion, tokenize, type Token } from "./lexer";
import { MAX_EXPR_DEPTH } from "./limits";

export interface BaseNode {
  id: number;
  line: number;
  col: number;
}
export interface NumLit extends BaseNode { k: "num"; v: number }
export interface StrLit extends BaseNode { k: "str"; v: string }
export interface ColorLit extends BaseNode { k: "color"; v: string }
export interface BoolLit extends BaseNode { k: "bool"; v: boolean }
export interface NaLit extends BaseNode { k: "na" }
export interface Ident extends BaseNode { k: "ident"; name: string }
export interface Unary extends BaseNode { k: "unary"; op: "-" | "+" | "not"; e: Expr }
export interface Bin extends BaseNode { k: "bin"; op: string; l: Expr; r: Expr }
export interface Ternary extends BaseNode { k: "ternary"; c: Expr; a: Expr; b: Expr }
export interface Hist extends BaseNode { k: "hist"; e: Expr; n: Expr }
export interface Member extends BaseNode { k: "member"; obj: Expr; name: string }
export interface Arg { name?: string; e: Expr }
export interface Call extends BaseNode { k: "call"; callee: Expr; args: Arg[]; generic?: string }
export interface Branch { cond: Expr | null; body: Stmt[] }
export interface IfExpr extends BaseNode { k: "ifexpr"; branches: Branch[] }
export interface SwitchExpr extends BaseNode { k: "switch"; subject: Expr | null; cases: Branch[] }
export interface LoopExpr extends BaseNode { k: "loopexpr"; stmt: ForStmt | ForInStmt | WhileStmt }
export interface ArrLit extends BaseNode { k: "arrlit"; items: Expr[] }
export type Expr =
  | NumLit | StrLit | ColorLit | BoolLit | NaLit | Ident
  | Unary | Bin | Ternary | Hist | Member | Call | IfExpr | SwitchExpr | LoopExpr | ArrLit;

export interface VarDecl extends BaseNode { k: "varDecl"; isVar: boolean; varip?: boolean; name: string; init: Expr; type?: string }
export interface Reassign extends BaseNode {
  k: "reassign";
  /** plain variable name (empty when the target is a field: obj.f := …) */
  name: string;
  target: Expr;
  op: ":=" | "+=" | "-=" | "*=" | "/=" | "%=";
  e: Expr;
}
export interface TupleDecl extends BaseNode { k: "tuple"; names: string[]; isDecl: boolean; init: Expr }
export interface IfStmt extends BaseNode { k: "if"; branches: Branch[] }
export interface ForStmt extends BaseNode { k: "for"; varName: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
export interface ForInStmt extends BaseNode { k: "forin"; idxName: string | null; itemName: string; iter: Expr; body: Stmt[] }
export interface WhileStmt extends BaseNode { k: "while"; cond: Expr; body: Stmt[] }
export interface Param { name: string; def: Expr | null; type?: string }
export interface FuncDecl extends BaseNode {
  k: "func";
  name: string;
  params: Param[];
  body: Stmt[];
  singleExpr: boolean;
  isMethod?: boolean;
  /** receiver type name for methods (first parameter's type) */
  recvType?: string;
}
export interface TypeField { name: string; type: string; def: Expr | null }
export interface TypeDecl extends BaseNode { k: "typeDecl"; name: string; fields: TypeField[] }
export interface EnumField { name: string; title: string | null }
export interface EnumDecl extends BaseNode { k: "enumDecl"; name: string; fields: EnumField[] }
export interface ImportStmt extends BaseNode { k: "import"; path: string; alias: string }
export interface ExprStmt extends BaseNode { k: "expr"; e: Expr }
export interface BreakStmt extends BaseNode { k: "break" }
export interface ContinueStmt extends BaseNode { k: "continue" }
export type Stmt =
  | VarDecl | Reassign | TupleDecl | IfStmt | ForStmt | ForInStmt | WhileStmt
  | FuncDecl | TypeDecl | EnumDecl | ImportStmt | ExprStmt | BreakStmt | ContinueStmt;

export interface Program {
  body: Stmt[];
  decl: Call | null; // the indicator()/strategy()/study() declaration call
  declKind: "indicator" | "strategy" | "library" | null;
  version: number;
  nodeCount: number;
}

const QUALIFIERS = new Set(["series", "simple", "const", "input"]);
const REASSIGN_OPS = new Set([":=", "+=", "-=", "*=", "/=", "%="]);

export class Parser {
  private toks: Token[];
  private p = 0;
  private nextId = 1;
  private exprDepth = 0;
  /** set when the last construct consumed ended with a block (dedent) */
  private blockEnded = false;
  program: Program;

  constructor(src: string) {
    this.toks = tokenize(src);
    this.program = { body: [], decl: null, declKind: null, version: pineVersion(src), nodeCount: 0 };
  }

  private enterExpr(t: Token): void {
    if (++this.exprDepth > MAX_EXPR_DEPTH) {
      this.err(`This expression is nested more than ${MAX_EXPR_DEPTH} levels deep — break it into named intermediate variables.`, t);
    }
  }
  private leaveExpr(): void {
    this.exprDepth--;
  }

  // ── token helpers ─────────────────────────────────────────────────────
  private peek(off = 0): Token {
    return this.toks[Math.min(this.p + off, this.toks.length - 1)];
  }
  private at(kind: Token["kind"], value?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (value === undefined || t.value === value);
  }
  private atOp(v: string, off = 0): boolean {
    const t = this.peek(off);
    return t.kind === "op" && t.value === v;
  }
  private atIdent(v: string, off = 0): boolean {
    const t = this.peek(off);
    return t.kind === "ident" && t.value === v;
  }
  private next(): Token {
    this.blockEnded = false;
    return this.toks[this.p++];
  }
  private err(msg: string, tok: Token = this.peek()): never {
    throw new PineSyntaxError(msg, tok.line, tok.col);
  }
  private expectOp(op: string): Token {
    if (!this.at("op", op)) this.err(`Expected "${op}" but found "${this.describe(this.peek())}".`);
    return this.next();
  }
  private expectIdent(what: string): Token {
    const t = this.peek();
    if (t.kind !== "ident") this.err(`Expected ${what} but found "${this.describe(t)}".`, t);
    return this.next();
  }
  private describe(t: Token): string {
    switch (t.kind) {
      case "nl": return "end of line";
      case "eof": return "end of script";
      case "indent": return "indent";
      case "dedent": return "outdent";
      default: return t.value;
    }
  }
  private skipNls(): void {
    while (this.at("nl")) this.next();
  }
  private id(): number {
    return this.nextId++;
  }

  // ── program ───────────────────────────────────────────────────────────
  parse(): Program {
    this.skipNls();
    while (!this.at("eof")) {
      if (this.at("nl") || this.at("dedent") || this.at("indent")) { this.next(); continue; }
      const st = this.parseStmt();
      if (!st) continue;
      // the declaration statement: indicator(…) / strategy(…) / study(…) / library(…)
      if (!this.program.decl && st.k === "expr" && st.e.k === "call" && st.e.callee.k === "ident") {
        const nm = st.e.callee.name;
        if (nm === "indicator" || nm === "strategy" || nm === "study" || nm === "library") {
          this.program.decl = st.e;
          this.program.declKind = nm === "strategy" ? "strategy" : nm === "library" ? "library" : "indicator";
        }
      }
      this.program.body.push(st);
    }
    this.program.nodeCount = this.nextId - 1;
    return this.program;
  }

  /** one logical statement (consumes the trailing newline) */
  private parseStmt(): Stmt | null {
    const t = this.peek();
    if (t.kind === "indent") { this.next(); return this.parseStmt(); }
    if (t.kind === "dedent") return null;

    if (t.kind === "op" && t.value === "[") {
      const tup = this.tryTuple();
      if (tup) return tup;
    }

    if (t.kind === "ident") {
      switch (t.value) {
        case "if": {
          const st = this.parseIf();
          return st;
        }
        case "for": return this.parseFor();
        case "while": return this.parseWhile();
        case "var":
        case "varip": {
          this.next();
          return this.parseDeclAfterVar(true, t.value === "varip", t);
        }
        case "break":
          this.next();
          this.eol();
          return { k: "break", id: this.id(), line: t.line, col: t.col };
        case "continue":
          this.next();
          this.eol();
          return { k: "continue", id: this.id(), line: t.line, col: t.col };
        case "import":
          return this.parseImport();
        case "export": {
          // `export f(x) => …` · `export type …` · `export method …` (libraries)
          this.next();
          return this.parseStmt();
        }
        case "type":
          if (this.peek(1).kind === "ident" && (this.peek(2).kind === "nl" || this.peek(2).kind === "eof")) return this.parseTypeDecl();
          break;
        case "enum":
          if (this.peek(1).kind === "ident" && (this.peek(2).kind === "nl" || this.peek(2).kind === "eof")) return this.parseEnumDecl();
          break;
        case "method":
          if (this.peek(1).kind === "ident" && this.atOp("(", 2)) {
            this.next();
            return this.parseFuncDecl(true);
          }
          break;
      }
      // function declaration: name(params) =>
      if (this.atOp("(", 1) && this.isFuncDecl()) return this.parseFuncDecl(false);
    }

    // typed declaration: [qualifier] type name = expr
    const typed = this.tryTypedDecl(false, false, t);
    if (typed) return typed;

    // plain declaration
    if (t.kind === "ident" && this.atOp("=", 1)) {
      this.next();
      return this.parseVarDecl(false, false, t, t.line, t.col);
    }

    // reassignment: name := … / obj.field := … / name += …
    if (t.kind === "ident") {
      let j = 1;
      while (this.atOp(".", j) && this.peek(j + 1).kind === "ident") j += 2;
      const opTok = this.peek(j);
      if (opTok.kind === "op" && REASSIGN_OPS.has(opTok.value)) {
        let target: Expr = { k: "ident", id: this.id(), line: t.line, col: t.col, name: t.value };
        this.next();
        while (this.atOp(".")) {
          const dot = this.next();
          const nm = this.next();
          target = { k: "member", id: this.id(), line: dot.line, col: dot.col, obj: target, name: nm.value };
        }
        this.next(); // op
        const e = this.parseExpr();
        this.eol();
        return {
          k: "reassign", id: this.id(), line: t.line, col: t.col,
          name: target.k === "ident" ? target.name : "", target, op: opTok.value as Reassign["op"], e,
        };
      }
    }

    const e = this.parseExpr();
    this.eol();
    return { k: "expr", id: this.id(), line: e.line, col: e.col, e };
  }

  // ── types ─────────────────────────────────────────────────────────────
  /** try to read a type spec at the cursor; returns its text or null (cursor restored) */
  private readType(): string | null {
    const save = this.p;
    while (this.peek().kind === "ident" && QUALIFIERS.has(this.peek().value) && this.peek(1).kind === "ident") this.next();
    const t = this.peek();
    if (t.kind !== "ident") { this.p = save; return null; }
    let name = this.next().value;
    while (this.atOp(".") && this.peek(1).kind === "ident") {
      this.next();
      name += "." + this.next().value;
    }
    if (this.atOp("<")) {
      const end = this.genericEnd(this.p);
      if (end < 0) { this.p = save; return null; }
      const inner = this.toks.slice(this.p + 1, end).map((x) => x.value).join("");
      name += `<${inner}>`;
      this.p = end + 1;
    }
    if (this.atOp("[") && this.atOp("]", 1)) {
      this.next(); this.next();
      name += "[]";
    }
    return name;
  }

  /** index of the matching '>' of a generic type list starting at `start` ('<'), or -1 */
  private genericEnd(start: number): number {
    let d = 0;
    for (let i = start; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.kind === "op" && t.value === "<") d++;
      else if (t.kind === "op" && t.value === ">") {
        d--;
        if (d === 0) return i;
      } else if (t.kind === "ident" || (t.kind === "op" && (t.value === "," || t.value === "." || t.value === "[" || t.value === "]"))) {
        continue;
      } else return -1;
    }
    return -1;
  }

  private tryTypedDecl(isVar: boolean, varip: boolean, startTok: Token): Stmt | null {
    const t = this.peek();
    if (t.kind !== "ident" || ["if", "for", "while", "switch", "not", "na", "true", "false"].includes(t.value)) return null;
    const save = this.p;
    const type = this.readType();
    if (type && this.peek().kind === "ident" && this.atOp("=", 1)) {
      const nameTok = this.next();
      return this.parseVarDecl(isVar, varip, nameTok, startTok.line, startTok.col, type);
    }
    this.p = save;
    return null;
  }

  private parseDeclAfterVar(isVar: boolean, varip: boolean, startTok: Token): Stmt {
    const typed = this.tryTypedDecl(isVar, varip, startTok);
    if (typed) return typed;
    const nameTok = this.expectIdent("a variable name after 'var'");
    return this.parseVarDecl(isVar, varip, nameTok, startTok.line, startTok.col);
  }

  private parseVarDecl(isVar: boolean, varip: boolean, nameTok: Token, line: number, col: number, type?: string): Stmt {
    this.expectOp("=");
    const init = this.parseExpr();
    this.eol();
    return { k: "varDecl", id: this.id(), line, col, isVar, varip, name: nameTok.value, init, type };
  }

  /** `[a, b] = …` / `[a, b] := …` — falls back (returns null) when it is an expression */
  private tryTuple(): Stmt | null {
    const save = this.p;
    const t = this.next(); // [
    const names: string[] = [];
    while (!this.atOp("]")) {
      if (this.peek().kind !== "ident") { this.p = save; return null; }
      names.push(this.next().value);
      if (this.atOp(",")) this.next();
      else break;
    }
    if (!this.atOp("]")) { this.p = save; return null; }
    this.next();
    let isDecl = true;
    if (this.atOp(":=")) { this.next(); isDecl = false; }
    else if (this.atOp("=")) this.next();
    else { this.p = save; return null; }
    const init = this.parseExpr();
    this.eol();
    return { k: "tuple", id: this.id(), line: t.line, col: t.col, names, isDecl, init };
  }

  private isFuncDecl(): boolean {
    let i = this.p + 2; // after '('
    let d = 1;
    while (i < this.toks.length && d > 0) {
      const t = this.toks[i];
      if (t.kind === "op" && (t.value === "(" || t.value === "[")) d++;
      if (t.kind === "op" && (t.value === ")" || t.value === "]")) d--;
      if (t.kind === "nl" || t.kind === "eof") return false;
      i++;
    }
    const arrow = this.toks[i];
    return !!arrow && arrow.kind === "op" && arrow.value === "=>";
  }

  private eol(): void {
    if (this.at("nl")) { this.next(); return; }
    if (this.at("eof") || this.at("dedent")) return;
    if (this.blockEnded) return; // e.g. `x = if …` / `x = switch …` whose block just closed
    this.err(`Unexpected "${this.describe(this.peek())}" — expected the end of the statement.`);
  }

  private parseBlock(): Stmt[] {
    this.skipNls();
    if (!this.at("indent")) this.err("Expected an indented block (Pine uses 4-space indentation).");
    this.next();
    const out: Stmt[] = [];
    while (!this.at("dedent") && !this.at("eof")) {
      if (this.at("nl") || this.at("indent")) { this.next(); continue; }
      const st = this.parseStmt();
      if (st) out.push(st);
    }
    if (this.at("dedent")) this.next();
    this.blockEnded = true;
    return out;
  }

  /** block body or a single expression on the same line (switch cases / `=>`) */
  private parseArrowBody(): Stmt[] {
    if (this.at("nl")) return this.parseBlock();
    const st = this.parseInlineStmt();
    if (!this.blockEnded) {
      if (this.at("nl")) this.next();
    }
    return [st];
  }

  /** a statement on the same line as `=>` (expression, assignment or call) */
  private parseInlineStmt(): Stmt {
    const t = this.peek();
    if (t.kind === "ident") {
      let j = 1;
      while (this.atOp(".", j) && this.peek(j + 1).kind === "ident") j += 2;
      const opTok = this.peek(j);
      if (opTok.kind === "op" && REASSIGN_OPS.has(opTok.value)) {
        let target: Expr = { k: "ident", id: this.id(), line: t.line, col: t.col, name: t.value };
        this.next();
        while (this.atOp(".")) {
          const dot = this.next();
          const nm = this.next();
          target = { k: "member", id: this.id(), line: dot.line, col: dot.col, obj: target, name: nm.value };
        }
        this.next();
        const e = this.parseExpr();
        return { k: "reassign", id: this.id(), line: t.line, col: t.col, name: target.k === "ident" ? target.name : "", target, op: opTok.value as Reassign["op"], e };
      }
    }
    if (t.kind === "op" && t.value === "[") {
      // tuple value in a switch arm / function: [a, b]
      const e = this.parseExpr();
      return { k: "expr", id: this.id(), line: e.line, col: e.col, e };
    }
    const e = this.parseExpr();
    return { k: "expr", id: this.id(), line: e.line, col: e.col, e };
  }

  private parseIf(): IfStmt {
    const t = this.next(); // 'if'
    const branches: Branch[] = [];
    const cond = this.parseExpr();
    branches.push({ cond, body: this.parseBlock() });
    for (;;) {
      const save = this.p;
      this.skipNls();
      if (this.atIdent("else")) {
        this.next();
        if (this.atIdent("if")) {
          this.next();
          const c2 = this.parseExpr();
          branches.push({ cond: c2, body: this.parseBlock() });
          continue;
        }
        branches.push({ cond: null, body: this.parseBlock() });
        continue;
      }
      this.p = save;
      break;
    }
    this.blockEnded = true;
    return { k: "if", id: this.id(), line: t.line, col: t.col, branches };
  }

  private parseFor(): ForStmt | ForInStmt {
    const t = this.next(); // 'for'
    // for [i, x] in arr
    if (this.atOp("[")) {
      this.next();
      const a = this.expectIdent("an index name").value;
      this.expectOp(",");
      const b = this.expectIdent("an element name").value;
      this.expectOp("]");
      if (!this.atIdent("in")) this.err("Expected 'in' (for [i, x] in array).");
      this.next();
      const iter = this.parseExpr();
      const body = this.parseBlock();
      return { k: "forin", id: this.id(), line: t.line, col: t.col, idxName: a, itemName: b, iter, body };
    }
    const v = this.expectIdent("a loop variable after 'for'");
    if (this.atIdent("in")) {
      this.next();
      const iter = this.parseExpr();
      const body = this.parseBlock();
      return { k: "forin", id: this.id(), line: t.line, col: t.col, idxName: null, itemName: v.value, iter, body };
    }
    this.expectOp("=");
    const from = this.parseExpr();
    if (!this.atIdent("to")) this.err("Expected 'to' in the for loop (for i = 0 to 10).");
    this.next();
    const to = this.parseExpr();
    let step: Expr | null = null;
    if (this.atIdent("by")) { this.next(); step = this.parseExpr(); }
    const body = this.parseBlock();
    return { k: "for", id: this.id(), line: t.line, col: t.col, varName: v.value, from, to, step, body };
  }

  private parseWhile(): WhileStmt {
    const t = this.next();
    const cond = this.parseExpr();
    const body = this.parseBlock();
    return { k: "while", id: this.id(), line: t.line, col: t.col, cond, body };
  }

  private parseImport(): Stmt {
    const t = this.next(); // import
    let path = "";
    while (!this.at("nl") && !this.at("eof") && !this.atIdent("as")) path += this.next().value;
    let alias = path.split("/")[1] ?? path;
    if (this.atIdent("as")) {
      this.next();
      alias = this.expectIdent("a library alias").value;
    }
    this.eol();
    return { k: "import", id: this.id(), line: t.line, col: t.col, path, alias };
  }

  private parseTypeDecl(): Stmt {
    const t = this.next(); // type
    const name = this.next().value;
    const fields: TypeField[] = [];
    this.skipNls();
    if (this.at("indent")) {
      this.next();
      while (!this.at("dedent") && !this.at("eof")) {
        if (this.at("nl")) { this.next(); continue; }
        if (this.atIdent("varip")) this.next();
        const type = this.readType();
        if (!type) this.err("Expected a field type (e.g. float price).");
        const fname = this.expectIdent("a field name").value;
        let def: Expr | null = null;
        if (this.atOp("=")) { this.next(); def = this.parseExpr(); }
        fields.push({ name: fname, type, def });
        this.eol();
      }
      if (this.at("dedent")) this.next();
    }
    return { k: "typeDecl", id: this.id(), line: t.line, col: t.col, name, fields };
  }

  private parseEnumDecl(): Stmt {
    const t = this.next(); // enum
    const name = this.next().value;
    const fields: EnumField[] = [];
    this.skipNls();
    if (this.at("indent")) {
      this.next();
      while (!this.at("dedent") && !this.at("eof")) {
        if (this.at("nl")) { this.next(); continue; }
        const fname = this.expectIdent("an enum field name").value;
        let title: string | null = null;
        if (this.atOp("=")) {
          this.next();
          const s = this.peek();
          if (s.kind !== "str") this.err("Enum field titles must be string literals.", s);
          title = this.next().value;
        }
        fields.push({ name: fname, title });
        this.eol();
      }
      if (this.at("dedent")) this.next();
    }
    return { k: "enumDecl", id: this.id(), line: t.line, col: t.col, name, fields };
  }

  private parseFuncDecl(isMethod: boolean): Stmt {
    const t = this.next(); // name
    this.expectOp("(");
    const params: Param[] = [];
    while (!this.atOp(")")) {
      if (this.at("nl")) { this.next(); continue; }
      // [qualifier] [type] name [= default]
      let type: string | undefined;
      const save = this.p;
      const ty = this.readType();
      if (ty && this.peek().kind === "ident") type = ty;
      else this.p = save;
      const pn = this.expectIdent("a parameter name");
      let def: Expr | null = null;
      if (this.atOp("=")) { this.next(); def = this.parseExpr(); }
      params.push({ name: pn.value, def, type });
      if (this.atOp(",")) this.next();
      else break;
    }
    this.expectOp(")");
    this.expectOp("=>");
    const recvType = isMethod ? params[0]?.type?.replace(/^(series|simple|const)\s*/, "") : undefined;
    if (this.at("nl")) {
      const body = this.parseBlock();
      return { k: "func", id: this.id(), line: t.line, col: t.col, name: t.value, params, body, singleExpr: false, isMethod, recvType };
    }
    const st = this.parseInlineStmt();
    this.eol();
    return { k: "func", id: this.id(), line: t.line, col: t.col, name: t.value, params, body: [st], singleExpr: true, isMethod, recvType };
  }

  // ── expressions (precedence: ?: < or < and < == != < compare < +- < */% < unary < postfix) ──
  private parseExpr(): Expr {
    return this.parseTernary();
  }
  private parseTernary(): Expr {
    const c = this.parseOr();
    if (this.atOp("?")) {
      this.enterExpr(this.peek());
      const t = this.next();
      const a = this.parseTernary();
      this.expectOp(":");
      const b = this.parseTernary();
      this.leaveExpr();
      return { k: "ternary", id: this.id(), line: t.line, col: t.col, c, a, b };
    }
    return c;
  }
  private parseOr(): Expr {
    let l = this.parseAnd();
    while (this.atIdent("or")) {
      const t = this.next();
      const r = this.parseAnd();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: "or", l, r };
    }
    return l;
  }
  private parseAnd(): Expr {
    let l = this.parseEquality();
    while (this.atIdent("and")) {
      const t = this.next();
      const r = this.parseEquality();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: "and", l, r };
    }
    return l;
  }
  private parseEquality(): Expr {
    let l = this.parseCompare();
    while (this.at("op") && (this.peek().value === "==" || this.peek().value === "!=")) {
      const t = this.next();
      const r = this.parseCompare();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: t.value, l, r };
    }
    return l;
  }
  private parseCompare(): Expr {
    let l = this.parseAdd();
    while (this.at("op") && ["<", "<=", ">", ">="].includes(this.peek().value)) {
      const t = this.next();
      const r = this.parseAdd();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: t.value, l, r };
    }
    return l;
  }
  private parseAdd(): Expr {
    let l = this.parseMul();
    while (this.at("op") && (this.peek().value === "+" || this.peek().value === "-")) {
      const t = this.next();
      const r = this.parseMul();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: t.value, l, r };
    }
    return l;
  }
  private parseMul(): Expr {
    let l = this.parseUnary();
    while (this.at("op") && ["*", "/", "%"].includes(this.peek().value)) {
      const t = this.next();
      const r = this.parseUnary();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: t.value, l, r };
    }
    return l;
  }
  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "op" && (t.value === "-" || t.value === "+")) {
      this.enterExpr(t);
      this.next();
      const e = this.parseUnary();
      this.leaveExpr();
      if (e.k === "num" && t.value === "-") return { ...e, v: -e.v, line: t.line, col: t.col };
      return { k: "unary", id: this.id(), line: t.line, col: t.col, op: t.value as "-" | "+", e };
    }
    if (this.atIdent("not")) {
      this.enterExpr(t);
      this.next();
      const e = this.parseUnary();
      this.leaveExpr();
      return { k: "unary", id: this.id(), line: t.line, col: t.col, op: "not", e };
    }
    return this.parsePostfix();
  }
  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.atOp("[")) {
        const t = this.next();
        const n = this.parseExpr();
        this.expectOp("]");
        e = { k: "hist", id: this.id(), line: t.line, col: t.col, e, n };
        continue;
      }
      if (this.atOp(".")) {
        const dot = this.next();
        const nameTok = this.peek();
        if (nameTok.kind !== "ident") this.err("Expected a member name after '.'.", nameTok);
        this.next();
        e = { k: "member", id: this.id(), line: dot.line, col: dot.col, obj: e, name: nameTok.value };
        continue;
      }
      // generic constructor: array.new<float>(…) · map.new<string, int>() · matrix.new<float>()
      let generic: string | undefined;
      if (this.atOp("<") && e.k === "member" && (e.name === "new" || e.name.startsWith("new_"))) {
        const end = this.genericEnd(this.p);
        if (end > 0 && this.toks[end + 1]?.kind === "op" && this.toks[end + 1].value === "(") {
          generic = this.toks.slice(this.p + 1, end).map((x) => x.value).join("");
          this.p = end + 1;
        }
      }
      if (this.atOp("(")) {
        const t = this.next();
        const args: Arg[] = [];
        while (!this.atOp(")")) {
          if (this.at("nl")) { this.next(); continue; }
          let name: string | undefined;
          const a0 = this.peek();
          if (a0.kind === "ident" && this.atOp("=", 1)) {
            name = this.next().value;
            this.next();
          }
          const ev = this.parseExpr();
          args.push(name ? { name, e: ev } : { e: ev });
          if (this.atOp(",")) { this.next(); continue; }
          if (this.at("nl")) { this.next(); if (this.atOp(")")) break; continue; }
          break;
        }
        this.expectOp(")");
        e = { k: "call", id: this.id(), line: t.line, col: t.col, callee: e, args, generic };
        continue;
      }
      break;
    }
    return e;
  }
  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === "num") { this.next(); return { k: "num", id: this.id(), line: t.line, col: t.col, v: parseFloat(t.value) }; }
    if (t.kind === "str") { this.next(); return { k: "str", id: this.id(), line: t.line, col: t.col, v: t.value }; }
    if (t.kind === "color") { this.next(); return { k: "color", id: this.id(), line: t.line, col: t.col, v: t.value }; }
    if (this.atIdent("true")) { this.next(); return { k: "bool", id: this.id(), line: t.line, col: t.col, v: true }; }
    if (this.atIdent("false")) { this.next(); return { k: "bool", id: this.id(), line: t.line, col: t.col, v: false }; }
    if (this.atIdent("na") && !this.atOp("(", 1)) {
      this.next();
      return { k: "na", id: this.id(), line: t.line, col: t.col };
    }
    if (t.kind === "ident") {
      if (t.value === "if") {
        const st = this.parseIf();
        return { k: "ifexpr", id: st.id, line: st.line, col: st.col, branches: st.branches };
      }
      if (t.value === "switch") return this.parseSwitch();
      if (t.value === "for" || t.value === "while") {
        const st = t.value === "for" ? this.parseFor() : this.parseWhile();
        return { k: "loopexpr", id: this.id(), line: t.line, col: t.col, stmt: st };
      }
      this.next();
      return { k: "ident", id: this.id(), line: t.line, col: t.col, name: t.value };
    }
    if (t.kind === "op" && t.value === "(") {
      this.enterExpr(t);
      this.next();
      const e = this.parseExpr();
      this.expectOp(")");
      this.leaveExpr();
      return e;
    }
    if (t.kind === "op" && t.value === "[") {
      this.next();
      const items: Expr[] = [];
      while (!this.atOp("]")) {
        if (this.at("nl")) { this.next(); continue; }
        items.push(this.parseExpr());
        if (this.atOp(",")) { this.next(); continue; }
        break;
      }
      this.expectOp("]");
      return { k: "arrlit", id: this.id(), line: t.line, col: t.col, items };
    }
    this.err(`Unexpected "${this.describe(t)}" in an expression.`);
  }

  private parseSwitch(): Expr {
    const t = this.next(); // switch
    let subject: Expr | null = null;
    if (!this.at("nl")) subject = this.parseExpr();
    this.skipNls();
    if (!this.at("indent")) this.err("Expected the indented switch cases on the next lines.");
    this.next();
    const cases: Branch[] = [];
    while (!this.at("dedent") && !this.at("eof")) {
      if (this.at("nl")) { this.next(); continue; }
      let cond: Expr | null = null;
      if (this.atOp("=>")) {
        this.next();
      } else {
        cond = this.parseExpr();
        this.expectOp("=>");
      }
      const body = this.parseArrowBody();
      cases.push({ cond, body });
    }
    if (this.at("dedent")) this.next();
    this.blockEnded = true;
    return { k: "switch", id: this.id(), line: t.line, col: t.col, subject, cases };
  }
}

export function parsePine(src: string): Program {
  return new Parser(src).parse();
}
