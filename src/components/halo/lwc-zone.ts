// ════════════════════════════════════════════════════════════════════════
//  LWC ZONE OVERLAY · canvas rectangles that follow pan/zoom
//  Shared by the HALO chart panel and the LIVE BACKTEST REPLAY deck —
//  draws the equal-level zones and the TradingView-style position tool
//  (green profit zone entry→TP, red risk zone entry→SL) by converting
//  time/price to media coordinates at draw time.
// ════════════════════════════════════════════════════════════════════════

import type {
  IPrimitivePaneView,
  ITimeScaleApi,
  SeriesAttachedParameter,
  Time,
  UTCTimestamp,
} from "lightweight-charts";

export interface ZoneRectSpec {
  t1: number | null; // ms epoch, null = pane left edge
  t2: number | null; // null = pane right edge
  p1: number;
  p2: number;
  fill: string;
  border?: string;
  dashed?: boolean;
}

interface MediaSpaceState {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface DrawTargetLike {
  useMediaCoordinateSpace<T>(h: (s: MediaSpaceState) => T): T;
}

export class ZoneOverlay {
  private param: SeriesAttachedParameter<Time> | null = null;
  rects: ZoneRectSpec[] = [];

  private readonly view: IPrimitivePaneView = {
    zOrder: () => "bottom",
    renderer: () => ({
      draw: (target: unknown) => this.draw(target as DrawTargetLike),
    }),
  };

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param;
  }
  detached(): void {
    this.param = null;
  }
  updateAllViews(): void {
    // rects are read live at draw time — nothing to cache
  }
  paneViews(): IPrimitivePaneView[] {
    return [this.view];
  }
  requestUpdate(): void {
    this.param?.requestUpdate();
  }

  private xOf(ts: ITimeScaleApi<Time>, tSec: number, visL: number | null, visR: number | null, W: number): number | null {
    const c = ts.timeToCoordinate(tSec as UTCTimestamp);
    if (c !== null) return c;
    if (visL !== null && tSec <= visL) return 0;
    if (visR !== null && tSec >= visR) return W;
    return null;
  }

  private draw(target: DrawTargetLike): void {
    const p = this.param;
    if (!p || this.rects.length === 0) return;
    const ts = p.chart.timeScale();
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      if (W <= 0 || H <= 0) return;
      const vis = ts.getVisibleRange();
      const visL = vis ? (vis.from as number) : null;
      const visR = vis ? (vis.to as number) : null;
      context.save();
      context.beginPath();
      context.rect(0, 0, W, H);
      context.clip();
      for (const r of this.rects) {
        const x1 = r.t1 === null ? 0 : this.xOf(ts, r.t1 / 1000, visL, visR, W);
        const x2 = r.t2 === null ? W : this.xOf(ts, r.t2 / 1000, visL, visR, W);
        const yA = p.series.priceToCoordinate(r.p1);
        const yB = p.series.priceToCoordinate(r.p2);
        if (x1 === null || x2 === null || yA === null || yB === null) continue;
        // razor-thin equal-level bands (0.2 on XAU ≈ 0.3px when zoomed out)
        // would be invisible — grow to a minimum 3px so the zone always reads
        const MIN_ZONE_PX = 3;
        let top = Math.min(yA, yB);
        let bot = Math.max(yA, yB);
        if (bot - top < MIN_ZONE_PX) {
          const grow = (MIN_ZONE_PX - (bot - top)) / 2;
          top -= grow;
          bot += grow;
        }
        if (bot < 0 || top > H || x2 <= 0 || x1 >= W) continue;
        const L = Math.max(x1, 0);
        const R = Math.min(x2, W);
        const h = Math.max(1, bot - top);
        context.fillStyle = r.fill;
        context.fillRect(L, top, R - L, h);
        if (r.border) {
          context.strokeStyle = r.border;
          context.lineWidth = 1;
          if (r.dashed) context.setLineDash([4, 3]);
          context.strokeRect(L + 0.5, top + 0.5, Math.max(1, R - L - 1), h - 1);
          context.setLineDash([]);
        }
      }
      context.restore();
    });
  }
}
