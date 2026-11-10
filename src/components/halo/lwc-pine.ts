// ════════════════════════════════════════════════════════════════════════
//  LWC PINE DRAWINGS · TradingView-style rendering of a Pine script's
//  line.new / box.new / label.new / linefill / polyline / table objects
//  plus bgcolor() and fill(), on a lightweight-charts series primitive.
//  Coordinates are converted at draw time (time → logical bar index →
//  pixel), so every object follows pan/zoom and can sit in the future
//  space right of the last candle, exactly like on TradingView.
// ════════════════════════════════════════════════════════════════════════

import type { IPrimitivePaneView, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { PineDrawings, PineLabel, PineLine, PineTable } from "@/lib/pine/drawings";

interface MediaSpaceState {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface DrawTargetLike {
  useMediaCoordinateSpace<T>(h: (s: MediaSpaceState) => T): T;
}

export interface PinePlotSeries {
  key: string;
  data: { time: number; value: number }[];
}

const FONT = "Inter, system-ui, -apple-system, Segoe UI, sans-serif";
const SIZE_PX: Record<string, number> = { tiny: 9, small: 10, normal: 12, auto: 11, large: 15, huge: 20 };
const fontPx = (s: string) => SIZE_PX[s] ?? 11;

function dash(ctx: CanvasRenderingContext2D, style: string, w: number): void {
  if (style.includes("dashed")) ctx.setLineDash([6 * Math.max(1, w / 2), 4]);
  else if (style.includes("dotted")) ctx.setLineDash([Math.max(1, w), 3]);
  else ctx.setLineDash([]);
}

export class PineDrawOverlay {
  private param: SeriesAttachedParameter<Time> | null = null;
  data: PineDrawings | null = null;
  /** plot values by key → (time sec → value), for fill() */
  private plotVals = new Map<string, Map<number, number>>();
  /** bar times (seconds) of the chart's main candle series — the logical index space */
  getBars: () => number[] = () => [];
  /** pixels reserved at the top for the chart's HTML control strip (tables avoid it) */
  topInset = 0;

  private readonly bottomView: IPrimitivePaneView = {
    zOrder: () => "bottom",
    renderer: () => ({ draw: (t: unknown) => this.draw(t as DrawTargetLike, "bottom") }),
  };
  private readonly topView: IPrimitivePaneView = {
    zOrder: () => "top",
    renderer: () => ({ draw: (t: unknown) => this.draw(t as DrawTargetLike, "top") }),
  };

  setPlots(plots: PinePlotSeries[]): void {
    this.plotVals = new Map(plots.map((p) => [p.key, new Map(p.data.map((d) => [Math.round(d.time / 1000), d.value]))]));
  }
  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param;
  }
  detached(): void {
    this.param = null;
  }
  updateAllViews(): void {}
  paneViews(): IPrimitivePaneView[] {
    return [this.bottomView, this.topView];
  }
  requestUpdate(): void {
    this.param?.requestUpdate();
  }

  // ── coordinates ────────────────────────────────────────────────────────
  private logicalOf(tSec: number, bars: number[], step: number): number {
    const L = bars.length - 1;
    if (L < 0) return 0;
    if (tSec >= bars[L]) return L + (tSec - bars[L]) / step;
    if (tSec <= bars[0]) return (tSec - bars[0]) / step;
    let lo = 0, hi = L;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid] <= tSec) lo = mid; else hi = mid - 1;
    }
    const span = bars[lo + 1] - bars[lo];
    return lo + (span > 0 ? (tSec - bars[lo]) / span : 0);
  }

  private draw(target: DrawTargetLike, layer: "bottom" | "top"): void {
    const p = this.param;
    const d = this.data;
    if (!p || !d) return;
    const ts = p.chart.timeScale();
    const bars = this.getBars();
    if (bars.length === 0) return;
    let step = 60;
    if (bars.length > 2) {
      const diffs: number[] = [];
      for (let i = Math.max(1, bars.length - 50); i < bars.length; i++) diffs.push(bars[i] - bars[i - 1]);
      diffs.sort((a, b) => a - b);
      step = diffs[Math.floor(diffs.length / 2)] || 60;
    }
    const X = (tMs: number): number | null => {
      const c = ts.logicalToCoordinate(this.logicalOf(tMs / 1000, bars, step) as Logical);
      return c === null ? null : c;
    };
    const Y = (price: number): number | null => p.series.priceToCoordinate(price);
    const spacing = ts.options().barSpacing || 6;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      if (W <= 0 || H <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      if (layer === "bottom") {
        this.drawBg(ctx, d, X, H, spacing, W);
        this.drawFills(ctx, d, X, Y, bars);
        this.drawBoxes(ctx, d, X, Y, W);
        for (const lf of d.linefills) {
          const a = this.linePx(lf.a, X, Y, W), b = this.linePx(lf.b, X, Y, W);
          if (!a || !b) continue;
          ctx.fillStyle = lf.color;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.lineTo(b[2], b[3]); ctx.lineTo(b[0], b[1]);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        this.drawPolylines(ctx, d, X, Y);
        for (const l of d.lines) this.drawLine(ctx, l, X, Y, W);
        for (const lb of d.labels) this.drawLabel(ctx, lb, X, Y, W, H);
        for (const t of d.tables) this.drawTable(ctx, t, W, H);
      }
      ctx.restore();
    });
  }

  private drawBg(ctx: CanvasRenderingContext2D, d: PineDrawings, X: (t: number) => number | null, H: number, spacing: number, W: number): void {
    for (const b of d.bgcolors) {
      const x = X(b.time);
      if (x === null || x < -spacing || x > W + spacing) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(x - spacing / 2, 0, spacing + 0.5, H);
    }
  }

  private seriesVal(key: string, tSec: number, d: PineDrawings): number | null {
    if (key in d.hlinePrices) return d.hlinePrices[key];
    const v = this.plotVals.get(key)?.get(tSec);
    return v === undefined ? null : v;
  }

  private drawFills(ctx: CanvasRenderingContext2D, d: PineDrawings, X: (t: number) => number | null, Y: (p: number) => number | null, bars: number[]): void {
    const idx = new Map(bars.map((b, i) => [b, i]));
    for (const f of d.fills) {
      for (const c of f.colors) {
        const t = Math.round(c.time / 1000);
        const i = idx.get(t);
        if (i === undefined || i + 1 >= bars.length) continue;
        const t2 = bars[i + 1];
        const a1 = this.seriesVal(f.a, t, d), b1 = this.seriesVal(f.b, t, d);
        const a2 = this.seriesVal(f.a, t2, d), b2 = this.seriesVal(f.b, t2, d);
        if (a1 === null || b1 === null || a2 === null || b2 === null) continue;
        const x1 = X(t * 1000), x2 = X(t2 * 1000);
        const ya1 = Y(a1), yb1 = Y(b1), ya2 = Y(a2), yb2 = Y(b2);
        if (x1 === null || x2 === null || ya1 === null || yb1 === null || ya2 === null || yb2 === null) continue;
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.moveTo(x1, ya1); ctx.lineTo(x2, ya2); ctx.lineTo(x2, yb2); ctx.lineTo(x1, yb1);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  private drawBoxes(ctx: CanvasRenderingContext2D, d: PineDrawings, X: (t: number) => number | null, Y: (p: number) => number | null, W: number): void {
    for (const b of d.boxes) {
      let x1 = X(b.left), x2 = X(b.right);
      const y1 = Y(b.top), y2 = Y(b.bottom);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      if (b.extend === "right" || b.extend === "both") x2 = W;
      if (b.extend === "left" || b.extend === "both") x1 = 0;
      const L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), B = Math.max(y1, y2);
      if (R < 0 || L > W) continue;
      if (b.bg) {
        ctx.fillStyle = b.bg;
        ctx.fillRect(L, T, R - L, Math.max(1, B - T));
      }
      if (b.border && b.borderWidth > 0) {
        ctx.strokeStyle = b.border;
        ctx.lineWidth = b.borderWidth;
        dash(ctx, b.borderStyle, b.borderWidth);
        ctx.strokeRect(L + 0.5, T + 0.5, Math.max(1, R - L - 1), Math.max(1, B - T - 1));
        ctx.setLineDash([]);
      }
      if (b.text) {
        const fs = fontPx(b.textSize);
        ctx.font = `${fs}px ${FONT}`;
        ctx.fillStyle = b.textColor;
        ctx.textAlign = b.halign === "left" ? "left" : b.halign === "right" ? "right" : "center";
        ctx.textBaseline = b.valign === "top" ? "top" : b.valign === "bottom" ? "bottom" : "middle";
        const tx = b.halign === "left" ? L + 4 : b.halign === "right" ? R - 4 : (L + Math.min(R, W)) / 2;
        const ty = b.valign === "top" ? T + 3 : b.valign === "bottom" ? B - 3 : (T + B) / 2;
        ctx.fillText(b.text, tx, ty);
      }
    }
  }

  private linePx(l: PineLine, X: (t: number) => number | null, Y: (p: number) => number | null, W: number): [number, number, number, number] | null {
    let x1 = X(l.x1), x2 = X(l.x2);
    let y1 = Y(l.y1), y2 = Y(l.y2);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
    if (l.extend !== "none" && x1 !== x2) {
      const slope = (y2 - y1) / (x2 - x1);
      const [lx, ly, rx, ry] = x1 <= x2 ? [x1, y1, x2, y2] : [x2, y2, x1, y1];
      let nlx = lx, nly = ly, nrx = rx, nry = ry;
      if (l.extend === "right" || l.extend === "both") { nrx = W; nry = ry + slope * (W - rx); }
      if (l.extend === "left" || l.extend === "both") { nlx = 0; nly = ly - slope * lx; }
      [x1, y1, x2, y2] = [nlx, nly, nrx, nry];
    }
    return [x1, y1, x2, y2];
  }

  private drawLine(ctx: CanvasRenderingContext2D, l: PineLine, X: (t: number) => number | null, Y: (p: number) => number | null, W: number): void {
    const px = this.linePx(l, X, Y, W);
    if (!px) return;
    const [x1, y1, x2, y2] = px;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = l.width;
    dash(ctx, l.style, l.width);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    const head = (fx: number, fy: number, tx: number, ty: number) => {
      const a = Math.atan2(ty - fy, tx - fx);
      const s = 6 + l.width * 2;
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - s * Math.cos(a - 0.4), ty - s * Math.sin(a - 0.4));
      ctx.lineTo(tx - s * Math.cos(a + 0.4), ty - s * Math.sin(a + 0.4));
      ctx.closePath();
      ctx.fill();
    };
    if (l.style === "arrow_right" || l.style === "arrow_both") head(x1, y1, x2, y2);
    if (l.style === "arrow_left" || l.style === "arrow_both") head(x2, y2, x1, y1);
  }

  private drawPolylines(ctx: CanvasRenderingContext2D, d: PineDrawings, X: (t: number) => number | null, Y: (p: number) => number | null): void {
    for (const pl of d.polylines) {
      const pts = pl.points.map((q) => [X(q.t), Y(q.p)] as const).filter((q): q is readonly [number, number] => q[0] !== null && q[1] !== null);
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        if (pl.curved && i < pts.length - 1) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        } else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      if (pl.closed) ctx.closePath();
      if (pl.fill) {
        ctx.fillStyle = pl.fill;
        ctx.fill();
      }
      if (pl.color) {
        ctx.strokeStyle = pl.color;
        ctx.lineWidth = pl.width;
        dash(ctx, pl.style, pl.width);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawLabel(ctx: CanvasRenderingContext2D, lb: PineLabel, X: (t: number) => number | null, Y: (p: number) => number | null, W: number, H: number): void {
    const x = X(lb.x), y = Y(lb.y);
    if (x === null || y === null || x < -200 || x > W + 200 || y < -100 || y > H + 100) return;
    const fs = fontPx(lb.size);
    ctx.font = `${fs}px ${FONT}`;
    const linesTxt = lb.text.split("\n");
    const tw = Math.max(0, ...linesTxt.map((t) => ctx.measureText(t).width));
    const lh = fs + 3;
    const padX = 6, padY = 4;
    const bw = lb.text ? tw + padX * 2 : 0;
    const bh = lb.text ? linesTxt.length * lh + padY * 2 - 3 : 0;
    const st = lb.style;
    const ptr = 6;
    const shape = ["xcross", "cross", "triangleup", "triangledown", "flag", "circle", "arrowup", "arrowdown", "square", "diamond"].includes(st);
    let bx = x - bw / 2, by = y - bh - ptr;
    if (shape) {
      const s = fs * 0.6;
      ctx.fillStyle = lb.color ?? "#2962FF";
      ctx.strokeStyle = lb.color ?? "#2962FF";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (st === "circle") ctx.arc(x, y, s, 0, Math.PI * 2);
      else if (st === "square") ctx.rect(x - s, y - s, 2 * s, 2 * s);
      else if (st === "diamond") { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
      else if (st === "triangleup" || st === "arrowup") { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); }
      else if (st === "triangledown" || st === "arrowdown") { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y - s); ctx.closePath(); }
      else if (st === "flag") { ctx.moveTo(x - s, y + s); ctx.lineTo(x - s, y - s); ctx.lineTo(x + s, y - s / 2); ctx.lineTo(x - s, y); }
      if (st === "xcross" || st === "cross") {
        if (st === "xcross") { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); }
        else { ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); }
        ctx.stroke();
      } else if (st === "flag") ctx.stroke();
      else ctx.fill();
      if (lb.text) {
        ctx.fillStyle = lb.color ?? lb.textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = st.includes("down") ? "bottom" : "top";
        linesTxt.forEach((t, i) => ctx.fillText(t, x, st.includes("down") ? y - s - 3 - (linesTxt.length - 1 - i) * lh : y + s + 3 + i * lh));
      }
      return;
    }
    if (st === "label_up") by = y + ptr;
    else if (st === "label_left") { bx = x + ptr; by = y - bh / 2; }
    else if (st === "label_right") { bx = x - bw - ptr; by = y - bh / 2; }
    else if (st === "label_center" || st === "none" || st === "text_outline") { by = y - bh / 2; }
    else if (st === "label_upper_left") { bx = x; by = y; }
    else if (st === "label_upper_right") { bx = x - bw; by = y; }
    else if (st === "label_lower_left") { bx = x; by = y - bh; }
    else if (st === "label_lower_right") { bx = x - bw; by = y - bh; }
    const hasBg = !!lb.color && st !== "none" && st !== "text_outline";
    if (hasBg && lb.text) {
      ctx.fillStyle = lb.color!;
      const r = 3;
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
      ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
      ctx.arcTo(bx, by + bh, bx, by, r);
      ctx.arcTo(bx, by, bx + bw, by, r);
      ctx.closePath();
      ctx.fill();
      // pointer
      ctx.beginPath();
      if (st === "label_down") { ctx.moveTo(x - ptr, by + bh); ctx.lineTo(x + ptr, by + bh); ctx.lineTo(x, y); }
      else if (st === "label_up") { ctx.moveTo(x - ptr, by); ctx.lineTo(x + ptr, by); ctx.lineTo(x, y); }
      else if (st === "label_left") { ctx.moveTo(bx, y - ptr); ctx.lineTo(bx, y + ptr); ctx.lineTo(x, y); }
      else if (st === "label_right") { ctx.moveTo(bx + bw, y - ptr); ctx.lineTo(bx + bw, y + ptr); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fill();
    }
    if (!lb.text) return;
    ctx.fillStyle = hasBg ? lb.textColor : lb.color && st === "none" ? lb.textColor : lb.textColor;
    ctx.textBaseline = "top";
    ctx.textAlign = lb.textAlign === "left" ? "left" : lb.textAlign === "right" ? "right" : "center";
    const tx = lb.textAlign === "left" ? bx + padX : lb.textAlign === "right" ? bx + bw - padX : bx + bw / 2;
    linesTxt.forEach((t, i) => ctx.fillText(t, tx, by + padY + i * lh));
  }

  private drawTable(ctx: CanvasRenderingContext2D, t: PineTable, W: number, H: number): void {
    const cols = Math.max(t.cols, ...t.cells.map((c) => c.col + 1));
    const rows = Math.max(t.rows, ...t.cells.map((c) => c.row + 1));
    const colW = new Array(cols).fill(0);
    const rowH = new Array(rows).fill(0);
    for (const c of t.cells) {
      const fs = fontPx(c.size);
      ctx.font = `${fs}px ${FONT}`;
      const lines = c.text.split("\n");
      colW[c.col] = Math.max(colW[c.col], ...lines.map((l) => ctx.measureText(l).width + 12));
      rowH[c.row] = Math.max(rowH[c.row], lines.length * (fs + 3) + 6);
    }
    for (let i = 0; i < rows; i++) if (!rowH[i]) rowH[i] = 0;
    const tw = colW.reduce((a, b) => a + b, 0);
    const th = rowH.reduce((a, b) => a + b, 0);
    if (tw === 0 || th === 0) return;
    const m = 8;
    const pos = t.position;
    const x0 = pos.endsWith("left") ? m : pos.endsWith("center") ? (W - tw) / 2 : W - tw - m;
    const top = Math.max(m, this.topInset);
    const y0 = pos.startsWith("top") ? top : pos.startsWith("middle") ? (H - th) / 2 : H - th - m;
    if (t.bg) {
      ctx.fillStyle = t.bg;
      ctx.fillRect(x0, y0, tw, th);
    }
    const colX = (c: number) => x0 + colW.slice(0, c).reduce((a, b) => a + b, 0);
    const rowY = (r: number) => y0 + rowH.slice(0, r).reduce((a, b) => a + b, 0);
    for (const c of t.cells) {
      const cx = colX(c.col), cy = rowY(c.row), cw = colW[c.col], ch = rowH[c.row];
      if (c.bg) {
        ctx.fillStyle = c.bg;
        ctx.fillRect(cx, cy, cw, ch);
      }
      const fs = fontPx(c.size);
      ctx.font = `${fs}px ${FONT}`;
      ctx.fillStyle = c.color;
      ctx.textBaseline = "top";
      ctx.textAlign = c.halign === "left" ? "left" : c.halign === "right" ? "right" : "center";
      const tx = c.halign === "left" ? cx + 6 : c.halign === "right" ? cx + cw - 6 : cx + cw / 2;
      c.text.split("\n").forEach((l, i) => ctx.fillText(l, tx, cy + 3 + i * (fs + 3)));
    }
    if (t.border && t.borderWidth > 0) {
      ctx.strokeStyle = t.border;
      ctx.lineWidth = t.borderWidth;
      for (let c = 1; c < cols; c++) { const x = colX(c); ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + th); ctx.stroke(); }
      for (let r = 1; r < rows; r++) { const y = rowY(r); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + tw, y); ctx.stroke(); }
    }
    if (t.frame && t.frameWidth > 0) {
      ctx.strokeStyle = t.frame;
      ctx.lineWidth = t.frameWidth;
      ctx.strokeRect(x0, y0, tw, th);
    }
  }
}
