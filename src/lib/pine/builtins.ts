// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine built-in library (everything except ta.*)
//  Single source of truth: the compiler validates names against the SAME
//  tables the runtime dispatches on, so "compiles" always means "runs".
//  Visual-only objects (line/label/box/table/linefill/polyline, bgcolor,
//  fill, barcolor) are fully executable — getters/setters/arrays work —
//  they are simply not drawn on the HALO chart.
// ════════════════════════════════════════════════════════════════════════

import type { Call } from "./parser";
import type { PineRuntime } from "./runtime";
import {
  PineError, isNum, isDraw, isUdt, isMap, isMatrix, isEnum, eqVal, truthy, normalizeColor, parseColor, rgbaStr,
  NAMED_COLORS, defaultNumStr, formatPattern, decimalsOf, formatVolume, tzParts, tzTimestamp, tvTfSec, secToTv,
  bucketStart, bucketEnd, type PValue, type PDraw, type DrawKind, type PMap, type PMatrix, type PUdt,
} from "./values";
import { taCall, TA_SIGS, TA_VARS, bindArgs, computeTaVarsImpl } from "./ta";

export type BuiltinCtx = PineRuntime;
type Fn = (rt: PineRuntime, pos: PValue[], named: Record<string, PValue>, site: Call) => PValue;

const SKIP = (): PValue => null;

/** Pine type-cast functions: float(x), int(x), bool(x), string(x), color(na), line(na)… */
export const CAST_FUNCS = new Set(["int", "float", "bool", "string", "color", "line", "label", "box", "table", "linefill", "polyline"]);

/** Pine v1–v4 un-namespaced names → v5 equivalents (accepted in every version) */
export const V4_ALIASES: Record<string, string> = {
  study: "indicator", security: "request.security", tostring: "str.tostring", tonumber: "str.tonumber",
  abs: "math.abs", acos: "math.acos", asin: "math.asin", atan: "math.atan", avg: "math.avg", ceil: "math.ceil",
  cos: "math.cos", exp: "math.exp", floor: "math.floor", log: "math.log", log10: "math.log10", max: "math.max",
  min: "math.min", pow: "math.pow", round: "math.round", sign: "math.sign", sin: "math.sin", sqrt: "math.sqrt",
  tan: "math.tan", todegrees: "math.todegrees", toradians: "math.toradians", random: "math.random",
  iff: "iff", offset: "offset", heikinashi: "ticker.heikinashi", tickerid: "ticker.new",
  financial: "request.financial", quandl: "request.quandl", splits: "request.splits", dividends: "request.dividends", earnings: "request.earnings",
};
for (const k of Object.keys(TA_SIGS)) if (!(k in V4_ALIASES) && !["max", "min", "range", "cross"].includes(k)) V4_ALIASES[k] = `ta.${k}`;
V4_ALIASES.cross = "ta.cross";

// ── helpers ──────────────────────────────────────────────────────────────
function a(sig: string[], pos: PValue[], named: Record<string, PValue>): Record<string, PValue | undefined> {
  const out: Record<string, PValue | undefined> = {};
  sig.forEach((s, i) => {
    if (i < pos.length) out[s] = pos[i];
    else if (s in named) out[s] = named[s];
  });
  return out;
}
const n0 = (v: PValue | undefined, d: number): number => (isNum(v) ? v : d);
const s0 = (v: PValue | undefined, d: string): string => (typeof v === "string" ? v : d);
function err(site: Call, msg: string): never {
  throw new PineError(msg, site.line, site.col);
}

export function toPineStr(v: PValue, rt?: PineRuntime): string {
  if (v === null) return "NaN";
  if (typeof v === "number") return Number.isFinite(v) ? defaultNumStr(v) : "NaN";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return `[${v.map((x) => toPineStr(x, rt)).join(", ")}]`;
  if (isEnum(v)) return v.title;
  if (isUdt(v)) return v.__t;
  return String(v);
}
function fmtNum(rt: PineRuntime, v: number, f: PValue | undefined): string {
  if (f === undefined || f === null || f === "inherit" || f === "price") {
    if (f === "price" || f === "inherit") return v.toFixed(decimalsOf(rt.opts.mintick));
    return defaultNumStr(v);
  }
  if (f === "mintick") {
    const mt = rt.opts.mintick || 0.01;
    return (Math.round(v / mt) * mt).toFixed(decimalsOf(mt));
  }
  if (f === "percent") return `${v.toFixed(2)}%`;
  if (f === "volume") return formatVolume(v);
  if (typeof f === "string") return formatPattern(v, f);
  return defaultNumStr(v);
}

// ── str.format (Java MessageFormat subset, like TradingView) ─────────────
function strFormat(rt: PineRuntime, fmt: string, args: PValue[]): string {
  return fmt.replace(/\{(\d+)(?:\s*,\s*(number|date|time)\s*(?:,\s*([^}]*))?)?\}/g, (_m, idx: string, kind?: string, style?: string) => {
    const v = args[Number(idx)];
    if (v === undefined) return "";
    if (kind === "number" && isNum(v)) {
      const s = (style ?? "").trim();
      if (s === "" ) return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
      if (s === "integer") return Math.round(v).toLocaleString("en-US");
      if (s === "percent") return `${Math.round(v * 100).toLocaleString("en-US")}%`;
      if (s === "currency") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return formatPattern(v, s);
    }
    if ((kind === "date" || kind === "time") && isNum(v)) return formatTime(v, (style ?? "").trim() || (kind === "date" ? "yyyy-MM-dd" : "HH:mm:ss"), rt.timezone);
    return toPineStr(v, rt);
  });
}
function formatTime(t: number, fmt: string, tz: string): string {
  const p = tzParts(t, tz);
  const pad = (x: number, n = 2) => String(x).padStart(n, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|m|ss|s|a|z|Z/g, (tok) => {
    switch (tok) {
      case "yyyy": return String(p.year);
      case "yy": return pad(p.year % 100);
      case "MMMM": case "MMM": return months[p.month - 1];
      case "MM": return pad(p.month);
      case "M": return String(p.month);
      case "dd": return pad(p.day);
      case "d": return String(p.day);
      case "EEEE": case "EEE": return days[p.dow - 1];
      case "HH": return pad(p.hour);
      case "H": return String(p.hour);
      case "hh": return pad(p.hour % 12 || 12);
      case "h": return String(p.hour % 12 || 12);
      case "mm": return pad(p.minute);
      case "m": return String(p.minute);
      case "ss": return pad(p.second);
      case "s": return String(p.second);
      case "a": return p.hour < 12 ? "AM" : "PM";
      default: return tz;
    }
  });
}

// ── sessions ─────────────────────────────────────────────────────────────
function inSession(rt: PineRuntime, t: number, session: string, tz: string): boolean {
  const s = session.trim();
  if (s === "" || /^24x7$/i.test(s)) return true;
  const p = tzParts(t, tz);
  const mins = p.hour * 60 + p.minute;
  for (const part of s.split(",")) {
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})(?::(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const days = m[5] ?? "1234567";
    const a1 = Number(m[1]) * 60 + Number(m[2]);
    const b1 = Number(m[3]) * 60 + Number(m[4]);
    if (a1 <= b1 || b1 === 0) {
      const end = b1 === 0 ? 1440 : b1;
      if (mins >= a1 && mins < end && days.includes(String(p.dow))) return true;
    } else {
      // overnight session: the day listed is the day the session ENDS (TradingView)
      if (mins >= a1) {
        const next = (p.dow % 7) + 1;
        if (days.includes(String(next))) return true;
      } else if (mins < b1 && days.includes(String(p.dow))) return true;
    }
  }
  void rt;
  return false;
}

