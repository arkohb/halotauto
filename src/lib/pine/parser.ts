// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script v5 (subset) PARSER
//  Recursive-descent parser producing the AST the runtime evaluates.
//  Every node carries line/col so compile errors point at the exact spot.
// ════════════════════════════════════════════════════════════════════════

import { PineSyntaxError, tokenize, type Token } from "./lexer";

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
export interface Call extends BaseNode { k: "call"; callee: Expr; args: Arg[] }
export interface IfExpr extends BaseNode { k: "ifexpr"; branches: { cond: Expr | null; body: Stmt[] }[] }
export interface ArrLit extends BaseNode { k: "arrlit"; items: Expr[] }
export type Expr =
  | NumLit | StrLit | ColorLit | BoolLit | NaLit | Ident
  | Unary | Bin | Ternary | Hist | Member | Call | IfExpr | ArrLit;

export interface VarDecl extends BaseNode { k: "varDecl"; isVar: boolean; name: string; init: Expr }
export interface Reassign extends BaseNode { k: "reassign"; name: string; op: ":=" | "+=" | "-=" | "*=" | "/=" | "%="; e: Expr }
export interface TupleDecl extends BaseNode { k: "tuple"; names: string[]; isDecl: boolean; init: Expr }
export interface IfStmt extends BaseNode { k: "if"; branches: { cond: Expr | null; body: Stmt[] }[] }
export interface ForStmt extends BaseNode { k: "for"; varName: string; from: Expr; to: Expr; step: Expr | null; body: Stmt[] }
export interface WhileStmt extends BaseNode { k: "while"; cond: Expr; body: Stmt[] }
export interface FuncDecl extends BaseNode { k: "func"; name: string; params: string[]; body: Stmt[]; singleExpr: boolean }
export interface ExprStmt extends BaseNode { k: "expr"; e: Expr }
export interface BreakStmt extends BaseNode { k: "break" }
export interface ContinueStmt extends BaseNode { k: "continue" }
export type Stmt =
  | VarDecl | Reassign | TupleDecl | IfStmt | ForStmt | WhileStmt
  | FuncDecl | ExprStmt | BreakStmt | ContinueStmt;

export interface Program {
  body: Stmt[];
  decl: Call | null; // the indicator()/strategy() declaration call
  declKind: "indicator" | "strategy" | null;
  nodeCount: number;
}

export class Parser {
  private toks: Token[];
  private p = 0;
  private nextId = 1;
  program: Program = { body: [], decl: null, declKind: null, nodeCount: 0 };

  constructor(src: string) {
    this.toks = tokenize(src);
  }

  // ── token helpers ─────────────────────────────────────────────────────
  private peek(off = 0): Token {
    return this.toks[Math.min(this.p + off, this.toks.length - 1)];
  }
  private at(kind: Token["kind"], value?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (value === undefined || t.value === value);
  }
  private atIdent(v: string, off = 0): boolean {
    const t = this.peek(off);
    return t.kind === "ident" && t.value === v;
  }
  private next(): Token {
    return this.toks[this.p++];
  }
  private err(msg: string, tok: Token = this.peek()): never {
    throw new PineSyntaxError(msg, tok.line, tok.col);
  }
  private expectOp(op: string): Token {
    if (!this.at("op", op)) this.err(`Expected "${op}" but found "${this.describe(this.peek())}".`);
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
    // declaration line: indicator(...) / strategy(...) / library(...)
    if (this.atIdent("indicator") || this.atIdent("strategy") || this.atIdent("library")) {
      const t = this.peek();
      if (this.peek(1).kind === "op" && this.peek(1).value === "(") {
        const e = this.parseExpr() as Call;
        if (e.k !== "call") this.err("Expected the script declaration call.", t);
        if (e.callee.k === "ident" && e.callee.name === "library") {
          this.err("Pine libraries are not supported — paste a strategy() or indicator() script.", t);
        }
        this.program.decl = e;
        this.program.declKind = e.callee.k === "ident" && e.callee.name === "strategy" ? "strategy" : "indicator";
      }
    }
    while (!this.at("eof")) {
      if (this.at("nl")) { this.next(); continue; }
      if (this.at("dedent")) { this.next(); continue; }
      const st = this.parseStmt();
      if (st) this.program.body.push(st);
    }
    this.program.nodeCount = this.nextId - 1;
    return this.program;
  }

