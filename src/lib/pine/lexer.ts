// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script v5 (subset) LEXER
//  Tokenizer for the trader-authored Pine sources. Newlines and
//  indentation are significant (Pine blocks are indentation-based); inside
//  (…) / […] newlines are swallowed so wrapped call arguments just work.
// ════════════════════════════════════════════════════════════════════════

export type TokKind =
  | "nl"
  | "indent"
  | "dedent"
  | "num"
  | "str"
  | "color"
  | "ident"
  | "op"
  | "eof";

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
  "===", "!==",
  "==", "!=", "<=", ">=", ":=", "+=", "-=", "*=", "/=", "%=", "=>",
  "+", "-", "*", "/", "%", "<", ">", "=", "?", ":", ".", ",", "[", "]", "(", ")", "{", "}",
];

export const KEYWORDS = new Set([
  "if", "else", "for", "to", "by", "while", "var", "varip", "and", "or", "not",
  "true", "false", "na", "break", "continue", "switch",
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  // indentation stack — Pine convention: blocks indent deeper than parent
  const indents: number[] = [0];
  let depth = 0; // () [] nesting — suppresses NL/INDENT while > 0

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    let i = 0;
    const lineNo = li + 1;

    if (depth === 0) {
      // measure indentation
      let ind = 0;
      while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) {
        ind += raw[i] === "\t" ? 4 : 1;
        i++;
      }
      const rest = raw.slice(i);
      // blank / comment-only lines never affect indentation
      if (rest.trim() === "" || rest.trim().startsWith("//")) continue;
      if (ind > indents[indents.length - 1]) {
        indents.push(ind);
        toks.push({ kind: "indent", value: " ".repeat(ind), line: lineNo, col: 1 });
      } else {
        while (ind < indents[indents.length - 1]) {
          indents.pop();
          toks.push({ kind: "dedent", value: "", line: lineNo, col: 1 });
        }
        if (ind !== indents[indents.length - 1]) {
          throw new PineSyntaxError(
            "Inconsistent indentation — this line does not align with the block it belongs to.",
            lineNo,
            ind + 1
          );
        }
      }
    }

    while (i < raw.length) {
      const c = raw[i];
      // comment → end of line
      if (c === "/" && raw[i + 1] === "/") break;
      if (c === " " || c === "\t") {
        i++;
        continue;
      }
      const col = i + 1;

      // string literal (single or double quotes)
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

      // hex color literal #RGB[A] / #RRGGBB[AA]
      if (c === "#") {
        const m = /^#[0-9a-fA-F]{3,8}/.exec(raw.slice(i));
        if (!m) throw new PineSyntaxError("Invalid color literal after '#'.", lineNo, col);
        toks.push({ kind: "color", value: m[0], line: lineNo, col });
        i += m[0].length;
        continue;
      }

      // number (int / float / exponent)
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(raw[i + 1] ?? ""))) {
        const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(raw.slice(i))!;
        toks.push({ kind: "num", value: m[0], line: lineNo, col });
        i += m[0].length;
        continue;
      }

      // identifier / keyword / namespace
      if (IDENT_START.test(c)) {
        let j = i + 1;
        while (j < raw.length && IDENT_CHAR.test(raw[j])) j++;
        const word = raw.slice(i, j);
        toks.push({ kind: "ident", value: word, line: lineNo, col });
        i = j;
        continue;
      }

      // operators
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
  // close trailing open blocks
  while (indents.length > 1) {
    indents.pop();
    toks.push({ kind: "dedent", value: "", line: lines.length, col: 1 });
  }
  toks.push({ kind: "eof", value: "", line: lines.length + 1, col: 1 });
  return toks;
}