// ── drawings ─────────────────────────────────────────────────────────────
const DRAW_SIGS: Record<string, string[]> = {
  line: ["x1", "y1", "x2", "y2", "xloc", "extend", "color", "style", "width", "force_overlay"],
  linePt: ["first_point", "second_point", "xloc", "extend", "color", "style", "width", "force_overlay"],
  label: ["x", "y", "text", "xloc", "yloc", "color", "style", "textcolor", "size", "textalign", "tooltip", "text_font_family", "force_overlay"],
  labelPt: ["point", "text", "xloc", "yloc", "color", "style", "textcolor", "size", "textalign", "tooltip", "text_font_family", "force_overlay"],
  box: ["left", "top", "right", "bottom", "border_color", "border_width", "border_style", "extend", "xloc", "bgcolor", "text", "text_size", "text_color", "text_halign", "text_valign", "text_wrap", "text_font_family", "force_overlay"],
  boxPt: ["top_left", "bottom_right", "border_color", "border_width", "border_style", "extend", "xloc", "bgcolor", "text", "text_size", "text_color", "text_halign", "text_valign", "text_wrap", "text_font_family", "force_overlay"],
  table: ["position", "columns", "rows", "bgcolor", "frame_color", "frame_width", "border_color", "border_width", "force_overlay"],
  linefill: ["line1", "line2", "color"],
  polyline: ["points", "curved", "closed", "xloc", "line_color", "fill_color", "line_style", "line_width", "force_overlay"],
};
function newDraw(rt: PineRuntime, kind: DrawKind, props: Record<string, unknown>): PDraw {
  const d: PDraw = { __d: kind, props };
  if (rt.isSecondary) return d;
  rt.drawingsCreated++;
  const list = rt.drawLists[kind];
  if (list) {
    list.push(d);
    const lim = rt.drawLimits[kind] ?? 500;
    while (list.length > lim) {
      const old = list.shift()!;
      old.props.__deleted = true;
    }
  }
  return d;
}
function ptField(p: PValue | undefined, f: "time" | "index" | "price"): PValue {
  return isUdt(p) ? p.f[f] ?? null : null;
}
function drawNew(rt: PineRuntime, kind: "line" | "label" | "box", pos: PValue[], named: Record<string, PValue>): PDraw {
  const first = pos[0] !== undefined ? pos[0] : named.first_point ?? named.point ?? named.top_left;
  if (isUdt(first) && first.__t === "chart.point") {
    const sig = DRAW_SIGS[`${kind}Pt`];
    const r = a(sig, pos, named);
    const props: Record<string, unknown> = { ...r };
    const xl = r.xloc === "bar_time" ? "time" : "index";
    if (kind === "line") {
      props.x1 = ptField(r.first_point, xl); props.y1 = ptField(r.first_point, "price");
      props.x2 = ptField(r.second_point, xl); props.y2 = ptField(r.second_point, "price");
    } else if (kind === "label") {
      props.x = ptField(r.point, xl); props.y = ptField(r.point, "price");
    } else {
      props.left = ptField(r.top_left, xl); props.top = ptField(r.top_left, "price");
      props.right = ptField(r.bottom_right, xl); props.bottom = ptField(r.bottom_right, "price");
    }
    return newDraw(rt, kind, props);
  }
  const r = a(DRAW_SIGS[kind], pos, named);
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) props[k] = v;
  if (kind === "label" && props.text === undefined) props.text = "";
  return newDraw(rt, kind, props);
}
function drawCall(rt: PineRuntime, ns: DrawKind, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  if (name === "new") {
    if (ns === "line" || ns === "label" || ns === "box") return drawNew(rt, ns, pos, named);
    const r = a(DRAW_SIGS[ns] ?? [], pos, named);
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (v !== undefined) props[k] = v;
    if (ns === "table") props.cells = {};
    return newDraw(rt, ns, props);
  }
  const d = pos[0];
  if (name === "delete") {
    if (isDraw(d)) {
      d.props.__deleted = true;
      const list = rt.drawLists[d.__d];
      if (list) {
        const i = list.indexOf(d);
        if (i >= 0) list.splice(i, 1);
      }
    }
    return null;
  }
  if (name === "copy") {
    if (!isDraw(d)) return null;
    return newDraw(rt, d.__d, { ...d.props });
  }
  if (!isDraw(d)) return null; // na object — Pine treats setters/getters on na as no-ops
  const p = d.props;
  // table cells
  if (ns === "table") {
    if (name === "cell") {
      const r = a(["table_id", "column", "row", "text", "width", "height", "text_color", "text_halign", "text_valign", "text_size", "bgcolor", "tooltip", "text_font_family", "text_formatting"], pos, named);
      (p.cells as Record<string, unknown>)[`${r.column},${r.row}`] = { ...r, table_id: undefined };
      return null;
    }
    if (name.startsWith("cell_set_")) {
      const key = `${pos[1]},${pos[2]}`;
      const cells = p.cells as Record<string, Record<string, unknown>>;
      cells[key] = { ...(cells[key] ?? {}), [name.slice(9)]: pos[3] ?? null };
      return null;
    }
    if (name === "clear") { p.cells = {}; return null; }
    if (name === "merge_cells") return null;
    if (name.startsWith("set_")) { p[name.slice(4)] = pos[1] ?? null; return null; }
    return null;
  }
  if (name.startsWith("set_")) {
    const attr = name.slice(4);
    const v1 = pos[1] ?? named[attr] ?? null;
    switch (attr) {
      case "xy1": p.x1 = pos[1] ?? null; p.y1 = pos[2] ?? null; break;
      case "xy2": p.x2 = pos[1] ?? null; p.y2 = pos[2] ?? null; break;
      case "xy": p.x = pos[1] ?? null; p.y = pos[2] ?? null; break;
      case "lefttop": p.left = pos[1] ?? null; p.top = pos[2] ?? null; break;
      case "rightbottom": p.right = pos[1] ?? null; p.bottom = pos[2] ?? null; break;
      case "xloc":
        if (ns === "line") { p.x1 = pos[1] ?? null; p.x2 = pos[2] ?? null; p.xloc = pos[3] ?? p.xloc; }
        else { p.x = pos[1] ?? null; p.xloc = pos[2] ?? p.xloc; }
        break;
      case "first_point": p.x1 = ptField(v1, "index"); p.y1 = ptField(v1, "price"); break;
      case "second_point": p.x2 = ptField(v1, "index"); p.y2 = ptField(v1, "price"); break;
      case "point": p.x = ptField(v1, "index"); p.y = ptField(v1, "price"); break;
      case "top_left_point": p.left = ptField(v1, "index"); p.top = ptField(v1, "price"); break;
      case "bottom_right_point": p.right = ptField(v1, "index"); p.bottom = ptField(v1, "price"); break;
      default: p[attr] = v1;
    }
    return null;
  }
  if (name.startsWith("get_")) {
    const attr = name.slice(4);
    if (attr === "price" && ns === "line") {
      const x = n0(pos[1], NaN);
      const x1 = p.x1 as number, x2 = p.x2 as number, y1 = p.y1 as number, y2 = p.y2 as number;
      if (![x, x1, x2, y1, y2].every(isNum)) return null;
      if (x2 === x1) return y1;
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    }
    if (ns === "linefill" && (attr === "line1" || attr === "line2")) return (p[attr] as PValue) ?? null;
    return (p[attr] as PValue) ?? null;
  }
  return err(site, `${ns}.${name} is not a TradingView function.`);
}

// ── arrays ───────────────────────────────────────────────────────────────
function arrDefault(kind: string): PValue {
  void kind;
  return null; // Pine: initial_value defaults to na for every element type
}
function arrIdx(arr: PValue[], i: PValue): number {
  if (!isNum(i)) return -1;
  const k = Math.trunc(i);
  return k < 0 ? arr.length + k : k;
}
function numsOf(arr: PValue[]): number[] {
  return arr.filter((x): x is number => isNum(x));
}
function arrCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  if (name.startsWith("new")) {
    const r = a(["size", "initial_value"], pos, named);
    const size = Math.max(0, Math.round(n0(r.size, 0)));
    const init = r.initial_value === undefined ? arrDefault(name) : r.initial_value;
    return Array.from({ length: size }, () => init);
  }
  if (name === "from") return [...pos];
  const arr = pos[0];
  if (!Array.isArray(arr)) {
    if (arr === null) {
      if (name === "size") return null;
      return null; // operations on an na array are no-ops (TradingView raises a runtime error)
    }
    return err(site, `array.${name} expected an array as its first argument.`);
  }
  const x = pos[1];
  switch (name) {
    case "size": return arr.length;
    case "get": { const i = arrIdx(arr, x); return i >= 0 && i < arr.length ? arr[i] : null; }
    case "set": { const i = arrIdx(arr, x); if (i >= 0 && i < arr.length) arr[i] = pos[2] ?? null; return null; }
    case "push": arr.push(x ?? null); return null;
    case "pop": return arr.length ? arr.pop()! : null;
    case "shift": return arr.length ? arr.shift()! : null;
    case "unshift": arr.unshift(x ?? null); return null;
    case "insert": { const i = arrIdx(arr, x); arr.splice(Math.max(0, i), 0, pos[2] ?? null); return null; }
    case "remove": { const i = arrIdx(arr, x); return i >= 0 && i < arr.length ? arr.splice(i, 1)[0] : null; }
    case "clear": arr.length = 0; return null;
    case "first": return arr.length ? arr[0] : null;
    case "last": return arr.length ? arr[arr.length - 1] : null;
    case "includes": return arr.some((v) => eqVal(v, x ?? null) || (isEnum(v) && v === x));
    case "indexof": return arr.findIndex((v) => eqVal(v, x ?? null));
    case "lastindexof": { for (let i = arr.length - 1; i >= 0; i--) if (eqVal(arr[i], x ?? null)) return i; return -1; }
    case "reverse": arr.reverse(); return null;
    case "slice": { const from = Math.max(0, n0(x, 0)); const to = n0(pos[2], arr.length); return arr.slice(from, to); }
    case "copy": return [...arr];
    case "concat": if (Array.isArray(x)) arr.push(...x); return arr;
    case "fill": { const from = n0(pos[2], 0), to = n0(pos[3], arr.length); for (let i = from; i < to && i < arr.length; i++) arr[i] = x ?? null; return null; }
    case "join": return arr.map((v) => toPineStr(v, rt)).join(typeof x === "string" ? x : ",");
    case "sort": {
      const desc = x === "descending";
      arr.sort((p, q) => {
        if (p === null) return 1;
        if (q === null) return -1;
        const c = isNum(p) && isNum(q) ? p - q : String(p) < String(q) ? -1 : String(p) > String(q) ? 1 : 0;
        return desc ? -c : c;
      });
      return null;
    }
    case "sort_indices": {
      const desc = x === "descending";
      return arr.map((v, i) => ({ v, i })).sort((p, q) => (isNum(p.v) && isNum(q.v) ? (desc ? q.v - p.v : p.v - q.v) : 0)).map((o) => o.i);
    }
    case "every": return arr.every((v) => truthy(v));
    case "some": return arr.some((v) => truthy(v));
    case "abs": return arr.map((v) => (isNum(v) ? Math.abs(v) : null));
    case "binary_search": case "binary_search_leftmost": case "binary_search_rightmost": {
      const ns = arr as number[];
      let lo = 0, hi = ns.length - 1;
      const t = n0(x, NaN);
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ns[mid] === t && name === "binary_search") return mid;
        if (ns[mid] < t) lo = mid + 1; else hi = mid - 1;
      }
      if (name === "binary_search") return -1;
      return name === "binary_search_leftmost" ? lo : hi;
    }
    case "standardize": {
      const ns = numsOf(arr);
      if (!ns.length) return [];
      const m = ns.reduce((p, q) => p + q, 0) / ns.length;
      const sd = Math.sqrt(ns.reduce((p, q) => p + (q - m) ** 2, 0) / ns.length);
      return arr.map((v) => (isNum(v) && sd ? (v - m) / sd : null));
    }
    case "covariance": {
      if (!Array.isArray(x)) return null;
      const n = Math.min(arr.length, x.length);
      const p = arr.slice(0, n) as number[], q = x.slice(0, n) as number[];
      const mp = p.reduce((s, v) => s + v, 0) / n, mq = q.reduce((s, v) => s + v, 0) / n;
      let c = 0;
      for (let i = 0; i < n; i++) c += (p[i] - mp) * (q[i] - mq);
      return c / (pos[2] === false ? n - 1 : n);
    }
  }
  // numeric aggregates
  const ns = numsOf(arr);
  switch (name) {
    case "sum": return ns.length ? ns.reduce((p, q) => p + q, 0) : null;
    case "avg": return ns.length ? ns.reduce((p, q) => p + q, 0) / ns.length : null;
    case "min": case "max": {
      if (!ns.length) return null;
      const nth = Math.max(0, n0(x, 0));
      const s = [...ns].sort((p, q) => (name === "min" ? p - q : q - p));
      return s[Math.min(nth, s.length - 1)];
    }
    case "range": return ns.length ? Math.max(...ns) - Math.min(...ns) : null;
    case "median": {
      if (!ns.length) return null;
      const s = [...ns].sort((p, q) => p - q);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    case "mode": {
      if (!ns.length) return null;
      const cnt = new Map<number, number>();
      for (const v of ns) cnt.set(v, (cnt.get(v) ?? 0) + 1);
      let best = ns[0], bn = 0;
      for (const [v, c] of cnt) if (c > bn || (c === bn && v < best)) { best = v; bn = c; }
      return best;
    }
    case "stdev": case "variance": {
      if (!ns.length) return null;
      const m = ns.reduce((p, q) => p + q, 0) / ns.length;
      const biased = x !== false;
      const v = ns.reduce((p, q) => p + (q - m) ** 2, 0) / (biased ? ns.length : Math.max(1, ns.length - 1));
      return name === "variance" ? v : Math.sqrt(v);
    }
    case "percentrank": {
      const i = arrIdx(arr, x);
      const cur = arr[i];
      if (!isNum(cur)) return null;
      return (ns.filter((v) => v <= cur).length - 1) / Math.max(1, ns.length - 1) * 100;
    }
    case "percentile_linear_interpolation": case "percentile_nearest_rank": {
      if (!ns.length) return null;
      const s = [...ns].sort((p, q) => p - q);
      const pct = n0(x, 50);
      if (name === "percentile_nearest_rank") return s[Math.max(0, Math.min(s.length - 1, Math.ceil((pct / 100) * s.length) - 1))];
      const p2 = (pct / 100) * (s.length - 1);
      const lo = Math.floor(p2), hi = Math.ceil(p2);
      return s[lo] + (s[hi] - s[lo]) * (p2 - lo);
    }
  }
  return err(site, `array.${name} is not a TradingView function.`);
}
const ARRAY_FUNCS = [
  "new", "new_int", "new_float", "new_bool", "new_string", "new_color", "new_line", "new_label", "new_box", "new_table", "new_linefill",
  "from", "size", "get", "set", "push", "pop", "shift", "unshift", "insert", "remove", "clear", "first", "last", "includes", "indexof",
  "lastindexof", "reverse", "slice", "copy", "concat", "fill", "join", "sort", "sort_indices", "every", "some", "abs", "binary_search",
  "binary_search_leftmost", "binary_search_rightmost", "standardize", "covariance", "sum", "avg", "min", "max", "range", "median", "mode",
  "stdev", "variance", "percentrank", "percentile_linear_interpolation", "percentile_nearest_rank",
];