  /** one logical statement (consumes trailing newline) */
  private parseStmt(): Stmt | null {
    const t = this.peek();
    if (t.kind === "indent") { this.next(); return this.parseStmt(); }
    if (t.kind === "dedent") return null;

    // tuple destructuring: [a, b] = f()  /  [a, b] := f()
    if (t.kind === "op" && t.value === "[") return this.parseTuple();

    if (t.kind === "ident") {
      switch (t.value) {
        case "if": return this.parseIf();
        case "for": return this.parseFor();
        case "while": return this.parseWhile();
        case "var":
        case "varip": {
          // `var name = …`  ·  `var float name = …`  ·  `var float[] name = …`
          //  ·  `var array<line> name = …` — optional type annotations
          const TYPE_WORDS = new Set(["float", "int", "bool", "string", "color", "line", "label", "box", "array", "matrix", "map"]);
          const t1 = this.peek(1);
          if (t1.kind === "ident" && TYPE_WORDS.has(t1.value)) {
            this.next(); this.next(); // var + type word
            if (this.at("op", "[") && this.peek(1).kind === "op" && this.peek(1).value === "]") { this.next(); this.next(); }
            else if (this.at("op", "<")) {
              let d = 1;
              while (d > 0 && !this.at("eof")) {
                const tv = this.next();
                if (tv.kind === "op" && tv.value === "<") d++;
                if (tv.kind === "op" && tv.value === ">") d--;
              }
            }
            const nameTok = this.peek();
            if (nameTok.kind !== "ident") this.err("Expected a variable name after the type annotation.", nameTok);
            this.next();
            return this.parseVarDecl(true, nameTok, t.line, t.col);
          }
          if (t1.kind === "ident") { this.next(); this.next(); return this.parseVarDecl(true, t1, t.line, t.col); }
          break;
        }
        case "break": {
          this.next();
          this.eol();
          return { k: "break", id: this.id(), line: t.line, col: t.col };
        }
        case "continue": {
          this.next();
          this.eol();
          return { k: "continue", id: this.id(), line: t.line, col: t.col };
        }
        case "import":
        case "export":
          this.err("Pine libraries / imports are not supported by the HALO compiler — paste a self-contained script.", t);
          break;
        case "type":
          this.err("User-defined types (UDTs) are not supported by the HALO compiler yet.", t);
          break;
        case "switch":
          this.err("switch expressions are not supported — use if / else or the ?: operator.", t);
          break;
        case "method":
          this.err("method function declarations are not supported — declare plain functions with f(x) => .", t);
          break;
      }
      // function declaration: name(params) =>
      if (this.peek(1).kind === "op" && this.peek(1).value === "(" && this.isFuncDecl()) {
        return this.parseFuncDecl();
      }
      // tuple assignment: [a, b] = f()  /  [a, b] := f()
      if (t.value === "[" || (this.peek(1).kind === "op" && this.peek(1).value === "[")) {
        // could be tuple decl only if starts with [
        if (t.value === "[") return this.parseTuple();
      }
    }

    // typed declaration without var: `float fireEntry = na` · `bool remove = false`
    const TYPE_WORDS0 = new Set(["float", "int", "bool", "string", "color", "line", "label", "box"]);
    if (t.kind === "ident" && TYPE_WORDS0.has(t.value)) {
      const t1 = this.peek(1);
      const t2 = this.peek(2);
      if (t1.kind === "ident" && t2.kind === "op" && t2.value === "=") {
        this.next(); // type word
        const nameTok = this.next(); // name
        return this.parseVarDecl(false, nameTok, t.line, t.col);
      }
      // `float[] x = …`
      if (t1.kind === "op" && t1.value === "[" && this.peek(2).kind === "op" && this.peek(2).value === "]" && this.peek(3).kind === "ident" && this.peek(4).kind === "op" && this.peek(4).value === "=") {
        this.next(); this.next(); this.next(); // type [ ]
        const nameTok = this.next();
        return this.parseVarDecl(false, nameTok, t.line, t.col);
      }
    }

    // plain statement: declaration, reassignment or expression
    const nt = this.peek(1);
    if (t.kind === "ident" && nt.kind === "op" && (nt.value === "=" )) {
      this.next(); // consume the variable name
      return this.parseVarDecl(false, t, t.line, t.col);
    }
    if (t.kind === "ident" && nt.kind === "op" && [":=", "+=", "-=", "*=", "/=", "%="].includes(nt.value)) {
      this.next(); this.next();
      const e = this.parseExpr();
      this.eol();
      return { k: "reassign", id: this.id(), line: t.line, col: t.col, name: t.value, op: nt.value as Reassign["op"], e };
    }
    const e = this.parseExpr();
    this.eol();
    return { k: "expr", id: this.id(), line: e.line, col: e.col, e };
  }

