"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL CHART · lightweight-charts v5
//  Candles + C1/C2 equal-level lines + C3 fire arrows + ENTRY/SL/TP tags
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
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
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, LevelSnapshot, TradeSnapshot } from "@/lib/halo/types";
import { C, fmtPx } from "@/lib/halo/ui-helpers";
import type { LogEntry } from "@/lib/halo/types";
import { TvChart } from "./tv-chart";

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
}

interface LevelLines {
  series: ISeriesApi<"Line">[];
  priceLines: IPriceLine[];
}

function sideColor(side: number, alpha: string): string {
  const rgb = side === -1 ? "242,54,69" : "8,153,129";
  return `rgba(${rgb},${alpha})`;
}

type ChartMode = "tv" | "halo";
const MODE_KEY = "halo3el.chartmode";

export default function ChartPanel(props: ChartProps) {
  const { candles, drawings, log, trade, mintick, symbol, tf, source, statusLine, routing } = props;
  const [mode, setMode] = useState<ChartMode>("tv");
  const [tvNote, setTvNote] = useState<string | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const overlayRef = useRef<LevelLines>({ series: [], priceLines: [] });

  // restore persisted chart mode (deferred so we never setState synchronously in an effect)
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const m = localStorage.getItem(MODE_KEY);
        if (m === "halo" || m === "tv") setMode(m);
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

  // init chart once per halo-mode mount
  useEffect(() => {
    if (mode !== "halo") return;
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
      grid: { vertLines: { color: "#121D35" }, horzLines: { color: "#121D35" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 8 },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      wickUpColor: C.green,
      wickDownColor: C.red,
      borderVisible: false,
      priceLineColor: "#5D606B",
    });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
    chartRef.current = chart;
    candleRef.current = candleSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      markersRef.current = null;
      overlayRef.current = { series: [], priceLines: [] };
    };
  }, [mode]);

  // candle data — always push the full window whenever the prop changes
  // (cheap for ≤720 bars and impossible to go stale)
  useEffect(() => {
    if (mode !== "halo") return;
    const s = candleRef.current;
    if (!s || candles.length === 0) return;
    s.setData(
      candles.map((c) => ({
        time: (c.time / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
  }, [candles, mode]);

  // overlays: level lines + trade price lines + markers
  useEffect(() => {
    if (mode !== "halo") return;
    const chart = chartRef.current;
    const cs = candleRef.current;
    const mk = markersRef.current;
    if (!chart || !cs || !mk) return;

    // clear previous overlays
    for (const s of overlayRef.current.series) chart.removeSeries(s);
    for (const pl of overlayRef.current.priceLines) cs.removePriceLine(pl);
    overlayRef.current = { series: [], priceLines: [] };

    const firstT = candles.length > 0 ? candles[0].time : 0;
    const lastT = candles.length > 0 ? candles[candles.length - 1].time : Date.now();
    const visible = drawings.filter((d) => (d.endTime ?? lastT) >= firstT).slice(-26);

    const addLevelLine = (t1: number, t2: number, price: number, color: string, width: 1 | 2, dashed: boolean) => {
      const a = Math.max(t1, firstT) / 1000;
      const b = Math.max(t2, firstT + 1000) / 1000;
      if (!(b > a)) return;
      const ser = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        pointMarkersVisible: false,
      });
      ser.setData([
        { time: a as UTCTimestamp, value: price },
        { time: b as UTCTimestamp, value: price },
      ]);
      overlayRef.current.series.push(ser);
    };

    const markers: SeriesMarker<Time>[] = [];

    for (const d of visible) {
      const alpha = d.state === "fresh" ? "0.95" : d.state === "fired" ? "0.85" : "0.32";
      const col = sideColor(d.side, alpha);
      const end = d.endTime ?? lastT;
      addLevelLine(d.b1Time, end, d.c1Close, col, 2, false);
      addLevelLine(d.b2Time, end, d.c2Open, col, 1, true);
      if (d.state === "fresh") {
        const pos = d.side === -1 ? "aboveBar" : "belowBar";
        markers.push({ time: (d.b1Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C1", color: col, size: 1 });
        markers.push({ time: (d.b2Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C2", color: col, size: 1 });
      }
    }

    // trade lines
    const t = trade;
    if (t) {
      overlayRef.current.priceLines.push(
        cs.createPriceLine({
          price: t.entry,
          color: C.gray,
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

    // event markers (fires + results)
    for (const e of log.slice(-30)) {
      if (e.kind === "fire") {
        markers.push({
          time: (e.time / 1000) as UTCTimestamp,
          position: e.dir === -1 ? "aboveBar" : "belowBar",
          shape: e.dir === -1 ? "arrowDown" : "arrowUp",
          text: e.dir === -1 ? "C3 SELL" : "C3 BUY",
          color: C.gold,
          size: 1.5,
        });
      } else if (e.kind === "win") {
        markers.push({
          time: (e.time / 1000) as UTCTimestamp,
          position: e.dir === -1 ? "belowBar" : "aboveBar",
          shape: "circle",
          text: `TP ${e.pips.toFixed(0)}p`,
          color: C.green,
          size: 1,
        });
      } else if (e.kind === "loss") {
        markers.push({
          time: (e.time / 1000) as UTCTimestamp,
          position: e.dir === -1 ? "aboveBar" : "belowBar",
          shape: "square",
          text: `SL ${e.pips.toFixed(0)}p`,
          color: C.red,
          size: 1,
        });
      }
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(markers);
  }, [drawings, log, trade, mintick, candles, mode]);

  const heightCls = "h-[380px] sm:h-[440px] xl:h-[540px]";

  return (
    <div className="relative rounded-xl border border-[#1C2A47] bg-[#0B1426] overflow-hidden">
      <div className="absolute left-3 top-2.5 z-10 flex items-center gap-2 text-[11px] pointer-events-none">
        <span className="font-semibold text-[#E8ECF4]">{symbol}</span>
        <span className="text-[#8C98AE]">· {tf} ·</span>
        <span className="uppercase tracking-wide text-[#D4AF37]">{source}</span>
        {tvNote && mode === "tv" && (
          <span className="rounded border px-1.5 py-0.5 text-[9px] tracking-wider" style={{ borderColor: "rgba(212,175,55,0.5)", color: C.gold }}>
            TV FALLBACK
          </span>
        )}
      </div>

      {/* chart engine toggle */}
      <div className="absolute right-2.5 top-2 z-20 flex overflow-hidden rounded-lg border border-[#1C2A47] bg-[#0F1A30]/95 backdrop-blur">
        {(
          [
            ["tv", "TRADINGVIEW"],
            ["halo", "HALO EA"],
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

      {mode === "tv" ? (
        <div className={heightCls}>
          <TvChart
            key={`${symbol}-${tf}`}
            symbol={symbol}
            tf={tf}
            height="100%"
            onUnavailable={(reason) => {
              setTvNote(reason);
              setMode("halo");
              try {
                localStorage.setItem(MODE_KEY, "halo");
              } catch {
                // ignore
              }
            }}
          />
          {/* EA attach HUD — EA state drawn over the TradingView chart */}
          <div
            aria-label="EA attach status"
            className="pointer-events-none absolute bottom-2.5 left-3 z-10 max-w-[78%] rounded-lg border border-[#1C2A47] bg-[#0F1A30]/92 px-3 py-2 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5 text-[9px] font-extrabold tracking-[0.16em]">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: routing?.startsWith("LIVE") ? C.gold : C.green }}
              />
              <span style={{ color: C.gold }}>EA ATTACHED</span>
              {routing && <span className="text-[#8C98AE]">· {routing}</span>}
            </div>
            {statusLine && (
              <div className="mt-0.5 text-[10px] font-bold tracking-wide text-[#E8ECF4]">{statusLine}</div>
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
              <div className="mt-0.5 text-[9px] tracking-wide text-[#8C98AE]">
                C3 fires auto-execute on the linked account · attach card below
              </div>
            )}
          </div>
        </div>
      ) : (
        <div ref={elRef} className={`${heightCls} w-full`} />
      )}
    </div>
  );
}
