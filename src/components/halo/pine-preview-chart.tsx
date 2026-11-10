"use client";

// ════════════════════════════════════════════════════════════════════════
//  PINE PREVIEW CHART · candles + compiled Pine plots + trade markers
//  The Strategy Studio's own lightweight-charts view of what the compiled
//  script really draws over real market history (from the preview API).
//  Overlay scripts draw on the price pane; separate-pane scripts (RSI /
//  MACD, overlay=false) get their own pane so their scale stays honest.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesPrimitive,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { C } from "@/lib/halo/ui-helpers";
import type { Candle } from "@/lib/halo/types";
import type { PineDrawings } from "@/lib/pine/drawings";
import { PineDrawOverlay } from "./lwc-pine";

export interface PreviewPlot {
  key: string;
  title: string;
  style: string;
  color: string;
  lineWidth: number;
  /** script-level overlay flag — false renders the plot in its own pane */
  overlay?: boolean;
  data: { time: number; value: number; color?: string }[];
}
export interface PreviewMarker {
  time: number;
  up: boolean;
  text: string;
  color: string;
  title: string;
}
export interface PreviewHLine {
  price: number;
  title: string;
  color?: string;
}

export function PinePreviewChart({
  candles,
  plots,
  markers,
  hlines,
  drawings,
  overlay = true,
  height = 380,
}: {
  candles: Candle[];
  plots: PreviewPlot[];
  markers: PreviewMarker[];
  hlines: PreviewHLine[];
  /** the script's line/box/label/table/fill/bgcolor objects */
  drawings?: PineDrawings;
  overlay?: boolean;
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const extraRef = useRef<Array<ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>([]);
  const hlinesRef = useRef<Array<{ s: ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | ISeriesApi<"Candlestick">; pl: IPriceLine }>>([]);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const drawRef = useRef<{ s: ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | ISeriesApi<"Candlestick">; prim: PineDrawOverlay } | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      height,
      layout: { background: { type: ColorType.Solid, color: C.navy }, textColor: C.muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.divider }, horzLines: { color: C.divider } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false },
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      wickUpColor: C.green,
      wickDownColor: C.red,
      borderVisible: false,
    });
    chartRef.current = chart;
    candleRef.current = cs;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      extraRef.current = [];
      hlinesRef.current = [];
      markersRef.current = null;
      drawRef.current = null;
    };
  }, [height]);

  // data + overlays
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleRef.current;
    if (!chart || !cs || candles.length === 0) return;
    cs.setData(
      candles.map((c) => ({ time: (c.time / 1000) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }))
    );

    for (const s of extraRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // already gone
      }
    }
    extraRef.current = [];
    for (const { s, pl } of hlinesRef.current) {
      try {
        s.removePriceLine(pl);
      } catch {
        // already gone
      }
    }
    hlinesRef.current = [];
    if (drawRef.current) {
      try {
        drawRef.current.s.detachPrimitive(drawRef.current.prim as unknown as ISeriesPrimitive<Time>);
      } catch {
        // series already removed
      }
      drawRef.current = null;
    }

    // Pane placement — mirror the live chart: overlay=false scripts plot in
    // their own pane below the candles.
    let firstPaneSeries: ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | null = null;
    for (const p of plots.slice(0, 8)) {
      const separate = p.overlay === false;
      const paneIdx = separate ? 1 : 0;
      const asHistogram = p.style === "histogram" || p.style === "columns";
      const ser = asHistogram
        ? chart.addSeries(
            HistogramSeries,
            {
              color: p.color || C.cyan,
              lastValueVisible: true,
              priceLineVisible: false,
              title: p.title,
            },
            paneIdx
          )
        : chart.addSeries(
            LineSeries,
            {
              color: p.color || C.cyan,
              lineWidth: Math.min(3, Math.max(1, p.lineWidth)) as 1 | 2 | 3,
              lineStyle: LineStyle.Solid,
              lastValueVisible: true,
              priceLineVisible: false,
              title: p.title,
              crosshairMarkerVisible: false,
            },
            paneIdx
          );
      ser.setData(p.data.map((d) => ({ time: (d.time / 1000) as UTCTimestamp, value: d.value, color: d.color })));
      extraRef.current.push(ser);
      if (separate && !firstPaneSeries) firstPaneSeries = ser;
    }
    const hlineTarget = firstPaneSeries ?? cs;
    for (const h of hlines.slice(0, 6)) {
      try {
        hlinesRef.current.push({
          s: hlineTarget,
          pl: hlineTarget.createPriceLine({
            price: h.price,
            color: h.color || C.label,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: h.title || "hline",
          }),
        });
      } catch {
        // out-of-range hline — skip
      }
    }
    const mk: SeriesMarker<Time>[] = markers.slice(0, 200).map((m) => ({
      time: (m.time / 1000) as UTCTimestamp,
      position: m.up ? "belowBar" : "aboveBar",
      shape: m.up ? "arrowUp" : "arrowDown",
      color: m.color || (m.up ? C.green : C.red),
      text: m.text || (m.up ? "BUY" : "SELL"),
    }));
    if (!markersRef.current) markersRef.current = createSeriesMarkers(cs, []);
    markersRef.current.setMarkers(mk);
    const drawTarget = overlay === false ? firstPaneSeries : cs;
    if (drawings && drawTarget) {
      const prim = new PineDrawOverlay();
      prim.data = drawings;
      prim.setPlots(plots);
      prim.getBars = () => cs.data().map((b) => b.time as number);
      drawTarget.attachPrimitive(prim as unknown as ISeriesPrimitive<Time>);
      drawRef.current = { s: drawTarget, prim };
    }
    chart.timeScale().fitContent();
  }, [candles, plots, markers, hlines, drawings, overlay]);

  return <div ref={elRef} className="w-full" style={{ height }} />;
}