  private isFuncDecl(): boolean {
    // lookahead: ident ( params ) =>
    let i = this.p + 2; // after '('
    let d = 1;
    while (i < this.toks.length && d > 0) {
      const t = this.toks[i];
      if (t.kind === "op" && t.value === "(") d++;
      if (t.kind === "op" && t.value === ")") d--;
      i++;
    }
    const close = this.toks[i - 1];
    const arrow = this.toks[i];
    return !!close && close.kind === "op" && close.value === ")" && !!arrow && arrow.kind === "op" && arrow.value === "=>";
  }

  private eol(): void {
    if (this.at("nl")) this.next();
    else if (!this.at("eof") && !this.at("dedent")) this.err(`Unexpected "${this.describe(this.peek())}" — expected the end of the statement.`);
  }

  private parseVarDecl(isVar: boolean, nameTok: Token, line: number, col: number): Stmt {
    this.expectOp("=");
    const init = this.parseExpr();
    this.eol();
    return { k: "varDecl", id: this.id(), line, col, isVar, name: nameTok.value, init };
  }

  private parseTuple(): Stmt {
    const t = this.expectOp("[");
    const names: string[] = [];
    while (!this.at("op", "]")) {
      const idTok = this.peek();
      if (idTok.kind !== "ident") this.err("Expected a variable name inside the [a, b, …] tuple.", idTok);
      names.push(this.next().value);
      if (this.at("op", ",")) this.next();
      else break;
    }
    this.expectOp("]");
    let isDecl = true;
    if (this.at("op", ":=")) { this.next(); isDecl = false; }
    else this.expectOp("=");
    const init = this.parseExpr();
    this.eol();
    return { k: "tuple", id: this.id(), line: t.line, col: t.col, names, isDecl, init };
  }

  private parseBlock(): Stmt[] {
    this.skipNls();
    if (!this.at("indent")) this.err("Expected an indented block (Pine uses 4-space indentation).");
    this.next();
    const out: Stmt[] = [];
    while (!this.at("dedent") && !this.at("eof")) {
      if (this.at("nl")) { this.next(); continue; }
      const st = this.parseStmt();
      if (st) out.push(st);
    }
    if (this.at("dedent")) this.next();
    return out;
  }

  private parseIf(): Stmt {
    const t = this.next(); // 'if'
    const branches: { cond: Expr | null; body: Stmt[] }[] = [];
    const cond = this.parseExpr();
    branches.push({ cond, body: this.parseBlock() });
    // else / else if chains — at the same indent level
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
    return { k: "if", id: this.id(), line: t.line, col: t.col, branches };
  }

