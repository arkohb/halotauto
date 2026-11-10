// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine drawings → chart payload
//  Turns the runtime's live drawing objects (line / box / label / linefill /
//  polyline / table) plus bgcolor() and fill() into a compact, serialisable
//  snapshot the chart canvas renders exactly like TradingView: only objects
//  still alive on the last bar, bar_index x-coordinates converted to candle
//  times (future bars extrapolated), yloc.abovebar/belowbar resolved, and
//  TradingView's default colours applied where the script left them unset.
// ════════════════════════════════════════════════════════════════════════

import type { PineRuntime } from "./runtime";
import { isNum, isDraw, normalizeColor, type PDraw, type PValue } from "./values";

export interface PineLine { x1: number; y1: number; x2: number; y2: number; color: string; width: number; style: string; extend: string }
export interface PineBox { left: number; right: number; top: number; bottom: number; border: string | null; borderWidth: number; borderStyle: string; bg: string | null; extend: string; text: string; textColor: string; textSize: string; halign: string; valign: string }
export interface PineLabel { x: number; y: number; text: string; color: string | null; textColor: string; style: string; size: string; textAlign: string }
export interface PineLinefill { a: PineLine; b: PineLine; color: string }
export interface PinePolyline { points: { t: number; p: number }[]; color: string | null; fill: string | null; width: number; style: string; closed: boolean; curved: boolean }
export interface PineTableCell { col: number; row: number; text: string; bg: string | null; color: string; size: string; halign: string }
export interface PineTable { position: string; cols: number; rows: number; bg: string | null; frame: string | null; frameWidth: number; border: string | null; borderWidth: number; cells: PineTableCell[] }
export interface PineFill { a: string; b: string; colors: { time: number; color: string }[] }
export interface PineDrawings {
  lines: PineLine[];
  boxes: PineBox[];
  labels: PineLabel[];
  linefills: PineLinefill[];
  polylines: PinePolyline[];
  tables: PineTable[];
  bgcolors: { time: number; color: string }[];
  fills: PineFill[];
  /** constant hline prices, by hline ref key (fill() between hlines) */
  hlinePrices: Record<string, number>;
}

const TV_BLUE = "#2962FF";

function col(v: unknown, def: string | null): string | null {
  if (v === undefined) return def;
  if (v === null) return null; // na colour = transparent
  return typeof v === "string" ? normalizeColor(v) : def;
}
function str(v: unknown, def: string): string {
  return typeof v === "string" ? v.replace(/^style_/, "") : def;
}
function n(v: unknown, def: number): number {
  return isNum(v) ? v : def;
}