// ── maps ─────────────────────────────────────────────────────────────────
function mapKey(k: PValue): unknown {
  return isEnum(k) ? `${k.__e}.${k.k}` : k;
}
function mapCall(_rt: PineRuntime, name: string, pos: PValue[], _named: Record<string, PValue>, site: Call): PValue {
  if (name === "new") return { __map: new Map() } as PMap;
  const m = pos[0];
  if (!isMap(m)) return null;
  const mm = m.__map;
  switch (name) {
    case "put": { const prev = mm.get(mapKey(pos[1] ?? null)); mm.set(mapKey(pos[1] ?? null), pos[2] ?? null); return prev ?? null; }
    case "get": return mm.get(mapKey(pos[1] ?? null)) ?? null;
    case "contains": return mm.has(mapKey(pos[1] ?? null));
    case "remove": { const k = mapKey(pos[1] ?? null); const v = mm.get(k) ?? null; mm.delete(k); return v; }
    case "size": return mm.size;
    case "keys": return [...mm.keys()] as PValue[];
    case "values": return [...mm.values()];
    case "clear": mm.clear(); return null;
    case "copy": return { __map: new Map(mm) } as PMap;
    case "put_all": { const o = pos[1]; if (isMap(o)) for (const [k, v] of o.__map) mm.set(k, v); return null; }
  }
  return err(site, `map.${name} is not a TradingView function.`);
}
const MAP_FUNCS = ["new", "put", "get", "contains", "remove", "size", "keys", "values", "clear", "copy", "put_all"];

// ── matrices ─────────────────────────────────────────────────────────────
function matCall(_rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  if (name === "new") {
    const r = a(["rows", "columns", "initial_value"], pos, named);
    const rows = Math.max(0, Math.round(n0(r.rows, 0))), cols = Math.max(0, Math.round(n0(r.columns, 0)));
    const init = r.initial_value ?? null;
    return { __mx: Array.from({ length: rows }, () => Array.from({ length: cols }, () => init)) } as PMatrix;
  }
  const m = pos[0];
  if (!isMatrix(m)) return null;
  const mx = m.__mx;
  const cols = () => (mx[0]?.length ?? 0);
  switch (name) {
    case "get": return mx[n0(pos[1], -1)]?.[n0(pos[2], -1)] ?? null;
    case "set": { const r = mx[n0(pos[1], -1)]; if (r && n0(pos[2], -1) >= 0 && n0(pos[2], -1) < r.length) r[n0(pos[2], -1)] = pos[3] ?? null; return null; }
    case "rows": return mx.length;
    case "columns": return cols();
    case "elements_count": return mx.length * cols();
    case "add_row": {
      const at = isNum(pos[1]) ? pos[1] : mx.length;
      const row = Array.isArray(pos[2]) ? [...pos[2]] : Array.from({ length: cols() }, () => null);
      mx.splice(at, 0, row);
      return null;
    }
    case "add_col": {
      const at = isNum(pos[1]) ? pos[1] : cols();
      const col = Array.isArray(pos[2]) ? pos[2] : [];
      mx.forEach((r, i) => r.splice(at, 0, col[i] ?? null));
      return null;
    }
    case "remove_row": { const at = isNum(pos[1]) ? pos[1] : mx.length - 1; return mx.splice(at, 1)[0] ?? null; }
    case "remove_col": { const at = isNum(pos[1]) ? pos[1] : cols() - 1; return mx.map((r) => r.splice(at, 1)[0] ?? null); }
    case "row": return [...(mx[n0(pos[1], -1)] ?? [])];
    case "col": return mx.map((r) => r[n0(pos[1], -1)] ?? null);
    case "fill": for (const r of mx) for (let i = 0; i < r.length; i++) r[i] = pos[1] ?? null; return null;
    case "copy": return { __mx: mx.map((r) => [...r]) } as PMatrix;
    case "transpose": return { __mx: Array.from({ length: cols() }, (_, j) => mx.map((r) => r[j])) } as PMatrix;
    case "reshape": {
      const flat = mx.flat();
      const rr = n0(pos[1], mx.length), cc = n0(pos[2], cols());
      m.__mx = Array.from({ length: rr }, (_, i) => flat.slice(i * cc, i * cc + cc));
      return null;
    }
    case "sum": case "avg": case "max": case "min": case "median": case "mode": {
      const ns = mx.flat().filter((x): x is number => isNum(x));
      if (!ns.length) return null;
      if (name === "sum") return ns.reduce((p, q) => p + q, 0);
      if (name === "avg") return ns.reduce((p, q) => p + q, 0) / ns.length;
      if (name === "max") return Math.max(...ns);
      if (name === "min") return Math.min(...ns);
      const s = [...ns].sort((p, q) => p - q);
      if (name === "median") { const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; }
      return s[0];
    }
  }
  return err(site, `matrix.${name} is not supported by the HALO runtime.`);
}
const MATRIX_FUNCS = ["new", "get", "set", "rows", "columns", "elements_count", "add_row", "add_col", "remove_row", "remove_col", "row", "col", "fill", "copy", "transpose", "reshape", "sum", "avg", "max", "min", "median", "mode"];

// ── inputs ───────────────────────────────────────────────────────────────
const INPUT_SIGS: Record<string, string[]> = {
  input: ["defval", "title", "tooltip", "inline", "group", "confirm", "display"],
  int: ["defval", "title", "minval", "maxval", "step", "tooltip", "inline", "group", "confirm", "display"],
  float: ["defval", "title", "minval", "maxval", "step", "tooltip", "inline", "group", "confirm", "display"],
  bool: ["defval", "title", "tooltip", "inline", "group", "confirm", "display"],
  string: ["defval", "title", "options", "tooltip", "inline", "group", "confirm", "display"],
  color: ["defval", "title", "tooltip", "inline", "group", "confirm", "display"],
  source: ["defval", "title", "tooltip", "inline", "group", "display"],
  timeframe: ["defval", "title", "options", "tooltip", "inline", "group", "confirm", "display"],
  session: ["defval", "title", "options", "tooltip", "inline", "group", "confirm", "display"],
  symbol: ["defval", "title", "tooltip", "inline", "group", "confirm", "display"],
  price: ["defval", "title", "tooltip", "inline", "group", "confirm", "display"],
  time: ["defval", "title", "tooltip", "inline", "group", "confirm", "display"],
  text_area: ["defval", "title", "tooltip", "group", "confirm", "display"],
  enum: ["defval", "title", "options", "tooltip", "inline", "group", "confirm", "display"],
};
function inputCall(rt: PineRuntime, kindRaw: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  let kind = kindRaw;
  // generic input(): v4 type= argument, or infer from the default value
  if (kind === "input") {
    const t = named.type;
    if (typeof t === "string") kind = t === "integer" ? "int" : t === "resolution" ? "timeframe" : t;
    else {
      const d = pos[0] ?? named.defval;
      kind = typeof d === "boolean" ? "bool" : typeof d === "string" ? (d.startsWith("#") || d.startsWith("rgba") ? "color" : "string") : "float";
    }
    // in v4, input(close) yields a source input whose value is the series
    if (pos.length > 0 && site.args[0] && site.args[0].e.k === "ident" && rt.seriesBox(site.args[0].e.name)) kind = "source";
  }
  const sig = INPUT_SIGS[kind] ?? INPUT_SIGS.input;
  const r = a(sig, pos, named);
  // v4 positional: input(defval, title, type, minval, maxval…) — honour options/minval/maxval named
  let defval: PValue = r.defval ?? null;
  if (kind === "source") {
    // the default is the evaluated series value itself (close, hl2, another plot…)
    defval = (pos[0] ?? named.defval ?? rt.bClose.at(rt.bar)) as PValue;
  }
  const title = typeof r.title === "string" ? r.title : rt.pendingInputVar ?? `${kind} ${rt.inputs.length + 1}`;
  const id = rt.pendingInputVar ?? `input_${rt.inputs.length + 1}`;
  if (!rt.inputSites.has(site.id) && !rt.isSecondary) {
    const optsV = named.options ?? r.options;
    rt.inputs.push({
      id,
      kind,
      title,
      defval: kind === "source" ? (site.args[0]?.e.k === "ident" ? site.args[0].e.name : "close") : defval,
      minval: isNum(r.minval) ? r.minval : isNum(named.minval) ? named.minval : undefined,
      maxval: isNum(r.maxval) ? r.maxval : isNum(named.maxval) ? named.maxval : undefined,
      step: isNum(r.step) ? r.step : isNum(named.step) ? named.step : undefined,
      options: Array.isArray(optsV) ? optsV : undefined,
      group: typeof r.group === "string" ? r.group : undefined,
    });
    rt.inputSites.set(site.id, defval);
  }
  rt.pendingInputVar = null;
  const ov = rt.opts.inputs;
  if (ov && kind !== "source") {
    if (id in ov) return ov[id];
    if (title in ov) return ov[title];
  }
  return defval;
}