  private parseFor(): Stmt {
    const t = this.next(); // 'for'
    const v = this.peek();
    if (v.kind !== "ident") this.err("Expected a loop variable after 'for'.", v);
    this.next();
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

  private parseWhile(): Stmt {
    const t = this.next();
    const cond = this.parseExpr();
    const body = this.parseBlock();
    return { k: "while", id: this.id(), line: t.line, col: t.col, cond, body };
  }

  private parseFuncDecl(): Stmt {
    const t = this.next(); // name
    this.expectOp("(");
    const params: string[] = [];
    while (!this.at("op", ")")) {
      const p = this.peek();
      if (p.kind !== "ident") this.err("Expected a parameter name.", p);
      params.push(this.next().value);
      if (this.at("op", ",")) this.next();
      else break;
    }
    this.expectOp(")");
    this.expectOp("=>");
    // single-expression body or indented block
    if (this.at("nl")) {
      const body = this.parseBlock();
      return { k: "func", id: this.id(), line: t.line, col: t.col, name: t.value, params, body, singleExpr: false };
    }
    const e = this.parseExpr();
    this.eol();
    return { k: "func", id: this.id(), line: t.line, col: t.col, name: t.value, params, body: [{ k: "expr", id: this.id(), line: e.line, col: e.col, e }], singleExpr: true };
  }

  // ── expressions (precedence: ?: < or < and < compare < +- < */% < unary < postfix) ──
  private parseExpr(): Expr {
    return this.parseTernary();
  }
  private parseTernary(): Expr {
    const c = this.parseOr();
    if (this.at("op", "?")) {
      const t = this.next();
      const a = this.parseTernary();
      this.expectOp(":");
      const b = this.parseTernary();
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
    let l = this.parseCompare();
    while (this.atIdent("and")) {
      const t = this.next();
      const r = this.parseCompare();
      l = { k: "bin", id: this.id(), line: t.line, col: t.col, op: "and", l, r };
    }
    return l;
  }
  private parseCompare(): Expr {
    let l = this.parseAdd();
    while (this.at("op") && ["==", "!=", "<", "<=", ">", ">="].includes(this.peek().value)) {
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
      this.next();
      const e = this.parseUnary();
      return { k: "unary", id: this.id(), line: t.line, col: t.col, op: t.value as "-" | "+", e };
    }
    if (this.atIdent("not")) {
      this.next();
      const e = this.parseUnary();
      return { k: "unary", id: this.id(), line: t.line, col: t.col, op: "not", e };
    }
    return this.parsePostfix();
  }
  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.at("op", "[")) {
        const t = this.next();
        const n = this.parseExpr();
        this.expectOp("]");
        e = { k: "hist", id: this.id(), line: t.line, col: t.col, e, n };
        continue;
      }
      if (this.at("op", ".")) {
        const dot = this.next();
        const nameTok = this.peek();
        if (nameTok.kind !== "ident") this.err("Expected a member name after '.'.", nameTok);
        this.next();
        e = { k: "member", id: this.id(), line: dot.line, col: dot.col, obj: e, name: nameTok.value };
        continue;
      }
      if (this.at("op", "(")) {
        const t = this.next();
        const args: Arg[] = [];
        while (!this.at("op", ")")) {
          if (this.at("nl")) { this.next(); continue; }
          // named arg: ident '=' (not ==)
          let name: string | undefined;
          const a0 = this.peek();
          if (a0.kind === "ident" && this.peek(1).kind === "op" && this.peek(1).value === "=") {
            name = this.next().value;
            this.next();
          }
          const ev = this.parseExpr();
          args.push(name ? { name, e: ev } : { e: ev });
          if (this.at("op", ",")) { this.next(); continue; }
          if (this.at("nl")) { this.next(); if (this.at("op", ")")) break; continue; }
          break;
        }
        this.expectOp(")");
        e = { k: "call", id: this.id(), line: t.line, col: t.col, callee: e, args };
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
    if (this.atIdent("na")) {
      // `na` alone is the na literal; `na(x)` is the na-test function
      const nx = this.peek(1);
      if (!(nx.kind === "op" && nx.value === "(")) {
        this.next();
        return { k: "na", id: this.id(), line: t.line, col: t.col };
      }
    }
    if (t.kind === "ident") {
      // if-expression: value = if cond …
      if (t.value === "if") {
        const st = this.parseIf();
        return { k: "ifexpr", id: st.id, line: st.line, col: st.col, branches: (st as IfStmt).branches };
      }
      this.next();
      return { k: "ident", id: this.id(), line: t.line, col: t.col, name: t.value };
    }
    if (t.kind === "op" && t.value === "(") {
      this.next();
      const e = this.parseExpr();
      this.expectOp(")");
      return e;
    }
    // array literal: ["Instant", "Bar close"] — used by input options=[…]
    if (t.kind === "op" && t.value === "[") {
      this.next();
      const items: Expr[] = [];
      while (!this.at("op", "]")) {
        if (this.at("nl")) { this.next(); continue; }
        items.push(this.parseExpr());
        if (this.at("op", ",")) { this.next(); continue; }
        break;
      }
      this.expectOp("]");
      return { k: "arrlit", id: this.id(), line: t.line, col: t.col, items };
    }
    this.err(`Unexpected "${this.describe(t)}" in an expression.`);
  }
}

export function parsePine(src: string): Program {
  return new Parser(src).parse();
}
