// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine value model + shared helpers
//  (types, na-aware arithmetic, colours, number/string formatting,
//   timeframes and timezones). Pure module — no runtime state.
// ════════════════════════════════════════════════════════════════════════

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
export type DrawKind = "line" | "label" | "box" | "table" | "linefill" | "polyline" | "plot" | "hline";
export type PDraw = { __d: DrawKind; props: Record<string, unknown> };
export type PUdt = { __t: string; f: Record<string, PValue> };
export type PMap = { __map: Map<unknown, PValue> };
export type PMatrix = { __mx: PValue[][] };
export type PEnum = { __e: string; k: string; title: string };
export type PFuncVal = { __f: true; name: string };
export type PObj = PDraw | PUdt | PMap | PMatrix | PEnum | PFuncVal;
export type PValue = number | boolean | string | PObj | PValue[] | null;

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
export function num(v: PValue, ctx: string): number {
  if (!isNum(v)) throw new PineError(`${ctx} expected a number (got ${typeName(v)}).`);
  return v;
}
export function isDraw(v: unknown): v is PDraw {
  return !!v && typeof v === "object" && "__d" in (v as object);
}
export function isUdt(v: unknown): v is PUdt {
  return !!v && typeof v === "object" && "__t" in (v as object);
}
export function isMap(v: unknown): v is PMap {
  return !!v && typeof v === "object" && "__map" in (v as object);
}
export function isMatrix(v: unknown): v is PMatrix {
  return !!v && typeof v === "object" && "__mx" in (v as object);
}
export function isEnum(v: unknown): v is PEnum {
  return !!v && typeof v === "object" && "__e" in (v as object);
}
export function typeName(v: PValue): string {
  if (v === null) return "na";
  if (Array.isArray(v)) return "array";
  if (isDraw(v)) return v.__d;
  if (isUdt(v)) return v.__t;
  if (isMap(v)) return "map";
  if (isMatrix(v)) return "matrix";
  if (isEnum(v)) return v.__e;
  if (typeof v === "object") return "function";
  return typeof v === "boolean" ? "bool" : typeof v === "number" ? "float" : "string";
}

// ── na-aware operators ───────────────────────────────────────────────────
export function eqVal(l: PValue, r: PValue): boolean {
  if (l === null || r === null) return false;
  return l === r;
}
export function cmpVal(l: PValue, r: PValue, cmp: (a: number, b: number) => boolean): boolean {
  if (typeof l === "string" && typeof r === "string") return cmp(l < r ? -1 : l > r ? 1 : 0, 0);
  if (!isNum(l) || !isNum(r)) return false;
  return cmp(l, r);
}
export function addVal(l: PValue, r: PValue): PValue {
  if (typeof l === "string" || typeof r === "string") return l === null || r === null ? null : `${l}${r}`;
  if (!isNum(l) || !isNum(r)) return null;
  return l + r;
}
export function subVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r)) return null;
  return l - r;
}
export function mulVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r)) return null;
  return l * r;
}
export function divVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r) || r === 0) return null;
  return l / r;
}
export function modVal(l: PValue, r: PValue): PValue {
  if (!isNum(l) || !isNum(r) || r === 0) return null;
  return l % r;
}
export function applyBin(op: string, l: PValue, r: PValue, line: number, col: number): PValue {
  switch (op) {
    case "==": return eqVal(l, r);
    case "!=": return l === null || r === null ? false : l !== r;
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
      throw new PineError(`Unsupported operator "${op}".`, line, col);
  }
}

/** Pine truthiness: true, or (v4/v5 implicit cast) a non-zero number */
export function truthy(v: PValue): boolean {
  if (v === true) return true;
  if (typeof v === "number") return Number.isFinite(v) && v !== 0;
  return false;
}

