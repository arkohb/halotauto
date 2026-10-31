"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL CHART · dual engine, indicator attached to BOTH views
//
//  CURRENT-SIGNAL MODE — the chart stays clean:
//  exactly what the EA acts on is drawn — BOTH armed levels (the support
//  BUY line + the resistance SELL line, pinned at the script's exact
//  prices), the C3 forming tracker, and the open trade's ENTRY/SL/TP.
//  Old levels, old fires, old TP/SL hits are never rendered.
//
//  • TRADINGVIEW  — Advanced Chart widget + floating 3EL indicator rail
//    (current C1/C2 level, C3 forming tracker, ENTRY/SL/TP position card).
//  • 3EL INDICATOR — lightweight-charts (TradingView's own chart engine)
//    with the 3EL indicator drawn ON the chart: shaded equal-level zone,
//    trigger lines, C3 FORMING marker on the live bar, level price tag on
//    the axis, and the TradingView-style position tool (green profit zone
//    entry→TP, red risk zone entry→SL, ENTRY/SL/TP axis labels).
//
//  ⚠ Presentation layer only — the live strategy / EA is never touched.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneView,
  type ITimeScaleApi,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, HaloConfig, LevelSnapshot, TradeSnapshot } from "@/lib/halo/types";
import { C, fmtPx, type PineOverlayData } from "@/lib/halo/ui-helpers";
import type { LogEntry } from "@/lib/halo/types";
import { subscribeLiveBars, type LiveBar, type LiveFeedKind } from "@/lib/halo/live-feed";
import { SYMBOL_GROUPS, symbolsByGroup, tfSec, TIMEFRAMES } from "@/lib/market-symbols";
import { TvChart } from "./tv-chart";
import { TvSignalOverlay } from "./tv-signal-overlay";
import { IndicatorRail } from "./indicator-rail";
import { CandleTimer } from "./candle-timer";
import { bestC3Form, c3FormCheck } from "@/lib/halo/c3-form";

interface ChartProps {
  candles: Candle[];
  drawings: LevelSnapshot[];
  log: LogEntry[];
  trade: TradeSnapshot | null;
  mintick: number;
  symbol: string;
  tf: string;
  source: string;
  /** live EA status line, e.g. "WAITING FOR C3 · 2 FRESH LEVELS" */
  statusLine?: string;
  /** where fires are routed, e.g. "LIVE → ICMarketsSC-MT5 · 12345" */
  routing?: string;
  /** when a Pine strategy is the bot's active strategy, its indicator plots here */
  pineStrategy?: { id: string; name: string } | null;
  /** EA bot running */
  enabled: boolean;
  /** EA auto-attaches to this chart (auto-start on boot) */
  autoAttach: boolean;
  busy: string | null;
  /** start/stop the EA straight from the chart */
  onToggleBot: () => void;
  /** switch the chart symbol — the EA follows automatically */
  onSymbol: (s: string) => void;
  /** switch the chart timeframe — the EA follows automatically */
  onTf: (t: string) => void;
  /** strategy config (C3 forming thresholds) — read-only */
  cfg: HaloConfig;
  /** engine ATR — read-only */
  atr: number | null;
  /** last feed price — read-only */
  price: number;
  /** live stream price from this chart (real venue feed) — lifted so tickers stay in sync */
  onLivePrice?: (symbol: string, price: number) => void;
}

interface LevelLines {
  series: ISeriesApi<"Line">[];
  priceLines: IPriceLine[];
}