// ── strategy ─────────────────────────────────────────────────────────────
type Trade = NonNullable<PineRuntime["simPos"]>;
function tradeStats(rt: PineRuntime) {
  const closed = rt.simTrades.filter((t) => t.exit !== null);
  const pnl = (t: Trade) => ((t.exit ?? 0) - t.entry) * t.dir;
  let net = 0, gp = 0, gl = 0, wins = 0, losses = 0, even = 0, peak = 0, dd = 0, runup = 0, trough = 0;
  for (const t of closed) {
    const p = pnl(t);
    net += p;
    if (p > 0) { gp += p; wins++; } else if (p < 0) { gl -= p; losses++; } else even++;
    peak = Math.max(peak, net);
    dd = Math.max(dd, peak - net);
    trough = Math.min(trough, net);
    runup = Math.max(runup, net - trough);
  }
  const pos = rt.simPos;
  const c = rt.bClose.at(rt.bar);
  const open = pos && isNum(c) ? (c - pos.entry) * pos.dir : 0;
  return { closed, net, gp, gl, wins, losses, even, dd, runup, open };
}
function stratVar(rt: PineRuntime, name: string): PValue | undefined {
  if (rt.isSecondary) {
    if (["opentrades", "closedtrades", "wintrades", "losstrades", "eventrades", "netprofit", "openprofit", "grossprofit", "grossloss", "max_drawdown", "max_runup"].includes(name)) return 0;
  }
  const s = tradeStats(rt);
  const ic = rt.initialCapital;
  switch (name) {
    case "opentrades": return rt.currentPos().dir !== 0 ? 1 : 0;
    case "closedtrades": return s.closed.length;
    case "wintrades": return s.wins;
    case "losstrades": return s.losses;
    case "eventrades": return s.even;
    case "netprofit": return s.net;
    case "netprofit_percent": return (s.net / ic) * 100;
    case "openprofit": return s.open;
    case "openprofit_percent": return (s.open / ic) * 100;
    case "grossprofit": return s.gp;
    case "grossprofit_percent": return (s.gp / ic) * 100;
    case "grossloss": return s.gl;
    case "grossloss_percent": return (s.gl / ic) * 100;
    case "equity": return ic + s.net + s.open;
    case "initial_capital": return ic;
    case "max_drawdown": return s.dd;
    case "max_drawdown_percent": return (s.dd / ic) * 100;
    case "max_runup": return s.runup;
    case "max_runup_percent": return (s.runup / ic) * 100;
    case "position_entry_name": return rt.simPos?.entryId ?? "";
    case "account_currency": return "USD";
    case "avg_trade": return s.closed.length ? s.net / s.closed.length : null;
    case "avg_trade_percent": return s.closed.length ? (s.net / s.closed.length / ic) * 100 : null;
    case "avg_winning_trade": return s.wins ? s.gp / s.wins : null;
    case "avg_winning_trade_percent": return s.wins ? (s.gp / s.wins / ic) * 100 : null;
    case "avg_losing_trade": return s.losses ? s.gl / s.losses : null;
    case "avg_losing_trade_percent": return s.losses ? (s.gl / s.losses / ic) * 100 : null;
    case "margin_liquidation_price": return null;
    case "max_contracts_held_all": case "max_contracts_held_long": case "max_contracts_held_short": return 1;
    case "closedtrades.first_index": return 0;
    case "opentrades.capital_held": return 0;
  }
  return undefined;
}
const STRATEGY_VARS = [
  "position_size", "position_avg_price", "opentrades", "closedtrades", "wintrades", "losstrades", "eventrades", "netprofit", "netprofit_percent",
  "openprofit", "openprofit_percent", "grossprofit", "grossprofit_percent", "grossloss", "grossloss_percent", "equity", "initial_capital",
  "max_drawdown", "max_drawdown_percent", "max_runup", "max_runup_percent", "position_entry_name", "account_currency", "avg_trade",
  "avg_trade_percent", "avg_winning_trade", "avg_winning_trade_percent", "avg_losing_trade", "avg_losing_trade_percent",
  "margin_liquidation_price", "max_contracts_held_all", "max_contracts_held_long", "max_contracts_held_short", "closedtrades.first_index",
  "opentrades.capital_held",
];
function tradeField(rt: PineRuntime, closed: boolean, field: string, idx: PValue): PValue {
  const list = closed ? rt.simTrades : rt.simPos ? [rt.simPos] : [];
  const t = isNum(idx) ? list[Math.trunc(idx)] : undefined;
  if (!t) return null;
  const c = rt.bClose.at(rt.bar);
  switch (field) {
    case "entry_price": return t.entry;
    case "exit_price": return t.exit;
    case "entry_bar_index": return t.entryBar;
    case "exit_bar_index": return t.exitBar ?? null;
    case "entry_time": return t.entryTime;
    case "exit_time": return t.exitTime;
    case "entry_id": return t.entryId;
    case "exit_id": return t.reason ?? "";
    case "entry_comment": case "exit_comment": return "";
    case "size": return t.dir;
    case "profit": return t.exit !== null ? (t.exit - t.entry) * t.dir : isNum(c) ? (c - t.entry) * t.dir : null;
    case "profit_percent": { const p = t.exit !== null ? (t.exit - t.entry) * t.dir : isNum(c) ? (c - t.entry) * t.dir : 0; return (p / t.entry) * 100; }
    case "commission": return 0;
    case "max_drawdown": case "max_runup": case "max_drawdown_percent": case "max_runup_percent": return 0;
  }
  return null;
}
const TRADE_FIELDS = ["entry_price", "exit_price", "entry_bar_index", "exit_bar_index", "entry_time", "exit_time", "entry_id", "exit_id", "entry_comment", "exit_comment", "size", "profit", "profit_percent", "commission", "max_drawdown", "max_runup", "max_drawdown_percent", "max_runup_percent"];

function dirOf(v: PValue | undefined): 1 | -1 {
  if (v === -1 || v === "short" || v === false) return -1;
  return 1;
}
function strategyCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  if (rt.isSecondary) return null;
  if (name.startsWith("closedtrades.") || name.startsWith("opentrades.")) {
    const closed = name.startsWith("closed");
    return tradeField(rt, closed, name.slice(name.indexOf(".") + 1), pos[0] ?? named.trade_num ?? null);
  }
  if (name.startsWith("risk.")) return null;
  // deprecated `when=` argument (v4/v5): the order is only placed when true
  if ("when" in named && !truthy(named.when)) return null;
  switch (name) {
    case "entry": case "order": {
      const r = a(["id", "direction", "qty", "limit", "stop", "oca_name", "oca_type", "comment", "alert_message", "disable_alert"], pos, named);
      const id = typeof r.id === "string" ? r.id : `E${rt.plan.entries.length + 1}`;
      const limit = isNum(r.limit) ? r.limit : null;
      const stop = isNum(r.stop) ? r.stop : null;
      rt.plan.entries.push(limit !== null || stop !== null ? { id, dir: dirOf(r.direction), limit, stop } : { id, dir: dirOf(r.direction) });
      return null;
    }
    case "exit": {
      const r = a(["id", "from_entry", "qty", "qty_percent", "profit", "limit", "loss", "stop", "trail_price", "trail_points", "trail_offset", "oca_name", "comment"], pos, named);
      const fromEntry = typeof r.from_entry === "string" ? r.from_entry : "";
      const stop = isNum(r.stop) ? r.stop : null;
      const limit = isNum(r.limit) ? r.limit : null;
      const profitTicks = isNum(r.profit) ? r.profit : null;
      const lossTicks = isNum(r.loss) ? r.loss : null;
      const orderId = typeof r.id === "string" ? r.id : `X${rt.plan.exits.length + 1}`;
      if (stop === null && limit === null && profitTicks === null && lossTicks === null) return null;
      // absolute levels for the live executor: tick offsets resolve against the
      // open position (or this bar's close for an entry that fills next bar)
      const pos2 = rt.currentPos();
      const ref = pos2.dir !== 0 ? pos2.entry : (rt.bClose.at(rt.bar) as number);
      const dirE = pos2.dir !== 0 ? pos2.dir : (rt.plan.entries.find((e) => e.id === fromEntry || fromEntry === "")?.dir ?? 1);
      const mt = rt.opts.mintick || 0.01;
      const absStop = stop ?? (lossTicks !== null && isNum(ref) ? ref - dirE * lossTicks * mt : null);
      const absLimit = limit ?? (profitTicks !== null && isNum(ref) ? ref + dirE * profitTicks * mt : null);
      rt.plan.exits.push({ orderId, fromEntry, stop: absStop, limit: absLimit });
      rt.exitOrders.set(fromEntry, { stop, limit, profitTicks, lossTicks });
      return null;
    }
    case "close": {
      const id = typeof (pos[0] ?? named.id) === "string" ? ((pos[0] ?? named.id) as string) : "";
      rt.plan.closes.push(id);
      return null;
    }
    case "close_all":
      rt.plan.closeAll = true;
      return null;
    case "cancel": {
      const id = typeof (pos[0] ?? named.id) === "string" ? ((pos[0] ?? named.id) as string) : "";
      rt.plan.cancels.push(id);
      rt.exitOrders.delete(id);
      rt.restingEntries.delete(id);
      return null;
    }
    case "cancel_all":
      rt.exitOrders.clear();
      rt.restingEntries.clear();
      return null;
    case "convert_to_account": case "convert_to_symbol": return pos[0] ?? null;
    case "default_entry_qty": return 1;
  }
  return err(site, `strategy.${name} is not a TradingView function.`);
}
const STRATEGY_FUNCS = [
  "entry", "order", "exit", "close", "close_all", "cancel", "cancel_all", "convert_to_account", "convert_to_symbol", "default_entry_qty",
  "risk.allow_entry_in", "risk.max_cons_loss_days", "risk.max_drawdown", "risk.max_intraday_filled_orders", "risk.max_intraday_loss", "risk.max_position_size",
  ...TRADE_FIELDS.map((f) => `closedtrades.${f}`),
  ...TRADE_FIELDS.filter((f) => !f.startsWith("exit")).map((f) => `opentrades.${f}`),
];