// ── colours ──────────────────────────────────────────────────────────────
export const NAMED_COLORS: Record<string, string> = {
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
export interface Rgba { r: number; g: number; b: number; a: number }
export function parseColor(c: PValue): Rgba | null {
  if (typeof c !== "string") return null;
  const s = normalizeColor(c);
  if (s.startsWith("#")) {
    const h = s.slice(1);
    const full = h.length === 3 || h.length === 4 ? h.split("").map((x) => x + x).join("") : h;
    const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
    const a = full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [r, g, b].some((x) => Number.isNaN(x)) ? null : { r, g, b, a };
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
  return null;
}
export function rgbaStr(c: Rgba): string {
  const cl = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return `rgba(${cl(c.r)},${cl(c.g)},${cl(c.b)},${Math.max(0, Math.min(1, c.a)).toFixed(3)})`;
}

// ── formatting ───────────────────────────────────────────────────────────
export function defaultNumStr(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toPrecision(10)));
}
/** Pine number format patterns: "#.##", "0.00", "#,###.0", "#" … */
export function formatPattern(v: number, pat: string): string {
  const pctSuffix = pat.endsWith("%");
  const p = pctSuffix ? pat.slice(0, -1) : pat;
  const val = pctSuffix ? v * 100 : v;
  const dot = p.indexOf(".");
  const frac = dot >= 0 ? p.slice(dot + 1) : "";
  const minD = (frac.match(/0/g) ?? []).length;
  const maxD = frac.length;
  let s = val.toFixed(maxD);
  if (maxD > minD) {
    // trim optional (#) decimals
    const [ip, fp = ""] = s.split(".");
    let f = fp;
    while (f.length > minD && f.endsWith("0")) f = f.slice(0, -1);
    s = f.length ? `${ip}.${f}` : ip;
  }
  if (p.includes(",")) {
    const [ip, fp] = s.split(".");
    const neg = ip.startsWith("-");
    const digits = neg ? ip.slice(1) : ip;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    s = (neg ? "-" : "") + grouped + (fp !== undefined ? `.${fp}` : "");
  }
  return pctSuffix ? `${s}%` : s;
}
export function decimalsOf(step: number): number {
  if (!isNum(step) || step <= 0) return 2;
  const s = String(step);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const d = s.split(".")[1];
  return d ? d.length : 0;
}
export function formatVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${parseFloat((v / 1e9).toFixed(3))}B`;
  if (a >= 1e6) return `${parseFloat((v / 1e6).toFixed(3))}M`;
  if (a >= 1e3) return `${parseFloat((v / 1e3).toFixed(3))}K`;
  return defaultNumStr(parseFloat(v.toFixed(2)));
}

// ── timeframes ───────────────────────────────────────────────────────────
/** HALO chart timeframe ("5m", "1h", "1d", "1w") → seconds */
export function haloTfSec(tf: string): number {
  const m = /^(\d+)\s*(s|m|h|d|w|mo|M)$/.exec(tf.trim());
  if (!m) return 300;
  const n = Number(m[1]);
  switch (m[2]) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    case "w": return n * 604800;
    default: return n * 2592000;
  }
}
/** TradingView timeframe string ("", "5", "60", "1D", "W", "3M", "30S", "4H") → seconds, or null for chart TF */
export function tvTfSec(tf: string | null | undefined): number | null {
  if (tf === null || tf === undefined) return null;
  const s = String(tf).trim().toUpperCase();
  if (s === "") return null;
  const m = /^(\d*)\s*([SDWMH]?)$/.exec(s);
  if (!m) {
    const h = /^(\d+)\s*(MIN|M)$/.exec(s);
    return h ? Number(h[1]) * 60 : null;
  }
  const n = m[1] === "" ? 1 : Number(m[1]);
  switch (m[2]) {
    case "S": return n;
    case "H": return n * 3600;
    case "D": return n * 86400;
    case "W": return n * 604800;
    case "M": return n * 2592000;
    default: return n * 60;
  }
}
/** seconds → TradingView period string ("5", "60", "D", "W", "M", "30S") */
export function secToTv(sec: number): string {
  if (sec % 2592000 === 0) return sec === 2592000 ? "M" : `${sec / 2592000}M`;
  if (sec % 604800 === 0) return sec === 604800 ? "W" : `${sec / 604800}W`;
  if (sec % 86400 === 0) return sec === 86400 ? "D" : `${sec / 86400}D`;
  if (sec % 60 === 0) return String(sec / 60);
  return `${sec}S`;
}
const DAY = 86400000;
/** start of the higher-timeframe bucket containing t (UTC-aligned; weeks start Monday) */
export function bucketStart(t: number, sec: number): number {
  if (sec % 2592000 === 0) {
    const n = sec / 2592000;
    const d = new Date(t);
    const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const b = idx - (idx % n);
    return Date.UTC(Math.floor(b / 12), b % 12, 1);
  }
  if (sec % 604800 === 0) {
    const ms = sec * 1000;
    return Math.floor((t - 4 * DAY) / ms) * ms + 4 * DAY;
  }
  const ms = sec * 1000;
  return Math.floor(t / ms) * ms;
}
export function bucketEnd(start: number, sec: number): number {
  if (sec % 2592000 === 0) {
    const d = new Date(start);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + sec / 2592000, 1);
  }
  return start + sec * 1000;
}

// ── timezones ────────────────────────────────────────────────────────────
const fmtCache = new Map<string, Intl.DateTimeFormat>();
const offCache = new Map<string, number>();
/** offset (ms) of `tz` from UTC at instant t; accepts IANA names, "UTC", "GMT+3", "UTC-05:30" */
export function tzOffset(t: number, tz: string | null | undefined): number {
  if (!tz) return 0;
  const z = tz.trim();
  if (z === "" || /^(UTC|GMT|Etc\/UTC|Etc\/GMT|Z)$/i.test(z)) return 0;
  const fixed = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(z);
  if (fixed) {
    const sgn = fixed[1] === "-" ? -1 : 1;
    return sgn * (Number(fixed[2]) * 3600000 + Number(fixed[3] ?? 0) * 60000);
  }
  const hourKey = `${z}|${Math.floor(t / 3600000)}`;
  const hit = offCache.get(hourKey);
  if (hit !== undefined) return hit;
  let f = fmtCache.get(z);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return 0;
    }
    fmtCache.set(z, f);
  }
  const parts = f.formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const off = asUtc - Math.floor(t / 1000) * 1000;
  if (offCache.size > 20000) offCache.clear();
  offCache.set(hourKey, off);
  return off;
}
export interface TzParts { year: number; month: number; day: number; hour: number; minute: number; second: number; dow: number; weekofyear: number }
export function tzParts(t: number, tz: string | null | undefined): TzParts {
  const d = new Date(t + tzOffset(t, tz));
  const year = d.getUTCFullYear();
  // ISO week number
  const tmp = new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(tmp.getUTCFullYear(), 0, 1);
  const weekofyear = Math.ceil(((tmp.getTime() - yearStart) / DAY + 1) / 7);
  return {
    year,
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    dow: d.getUTCDay() + 1, // Pine: Sunday = 1 … Saturday = 7
    weekofyear,
  };
}
/** wall-clock time in tz → UTC instant */
export function tzTimestamp(tz: string | null | undefined, y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffset(guess, tz);
  const off2 = tzOffset(guess - off1, tz);
  return guess - off2;
}