export function exportDrawings(rt: PineRuntime, times: number[], highs: number[], lows: number[], tfMs: number): PineDrawings {
  const last = times.length - 1;
  /** x coordinate (bar_index or time) → epoch ms */
  const tOf = (x: unknown, xloc: unknown): number | null => {
    if (!isNum(x)) return null;
    if (xloc === "bar_time") return x;
    if (last < 0) return null;
    if (x >= 0 && x <= last && Number.isInteger(x)) return times[x];
    if (x > last) return times[last] + (x - last) * tfMs;
    if (x < 0) return times[0] + x * tfMs;
    const i = Math.floor(x);
    return times[i] + (x - i) * (times[Math.min(last, i + 1)] - times[i]);
  };
  const barOfX = (x: unknown, xloc: unknown): number => {
    if (!isNum(x)) return last;
    if (xloc !== "bar_time") return Math.max(0, Math.min(last, Math.round(x)));
    let lo = 0, hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return lo;
  };
  const alive = (k: string): PDraw[] => (rt.drawLists[k] ?? []).filter((d) => !d.props.__deleted);

  const lineOf = (d: PDraw): PineLine | null => {
    const p = d.props;
    const x1 = tOf(p.x1, p.xloc), x2 = tOf(p.x2, p.xloc);
    if (x1 === null || x2 === null || !isNum(p.y1) || !isNum(p.y2)) return null;
    return { x1, y1: p.y1, x2, y2: p.y2, color: col(p.color, TV_BLUE) ?? "rgba(0,0,0,0)", width: n(p.width, 1), style: str(p.style, "solid"), extend: str(p.extend, "none") };
  };

  const lines = alive("line").map(lineOf).filter((x): x is PineLine => x !== null);

  const boxes: PineBox[] = [];
  for (const d of alive("box")) {
    const p = d.props;
    const l = tOf(p.left, p.xloc), r = tOf(p.right, p.xloc);
    if (l === null || r === null || !isNum(p.top) || !isNum(p.bottom)) continue;
    boxes.push({
      left: l, right: r, top: p.top, bottom: p.bottom,
      border: col(p.border_color, TV_BLUE), borderWidth: n(p.border_width, 1), borderStyle: str(p.border_style, "solid"),
      bg: col(p.bgcolor, TV_BLUE), extend: str(p.extend, "none"),
      text: typeof p.text === "string" ? p.text : "", textColor: col(p.text_color, "#000000") ?? "#000000",
      textSize: str(p.text_size, "auto"), halign: str(p.text_halign, "center"), valign: str(p.text_valign, "center"),
    });
  }

  const labels: PineLabel[] = [];
  for (const d of alive("label")) {
    const p = d.props;
    const x = tOf(p.x, p.xloc);
    if (x === null) continue;
    let y = p.y;
    const bi = barOfX(p.x, p.xloc);
    if (p.yloc === "abovebar") y = highs[bi];
    else if (p.yloc === "belowbar") y = lows[bi];
    if (!isNum(y)) continue;
    labels.push({
      x, y, text: typeof p.text === "string" ? p.text : "",
      color: col(p.color, TV_BLUE), textColor: col(p.textcolor, "#FFFFFF") ?? "#FFFFFF",
      style: str(p.style, "label_down"), size: str(p.size, "normal"), textAlign: str(p.textalign, "center"),
    });
  }

  const linefills: PineLinefill[] = [];
  for (const d of alive("linefill")) {
    const p = d.props;
    const a = isDraw(p.line1) && !p.line1.props.__deleted ? lineOf(p.line1) : null;
    const b = isDraw(p.line2) && !p.line2.props.__deleted ? lineOf(p.line2) : null;
    const c = col(p.color, null);
    if (a && b && c) linefills.push({ a, b, color: c });
  }

  const polylines: PinePolyline[] = [];
  for (const d of alive("polyline")) {
    const p = d.props;
    const pts = Array.isArray(p.points) ? (p.points as PValue[]) : [];
    const out: { t: number; p: number }[] = [];
    for (const pt of pts) {
      if (!pt || typeof pt !== "object" || !("f" in pt)) continue;
      const f = (pt as { f: Record<string, PValue> }).f;
      const t = p.xloc === "bar_time" ? (isNum(f.time) ? f.time : null) : isNum(f.index) ? tOf(f.index, "bar_index") : isNum(f.time) ? f.time : null;
      if (t !== null && isNum(f.price)) out.push({ t, p: f.price });
    }
    if (out.length >= 2) {
      polylines.push({ points: out, color: col(p.line_color, TV_BLUE), fill: col(p.fill_color, null), width: n(p.line_width, 1), style: str(p.line_style, "solid"), closed: p.closed === true, curved: p.curved === true });
    }
  }

  const tables: PineTable[] = [];
  for (const d of alive("table")) {
    const p = d.props;
    const cells: PineTableCell[] = [];
    for (const [k, c0] of Object.entries((p.cells ?? {}) as Record<string, Record<string, unknown>>)) {
      const [cc, rr] = k.split(",").map(Number);
      if (!Number.isFinite(cc) || !Number.isFinite(rr)) continue;
      const t = c0.text;
      cells.push({
        col: cc, row: rr, text: typeof t === "string" ? t : isNum(t) ? String(t) : "",
        bg: col(c0.bgcolor, null), color: col(c0.text_color, "#000000") ?? "#000000",
        size: str(c0.text_size, "normal"), halign: str(c0.text_halign, "center"),
      });
    }
    if (cells.length === 0) continue;
    tables.push({
      position: str(p.position, "top_right"), cols: n(p.columns, 1), rows: n(p.rows, 1),
      bg: col(p.bgcolor, null), frame: col(p.frame_color, null), frameWidth: n(p.frame_width, 0),
      border: col(p.border_color, null), borderWidth: n(p.border_width, 0), cells,
    });
  }

  const bgcolors: { time: number; color: string }[] = [];
  rt.bgColors.forEach((c, i) => {
    if (c && i <= last) bgcolors.push({ time: times[i], color: c });
  });

  const fills: PineFill[] = [];
  for (const f of rt.fills.values()) {
    const colors: { time: number; color: string }[] = [];
    f.colors.forEach((c, i) => {
      if (c && i <= last) colors.push({ time: times[i], color: c });
    });
    if (colors.length) fills.push({ a: f.a, b: f.b, colors });
  }

  const hlinePrices: Record<string, number> = {};
  for (const h of rt.hlines) if (h.key) hlinePrices[h.key] = h.price;

  return {
    lines: lines.slice(-500),
    boxes: boxes.slice(-500),
    labels: labels.slice(-500),
    linefills: linefills.slice(-200),
    polylines: polylines.slice(-50),
    tables: tables.slice(-4),
    bgcolors: bgcolors.slice(-2000),
    fills,
    hlinePrices,
  };
}