// ── plots ────────────────────────────────────────────────────────────────
function plotRef(key: string, kind: DrawKind = "plot"): PDraw {
  return { __d: kind, props: { key } };
}
function doPlot(rt: PineRuntime, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const key = `p${site.id}`;
  if (rt.isSecondary) return plotRef(key);
  const r = a(["series", "title", "color", "linewidth", "style", "trackprice", "histbase", "offset", "join", "editable", "show_last", "display", "format", "precision", "force_overlay"], pos, named);
  let meta = rt.plots.get(key);
  if (!meta) {
    meta = {
      meta: {
        key,
        title: typeof r.title === "string" ? r.title : `Plot ${rt.plots.size + 1}`,
        style: typeof r.style === "string" ? r.style.replace(/^style_/, "") : "line",
        color: r.color !== undefined && r.color !== null ? normalizeColor(r.color) : "#2ECCFF",
        lineWidth: isNum(r.linewidth) ? r.linewidth : 2,
        editableColor: r.color !== undefined,
      },
      values: [],
      colors: [],
    };
    rt.plots.set(key, meta);
  }
  while (meta.values.length < rt.bar) {
    meta.values.push(null);
    meta.colors.push(null);
  }
  const v = r.series ?? null;
  const hidden = r.color === null;
  meta.values[rt.bar] = isNum(v) && !hidden ? v : typeof v === "boolean" ? (v ? 1 : 0) : null;
  meta.colors[rt.bar] = r.color !== undefined && r.color !== null ? normalizeColor(r.color) : null;
  return plotRef(key);
}
function doShape(rt: PineRuntime, kind: "plotshape" | "plotchar" | "plotarrow", pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  if (rt.isSecondary) return null;
  const key = `${kind === "plotarrow" ? "a" : "s"}${site.id}`;
  const sig = kind === "plotshape"
    ? ["series", "title", "style", "location", "color", "offset", "text", "textcolor", "editable", "size", "show_last", "display", "format", "precision", "force_overlay"]
    : kind === "plotchar"
      ? ["series", "title", "char", "location", "color", "offset", "text", "textcolor", "editable", "size", "show_last", "display", "format", "precision", "force_overlay"]
      : ["series", "title", "colorup", "colordown", "offset", "minheight", "maxheight", "editable", "show_last", "display", "format", "precision", "force_overlay"];
  const r = a(sig, pos, named);
  let meta = rt.shapes.get(key);
  if (!meta) {
    const style = kind === "plotarrow" ? "arrow" : kind === "plotchar" ? s0(r.char, "•") : s0(r.style, "xcross").replace(/^shape_/, "");
    meta = {
      meta: {
        key,
        title: typeof r.title === "string" ? r.title : `Shape ${rt.shapes.size + 1}`,
        style,
        color: r.color !== undefined && r.color !== null ? normalizeColor(r.color) : "#2ECCFF",
        location: s0(r.location, kind === "plotchar" || kind === "plotshape" ? "abovebar" : "absolute"),
        text: s0(r.text, kind === "plotchar" ? s0(r.char, "•") : ""),
      },
      marks: [],
    };
    rt.shapes.set(key, meta);
  }
  const v = r.series ?? null;
  if (kind === "plotarrow") {
    if (isNum(v) && v !== 0) {
      meta.marks.push({ bar: rt.bar, up: v > 0, text: "", color: v > 0 ? normalizeColor(r.colorup ?? "#089981") : normalizeColor(r.colordown ?? "#F23645") });
    }
    return null;
  }
  const on = v === true || (isNum(v) && v !== 0 && meta.meta.location !== "absolute") || (isNum(v) && meta.meta.location === "absolute");
  if (on && r.color !== null) {
    meta.marks.push({
      bar: rt.bar,
      up: !/down|below/.test(meta.meta.style + meta.meta.location),
      text: meta.meta.text,
      color: r.color !== undefined ? normalizeColor(r.color) : meta.meta.color,
    });
  }
  return null;
}

// ── colours ──────────────────────────────────────────────────────────────
function colorCall(_rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  switch (name) {
    case "new": {
      const r = a(["color", "transp"], pos, named);
      const c = parseColor(r.color ?? null);
      if (!c) return r.color === null ? null : (r.color ?? null);
      const t = n0(r.transp, 0);
      return rgbaStr({ ...c, a: Math.max(0, Math.min(1, 1 - t / 100)) });
    }
    case "rgb": {
      const r = a(["red", "green", "blue", "transp"], pos, named);
      return rgbaStr({ r: n0(r.red, 0), g: n0(r.green, 0), b: n0(r.blue, 0), a: 1 - n0(r.transp, 0) / 100 });
    }
    case "r": case "g": case "b": { const c = parseColor(pos[0] ?? null); return c ? c[name] : null; }
    case "t": { const c = parseColor(pos[0] ?? null); return c ? Math.round((1 - c.a) * 100) : null; }
    case "from_gradient": {
      const r = a(["value", "bottom_value", "top_value", "bottom_color", "top_color"], pos, named);
      const v = r.value, lo = r.bottom_value, hi = r.top_value;
      const c1 = parseColor(r.bottom_color ?? null), c2 = parseColor(r.top_color ?? null);
      if (!isNum(v) || !isNum(lo) || !isNum(hi) || !c1 || !c2) return null;
      const k = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      return rgbaStr({ r: c1.r + (c2.r - c1.r) * k, g: c1.g + (c2.g - c1.g) * k, b: c1.b + (c2.b - c1.b) * k, a: c1.a + (c2.a - c1.a) * k });
    }
  }
  return err(site, `color.${name} is not a TradingView function.`);
}

