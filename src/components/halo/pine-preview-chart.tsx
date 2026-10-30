"use client";

// ════════════════════════════════════════════════════════════════════════
//  PINE PREVIEW CHART · candles + compiled Pine plots + trade markers
//  The Strategy Studio's own lightweight-charts view of what the compiled
//  script really draws over real market history (from the preview API).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { C } from "@/lib/halo/ui-helpers";
import type { Candle } from "@/lib/halo/types";

export interface PreviewPlot {
  key: string;
  title: string;
  style: string;
  color: string;
  lineWidth: number;
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
  height = 380,
}: {
  candles: Candle[];
  plots: PreviewPlot[];
  markers: PreviewMarker[];
  hlines: PreviewHLine[];
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const extraRef = useRef<ISeriesApi<"Line">[]>([]);

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

    for (const p of plots.slice(0, 8)) {
      const ser = chart.addSeries(LineSeries, {
        color: p.color || C.cyan,
        lineWidth: Math.min(3, Math.max(1, p.lineWidth)) as 1 | 2 | 3,
        lineStyle: p.style === "stepline" ? LineStyle.Solid : LineStyle.Solid,
        lastValueVisible: true,
        priceLineVisible: false,
        title: p.title,
        crosshairMarkerVisible: false,
      });
      ser.setData(
        p.data.map((d) => ({ time: (d.time / 1000) as UTCTimestamp, value: d.value }))
      );
      extraRef.current.push(ser);
    }
    for (const h of hlines.slice(0, 6)) {
      cs.createPriceLine({
        price: h.price,
        color: h.color || C.label,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: h.title || "hline",
      });
    }
    const mk: SeriesMarker<Time>[] = markers.slice(0, 200).map((m) => ({
      time: (m.time / 1000) as UTCTimestamp,
      position: m.up ? "belowBar" : "aboveBar",
      shape: m.up ? "arrowUp" : "arrowDown",
      color: m.color || (m.up ? C.green : C.red),
      text: m.text || (m.up ? "BUY" : "SELL"),
    }));
    createSeriesMarkers(cs, mk);
    chart.timeScale().fitContent();
  }, [candles, plots, markers, hlines]);

  return <div ref={elRef} className="w-full" style={{ height }} />;
}
