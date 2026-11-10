// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script LEXER (v4 / v5 / v6)
//  Tokenizer for trader-authored Pine sources, following TradingView's
//  rules:
//    • blocks are indentation based (4 spaces or a tab per level)
//    • inside (…) / […] newlines are swallowed, so wrapped call arguments
//      just work
//    • LINE WRAPPING — a line indented by a number of spaces that is NOT a
//      multiple of 4 continues the previous line (TradingView's rule); a
//      line that follows one ending in a binary operator, "," "?" ":" or
//      "=" is treated as a continuation too
// ════════════════════════════════════════════════════════════════════════

export type TokKind = "nl" | "indent" | "dedent" | "num" | "str" | "color" | "ident" | "op" | "eof";

export interface Token {
  kind: TokKind;
  value: string;
  line: number; // 1-based
  col: number; // 1-based
}

export class PineSyntaxError extends Error {
  constructor(
    msg: string,
    public line: number,
    public col: number
  ) {
    super(msg);
  }
}

const OPS = [
  "==", "!=", "<=", ">=", ":=", "+=", "-=", "*=", "/=", "%=", "=>",
  "+", "-", "*", "/", "%", "<", ">", "=", "?", ":", ".", ",", "[", "]", "(", ")", "{", "}",
];

export const KEYWORDS = new Set([
  "if", "else", "for", "to", "by", "in", "while", "var", "varip", "and", "or", "not",
  "true", "false", "na", "break", "continue", "switch", "type", "enum", "method", "import", "export",
]);

/** tokens after which the next physical line is a continuation */
const CONT_OPS = new Set([
  "+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!=", "?", ":", ",", "=", ":=", "+=", "-=", "*=", "/=", "%=",
]);
const CONT_WORDS = new Set(["and", "or", "not"]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const NUM_RE = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;

function endsWithContinuation(toks: Token[]): boolean {
  // last real token before the pending newline
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.kind === "nl") continue;
    if (t.kind === "op") return CONT_OPS.has(t.value);
    if (t.kind === "ident") return CONT_WORDS.has(t.value);
    return false;
  }
  return false;
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const indents: number[] = [0];
  let depth = 0; // () [] nesting — suppresses NL/INDENT while > 0

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].replace(/﻿/g, "");
    let i = 0;
    const lineNo = li + 1;

    if (depth === 0) {
      let ind = 0;
      let spacesOnly = true;
      while (i < raw.length && (raw[i] === " " || raw[i] === "\t" || raw[i] === " ")) {
        if (raw[i] === "\t") { ind += 4; spacesOnly = false; } else ind += 1;
        i++;
      }
      const rest = raw.slice(i).trim();
      if (rest === "" || rest.startsWith("//")) continue; // blank / comment lines never affect indentation

      const prev = toks.length > 0 ? toks[toks.length - 1] : null;
      const isContinuation =
        prev !== null &&
        prev.kind === "nl" &&
        ind > 0 &&
        ((spacesOnly && ind % 4 !== 0) || (endsWithContinuation(toks) && ind > indents[indents.length - 1] - 0 && !(rest.startsWith("=>"))));
      if (isContinuation) {
        toks.pop(); // join with the previous logical line
      } else if (ind > indents[indents.length - 1]) {
        indents.push(ind);
        toks.push({ kind: "indent", value: " ".repeat(ind), line: lineNo, col: 1 });
      } else {
        while (ind < indents[indents.length - 1]) {
          indents.pop();
          toks.push({ kind: "dedent", value: "", line: lineNo, col: 1 });
        }
        if (ind !== indents[indents.length - 1]) {
          // tolerate a dedent that lands between two levels: snap to the
          // enclosing level (TradingView would reject; we stay forgiving and
          // let the parser judge the structure)
          indents.push(ind);
          toks.push({ kind: "indent", value: " ".repeat(ind), line: lineNo, col: 1 });
        }
      }
    }

    while (i < raw.length) {
      const c = raw[i];
      if (c === "/" && raw[i + 1] === "/") break; // comment → end of line
      if (c === " " || c === "\t" || c === " ") {
        i++;
        continue;
      }
      const col = i + 1;

      if (c === '"' || c === "'") {
        const quote = c;
        let j = i + 1;
        let out = "";
        while (j < raw.length && raw[j] !== quote) {
          if (raw[j] === "\\" && j + 1 < raw.length) {
            const nx = raw[j + 1];
            out += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
            j += 2;
            continue;
          }
          out += raw[j];
          j++;
        }
        if (j >= raw.length) throw new PineSyntaxError("Unterminated string literal.", lineNo, col);
        toks.push({ kind: "str", value: out, line: lineNo, col });
        i = j + 1;
        continue;
      }

      if (c === "#") {
        const m = /^#[0-9a-fA-F]{3,8}/.exec(raw.slice(i));
        if (!m) throw new PineSyntaxError("Invalid color literal after '#'.", lineNo, col);
        toks.push({ kind: "color", value: m[0], line: lineNo, col });
        i += m[0].length;
        continue;
      }

      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(raw[i + 1] ?? ""))) {
        const m = NUM_RE.exec(raw.slice(i))!;
        let lit = m[0];
        // "1.method" never happens in Pine, but "arr[1].x" etc. must not eat the dot
        if (lit.endsWith(".") && IDENT_START.test(raw[i + lit.length] ?? "")) lit = lit.slice(0, -1);
        toks.push({ kind: "num", value: lit, line: lineNo, col });
        i += lit.length;
        continue;
      }

      if (IDENT_START.test(c)) {
        let j = i + 1;
        while (j < raw.length && IDENT_CHAR.test(raw[j])) j++;
        toks.push({ kind: "ident", value: raw.slice(i, j), line: lineNo, col });
        i = j;
        continue;
      }

      const op = OPS.find((o) => raw.startsWith(o, i));
      if (op) {
        if (op === "(" || op === "[" || op === "{") depth++;
        if (op === ")" || op === "]" || op === "}") depth = Math.max(0, depth - 1);
        toks.push({ kind: "op", value: op, line: lineNo, col });
        i += op.length;
        continue;
      }

      throw new PineSyntaxError(`Unexpected character "${c}".`, lineNo, col);
    }

    if (depth === 0) toks.push({ kind: "nl", value: "\\n", line: lineNo, col: raw.length + 1 });
  }
  while (indents.length > 1) {
    indents.pop();
    toks.push({ kind: "dedent", value: "", line: lines.length, col: 1 });
  }
  toks.push({ kind: "eof", value: "", line: lines.length + 1, col: 1 });
  return toks;
}

/** `//@version=N` (defaults to 5 when absent, like a fresh TradingView editor) */
export function pineVersion(src: string): number {
  const m = /\/\/\s*@version\s*=\s*(\d+)/.exec(src);
  return m ? Number(m[1]) : 5;
}