// ── strings ──────────────────────────────────────────────────────────────
function strCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const s = pos[0];
  switch (name) {
    case "tostring": {
      const v = s ?? named.value ?? null;
      const f = pos[1] ?? named.format;
      if (typeof v === "number") return Number.isFinite(v) ? fmtNum(rt, v, f) : "NaN";
      if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "number" ? fmtNum(rt, x, f) : toPineStr(x, rt))).join(", ")}]`;
      return toPineStr(v ?? null, rt);
    }
    case "tonumber": { if (isNum(s)) return s; if (typeof s !== "string") return null; const n = Number(s.trim()); return s.trim() === "" || Number.isNaN(n) ? null : n; }
    case "format": return typeof s === "string" ? strFormat(rt, s, pos.slice(1)) : null;
    case "format_time": { const t = s ?? named.time; return isNum(t) ? formatTime(t, s0(pos[1] ?? named.format, "yyyy-MM-dd'T'HH:mm:ssZ").replace(/'/g, ""), s0(pos[2] ?? named.timezone, rt.timezone)) : null; }
    case "length": return typeof s === "string" ? s.length : null;
    case "contains": return typeof s === "string" && typeof pos[1] === "string" ? s.includes(pos[1]) : false;
    case "startswith": return typeof s === "string" && typeof pos[1] === "string" ? s.startsWith(pos[1]) : false;
    case "endswith": return typeof s === "string" && typeof pos[1] === "string" ? s.endsWith(pos[1]) : false;
    case "pos": { if (typeof s !== "string" || typeof pos[1] !== "string") return null; const i = s.indexOf(pos[1]); return i < 0 ? null : i; }
    case "lower": return typeof s === "string" ? s.toLowerCase() : null;
    case "upper": return typeof s === "string" ? s.toUpperCase() : null;
    case "trim": return typeof s === "string" ? s.trim() : null;
    case "substring": { if (typeof s !== "string") return null; return s.slice(n0(pos[1], 0), isNum(pos[2]) ? pos[2] : s.length); }
    case "replace": {
      if (typeof s !== "string" || typeof pos[1] !== "string") return s ?? null;
      const occ = n0(pos[3], 0);
      let idx = -1, from = 0;
      for (let i = 0; i <= occ; i++) { idx = s.indexOf(pos[1], from); if (idx < 0) return s; from = idx + pos[1].length; }
      return s.slice(0, idx) + s0(pos[2], "") + s.slice(idx + pos[1].length);
    }
    case "replace_all": return typeof s === "string" && typeof pos[1] === "string" ? s.split(pos[1]).join(s0(pos[2], "")) : s ?? null;
    case "repeat": {
      if (typeof s !== "string") return null;
      const n = Math.max(0, n0(pos[1], 0));
      const sep = s0(pos[2], "");
      return Array.from({ length: n }, () => s).join(sep);
    }
    case "split": return typeof s === "string" && typeof pos[1] === "string" ? s.split(pos[1]) : [];
    case "match": {
      if (typeof s !== "string" || typeof pos[1] !== "string") return "";
      try { const m = new RegExp(pos[1]).exec(s); return m ? m[0] : ""; } catch { return ""; }
    }
  }
  return err(site, `str.${name} is not a TradingView function.`);
}
const STR_FUNCS = ["tostring", "tonumber", "format", "format_time", "length", "contains", "startswith", "endswith", "pos", "lower", "upper", "trim", "substring", "replace", "replace_all", "repeat", "split", "match"];

// ── math ─────────────────────────────────────────────────────────────────
function mathCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const x = pos[0] ?? named.number ?? named.value ?? null;
  const one = (f: (v: number) => number): PValue => (isNum(x) ? f(x) : null);
  switch (name) {
    case "abs": return one(Math.abs);
    case "acos": return one(Math.acos);
    case "asin": return one(Math.asin);
    case "atan": return one(Math.atan);
    case "cos": return one(Math.cos);
    case "sin": return one(Math.sin);
    case "tan": return one(Math.tan);
    case "sqrt": return one((v) => (v < 0 ? NaN : Math.sqrt(v)));
    case "exp": return one(Math.exp);
    case "log": return one((v) => (v <= 0 ? NaN : Math.log(v)));
    case "log10": return one((v) => (v <= 0 ? NaN : Math.log10(v)));
    case "sign": return one(Math.sign);
    case "floor": return one(Math.floor);
    case "ceil": return one(Math.ceil);
    case "round": {
      if (!isNum(x)) return null;
      const d = n0(pos[1] ?? named.precision, 0);
      // Pine rounds half away from zero
      const f = 10 ** d;
      return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
    }
    case "pow": return isNum(x) && isNum(pos[1]) ? x ** pos[1] : null;
    case "max": case "min": {
      if (pos.some((v) => v === null)) return null;
      const ns = pos.filter(isNum);
      return ns.length ? (name === "max" ? Math.max(...ns) : Math.min(...ns)) : null;
    }
    case "avg": {
      if (pos.some((v) => v === null)) return null;
      const ns = pos.filter(isNum);
      return ns.length ? ns.reduce((p, q) => p + q, 0) / ns.length : null;
    }
    case "sum": {
      const len = pos[1] ?? named.length;
      const st = rt.siteState<{ buf: (number | null)[] }>(site.id, () => ({ buf: [] }));
      st.buf.push(isNum(x) ? x : null);
      if (!isNum(len)) return null;
      while (st.buf.length > len) st.buf.shift();
      if (st.buf.length < len || st.buf.some((v) => v === null)) return null;
      return (st.buf as number[]).reduce((p, q) => p + q, 0);
    }
    case "todegrees": return one((v) => (v * 180) / Math.PI);
    case "toradians": return one((v) => (v * Math.PI) / 180);
    case "round_to_mintick": { if (!isNum(x)) return null; const mt = rt.opts.mintick || 0.01; return parseFloat((Math.round(x / mt) * mt).toFixed(decimalsOf(mt))); }
    case "random": {
      const lo = n0(pos[0], 0), hi = n0(pos[1], 1);
      const seed = pos[2];
      if (isNum(seed)) {
        const st = rt.siteState<{ s: number }>(site.id, () => ({ s: Math.trunc(seed) >>> 0 }));
        st.s = (Math.imul(st.s ^ (st.s >>> 15), 1 | st.s) + 0x6d2b79f5) >>> 0;
        return lo + (st.s / 4294967296) * (hi - lo);
      }
      return lo + Math.random() * (hi - lo);
    }
  }
  return err(site, `math.${name} is not a TradingView function.`);
}
const MATH_FUNCS = ["abs", "acos", "asin", "atan", "cos", "sin", "tan", "sqrt", "exp", "log", "log10", "sign", "floor", "ceil", "round", "pow", "max", "min", "avg", "sum", "todegrees", "toradians", "round_to_mintick", "random"];

// ── time ─────────────────────────────────────────────────────────────────
function timeCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const bt = rt.barTime();
  switch (name) {
    case "time": case "time_close": {
      const r = a(["timeframe", "session", "timezone"], pos, named);
      const tfS = tvTfSec(typeof r.timeframe === "string" ? r.timeframe : "") ?? rt.tfSec;
      const start = tfS > rt.tfSec ? bucketStart(bt, tfS) : bt;
      const out = name === "time" ? start : tfS > rt.tfSec ? bucketEnd(start, tfS) : bt + rt.tfSec * 1000;
      if (typeof r.session === "string" && r.session !== "") {
        return inSession(rt, bt, r.session, s0(r.timezone, rt.timezone)) ? out : null;
      }
      return out;
    }
    case "year": case "month": case "weekofyear": case "dayofmonth": case "dayofweek": case "hour": case "minute": case "second": {
      const t = isNum(pos[0]) ? pos[0] : bt;
      const p = tzParts(t, s0(pos[1] ?? named.timezone, rt.timezone));
      const map: Record<string, number> = { year: p.year, month: p.month, weekofyear: p.weekofyear, dayofmonth: p.day, dayofweek: p.dow, hour: p.hour, minute: p.minute, second: p.second };
      return map[name];
    }
    case "timestamp": {
      if (pos.length === 1 && typeof pos[0] === "string") {
        const ms = Date.parse(pos[0]);
        return Number.isNaN(ms) ? null : ms;
      }
      let tz = rt.timezone;
      let args = pos;
      if (typeof pos[0] === "string") { tz = pos[0]; args = pos.slice(1); }
      if (typeof named.timezone === "string") tz = named.timezone;
      const [y, mo, d, h, mi, s] = [args[0] ?? named.year, args[1] ?? named.month, args[2] ?? named.day, args[3] ?? named.hour, args[4] ?? named.minute, args[5] ?? named.second];
      if (!isNum(y) || !isNum(mo) || !isNum(d)) return null;
      return tzTimestamp(tz, y, mo, d, n0(h, 0), n0(mi, 0), n0(s, 0));
    }
  }
  return err(site, `${name}() is not a TradingView function.`);
}
function tfCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  switch (name) {
    case "in_seconds": {
      const tf = pos[0] ?? named.timeframe;
      return tvTfSec(typeof tf === "string" ? tf : "") ?? rt.tfSec;
    }
    case "from_seconds": return isNum(pos[0]) ? secToTv(pos[0]) : null;
    case "change": {
      const tf = tvTfSec(typeof pos[0] === "string" ? pos[0] : "") ?? rt.tfSec;
      const st = rt.siteState<{ last: number | null }>(site.id, () => ({ last: null }));
      const b = bucketStart(rt.barTime(), tf);
      const ch = st.last !== null && b !== st.last;
      st.last = b;
      return ch;
    }
  }
  return err(site, `timeframe.${name} is not a TradingView function.`);
}

// ── chart.point ──────────────────────────────────────────────────────────
function pointCall(rt: PineRuntime, name: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const mk = (time: PValue, index: PValue, price: PValue): PUdt => ({ __t: "chart.point", f: { time, index, price } });
  switch (name) {
    case "new": { const r = a(["time", "index", "price"], pos, named); return mk(r.time ?? null, r.index ?? null, r.price ?? null); }
    case "from_index": { const r = a(["index", "price"], pos, named); return mk(null, r.index ?? null, r.price ?? null); }
    case "from_time": { const r = a(["time", "price"], pos, named); return mk(r.time ?? null, null, r.price ?? null); }
    case "now": return mk(rt.barTime(), rt.bar, pos[0] ?? named.price ?? rt.bClose.at(rt.bar));
    case "copy": return isUdt(pos[0]) ? { __t: "chart.point", f: { ...pos[0].f } } : null;
  }
  return err(site, `chart.point.${name} is not a TradingView function.`);
}

// ── the function table ───────────────────────────────────────────────────
const FUNCS: Record<string, Fn> = {
  na: (_rt, pos) => (pos.length ? pos[0] === null || (typeof pos[0] === "number" && !Number.isFinite(pos[0])) : true),
  nz: (_rt, pos, named) => {
    const v = pos[0] ?? null;
    const rep = pos.length > 1 ? pos[1] : named.replacement !== undefined ? named.replacement : 0;
    return v === null || (typeof v === "number" && !Number.isFinite(v)) ? rep : v;
  },
  fixnan: (rt, pos, _n, site) => {
    const st = rt.siteState<{ last: PValue }>(site.id, () => ({ last: null }));
    if (pos[0] !== null && pos[0] !== undefined) st.last = pos[0];
    return st.last;
  },
  iff: (_rt, pos) => (truthy(pos[0] ?? null) ? pos[1] ?? null : pos[2] ?? null),
  offset: (rt, pos, _n, site) => {
    const st = rt.siteState<{ h: PValue[] }>(site.id, () => ({ h: [] }));
    st.h.push(pos[0] ?? null);
    const n = n0(pos[1], 0);
    return st.h[st.h.length - 1 - n] ?? null;
  },
  plot: doPlot,
  plotshape: (rt, pos, named, site) => doShape(rt, "plotshape", pos, named, site),
  plotchar: (rt, pos, named, site) => doShape(rt, "plotchar", pos, named, site),
  plotarrow: (rt, pos, named, site) => doShape(rt, "plotarrow", pos, named, site),
  plotcandle: SKIP,
  plotbar: SKIP,
  hline: (rt, pos, named, site) => {
    const r = a(["price", "title", "color", "linestyle", "linewidth", "editable", "display"], pos, named);
    if (!rt.isSecondary && !rt.hlineSitesHas(site.id) && isNum(r.price)) {
      rt.hlines.push({
        key: `h${site.id}`,
        price: r.price,
        color: r.color !== undefined ? normalizeColor(r.color) : "#6485AB",
        style: typeof r.linestyle === "string" ? r.linestyle.replace(/^style_/, "") : "solid",
        title: typeof r.title === "string" ? r.title : "",
      });
    }
    return plotRef(`h${site.id}`, "hline");
  },
  bgcolor: (rt, pos, named) => {
    if (rt.isSecondary) return null;
    const r = a(["color", "offset", "editable", "show_last", "title", "display", "force_overlay"], pos, named);
    let c = r.color ?? null;
    if (c !== null && isNum(named.transp)) c = colorCall(rt, "new", [c, named.transp], {}, null as unknown as Call);
    while (rt.bgColors.length < rt.bar) rt.bgColors.push(null);
    if (c !== null && typeof c === "string") rt.bgColors[rt.bar] = normalizeColor(c);
    else if (rt.bgColors[rt.bar] === undefined) rt.bgColors[rt.bar] = null;
    return null;
  },
  barcolor: SKIP,
  fill: (rt, pos, named, site) => {
    if (rt.isSecondary) return null;
    const p1 = pos[0] ?? named.plot1 ?? named.hline1 ?? null;
    const p2 = pos[1] ?? named.plot2 ?? named.hline2 ?? null;
    if (!isDraw(p1) || !isDraw(p2)) return null;
    // fill(p1, p2, color) · gradient fill(p1, p2, top_value, bottom_value, top_color, bottom_color)
    let c: PValue;
    if (isNum(pos[2]) || "top_color" in named) c = (pos[4] ?? named.top_color ?? null) as PValue;
    else c = (pos[2] ?? named.color ?? "rgba(41,98,255,0.2)") as PValue;
    if (c !== null && isNum(named.transp)) c = colorCall(rt, "new", [c, named.transp], {}, site);
    let f = rt.fills.get(site.id);
    if (!f) {
      f = { a: String(p1.props.key), b: String(p2.props.key), colors: [] };
      rt.fills.set(site.id, f);
    }
    while (f.colors.length < rt.bar) f.colors.push(null);
    f.colors[rt.bar] = typeof c === "string" ? normalizeColor(c) : null;
    return null;
  },
  alert: (rt, pos, named) => {
    const m = pos[0] ?? named.message;
    if (!rt.isSecondary && typeof m === "string") rt.barAlerts.push(m);
    return null;
  },
  alertcondition: (rt, pos, named) => {
    const r = a(["condition", "title", "message"], pos, named);
    if (!rt.isSecondary && truthy(r.condition ?? null)) rt.barAlerts.push(typeof r.message === "string" ? r.message : typeof r.title === "string" ? r.title : "alertcondition");
    return null;
  },
  indicator: SKIP,
  strategy: SKIP,
  library: SKIP,
  max_bars_back: SKIP,
  time: (rt, pos, named, site) => timeCall(rt, "time", pos, named, site),
  time_close: (rt, pos, named, site) => timeCall(rt, "time_close", pos, named, site),
  timestamp: (rt, pos, named, site) => timeCall(rt, "timestamp", pos, named, site),
  "request.currency_rate": () => 1,
  "request.financial": () => null,
  "request.quandl": () => null,
  "request.economic": () => null,
  "request.dividends": () => null,
  "request.earnings": () => null,
  "request.splits": () => null,
  "request.seed": () => null,
  "request.security_lower_tf": (_rt, pos, named) => [pos[2] ?? named.expression ?? null],
  "ticker.new": (rt, pos) => (typeof pos[1] === "string" ? pos[1] : rt.opts.ticker),
  "ticker.standard": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "ticker.modify": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "ticker.inherit": (rt, pos) => (typeof pos[1] === "string" ? pos[1] : rt.opts.ticker),
  "ticker.heikinashi": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "ticker.renko": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "ticker.linebreak": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "ticker.kagi": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "ticker.pointfigure": (rt, pos) => (typeof pos[0] === "string" ? pos[0] : rt.opts.ticker),
  "syminfo.prefix": () => "HALO",
  "syminfo.ticker": (rt) => rt.opts.ticker,
  "log.info": (rt, pos) => { if (!rt.isSecondary) rt.logs.push(String(pos[0] ?? "")); return null; },
  "log.warning": (rt, pos) => { if (!rt.isSecondary) rt.logs.push(String(pos[0] ?? "")); return null; },
  "log.error": (rt, pos) => { if (!rt.isSecondary) rt.logs.push(String(pos[0] ?? "")); return null; },
  "runtime.error": (_rt, pos, _n, site) => err(site, `runtime.error: ${toPineStr(pos[0] ?? "")}`),
  "linefill.new": (rt, pos, named, site) => drawCall(rt, "linefill", "new", pos, named, site),
};
for (const f of ["input", ...Object.keys(INPUT_SIGS).filter((k) => k !== "input").map((k) => `input.${k}`)]) {
  FUNCS[f] = (rt, pos, named, site) => inputCall(rt, f === "input" ? "input" : f.slice(6), pos, named, site);
}
for (const f of ["year", "month", "weekofyear", "dayofmonth", "dayofweek", "hour", "minute", "second"]) {
  FUNCS[f] = (rt, pos, named, site) => timeCall(rt, f, pos, named, site);
}
for (const k of Object.keys(TA_SIGS)) FUNCS[`ta.${k}`] = (rt, pos, named, site) => taCall(rt, k, pos, named, site);
for (const k of MATH_FUNCS) FUNCS[`math.${k}`] = (rt, pos, named, site) => mathCall(rt, k, pos, named, site);
for (const k of STR_FUNCS) FUNCS[`str.${k}`] = (rt, pos, named, site) => strCall(rt, k, pos, named, site);
for (const k of ARRAY_FUNCS) FUNCS[`array.${k}`] = (rt, pos, named, site) => arrCall(rt, k, pos, named, site);
for (const k of MAP_FUNCS) FUNCS[`map.${k}`] = (rt, pos, named, site) => mapCall(rt, k, pos, named, site);
for (const k of MATRIX_FUNCS) FUNCS[`matrix.${k}`] = (rt, pos, named, site) => matCall(rt, k, pos, named, site);
for (const k of ["new", "rgb", "r", "g", "b", "t", "from_gradient"]) FUNCS[`color.${k}`] = (rt, pos, named, site) => colorCall(rt, k, pos, named, site);
for (const k of STRATEGY_FUNCS) FUNCS[`strategy.${k}`] = (rt, pos, named, site) => strategyCall(rt, k, pos, named, site);
for (const k of ["in_seconds", "from_seconds", "change"]) FUNCS[`timeframe.${k}`] = (rt, pos, named, site) => tfCall(rt, k, pos, named, site);
for (const k of ["new", "from_index", "from_time", "now", "copy"]) FUNCS[`chart.point.${k}`] = (rt, pos, named, site) => pointCall(rt, k, pos, named, site);
const DRAW_METHODS: Record<string, string[]> = {
  line: ["new", "delete", "copy", "get_x1", "get_y1", "get_x2", "get_y2", "get_price", "set_x1", "set_y1", "set_x2", "set_y2", "set_xy1", "set_xy2", "set_xloc", "set_extend", "set_color", "set_style", "set_width", "set_first_point", "set_second_point"],
  label: ["new", "delete", "copy", "get_x", "get_y", "get_text", "set_x", "set_y", "set_xy", "set_xloc", "set_yloc", "set_text", "set_color", "set_style", "set_textcolor", "set_size", "set_textalign", "set_tooltip", "set_text_font_family", "set_point", "set_text_formatting"],
  box: ["new", "delete", "copy", "get_left", "get_top", "get_right", "get_bottom", "set_left", "set_top", "set_right", "set_bottom", "set_lefttop", "set_rightbottom", "set_top_left_point", "set_bottom_right_point", "set_border_color", "set_border_width", "set_border_style", "set_bgcolor", "set_extend", "set_text", "set_text_color", "set_text_size", "set_text_halign", "set_text_valign", "set_text_wrap", "set_text_font_family", "set_xloc", "set_text_formatting"],
  table: ["new", "delete", "cell", "clear", "merge_cells", "set_position", "set_bgcolor", "set_frame_color", "set_frame_width", "set_border_color", "set_border_width",
    "cell_set_text", "cell_set_bgcolor", "cell_set_text_color", "cell_set_text_size", "cell_set_text_halign", "cell_set_text_valign", "cell_set_width", "cell_set_height", "cell_set_tooltip", "cell_set_text_font_family", "cell_set_text_formatting"],
  linefill: ["delete", "get_line1", "get_line2", "set_color"],
  polyline: ["new", "delete"],
};
for (const [ns, list] of Object.entries(DRAW_METHODS)) {
  for (const m of list) FUNCS[`${ns}.${m}`] = (rt, pos, named, site) => drawCall(rt, ns as DrawKind, m, pos, named, site);
}

export function hasBuiltinFunc(path: string): boolean {
  return path in FUNCS || path === "request.security" || CAST_FUNCS.has(path);
}
export const FUNC_NAMES = new Set([...Object.keys(FUNCS), "request.security", ...CAST_FUNCS]);

export function callBuiltin(rt: PineRuntime, fn: string, pos: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const f = FUNCS[fn];
  if (f) return f(rt, pos, named, site);
  const alias = V4_ALIASES[fn];
  if (alias && FUNCS[alias]) return FUNCS[alias](rt, pos, named, site);
  throw new PineError(`"${fn}()" is not a TradingView function (or not available in the HALO runtime).`, site.line, site.col);
}

// ── built-in variables ───────────────────────────────────────────────────
export function builtinVar(rt: PineRuntime, path: string): PValue | undefined {
  const bar = rt.bar;
  switch (path) {
    case "na": return null;
    case "timenow": return Date.now();
    case "last_bar_index": return rt.knownLastBar ?? bar;
    case "last_bar_time": return rt.barTime();
    case "time_tradingday": return bucketStart(rt.barTime(), 86400);
    case "ask": case "bid": return rt.bClose.at(bar);
    case "year": case "month": case "weekofyear": case "dayofmonth": case "dayofweek": case "hour": case "minute": case "second": {
      const p = tzParts(rt.barTime(), rt.timezone);
      const map: Record<string, number> = { year: p.year, month: p.month, weekofyear: p.weekofyear, dayofmonth: p.day, dayofweek: p.dow, hour: p.hour, minute: p.minute, second: p.second };
      return map[path];
    }
    case "n": return rt.version <= 3 ? bar : undefined;
    // Pine v1–v3 built-in variables
    case "tickerid": case "ticker": return rt.version <= 3 ? rt.opts.ticker : undefined;
    case "period": return rt.version <= 3 ? secToTv(rt.tfSec) : undefined;
    case "interval": return rt.version <= 3 ? (builtinVar(rt, "timeframe.multiplier") as number) : undefined;
    case "isintraday": return rt.version <= 3 ? rt.tfSec < 86400 : undefined;
    case "isdwm": return rt.version <= 3 ? rt.tfSec >= 86400 : undefined;
    case "isdaily": return rt.version <= 3 ? rt.tfSec >= 86400 && rt.tfSec < 604800 : undefined;
    case "isweekly": return rt.version <= 3 ? rt.tfSec >= 604800 && rt.tfSec < 2592000 : undefined;
    case "ismonthly": return rt.version <= 3 ? rt.tfSec >= 2592000 : undefined;
    // barstate
    case "barstate.isfirst": return bar === 0;
    case "barstate.islast": case "barstate.islastconfirmedhistory":
      if (rt.knownLastBar !== null && !rt.isSecondary) return bar === rt.knownLastBar;
      return rt.barTime() + 2 * rt.tfSec * 1000 > Date.now();
    case "barstate.isconfirmed": return true;
    case "barstate.isnew": return true;
    case "barstate.isrealtime": return false;
    case "barstate.ishistory": return true;
    case "barstate.isclosed": return true;
    // syminfo
    case "syminfo.ticker": case "syminfo.tickerid": case "syminfo.root": case "syminfo.description": case "syminfo.main_tickerid": return rt.opts.ticker;
    case "syminfo.prefix": return "HALO";
    case "syminfo.mintick": return rt.opts.mintick;
    case "syminfo.pointvalue": return 1;
    case "syminfo.pricescale": return Math.round(1 / (rt.opts.mintick || 0.01));
    case "syminfo.minmove": return 1;
    case "syminfo.mincontract": return 0.01;
    case "syminfo.currency": return "USD";
    case "syminfo.basecurrency": return (rt.opts.ticker || "").slice(0, 3);
    case "syminfo.timezone": return rt.timezone;
    case "syminfo.session": return "24x7";
    case "syminfo.volumetype": return "tick";
    case "syminfo.type": {
      const t = (rt.opts.ticker || "").toUpperCase();
      if (/USDT$|^BTC|^ETH/.test(t)) return "crypto";
      if (/^X(AU|AG|PT|PD)/.test(t)) return "cfd";
      if (/^[A-Z]{6}$/.test(t)) return "forex";
      return "cfd";
    }
    case "syminfo.country": case "syminfo.sector": case "syminfo.industry": return "";
    case "syminfo.expiration_date": return null;
    case "syminfo.shares_outstanding_float": case "syminfo.shares_outstanding_total": case "syminfo.employees": case "syminfo.shareholders": return null;
    // timeframe
    case "timeframe.period": case "timeframe.main_period": return secToTv(rt.tfSec);
    case "timeframe.multiplier": {
      const s = rt.tfSec;
      if (s % 2592000 === 0) return s / 2592000;
      if (s % 604800 === 0) return s / 604800;
      if (s % 86400 === 0) return s / 86400;
      if (s % 60 === 0) return s / 60;
      return s;
    }
    case "timeframe.isintraday": return rt.tfSec < 86400;
    case "timeframe.isdaily": return rt.tfSec >= 86400 && rt.tfSec < 604800;
    case "timeframe.isweekly": return rt.tfSec >= 604800 && rt.tfSec < 2592000;
    case "timeframe.ismonthly": return rt.tfSec >= 2592000;
    case "timeframe.isdwm": return rt.tfSec >= 86400;
    case "timeframe.isminutes": return rt.tfSec >= 60 && rt.tfSec < 86400;
    case "timeframe.isseconds": return rt.tfSec < 60;
    case "timeframe.isticks": return false;
    // chart
    case "chart.bg_color": return "#131722";
    case "chart.fg_color": return "#D1D4DC";
    case "chart.is_standard": return true;
    case "chart.is_heikinashi": case "chart.is_kagi": case "chart.is_linebreak": case "chart.is_pnf": case "chart.is_range": case "chart.is_renko": return false;
    case "chart.left_visible_bar_time": return rt.candles[0]?.time ?? rt.barTime();
    case "chart.right_visible_bar_time": return rt.barTime();
    // session
    case "session.ismarket": return true;
    case "session.ispremarket": case "session.ispostmarket": return false;
    case "session.isfirstbar": case "session.isfirstbar_regular": {
      const pt = rt.bTime.hist(bar, 1);
      return !isNum(pt) || Math.floor(pt / 86400000) !== Math.floor(rt.barTime() / 86400000);
    }
    case "session.islastbar": case "session.islastbar_regular":
      return Math.floor((rt.barTime() + rt.tfSec * 1000) / 86400000) !== Math.floor(rt.barTime() / 86400000);
    // drawing collections
    case "line.all": return rt.drawLists.line;
    case "label.all": return rt.drawLists.label;
    case "box.all": return rt.drawLists.box;
    case "table.all": return rt.drawLists.table;
    case "linefill.all": return rt.drawLists.linefill;
    case "polyline.all": return rt.drawLists.polyline;
  }
  if (path.startsWith("strategy.")) return stratVar(rt, path.slice(9));
  return undefined;
}

export const VAR_NAMES = new Set([
  "open", "high", "low", "close", "volume", "time", "time_close", "hl2", "hlc3", "ohlc4", "hlcc4", "bar_index", "last_bar_index", "last_bar_time",
  "timenow", "time_tradingday", "ask", "bid", "year", "month", "weekofyear", "dayofmonth", "dayofweek", "hour", "minute", "second", "na",
  "barstate.isfirst", "barstate.islast", "barstate.islastconfirmedhistory", "barstate.isconfirmed", "barstate.isnew", "barstate.isrealtime", "barstate.ishistory", "barstate.isclosed",
  "syminfo.ticker", "syminfo.tickerid", "syminfo.root", "syminfo.description", "syminfo.main_tickerid", "syminfo.prefix", "syminfo.mintick", "syminfo.pointvalue",
  "syminfo.pricescale", "syminfo.minmove", "syminfo.mincontract", "syminfo.currency", "syminfo.basecurrency", "syminfo.timezone", "syminfo.session", "syminfo.volumetype",
  "syminfo.type", "syminfo.country", "syminfo.sector", "syminfo.industry", "syminfo.expiration_date", "syminfo.shares_outstanding_float", "syminfo.shares_outstanding_total",
  "syminfo.employees", "syminfo.shareholders",
  "timeframe.period", "timeframe.main_period", "timeframe.multiplier", "timeframe.isintraday", "timeframe.isdaily", "timeframe.isweekly", "timeframe.ismonthly",
  "timeframe.isdwm", "timeframe.isminutes", "timeframe.isseconds", "timeframe.isticks",
  "chart.bg_color", "chart.fg_color", "chart.is_standard", "chart.is_heikinashi", "chart.is_kagi", "chart.is_linebreak", "chart.is_pnf", "chart.is_range", "chart.is_renko",
  "chart.left_visible_bar_time", "chart.right_visible_bar_time",
  "session.ismarket", "session.ispremarket", "session.ispostmarket", "session.isfirstbar", "session.isfirstbar_regular", "session.islastbar", "session.islastbar_regular",
  "line.all", "label.all", "box.all", "table.all", "linefill.all", "polyline.all",
  ...STRATEGY_VARS.map((v) => `strategy.${v}`),
  ...TA_VARS.map((v) => `ta.${v}`),
]);

// ── constants ────────────────────────────────────────────────────────────
const CONST_PREFIXES = [
  "plot.style_", "plot.linestyle_", "shape.", "location.", "size.", "line.style_", "label.style_", "hline.style_", "extend.", "xloc.", "yloc.",
  "position.", "text.align_", "text.wrap_", "text.format_", "font.family_", "format.", "display.", "alert.freq_", "currency.", "scale.", "order.",
  "adjustment.", "backadjustment.", "settlement_as_close.", "splits.", "dividends.", "earnings.", "barmerge.", "strategy.direction.", "strategy.commission.",
  "strategy.oca.", "session.", "dayofweek.", "math.", "color.", "input.", "xloc.", "linestyle.",
];
const DOW: Record<string, number> = { sunday: 1, monday: 2, tuesday: 3, wednesday: 4, thursday: 5, friday: 6, saturday: 7 };
export function constantValue(path: string, version = 5): PValue | undefined {
  switch (path) {
    case "strategy.long": return 1;
    case "strategy.short": return -1;
    case "strategy.fixed": return "fixed";
    case "strategy.cash": return "cash";
    case "strategy.percent_of_equity": return "percent_of_equity";
    case "math.pi": return Math.PI;
    case "math.e": return Math.E;
    case "math.phi": return 1.618033988749895;
    case "math.rphi": return 0.618033988749895;
  }
  if (path.startsWith("color.")) {
    const c = path.slice(6);
    return NAMED_COLORS[c];
  }
  if (path.startsWith("dayofweek.")) return DOW[path.slice(10)];
  if (path.startsWith("math.")) return undefined;
  if (path === "session.regular" || path === "session.extended") return path.slice(8);
  if (path.startsWith("session.")) return undefined;
  if (path.startsWith("input.")) {
    // v4 `type=input.integer` constants
    const k = path.slice(6);
    return ["integer", "float", "bool", "string", "source", "resolution", "session", "symbol", "color", "time", "price"].includes(k) ? k : undefined;
  }
  for (const p of CONST_PREFIXES) {
    if (path.startsWith(p) && path.length > p.length) {
      const rest = path.slice(p.length);
      if (p === "plot.style_" || p === "line.style_" || p === "label.style_" || p === "hline.style_" || p === "plot.linestyle_") return rest;
      return rest;
    }
  }
  if (version <= 3) {
    if (NAMED_COLORS[path]) return NAMED_COLORS[path];
    const v3: Record<string, string> = { line: "line", stepline: "stepline", histogram: "histogram", cross: "cross", area: "area", columns: "columns", circles: "circles", linebr: "linebr", areabr: "areabr", solid: "solid", dotted: "dotted", dashed: "dashed" };
    if (v3[path]) return v3[path];
  }
  return undefined;
}
export function isConstantPath(path: string, version = 5): boolean {
  return constantValue(path, version) !== undefined;
}

// ── per-bar ta.* variables ───────────────────────────────────────────────
export function computeTaVars(rt: PineRuntime): void {
  computeTaVarsImpl(rt, (name) => {
    let b = rt.taVars.get(name);
    if (!b) {
      b = new (rt.bOpen.constructor as new (carry: boolean, init?: PValue) => typeof rt.bOpen)(false, null);
      rt.taVars.set(name, b);
    }
    return b;
  });
}

void bindArgs;
void isMatrix;