function sideColor(side: number, alpha: string): string {
  const rgb = side === -1 ? "242,54,69" : "8,153,129";
  return `rgba(${rgb},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Zone overlay primitive — canvas rectangles (level zones + position
//  tool) that follow pan/zoom by converting time/price at draw time.
// ─────────────────────────────────────────────────────────────────────────
interface ZoneRectSpec {
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

class ZoneOverlay {
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

type ChartMode = "tv" | "3el";
const MODE_KEY = "halo3el.chartmode.v2"; // v2: default is now the 3EL indicator view

export default function ChartPanel(props: ChartProps) {
  const {
    candles, drawings, log, trade, mintick, symbol, tf, source, statusLine, routing,
    enabled, autoAttach, busy, onToggleBot, onSymbol, onTf, cfg, atr, price, pineStrategy, onLivePrice,
  } = props;
  const [mode, setMode] = useState<ChartMode>("3el");
  const [tvNote, setTvNote] = useState<string | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const overlayRef = useRef<LevelLines>({ series: [], priceLines: [] });
  const zoneRef = useRef<ZoneOverlay | null>(null);
  const fitKeyRef = useRef<string>("");

  // derived (visual-only) state
  const freshLevels = useMemo(() => drawings.filter((d) => d.state === "fresh"), [drawings]);
  const liveCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;
  const forming = useMemo(() => c3FormCheck(liveCandle, freshLevels, atr, cfg), [liveCandle, freshLevels, atr, cfg]);
  const bestForm = bestC3Form(forming);

  // ── live stream state ──
  // active: a real venue stream (Deriv WS / Binance kline WS) is driving the
  // forming candle at tick rate. liveBar is a throttled mirror used only by
  // the light overlays (indicator rail, candle timer) — the candle series
  // itself updates per tick straight on the chart, no React re-render.
  const [liveStat, setLiveStat] = useState<{ active: boolean; kind: LiveFeedKind | null }>({ active: false, kind: null });
  const [liveBar, setLiveBar] = useState<Candle | null>(null);
  // actual time window of the bars currently IN the chart series (from either
  // the polled candles or the live feed history). Markers may only anchor to
  // times inside this window — lightweight-charts' markers primitive throws
  // "Value is null" when a marker time is missing from the series data.
  // ref = source of truth (kept fresh before the overlays effect runs);
  // state = re-render trigger for the feed-driven window changes.
  const seriesWinRef = useRef<{ first: number; last: number } | null>(null);
  const [seriesWin, setSeriesWin] = useState<{ first: number; last: number } | null>(null);

  // restore persisted chart mode (deferred so we never setState synchronously in an effect)
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const m = localStorage.getItem(MODE_KEY);
        if (m === "3el" || m === "tv" || m === "halo") setMode(m === "halo" ? "3el" : m);
      } catch {
        // ignore
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const switchMode = (m: ChartMode) => {
    setMode(m);
    if (m === "tv") setTvNote(null);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  };

  // init chart once per 3el-mode mount
  useEffect(() => {
    if (mode !== "3el") return;
    const el = elRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: C.navy },
        textColor: C.muted,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#061B38" }, horzLines: { color: "#061B38" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 10 },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      wickUpColor: C.green,
      wickDownColor: C.red,
      borderVisible: false,
      priceLineColor: "#51678A",
    });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
    chartRef.current = chart;
    candleRef.current = candleSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []);
    // 3EL zone primitive (level zones + position tool shading)
    const zone = new ZoneOverlay();
    candleSeries.attachPrimitive(zone as unknown as ISeriesPrimitive<Time>);
    zoneRef.current = zone;
    fitKeyRef.current = ""; // fresh mount → refit on first data
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      markersRef.current = null;
      zoneRef.current = null;
      overlayRef.current = { series: [], priceLines: [] };
    };
  }, [mode]);

  // ── LIVE STREAM · per-tick updates straight from the venue ───────────
  // Deriv public WS (synthetics / forex / metals) or Binance kline WS
  // (crypto) pushes the forming candle on every tick, exactly like the real
  // TradingView web chart. The Deriv feed also seeds REAL history (replacing
  // the polling series for that symbol). Presentation only — the strategy
  // engine, risk and execution are never touched.
  useEffect(() => {
    let alive = true;
    let lastPush = 0;
    const pushLive = (b: LiveBar, force: boolean) => {
      if (!alive) return;
      const now = Date.now();
      if (!force && now - lastPush < 400) return;
      lastPush = now;
      setLiveBar({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 });
      onLivePrice?.(symbol, b.close);
    };
    const un = subscribeLiveBars(symbol, tf, {
      onStatus: (st) => {
        if (alive) setLiveStat({ active: st.active, kind: st.kind });
      },
      onHistory: (bars) => {
        if (!alive || bars.length === 0) return;
        pushLive(bars[bars.length - 1], true);
        if (mode !== "3el") return;
        const s = candleRef.current;
        const chart = chartRef.current;
        if (!s || !chart) return;
        s.setData(
          bars.map((b) => ({
            time: (b.time / 1000) as UTCTimestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          }))
        );
        setSeriesWin((w) => (w && w.first === bars[0].time && w.last === bars[bars.length - 1].time ? w : { first: bars[0].time, last: bars[bars.length - 1].time }));
        seriesWinRef.current = { first: bars[0].time, last: bars[bars.length - 1].time };
        const key = `${symbol}|${tf}`;
        if (fitKeyRef.current !== key) {
          fitKeyRef.current = key;
          chart.timeScale().fitContent();
        }
      },
      onUpdate: (bar) => {
        if (!alive) return;
        if (mode === "3el") {
          candleRef.current?.update({
            time: (bar.time / 1000) as UTCTimestamp,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          });
        }
        // a brand-new bar extends the series window (bar rollover)
        setSeriesWin((w) => (w && bar.time > w.last ? { first: w.first, last: bar.time } : w));
        if (seriesWinRef.current && bar.time > seriesWinRef.current.last) {
          seriesWinRef.current = { first: seriesWinRef.current.first, last: bar.time };
        }
        pushLive(bar, false);
      },
    });
    return () => {
      alive = false;
      un();
    };
  }, [symbol, tf, mode, onLivePrice]);

  // candle data — always push the full window whenever the prop changes
  // (cheap for ≤720 bars and impossible to go stale). Skipped while the
  // Deriv live stream owns the series: its REAL history must never be
  // stomped by the slower polled feed.
  useEffect(() => {
    if (mode !== "3el") return;
    if (liveStat.active && liveStat.kind === "deriv") return;
    const s = candleRef.current;
    const chart = chartRef.current;
    if (!s || !chart || candles.length === 0) return;
    s.setData(
      candles.map((c) => ({
        time: (c.time / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    seriesWinRef.current = { first: candles[0].time, last: candles[candles.length - 1].time };
    // (no setState here — the `candles` dependency already re-triggers the
    // overlays effect, and the feed path owns the seriesWin state updates)
    // fit the full window once per symbol/timeframe switch (never fights user zoom)
    const key = `${symbol}|${tf}`;
    if (fitKeyRef.current !== key) {
      fitKeyRef.current = key;
      chart.timeScale().fitContent();
    }
  }, [candles, mode, symbol, tf, liveStat.active, liveStat.kind]);

  // overlays: level zones + trigger lines + position tool + markers
  useEffect(() => {
    if (mode !== "3el") return;
    const chart = chartRef.current;
    const cs = candleRef.current;
    const mk = markersRef.current;
    const zone = zoneRef.current;
    if (!chart || !cs || !mk || !zone) return;
    // markers must anchor to bars that exist in the series data — never draw
    // them before the data window is known (see seriesWinRef note above)
    const win = seriesWinRef.current;
    if (!win) return;
    const inWin = (t: number) => t >= win.first && t <= win.last;

    // clear previous overlays
    for (const s of overlayRef.current.series) chart.removeSeries(s);
    for (const pl of overlayRef.current.priceLines) cs.removePriceLine(pl);
    overlayRef.current = { series: [], priceLines: [] };

    const firstT = candles.length > 0 ? candles[0].time : 0;
    const lastT = candles.length > 0 ? candles[candles.length - 1].time : Date.now();

    // ── ARMED LEVELS ONLY ─────────────────────────────────
    // What renders is exactly what the EA acts on: BOTH armed levels —
    // the armed SUPPORT (BUY) and the armed RESISTANCE (SELL) — plus,
    // while a trade is open, the fired level that produced it. Burned /
    // stale history stays off the chart.
    //
    // LINES NEVER SHIFT: each armed line is anchored at its own C1 bar
    // (b1Time) at the exact script price — the equal-level mid the Pine
    // script draws with line.new(bar_index-1, nMid, extend.right) — and
    // only ever extends RIGHT as new bars arrive. The price is pinned at
    // creation and can never move.
    const freshAll = drawings.filter((d) => d.state === "fresh");
    let firedForTrade: LevelSnapshot | null = null;
    if (trade) {
      firedForTrade =
        drawings.find((d) => d.state === "fired" && d.endTime === trade.entryTime) ??
        [...drawings].reverse().find((d) => d.state === "fired") ??
        null;
    }
    const visible = [...freshAll];
    if (firedForTrade) visible.push(firedForTrade);

    const addLevelLine = (
      t1: number,
      t2: number,
      px: number,
      color: string,
      width: 1 | 2,
      style: "solid" | "dashed" | "dotted"
    ) => {
      const a = Math.max(t1, firstT) / 1000;
      const b = Math.max(t2, firstT + 1000) / 1000;
      if (!(b > a)) return;
      const ser = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style === "dotted" ? LineStyle.Dotted : style === "dashed" ? LineStyle.Dashed : LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        pointMarkersVisible: false,
      });
      ser.setData([
        { time: a as UTCTimestamp, value: px },
        { time: b as UTCTimestamp, value: px },
      ]);
      overlayRef.current.series.push(ser);
    };

    // ── 1. armed horizontal lines + dotted TRIGGER lines + equal-level zones ──
    // Per armed level the script draws TWO lines, both anchored at the C1
    // bar with prices pinned at creation (they can never shift):
    //   • the equal-level MID (solid) — C1 close ↔ C2 open armed level
    //   • the DOTTED TRIGGER line at the HIGHEST WICK of candle 1 & 2
    //     (resistance side) / LOWEST WICK (support side) — C3 must break
    //     this line and come back to it for the trade to fire.
    // Fresh levels span the whole chart so they read unmistakably at any
    // zoom; the fired level starts at its own formation and stops at the
    // fire bar.
    const rayEnd = lastT + tfSec(tf) * 1000 * 12;
    const zoneRects: ZoneRectSpec[] = [];
    for (const d of visible) {
      const alpha = d.state === "fresh" ? "0.95" : d.state === "fired" ? "0.85" : "0.32";
      const col = sideColor(d.side, alpha);
      const end = d.endTime ?? rayEnd;
      const startT = d.b1Time; // pinned anchor — the lines cannot shift
      const mid = (d.top + d.bot) / 2; // the script's armed level price
      addLevelLine(startT, end, mid, col, 2, "solid");
      if (d.state === "fresh") {
        // DOTTED TRIGGER LINE — the highest wick of C1 & C2 (entry line)
        addLevelLine(startT, end, d.ext, sideColor(d.side, "0.9"), 2, "dotted");
        // axis tag for the trigger line (no extra line drawn on the pane)
        overlayRef.current.priceLines.push(
          cs.createPriceLine({
            price: d.ext,
            color: sideColor(d.side, "0.9"),
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            lineVisible: false,
            title: `3EL TRIG ${d.side === -1 ? "▼" : "▲"}`,
          })
        );
      }
      // shaded equal-level zone (C1 close ↔ C2 open band)
      zoneRects.push({
        t1: d.b1Time,
        t2: d.state === "fresh" ? null : end,
        p1: d.bot,
        p2: d.top,
        fill: sideColor(d.side, d.state === "fresh" ? "0.14" : "0.05"),
        border: sideColor(d.side, d.state === "fresh" ? "0.5" : "0.2"),
        dashed: d.state !== "fresh",
      });
      // armed level price tag on the axis (TV-style plot tag, no extra line)
      if (d.state === "fresh") {
        overlayRef.current.priceLines.push(
          cs.createPriceLine({
            price: mid,
            color: sideColor(d.side, "0.95"),
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            lineVisible: false,
            title: `3EL ${d.side === -1 ? "RES ▼" : "SUP ▲"}`,
          })
        );
      }
    }

    // ── 2. position tool — TradingView-style ENTRY / SL / TP zones ──
    const t = trade;
    if (t) {
      const profitCol = t.dir === -1 ? "242,54,69" : "8,153,129"; // SELL profits below entry
      const riskCol = t.dir === -1 ? "8,153,129" : "242,54,69"; // risk sits the other way
      zoneRects.push({
        t1: t.entryTime,
        t2: null,
        p1: Math.min(t.entry, t.tp),
        p2: Math.max(t.entry, t.tp),
        fill: `rgba(${profitCol},0.13)`,
        border: `rgba(${profitCol},0.35)`,
      });
      zoneRects.push({
        t1: t.entryTime,
        t2: null,
        p1: Math.min(t.entry, t.sl),
        p2: Math.max(t.entry, t.sl),
        fill: `rgba(${riskCol},0.13)`,
        border: `rgba(${riskCol},0.35)`,
      });
      overlayRef.current.priceLines.push(
        cs.createPriceLine({
          price: t.entry,
          color: C.gold,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `ENTRY ${fmtPx(t.entry, mintick)}`,
        })
      );
      overlayRef.current.priceLines.push(
        cs.createPriceLine({
          price: t.sl,
          color: C.red,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `SL −${t.riskPips.toFixed(0)}p`,
        })
      );
      overlayRef.current.priceLines.push(
        cs.createPriceLine({
          price: t.tp,
          color: C.green,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `TP +${t.rewardPips.toFixed(0)}p`,
        })
      );
    }

    zone.rects = zoneRects;
    zone.requestUpdate();

    const markers: SeriesMarker<Time>[] = [];

    // ── 3. C1 / C2 markers ──
    for (const d of visible) {
      if (d.state === "burned") continue;
      const alpha = d.state === "fresh" ? "0.95" : "0.6";
      const col = sideColor(d.side, alpha);
      const pos = d.side === -1 ? "aboveBar" : "belowBar";
      if (inWin(d.b1Time)) markers.push({ time: (d.b1Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C1", color: col, size: 2 });
      if (inWin(d.b2Time)) markers.push({ time: (d.b2Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C2", color: col, size: 2 });
    }

    // ── 4. C3 FORMING marker on the live bar (visual tracker) ──
    if (liveCandle && bestForm && inWin(liveCandle.time)) {
      const stageTxt =
        bestForm.stage === "retest" ? "C3 RETEST · FIRE IMMINENT" : bestForm.stage === "break" ? "C3 BREAKING WICK LINE" : "C3 AT WICK LINE";
      markers.push({
        time: (liveCandle.time / 1000) as UTCTimestamp,
        position: bestForm.side === -1 ? "aboveBar" : "belowBar",
        shape: "circle",
        text: stageTxt,
        color: C.gold,
        size: 2.5,
      });
    }

    // ── 5. the current trade's fire marker — old signals never clutter the chart ──
    if (trade) {
      const f = log.find((e) => e.kind === "fire" && e.time === trade.entryTime);
      if (f && inWin(f.time)) {
        markers.push({
          time: (f.time / 1000) as UTCTimestamp,
          position: f.dir === -1 ? "aboveBar" : "belowBar",
          shape: f.dir === -1 ? "arrowDown" : "arrowUp",
          text: f.dir === -1 ? "C3 SELL" : "C3 BUY",
          color: C.gold,
          size: 2,
        });
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(markers);
  }, [drawings, log, trade, mintick, candles, mode, forming, bestForm, liveCandle, seriesWin]);

  // ── PINE STRATEGY OVERLAY · the active custom indicator draws itself here ──
  const [pineData, setPineData] = useState<PineOverlayData | null>(null);
  const pineSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const pineMarkersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);

  useEffect(() => {
    if (!pineStrategy) return; // clearing happens via the render effect below
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/strategies/${pineStrategy.id}/preview?symbol=${symbol}&tf=${tf}&limit=400`, { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; plots?: PineOverlayData["plots"]; markers?: PineOverlayData["markers"]; name?: string };
        if (alive && j.ok) {
          setPineData({ plots: j.plots ?? [], markers: j.markers ?? [], name: j.name ?? pineStrategy.name });
        } else if (alive && !j.ok) {
          setPineData(null);
        }
      } catch {
        // keep last overlay on network hiccups
      }
    };
    void load();
    const id = setInterval(load, 60_000); // indicator series move slowly — refresh once a minute
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pineStrategy?.id, pineStrategy, symbol, tf]);

  useEffect(() => {
    if (mode !== "3el") return;
    const chart = chartRef.current;
    const cs = candleRef.current;
    if (!chart || !cs) return;
    // clear previous pine series (own ref — never touches the 3EL overlays)
    for (const s of pineSeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // already gone
      }
    }
    pineSeriesRef.current = [];
    if (pineMarkersRef.current) {
      pineMarkersRef.current.setMarkers([]);
    }
    if (!pineStrategy || !pineData || candles.length === 0) return;
    for (const p of pineData.plots.slice(0, 6)) {
      if (p.data.length === 0) continue;
      const ser = chart.addSeries(LineSeries, {
        color: p.color || C.cyan,
        lineWidth: Math.min(3, Math.max(1, p.lineWidth ?? 2)) as 1 | 2 | 3,
        lastValueVisible: true,
        priceLineVisible: false,
        title: p.title,
        crosshairMarkerVisible: false,
        pointMarkersVisible: false,
      });
      ser.setData(p.data.map((d) => ({ time: (d.time / 1000) as UTCTimestamp, value: d.value })));
      pineSeriesRef.current.push(ser);
    }
    const mkPine: SeriesMarker<Time>[] = pineData.markers.slice(0, 120).map((m) => ({
      time: (m.time / 1000) as UTCTimestamp,
      position: m.up ? "belowBar" : "aboveBar",
      shape: m.up ? "arrowUp" : "arrowDown",
      color: m.color || (m.up ? C.green : C.red),
      text: m.text || (m.up ? "BUY" : "SELL"),
      size: 1.5,
    }));
    if (!pineMarkersRef.current) pineMarkersRef.current = createSeriesMarkers(cs, []);
    pineMarkersRef.current.setMarkers(mkPine);
  }, [pineData, candles, mode, pineStrategy]);

  const heightCls = "h-[380px] sm:h-[440px] xl:h-[540px]";

  return (
    <div className="relative rounded-xl border border-[#0F2E58] bg-[#020B1A] overflow-hidden">
      {/* ── EA AUTO-ATTACH OVERLAY · the chart IS the EA control surface ── */}
      <div className="absolute left-2.5 top-2 z-20 flex flex-wrap items-center gap-1.5">
        <Select value={symbol} onValueChange={(v) => onSymbol(v)} disabled={busy !== null}>
          <SelectTrigger
            aria-label="Chart symbol — the EA follows automatically"
            className="h-7 w-[132px] rounded-md border-[#1C4478] bg-[#021229]/95 text-[10.5px] font-bold text-[#EAF3FF] backdrop-blur"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[380px] border-[#1C4478] bg-[#041428] text-[#EAF3FF]">
            {SYMBOL_GROUPS.map((g) => (
              <SelectGroup key={g.key}>
                <SelectLabel className="pl-2 text-[9px] tracking-[0.18em] text-[#E9B94E]/80">{g.label}</SelectLabel>
                {symbolsByGroup(g.key).map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Select value={tf} onValueChange={(v) => onTf(v)} disabled={busy !== null}>
          <SelectTrigger
            aria-label="Chart timeframe — the EA follows automatically"
            className="h-7 w-[62px] rounded-md border-[#1C4478] bg-[#021229]/95 text-[10.5px] font-bold text-[#EAF3FF] backdrop-blur"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[#1C4478] bg-[#041428] text-[#EAF3FF]">
            {TIMEFRAMES.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden rounded-md border border-[#0F2E58] bg-[#021229]/95 px-1.5 py-[5px] text-[9px] uppercase tracking-wider text-[#E9B94E] backdrop-blur md:inline">
          {liveStat.active && liveStat.kind ? (liveStat.kind === "deriv" ? "DERIV LIVE" : "BINANCE LIVE") : source}
        </span>
        {tvNote && mode === "tv" && (
          <span className="rounded border px-1.5 py-0.5 text-[9px] tracking-wider" style={{ borderColor: "rgba(233,185,78,0.5)", color: C.gold }}>
            TV FALLBACK
          </span>
        )}
        {pineStrategy && mode === "3el" && (
          <span className="hidden rounded-md px-1.5 py-[5px] text-[9px] font-extrabold uppercase tracking-wider backdrop-blur md:inline" style={{ background: "rgba(0,214,143,0.14)", color: C.green, boxShadow: "inset 0 0 0 1px rgba(0,214,143,0.4)" }}>
            PINE · {pineStrategy.name}
          </span>
        )}
      </div>

      {/* right controls: EA attach toggle + chart engine toggle */}
      <div className="absolute right-2.5 top-2 z-20 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleBot}
          disabled={busy !== null}
          aria-label={enabled ? "Stop EA bot" : "Start EA bot"}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.14em] backdrop-blur transition-colors disabled:opacity-50"
          style={{
            borderColor: enabled ? "rgba(0,214,143,0.55)" : "#0F2E58",
            background: enabled ? "rgba(0,214,143,0.16)" : "rgba(2,18,41,0.95)",
            color: enabled ? C.green : C.muted,
          }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "animate-pulse" : ""}`} style={{ background: enabled ? C.green : "#51678A" }} />
          EA {enabled ? "ON" : "OFF"}
        </button>
        {autoAttach && (
          <span
            aria-label="EA auto-attach enabled"
            title="Auto-attach: the EA re-attaches to this chart on boot — no manual start"
            className="hidden rounded-lg border px-1.5 py-1 text-[8px] font-extrabold tracking-[0.18em] sm:inline"
            style={{ borderColor: "rgba(233,185,78,0.5)", background: "rgba(233,185,78,0.1)", color: C.gold }}
          >
            AUTO
          </span>
        )}
        <div className="flex overflow-hidden rounded-lg border border-[#0F2E58] bg-[#021229]/95 backdrop-blur">
          {(
            [
              ["3el", "TRADINGVIEW · 3EL"],
              ["tv", "TV WEB"],
            ] as Array<[ChartMode, string]>
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              aria-pressed={mode === m}
              aria-label={`Show ${label} chart`}
              className="px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.14em] transition-colors"
              style={{
                color: mode === m ? C.navy : C.muted,
                background: mode === m ? C.gold : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === "tv" ? (
        <div className={`relative ${heightCls}`}>
          <TvChart
            key={`${symbol}-${tf}`}
            symbol={symbol}
            tf={tf}
            height="100%"
            onUnavailable={(reason) => {
              setTvNote(reason);
              setMode("3el");
              try {
                localStorage.setItem(MODE_KEY, "3el");
              } catch {
                // ignore
              }
            }}
          />
          {/* 3EL INDICATOR attached to the TradingView web chart (legend rail) */}
          <IndicatorRail
            side="right"
            levels={freshLevels}
            trade={trade}
            live={liveStat.active && liveBar ? liveBar : liveCandle}
            price={liveStat.active && liveBar ? liveBar.close : price}
            atr={atr}
            cfg={cfg}
            mintick={mintick}
          />
          {/* approximate price ladder — current-signal lines drawn OVER the
              free embed (C1/C2/wick + ENTRY/SL/TP), drag-to-align */}
          <TvSignalOverlay
            candles={candles}
            levels={freshLevels}
            trade={trade}
            mintick={mintick}
            symbol={symbol}
            tf={tf}
          />
          {/* C3 forming alert pill — top-center works on both views */}
          {bestForm && (
            <div
              aria-label="C3 forming on live candle"
              className="absolute left-1/2 top-2 z-30 -translate-x-1/2 animate-pulse whitespace-nowrap rounded-full border px-3 py-1 text-[9px] font-extrabold tracking-[0.18em] backdrop-blur"
              style={{ borderColor: "rgba(233,185,78,0.65)", background: "rgba(233,185,78,0.2)", color: C.gold }}
            >
              ◎ C3 {bestForm.stage === "retest" ? "RETEST · FIRE IMMINENT" : bestForm.stage === "break" ? "BREAKING WICK LINE" : "AT WICK LINE"} {bestForm.side === -1 ? "▼" : "▲"}
            </div>
          )}
          {/* EA attach HUD — EA state drawn over the TradingView chart */}
          <div
            aria-label="EA attach status"
            className="pointer-events-none absolute bottom-2.5 left-3 z-10 max-w-[calc(100%-160px)] rounded-lg border border-[#0F2E58] bg-[#021229]/92 px-3 py-2 backdrop-blur-sm sm:max-w-[78%]"
          >
            <div className="flex items-center gap-1.5 text-[9px] font-extrabold tracking-[0.16em]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: !enabled ? "#51678A" : routing?.startsWith("LIVE") ? C.gold : C.green }}
              />
              <span style={{ color: enabled ? C.gold : C.muted }}>{enabled ? "EA AUTO-ATTACHED" : "EA DETACHED"}</span>
              {routing && enabled && <span className="text-[#8AA2C2]">· {routing}</span>}
            </div>
            {statusLine && (
              <div className="mt-0.5 text-[10px] font-bold tracking-wide text-[#EAF3FF]">{statusLine}</div>
            )}
            {trade ? (
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[9px] tracking-wide">
                <span style={{ color: trade.dir === -1 ? C.red : C.green }}>
                  {trade.dir === -1 ? "SELL" : "BUY"} @ {fmtPx(trade.entry, mintick)}
                </span>
                <span style={{ color: C.red }}>SL {fmtPx(trade.sl, mintick)}</span>
                <span style={{ color: C.green }}>TP {fmtPx(trade.tp, mintick)}</span>
              </div>
            ) : (
              <div className="mt-0.5 text-[9px] tracking-wide text-[#8AA2C2]">
                {enabled
                  ? "C3 fires auto-execute on the linked account — no manual steps"
                  : "Press EA ON — the EA re-attaches to this chart instantly"}
              </div>
            )}
            {/* free-embed notice — the TV web widget is a cross-origin iframe;
                the 3EL ladder overlays it approximately, full precision lives
                on the 3EL view */}
            <div className="mt-1 border-t border-[#0F2E58]/70 pt-1 text-[8px] font-bold tracking-[0.1em] text-[#8AA2C2]/80">
              FREE EMBED · 3EL LINES OVERLAID APPROXIMATELY (DRAG TO ALIGN) · FULL PRECISION ON “TRADINGVIEW · 3EL”
            </div>
          </div>
          {/* CANDLE TIMER — countdown to the current candle's close. The free
              TV embed is cross-origin (its own countdown can't be switched
              on from outside), so the timer rides on top as a HALO badge. */}
          <CandleTimer tf={tf} barOpenTime={liveStat.active && liveBar ? liveBar.time : liveCandle ? liveCandle.time : null} />
        </div>
      ) : (
        <div className="relative">
          <div ref={elRef} className={`${heightCls} w-full`} />
          {/* 3EL INDICATOR legend — TradingView-style top-left legend, always
              visible so the indicator is unmistakably attached to the chart */}
          <IndicatorRail
            side="left"
            levels={freshLevels}
            trade={trade}
            live={liveStat.active && liveBar ? liveBar : liveCandle}
            price={liveStat.active && liveBar ? liveBar.close : price}
            atr={atr}
            cfg={cfg}
            mintick={mintick}
          />
          {/* CANDLE TIMER — same countdown badge as the TV WEB view */}
          <CandleTimer tf={tf} barOpenTime={liveStat.active && liveBar ? liveBar.time : liveCandle ? liveCandle.time : null} />
        </div>
      )}
    </div>
  );
}
