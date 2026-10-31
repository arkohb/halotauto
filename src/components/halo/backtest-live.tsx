"use client";

// ════════════════════════════════════════════════════════════════════════
//  LIVE BACKTEST REPLAY · watch the 3EL bot trade REAL history bar-by-bar
//
//  The exact live HaloEngine runs in the browser over REAL OHLC history
//  (uncapped bars, any pair, M1→W1) fetched from the live feeds. The deck:
//   • candles print one-by-one at an adjustable speed (0.5× → MAX)
//   • the indicator is drawn AS IT FORMS: equal-level zones, the armed
//     mid lines, the DOTTED WICK TRIGGER lines (support + resistance),
//     C1/C2 markers, and the C3 break→return fire
//   • every trade lifecycle is marked on the chart and in the tape:
//     FIRE arrow → ENTRY/SL/TP position tool → TP HIT / SL HIT close tag
//   • live KPIs, growing equity curve, event tape and trade log update
//     while it runs, until the backtest period is fully replayed
//
//  No demo/simulator data — if real feeds are unreachable the run is
//  refused, exactly like the stats dashboard.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
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
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HaloEngine } from "@/lib/halo/engine";
import type { Candle, EngineEvent, HaloConfig, LevelSnapshot } from "@/lib/halo/types";
import { A, C, fmtPips, fmtPx } from "@/lib/halo/ui-helpers";
import { Pill } from "@/components/halo/panel";
import { BT_TIMEFRAMES, SYMBOLS, SYMBOL_GROUPS, tfSec } from "@/lib/market-symbols";
import { ZoneOverlay, type ZoneRectSpec } from "./lwc-zone";

interface LiveMeta {
  symbol: string;
  symbolLabel: string;
  group: string;
  tf: string;
  source: string;
  complete: boolean;
  mintick: number;
  bars: number;
  requestedBars: number | "all";
  from: string | null;
  span: { from: number; to: number };
}

interface LiveRes {
  ok: boolean;
  code?: string;
  error?: string;
  symbol?: string;
  symbolLabel?: string;
  group?: string;
  tf?: string;
  source?: string;
  complete?: boolean;
  mintick?: number;
  bars?: number;
  requestedBars?: number | "all";
  from?: string | null;
  span?: { from: number; to: number };
  candles?: Candle[];
}

interface TradeRow {
  dir: -1 | 1;
  entry: number;
  exit: number | null;
  sl: number;
  tp: number;
  result: "WIN" | "LOSS" | "OPEN";
  exitReason: "TP" | "SL" | null;
  pipsRaw: number;
  pips: number; // signed, net of spread
  riskPips: number;
  r: number | null;
  openTime: number;
  closeTime: number | null;
  holdMin: number | null;
}

type TapeKind = "armed" | "fire" | "tp" | "sl" | "burn" | "skip";
interface TapeItem {
  t: number;
  kind: TapeKind;
  text: string;
  sub: string;
}

type BannerTone = "fire" | "win" | "loss" | "info" | "done";
interface Banner {
  t: number;
  text: string;
  sub: string;
  tone: BannerTone;
}

interface Props {
  symbol: string;
  tf: string;
  config: HaloConfig;
}

const SPEEDS: Array<[string, number]> = [
  ["0.5×", 0.5],
  ["1×", 1],
  ["2×", 2],
  ["5×", 5],
  ["20×", 20],
  ["100×", 100],
  ["MAX", Infinity],
];
const BAR_PRESETS: Array<[string, string]> = [
  ["2000", "2K"],
  ["10000", "10K"],
  ["50000", "50K"],
  ["all", "ALL ∞"],
];
const MARKER_CAP = 1500; // rendered fire/close markers (all trades stay in the log)
const WARMUP = 220; // bars silently processed on load so ATR + first levels are live

const day = (t: number) => new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
const dt = (t: number) =>
  new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function sideColor(side: number, alpha: string): string {
  const rgb = side === -1 ? "242,54,69" : "8,153,129";
  return `rgba(${rgb},${alpha})`;
}

const sliderToSpeed = (v: number): number => 0.5 * Math.pow(10000, v / 100); // 0.5 → 5000 bars/s
function speedToSlider(s: number): number {
  if (!isFinite(s)) return 100;
  const raw = (Math.log(Math.max(0.5, s) / 0.5) / Math.log(10000)) * 100;
  return Math.max(0, Math.min(100, raw));
}
function speedText(s: number): string {
  if (s === Infinity) return "MAX SPEED";
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} bars/s`;
}
function bannerStyle(tone: BannerTone): { bg: string; border: string; fg: string } {
  switch (tone) {
    case "fire":
      return { bg: A.gold(0.14), border: A.gold(0.55), fg: C.gold };
    case "win":
      return { bg: A.green(0.16), border: A.green(0.55), fg: C.green };
    case "loss":
      return { bg: A.red(0.14), border: A.red(0.55), fg: C.red };
    case "done":
      return { bg: A.gold(0.18), border: A.gold(0.7), fg: "#E9CB5B" };
    default:
      return { bg: "rgba(2,18,41,0.9)", border: C.line2, fg: C.txt };
  }
}
const TAPE_STYLE: Record<TapeKind, { col: string; mark: string }> = {
  armed: { col: "#AEB9D6", mark: "◇" },
  fire: { col: C.gold, mark: "⯅" },
  tp: { col: C.green, mark: "●" },
  sl: { col: C.red, mark: "●" },
  burn: { col: "#5D6B8C", mark: "×" },
  skip: { col: "#5D6B8C", mark: "=" },
};

export function BacktestLive({ symbol, tf, config }: Props) {
  const known = SYMBOLS.some((s) => s.id === symbol);
  const [symPick, setSymPick] = useState(known ? symbol : "CUSTOM");
  const [customSym, setCustomSym] = useState(known ? "BTCUSD" : symbol);
  const activeSym = (symPick === "CUSTOM" ? customSym : symPick).toUpperCase().trim();
  const [btTf, setBtTf] = useState(BT_TIMEFRAMES.some((t) => t.id === tf) ? tf : "5m");
  const [bars, setBars] = useState("5000");
  const [from, setFrom] = useState("");
  const [spread, setSpread] = useState("0");

  const [meta, setMeta] = useState<LiveMeta | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadElapsed, setLoadElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [done, setDone] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [frame, setFrame] = useState(0);
  const seq = useRef(0);

  // ── chart handles ──
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersApiRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const zoneRef = useRef<ZoneOverlay | null>(null);
  const overlayRef = useRef<{ series: ISeriesApi<"Line">[]; priceLines: IPriceLine[] }>({ series: [], priceLines: [] });

  // ── replay core (refs — mutated at playback speed, rendered at ~12fps) ──
  const candlesRef = useRef<Candle[]>([]);
  const engineRef = useRef<HaloEngine | null>(null);
  const cursorRef = useRef(0);
  const speedRef = useRef(5);
  const spreadRef = useRef(0);
  const metaRef = useRef<LiveMeta | null>(null);
  const cfgRef = useRef<HaloConfig>(config);
  const tradesRef = useRef<TradeRow[]>([]);
  const openRowRef = useRef<TradeRow | null>(null);
  const equityRef = useRef<Array<{ t: number; pips: number }>>([]);
  const accRef = useRef(0);
  const peakRef = useRef(0);
  const ddRef = useRef(0);
  const wRef = useRef(0);
  const lRef = useRef(0);
  const gwRef = useRef(0);
  const glRef = useRef(0);
  const wsRef = useRef(0);
  const lsRef = useRef(0);
  const maxWsRef = useRef(0);
  const maxLsRef = useRef(0);
  const tapeRef = useRef<TapeItem[]>([]);
  const markersRef = useRef<SeriesMarker<Time>[]>([]);
  const bannerRef = useRef<Banner | null>(null);
  const lastBarRef = useRef<Candle | null>(null);

  // loading elapsed ticker
  useEffect(() => {
    if (!loading) return;
    const t0 = Date.now();
    setLoadElapsed(0);
    const iv = setInterval(() => setLoadElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [loading]);

  const pushMarker = useCallback((m: SeriesMarker<Time>) => {
    markersRef.current.push(m);
    const over = markersRef.current.length - MARKER_CAP;
    if (over > 0) markersRef.current.splice(0, over);
  }, []);

  const tape = useCallback((item: TapeItem) => {
    tapeRef.current.push(item);
    if (tapeRef.current.length > 60) tapeRef.current.splice(0, tapeRef.current.length - 60);
  }, []);

  // ── absorb engine events → trades, equity, tape, markers, banner ──
  const absorb = useCallback(
    (evs: EngineEvent[], barTime: number) => {
      const eng = engineRef.current;
      if (!eng) return;
      const mt = metaRef.current?.mintick ?? 0.01;
      for (const e of evs) {
        if (e.type === "fire") {
          // permanent formation circles (C1/C2) for the level that produced the trade
          const d = eng.state.drawings.find((x) => x.state === "fired" && x.endTime === e.time);
          if (d) {
            const pos = d.side === -1 ? "aboveBar" : "belowBar";
            const col = sideColor(d.side, "0.85");
            pushMarker({ time: (d.b1Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C1", color: col, size: 1.5 });
            pushMarker({ time: (d.b2Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C2", color: col, size: 1.5 });
          }
          pushMarker({
            time: (e.time / 1000) as UTCTimestamp,
            position: e.dir === -1 ? "aboveBar" : "belowBar",
            shape: e.dir === -1 ? "arrowDown" : "arrowUp",
            text: `${e.dir === -1 ? "SELL" : "BUY"} @ ${fmtPx(e.entry, mt)}`,
            color: C.gold,
            size: 2,
          });
          const row: TradeRow = {
            dir: e.dir,
            entry: e.entry,
            exit: null,
            sl: e.sl,
            tp: e.tp,
            result: "OPEN",
            exitReason: null,
            pipsRaw: 0,
            pips: 0,
            riskPips: e.riskPips,
            r: null,
            openTime: e.time,
            closeTime: null,
            holdMin: null,
          };
          tradesRef.current.push(row);
          openRowRef.current = row;
          const text = `${e.dir === -1 ? "▼ C3 SELL FIRED" : "▲ C3 BUY FIRED"} @ ${fmtPx(e.entry, mt)}`;
          const sub = `SL ${fmtPx(e.sl, mt)} · TP ${fmtPx(e.tp, mt)} · risk ${e.riskPips.toFixed(1)}p · instant at the wick line`;
          bannerRef.current = { t: barTime, text, sub, tone: "fire" };
          tape({ t: e.time, kind: "fire", text, sub: `SL ${fmtPx(e.sl, mt)} · TP ${fmtPx(e.tp, mt)}` });
        } else if (e.type === "win" || e.type === "loss") {
          const row = openRowRef.current;
          const win = e.type === "win";
          const raw = win ? e.pips : -e.pips;
          const net = raw - spreadRef.current; // spread cost per round trip
          if (row) {
            row.result = win ? "WIN" : "LOSS";
            row.exitReason = win ? "TP" : "SL";
            row.exit = win ? e.tp : e.sl;
            row.pipsRaw = raw;
            row.pips = net;
            row.r = row.riskPips > 0 ? net / row.riskPips : null;
            row.closeTime = e.time;
            row.holdMin = Math.max(0, (e.time - row.openTime) / 60000);
            openRowRef.current = null;
          }
          accRef.current += net;
          peakRef.current = Math.max(peakRef.current, accRef.current);
          ddRef.current = Math.max(ddRef.current, peakRef.current - accRef.current);
          equityRef.current.push({ t: e.time, pips: accRef.current });
          if (net > 0) {
            wRef.current += 1;
            gwRef.current += net;
            wsRef.current += 1;
            lsRef.current = 0;
            maxWsRef.current = Math.max(maxWsRef.current, wsRef.current);
          } else {
            lRef.current += 1;
            glRef.current += Math.abs(net);
            lsRef.current += 1;
            wsRef.current = 0;
            maxLsRef.current = Math.max(maxLsRef.current, lsRef.current);
          }
          const dirTxt = row ? (row.dir === -1 ? "SELL" : "BUY") : "trade";
          const holdTxt = row && row.holdMin !== null ? (row.holdMin < 60 ? `${row.holdMin.toFixed(0)}m` : `${(row.holdMin / 60).toFixed(1)}h`) : "—";
          const text = win ? `TP HIT  ${fmtPips(net)} pips` : `SL HIT  ${fmtPips(net)} pips`;
          const sub = `${dirTxt} closed · held ${holdTxt} · equity ${fmtPips(accRef.current)}p`;
          bannerRef.current = { t: barTime, text, sub, tone: win ? "win" : "loss" };
          tape({ t: e.time, kind: win ? "tp" : "sl", text, sub: `${dirTxt} closed · equity ${fmtPips(accRef.current)}p` });
          pushMarker({
            time: (e.time / 1000) as UTCTimestamp,
            position: win ? (row && row.dir === 1 ? "aboveBar" : "belowBar") : row && row.dir === -1 ? "aboveBar" : "belowBar",
            shape: "circle",
            text: `${win ? "TP" : "SL"} ${fmtPips(net)}`,
            color: win ? C.green : C.red,
            size: 1.5,
          });
        } else if (e.type === "level") {
          const d = eng.state.drawings.find((x) => x.id === e.id);
          const px = d ? fmtPx(d.ext, mt) : "—";
          const text = `${e.side === -1 ? "RESISTANCE ARMED" : "SUPPORT ARMED"} @ ${px}`;
          bannerRef.current = { t: barTime, text, sub: "dotted wick trigger line · waiting for C3 break → return", tone: "info" };
          tape({ t: barTime, kind: "armed", text, sub: "C1/C2 formed · dotted wick line set" });
        } else if (e.type === "burned") {
          tape({ t: barTime, kind: "burn", text: "level burned", sub: "broke the wick line, never returned — no trade" });
        } else if (e.type === "skipped") {
          tape({ t: barTime, kind: "skip", text: "signal skipped", sub: "a trade is already open" });
        }
        // "expired" levels are housekeeping — not shown
      }
    },
    [pushMarker, tape]
  );

  // ── process n bars (painting each candle as it lands) ──
  const stepBars = useCallback(
    (n: number) => {
      const eng = engineRef.current;
      const cs = candleRef.current;
      const candles = candlesRef.current;
      if (!eng || !cs || candles.length === 0) return;
      const total = candles.length;
      const end = Math.min(total, cursorRef.current + n);
      const budgeted = speedRef.current === Infinity;
      const t0 = performance.now();
      while (cursorRef.current < end) {
        const bar = candles[cursorRef.current];
        const evs = eng.processBar(bar, true);
        absorb(evs, bar.time);
        cs.update({ time: (bar.time / 1000) as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
        lastBarRef.current = bar;
        cursorRef.current += 1;
        // MAX speed: keep each frame under ~12ms so the page stays responsive
        if (budgeted && (cursorRef.current & 2047) === 0 && performance.now() - t0 > 12) break;
      }
    },
    [absorb]
  );

  // ── wipe all replay state and the chart (load / restart / backwards seek) ──
  const resetCore = useCallback(() => {
    const m = metaRef.current;
    engineRef.current = new HaloEngine(cfgRef.current, m ? m.mintick : 0.01);
    cursorRef.current = 0;
    tradesRef.current = [];
    openRowRef.current = null;
    equityRef.current = [];
    accRef.current = 0;
    peakRef.current = 0;
    ddRef.current = 0;
    wRef.current = 0;
    lRef.current = 0;
    gwRef.current = 0;
    glRef.current = 0;
    wsRef.current = 0;
    lsRef.current = 0;
    maxWsRef.current = 0;
    maxLsRef.current = 0;
    tapeRef.current = [];
    markersRef.current = [];
    bannerRef.current = null;
    lastBarRef.current = null;
    const chart = chartRef.current;
    const cs = candleRef.current;
    const mk = markersApiRef.current;
    const zone = zoneRef.current;
    if (chart) {
      for (const s of overlayRef.current.series) chart.removeSeries(s);
    }
    for (const pl of overlayRef.current.priceLines) cs?.removePriceLine(pl);
    overlayRef.current = { series: [], priceLines: [] };
    if (cs) cs.setData([]);
    if (mk) mk.setMarkers([]);
    if (zone) {
      zone.rects = [];
      zone.requestUpdate();
    }
  }, []);

  // ── chunked seek: silently replay to the target bar (records everything), then repaint ──
  const seekTo = useCallback(
    async (target: number) => {
      const total = candlesRef.current.length;
      if (total === 0) return;
      const end = Math.max(1, Math.min(Math.round(target), total));
      if (cursorRef.current > end) resetCore();
      setSeeking(true);
      while (cursorRef.current < end) {
        stepBars(Math.min(25000, end - cursorRef.current));
        setFrame((f) => f + 1);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      setSeeking(false);
      // re-center the view around the landed position
      const chart = chartRef.current;
      if (chart) {
        const vis = Math.min(320, cursorRef.current);
        chart.timeScale().setVisibleLogicalRange({ from: cursorRef.current - vis, to: cursorRef.current + 6 });
      }
      setFrame((f) => f + 1);
    },
    [resetCore, stepBars]
  );

  // ── playback loop (rAF; UI re-renders throttled to ~12fps) ──
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let uiAcc = 0;
    const loop = (now: number) => {
      const dtMs = Math.min(250, now - last);
      last = now;
      const spd = speedRef.current;
      acc += (dtMs / 1000) * (spd === Infinity ? 1e9 : spd);
      const n = Math.floor(acc);
      if (n > 0) {
        acc -= n;
        stepBars(n);
      }
      uiAcc += dtMs;
      const total = candlesRef.current.length;
      if (cursorRef.current >= total && total > 0) {
        setPlaying(false);
        setDone(true);
        bannerRef.current = {
          t: lastBarRef.current?.time ?? Date.now(),
          text: "BACKTEST COMPLETE",
          sub: `${wRef.current + lRef.current} trades closed · net ${fmtPips(accRef.current)} pips · period fully replayed`,
          tone: "done",
        };
        tape({
          t: lastBarRef.current?.time ?? Date.now(),
          kind: "tp",
          text: "BACKTEST COMPLETE",
          sub: `${wRef.current + lRef.current} trades · net ${fmtPips(accRef.current)}p`,
        });
        setFrame((f) => f + 1);
        return;
      }
      if (uiAcc >= 80) {
        uiAcc = 0;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, stepBars]);

  // ── chart init (once) ──
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.navy }, textColor: C.muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.divider }, horzLines: { color: C.divider } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 3 },
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      wickUpColor: C.green,
      wickDownColor: C.red,
      borderVisible: false,
      priceLineColor: C.dim,
    });
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
    const mk = createSeriesMarkers(cs, []);
    const zone = new ZoneOverlay();
    cs.attachPrimitive(zone as unknown as ISeriesPrimitive<Time>);
    chartRef.current = chart;
    candleRef.current = cs;
    markersApiRef.current = mk;
    zoneRef.current = zone;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      markersApiRef.current = null;
      zoneRef.current = null;
      overlayRef.current = { series: [], priceLines: [] };
    };
  }, []);

  // ── live overlay: armed lines + dotted triggers + zones + position tool + markers ──
  useEffect(() => {
    const chart = chartRef.current;
    const cs = candleRef.current;
    const mk = markersApiRef.current;
    const zone = zoneRef.current;
    const eng = engineRef.current;
    if (!chart || !cs || !mk || !zone || !eng || cursorRef.current === 0) return;

    // clear previous overlays
    for (const s of overlayRef.current.series) chart.removeSeries(s);
    for (const pl of overlayRef.current.priceLines) cs.removePriceLine(pl);
    overlayRef.current = { series: [], priceLines: [] };

    const m = metaRef.current;
    const tfSecs = tfSec(m?.tf ?? "5m");
    const firstT = candlesRef.current[0]?.time ?? 0;
    const curBar = candlesRef.current[Math.max(0, cursorRef.current - 1)];
    const curT = curBar?.time ?? Date.now();
    const rayEnd = curT + tfSecs * 1000 * 12;
    const mt = m?.mintick ?? 0.01;

    const addLevelLine = (t1: number, t2: number, px: number, color: string, width: 1 | 2, style: "solid" | "dashed" | "dotted") => {
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

    // armed levels: mid (solid) + DOTTED WICK TRIGGER (ext) — prices pinned at creation
    const fresh = eng.state.drawings.filter((d) => d.state === "fresh");
    const t = eng.state.trade;
    let firedForTrade: LevelSnapshot | null = null;
    if (t) {
      firedForTrade = eng.state.drawings.find((d) => d.state === "fired" && d.endTime === t.entryTime) ?? null;
    }
    const visible = [...fresh];
    if (firedForTrade) visible.push(firedForTrade);

    const rects: ZoneRectSpec[] = [];
    for (const d of visible) {
      const alpha = d.state === "fresh" ? "0.95" : "0.7";
      const col = sideColor(d.side, alpha);
      const end = d.state === "fresh" ? rayEnd : d.endTime ?? rayEnd;
      const startT = d.b1Time; // pinned anchor — lines never shift
      const mid = (d.top + d.bot) / 2;
      addLevelLine(startT, end, mid, col, 2, "solid");
      if (d.state === "fresh") {
        addLevelLine(startT, end, d.ext, sideColor(d.side, "0.9"), 2, "dotted");
        overlayRef.current.priceLines.push(
          cs.createPriceLine({
            price: d.ext,
            color: sideColor(d.side, "0.9"),
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            lineVisible: false,
            title: `TRIG ${d.side === -1 ? "▼" : "▲"}`,
          })
        );
        overlayRef.current.priceLines.push(
          cs.createPriceLine({
            price: mid,
            color: sideColor(d.side, "0.95"),
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            lineVisible: false,
            title: `3EL ${d.side === -1 ? "RES" : "SUP"}`,
          })
        );
      }
      rects.push({
        t1: d.b1Time,
        t2: d.state === "fresh" ? null : end,
        p1: d.bot,
        p2: d.top,
        fill: sideColor(d.side, d.state === "fresh" ? "0.14" : "0.05"),
        border: sideColor(d.side, d.state === "fresh" ? "0.5" : "0.2"),
        dashed: d.state !== "fresh",
      });
    }

    // position tool for the open trade — ENTRY/SL/TP zones + axis labels
    // (boxes ride the replayed candle: right edge = current replay bar,
    //  covered fully to its wick, never stretching into the future space)
    if (t) {
      const liveT = Math.max(curT, t.entryTime);
      const profitCol = t.dir === -1 ? "242,54,69" : "8,153,129";
      const riskCol = t.dir === -1 ? "8,153,129" : "242,54,69";
      rects.push({
        t1: t.entryTime,
        t2: liveT,
        capAtLastBar: true,
        p1: Math.min(t.entry, t.tp),
        p2: Math.max(t.entry, t.tp),
        fill: `rgba(${profitCol},0.13)`,
        border: `rgba(${profitCol},0.35)`,
      });
      rects.push({
        t1: t.entryTime,
        t2: liveT,
        capAtLastBar: true,
        p1: Math.min(t.entry, t.sl),
        p2: Math.max(t.entry, t.sl),
        fill: `rgba(${riskCol},0.13)`,
        border: `rgba(${riskCol},0.35)`,
      });
      overlayRef.current.priceLines.push(
        cs.createPriceLine({ price: t.entry, color: C.gold, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `ENTRY ${fmtPx(t.entry, mt)}` })
      );
      overlayRef.current.priceLines.push(
        cs.createPriceLine({ price: t.sl, color: C.red, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `SL −${t.riskPips.toFixed(0)}p` })
      );
      overlayRef.current.priceLines.push(
        cs.createPriceLine({ price: t.tp, color: C.green, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `TP +${t.rewardPips.toFixed(0)}p` })
      );
    }

    // markers: permanent trade history + transient C1/C2 for currently armed levels
    const transient: SeriesMarker<Time>[] = [];
    for (const d of fresh) {
      const pos = d.side === -1 ? "aboveBar" : "belowBar";
      const col = sideColor(d.side, "0.95");
      transient.push({ time: (d.b1Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C1", color: col, size: 1.5 });
      transient.push({ time: (d.b2Time / 1000) as UTCTimestamp, position: pos, shape: "circle", text: "C2", color: col, size: 1.5 });
    }
    const all = [...markersRef.current, ...transient].sort((a, b) => (a.time as number) - (b.time as number));
    mk.setMarkers(all);

    zone.rects = rects;
    zone.requestUpdate();
  }, [frame]);

  // ── load real history → warm up → auto-play ──
  const run = async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    setPlaying(false);
    setDone(false);
    setReady(false);
    spreadRef.current = Math.min(100, Math.max(0, Number(spread) || 0));
    try {
      const r = await fetch("/api/backtest/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: activeSym,
          tf: btTf,
          bars: bars.trim() === "" ? 5000 : bars,
          from: from || undefined,
        }),
      });
      const j = (await r.json()) as LiveRes;
      if (seq.current !== id) return;
      if (!j.ok || !j.candles || j.candles.length === 0 || j.mintick === undefined) {
        setError(
          j.code === "NO_LIVE_DATA"
            ? `NO LIVE DATA for ${activeSym} ${btTf} — the replay runs on REAL market prices only. Check the ticker or try again shortly.`
            : j.error ?? "Live history load failed."
        );
        setLoading(false);
        return;
      }
      const m: LiveMeta = {
        symbol: j.symbol ?? activeSym,
        symbolLabel: j.symbolLabel ?? "",
        group: j.group ?? "",
        tf: j.tf ?? btTf,
        source: j.source ?? "",
        complete: Boolean(j.complete),
        mintick: j.mintick,
        bars: j.candles.length,
        requestedBars: j.requestedBars ?? j.candles.length,
        from: j.from ?? null,
        span: j.span ?? { from: j.candles[0].time, to: j.candles[j.candles.length - 1].time },
      };
      cfgRef.current = config;
      metaRef.current = m;
      candlesRef.current = j.candles;
      setMeta(m);
      resetCore();
      setReady(true);
      setLoading(false);
      await seekTo(Math.min(WARMUP, j.candles.length)); // ATR + first levels live before the show starts
      if (seq.current === id) setPlaying(true);
    } catch (e) {
      if (seq.current === id) {
        setError((e as Error).message);
        setLoading(false);
      }
    }
  };

  const finish = () => {
    if (cursorRef.current >= candlesRef.current.length) {
      setDone(true);
      bannerRef.current = {
        t: lastBarRef.current?.time ?? Date.now(),
        text: "BACKTEST COMPLETE",
        sub: `${wRef.current + lRef.current} trades closed · net ${fmtPips(accRef.current)} pips · period fully replayed`,
        tone: "done",
      };
      setFrame((f) => f + 1);
    }
  };

  const onPlayPause = () => {
    if (!ready || seeking || done) return;
    if (cursorRef.current >= candlesRef.current.length) return;
    setPlaying((p) => !p);
  };
  const onStep = () => {
    if (!ready || seeking || done) return;
    setPlaying(false);
    stepBars(1);
    setFrame((f) => f + 1);
  };
  const onRestart = async () => {
    if (!ready || seeking) return;
    setPlaying(false);
    setDone(false);
    resetCore();
    setFrame((f) => f + 1);
    await seekTo(Math.min(WARMUP, candlesRef.current.length));
    setPlaying(true);
  };
  const onEnd = async () => {
    if (!ready || seeking || done) return;
    setPlaying(false);
    await seekTo(candlesRef.current.length);
    finish();
  };
  const onProgressClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!ready || seeking) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = Math.floor(pct * candlesRef.current.length);
    if (target === cursorRef.current) return;
    setPlaying(false);
    void seekTo(target);
  };
  const setSpeedBoth = (v: number) => {
    speedRef.current = v;
    setSpeed(v);
  };

  // ═══ PART 2 · RENDER ═══
  // render-time derivations (refs read here — re-rendered at ~12fps while playing)
  const eng = engineRef.current;
  const trade = eng?.state.trade ?? null;
  const levels = eng?.state.levels ?? [];
  const freshN = levels.length;
  const hasSup = levels.some((l) => l.side === 1);
  const hasRes = levels.some((l) => l.side === -1);
  const statsE = eng?.state.stats;
  const total = candlesRef.current.length;
  const cursor = cursorRef.current;
  const bar = lastBarRef.current;
  const mt = meta?.mintick ?? 0.01;
  const closedN = wRef.current + lRef.current;
  const net = accRef.current;
  const winRate = closedN > 0 ? (wRef.current * 100) / closedN : null;
  const pf = glRef.current > 0 ? gwRef.current / glRef.current : gwRef.current > 0 ? Infinity : null;
  const expectancy = closedN > 0 ? net / closedN : null;
  const avgW = wRef.current > 0 ? gwRef.current / wRef.current : null;
  const avgL = lRef.current > 0 ? glRef.current / lRef.current : null;
  const fp = trade && bar && eng ? ((bar.close - trade.entry) * trade.dir) / eng.pip : null;
  const pct = total > 0 ? (cursor / total) * 100 : 0;
  const banner = bannerRef.current;
  const tapeList = tapeRef.current.slice(-14).reverse();
  const logList = tradesRef.current.slice(-40).reverse();
  const holdSoFar = trade && bar ? Math.max(0, (bar.time - trade.entryTime) / 60000) : null;

  const statusObj = (() => {
    if (!ready) return { text: "LOAD REAL HISTORY TO BEGIN", fg: C.muted };
    if (done) return { text: "BACKTEST COMPLETE · PERIOD FULLY REPLAYED", fg: "#E9CB5B" };
    if (trade)
      return {
        text: `${trade.dir === -1 ? "▼ SELL" : "▲ BUY"} RUNNING · TP ${fmtPx(trade.tp, mt)} · SL ${fmtPx(trade.sl, mt)}`,
        fg: trade.dir === -1 ? C.red : C.green,
      };
    if (freshN > 0)
      return {
        text: hasSup && hasRes ? "WAITING FOR C3 WICK BREAK · SUPPORT + RESISTANCE ARMED" : `WAITING FOR C3 WICK BREAK · ${freshN} ARMED LEVEL${freshN > 1 ? "S" : ""}`,
        fg: C.gold,
      };
    return { text: "SCANNING FOR C1 / C2", fg: C.txt };
  })();

  const transportOff = !ready || seeking;

  return (
    <div className="space-y-4">
      {/* ── header ── */}
      <div className="rounded-xl border border-[#0F2E58] bg-[#021229] overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[#0F2E58]">
          <span className="text-xs font-bold tracking-wider text-[#EAF3FF]">LIVE BACKTEST REPLAY</span>
          <Pill tone="ok">REAL MARKET DATA ONLY · NO DEMO</Pill>
          <Pill tone="gold">∞ BARS · ANY PAIR · M1→W1</Pill>
          <span className="ml-auto text-[10px] text-[#8AA2C2]">watch the 3EL bot form levels, fire, and close — bar by bar</span>
        </div>

        <div className="flex flex-wrap items-end gap-3 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">PAIR / SYMBOL</span>
            <select
              value={symPick}
              onChange={(e) => setSymPick(e.target.value)}
              className="h-8 rounded-md border border-[#1C4478] bg-[#020B1A] px-2 text-xs font-mono text-[#EAF3FF] outline-none focus:border-[#E9B94E]"
            >
              {SYMBOL_GROUPS.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {SYMBOLS.filter((sy) => sy.group === g.key).map((sy) => (
                    <option key={sy.id} value={sy.id}>
                      {sy.id}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="CUSTOM">CUSTOM — ANY TICKER…</option>
            </select>
          </label>
          {symPick === "CUSTOM" && (
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">ANY TICKER</span>
              <Input
                value={customSym}
                onChange={(e) => setCustomSym(e.target.value.toUpperCase())}
                placeholder="BTCUSD, EURJPY, AAPL…"
                className="w-40 h-8 text-xs font-mono bg-[#020B1A] border-[#1C4478] text-[#EAF3FF] placeholder:text-[#4A5878]"
              />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">BAR SIZE (TF)</span>
            <select
              value={btTf}
              onChange={(e) => setBtTf(e.target.value)}
              className="h-8 rounded-md border border-[#1C4478] bg-[#020B1A] px-2 text-xs font-mono text-[#EAF3FF] outline-none focus:border-[#E9B94E]"
            >
              {BT_TIMEFRAMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">BARS · NO CAP</span>
            <Input
              value={bars}
              onChange={(e) => setBars(e.target.value)}
              placeholder="any count · or ALL"
              className="w-28 h-8 text-xs font-mono bg-[#020B1A] border-[#1C4478] text-[#EAF3FF] placeholder:text-[#4A5878]"
            />
          </label>
          <div className="flex gap-1">
            {BAR_PRESETS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setBars(v)}
                className="h-8 rounded-md border px-2.5 text-[10px] font-bold tracking-wide transition-colors"
                style={{
                  borderColor: bars === v ? C.gold : C.line2,
                  color: bars === v ? C.gold : C.muted,
                  background: bars === v ? A.gold(0.1) : "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">FROM (OPTIONAL)</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-36 h-8 text-xs font-mono bg-[#020B1A] border-[#1C4478] text-[#EAF3FF]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">SPREAD (PIPS / TRADE)</span>
            <Input
              type="number"
              value={spread}
              min={0}
              step={0.1}
              onChange={(e) => setSpread(e.target.value)}
              className="w-24 h-8 text-xs font-mono bg-[#020B1A] border-[#1C4478] text-[#EAF3FF]"
            />
          </label>

          <Button
            onClick={() => void run()}
            disabled={loading}
            className="h-8 px-5 rounded-md text-[11px] font-bold tracking-wider bg-[#2ECCFF] text-[#021229] hover:bg-[#7DDDFF]"
          >
            {loading ? `WALKING REAL HISTORY… ${loadElapsed}s` : ready ? "RELOAD HISTORY" : "LOAD REAL HISTORY"}
          </Button>
        </div>

        {loading && loadElapsed >= 6 && (
          <div className="px-3 pb-3 text-[10px] text-[#8AA2C2]">
            Deep walk in progress — huge windows (ALL on M1) fetch hundreds of pages and can take up to ~2 minutes.
          </div>
        )}
        {error && (
          <div
            className="mx-3 mb-3 rounded-lg border px-3 py-2 text-xs font-bold tracking-wide"
            style={{ borderColor: A.red(0.5), background: A.red(0.1), color: C.red }}
          >
            {error}
          </div>
        )}
      </div>

      {/* ── results strip ── */}
      {ready && meta && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-[#0F2E58] bg-[#021229] px-4 py-2 text-[10px] text-[#8AA2C2]">
          <span className="font-mono text-[11px] font-bold text-[#EAF3FF]">
            {meta.symbol}
            {meta.symbolLabel && meta.symbolLabel !== meta.symbol ? ` · ${meta.symbolLabel}` : ""} · {meta.tf.toUpperCase()}
          </span>
          <span>
            feed <span className="font-bold uppercase text-[#E9B94E]">{meta.source}</span>
          </span>
          <span>
            <span className="font-mono font-bold text-[#EAF3FF]">{meta.bars.toLocaleString()}</span> real bars
            <span className="text-[#4A5878]"> / requested {typeof meta.requestedBars === "string" ? "ALL" : meta.requestedBars.toLocaleString()}</span>
          </span>
          <span className="font-mono">
            {day(meta.span.from)} → {day(meta.span.to)}
          </span>
          {meta.requestedBars === "all" && <Pill tone="gold">ALL-HISTORY RUN</Pill>}
          {meta.complete && <Pill tone="ok">FEED GENESIS REACHED</Pill>}
          {meta.from && <Pill tone="muted">FROM {meta.from}</Pill>}
          <span>spread {spreadRef.current}p</span>
        </div>
      )}

      {/* ═══ REPLAY DECK ═══ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* ── left: transport + chart ── */}
        <div className="min-w-0 space-y-3">
          <div className="rounded-xl border border-[#0F2E58] bg-[#021229] p-3">
            {/* row 1 — transport */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onRestart()}
                disabled={transportOff}
                className="h-8 rounded-md border border-[#1C4478] px-3 text-[10px] font-extrabold tracking-wider text-[#AEB9D6] transition-colors hover:border-[#E9B94E] hover:text-[#E9B94E] disabled:opacity-40"
              >
                ⟲ RESTART
              </button>
              <Button
                onClick={onPlayPause}
                disabled={transportOff || done}
                className="h-8 px-5 rounded-md text-[11px] font-extrabold tracking-wider bg-[#2ECCFF] text-[#021229] hover:bg-[#7DDDFF] disabled:opacity-40"
              >
                {playing ? "❚❚ PAUSE" : "▶ PLAY"}
              </Button>
              <button
                type="button"
                onClick={onStep}
                disabled={transportOff || done}
                className="h-8 rounded-md border border-[#1C4478] px-3 text-[10px] font-extrabold tracking-wider text-[#AEB9D6] transition-colors hover:border-[#E9B94E] hover:text-[#E9B94E] disabled:opacity-40"
              >
                STEP +1
              </button>
              <button
                type="button"
                onClick={() => void onEnd()}
                disabled={transportOff || done}
                className="h-8 rounded-md border border-[#1C4478] px-3 text-[10px] font-extrabold tracking-wider text-[#AEB9D6] transition-colors hover:border-[#E9B94E] hover:text-[#E9B94E] disabled:opacity-40"
              >
                ⤓ SKIP TO END
              </button>
              {done && <Pill tone="gold">BACKTEST COMPLETE</Pill>}
              <span className="ml-auto font-mono text-[10px] font-bold text-[#E9B94E]">{speedText(speedRef.current)}</span>
            </div>

            {/* row 2 — speed */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-bold tracking-[0.14em] text-[#8AA2C2]">SPEED</span>
              {SPEEDS.map(([label, v]) => {
                const active = speedRef.current === v;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setSpeedBoth(v)}
                    className="h-7 rounded-md border px-2.5 text-[10px] font-bold tracking-wide transition-colors"
                    style={{
                      borderColor: active ? C.gold : C.line2,
                      color: active ? C.gold : C.muted,
                      background: active ? A.gold(0.1) : "transparent",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(speedToSlider(speed))}
                onChange={(e) => setSpeedBoth(sliderToSpeed(Number(e.target.value)))}
                aria-label="Replay speed — bars per second"
                className="ml-1 h-1 w-36 cursor-pointer accent-[#E9B94E]"
              />
            </div>

            {/* row 3 — progress */}
            <div className="mt-3">
              <div
                className="relative h-2.5 cursor-pointer rounded-full border border-[#0F2E58] bg-[#020B1A]"
                onClick={onProgressClick}
                role="slider"
                aria-label="Seek the replay"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                tabIndex={0}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${pct}%`, background: done ? C.gold : `linear-gradient(90deg,${C.goldDim},${C.gold})` }}
                />
                <div
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-[#020B1A]"
                  style={{ left: `calc(${pct}% - 7px)`, background: C.gold }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] text-[#8AA2C2]">
                <span>
                  bar {cursor.toLocaleString()} / {total.toLocaleString()} · {pct.toFixed(1)}%
                </span>
                <span>{bar ? dt(bar.time) : meta ? dt(meta.span.from) : "—"}</span>
              </div>
            </div>
          </div>

          {/* chart */}
          <div className="relative rounded-xl border border-[#0F2E58] bg-[#020B1A] overflow-hidden">
            <div ref={elRef} className="h-[420px] sm:h-[500px] xl:h-[580px]" />

            {/* latest event banner */}
            {banner && (
              <div
                className="pointer-events-none absolute left-2 top-2 z-10 max-w-[72%] rounded-lg border px-2.5 py-1.5 backdrop-blur"
                style={(() => {
                  const st = bannerStyle(banner.tone);
                  return { background: st.bg, borderColor: st.border };
                })()}
              >
                <div className="text-[11px] font-extrabold tracking-wide" style={{ color: bannerStyle(banner.tone).fg }}>
                  {banner.text}
                </div>
                <div className="font-mono text-[9.5px] text-[#AEB9D6]">
                  {banner.sub} · {dt(banner.t)}
                </div>
              </div>
            )}

            {/* replay clock */}
            <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-md border border-[#0F2E58] bg-[#021229]/90 px-2 py-1 font-mono text-[9.5px] text-[#8AA2C2] backdrop-blur">
              {meta ? `${meta.symbol} ${meta.tf.toUpperCase()}` : ""}
              {bar ? ` · ${dt(bar.time)}` : ""}
            </div>

            {/* open trade chip */}
            {trade && fp !== null && (
              <div className="absolute bottom-2 left-2 z-10 rounded-md border border-[#1C4478] bg-[#021229]/92 px-2.5 py-1.5 font-mono text-[10px] backdrop-blur">
                <span className="font-extrabold" style={{ color: trade.dir === -1 ? C.red : C.green }}>
                  {trade.dir === -1 ? "▼ SELL OPEN" : "▲ BUY OPEN"}
                </span>
                <span className="text-[#8AA2C2]"> @ {fmtPx(trade.entry, mt)} · floating </span>
                <span className="font-extrabold" style={{ color: fp >= 0 ? C.green : C.red }}>
                  {fmtPips(fp)}p
                </span>
              </div>
            )}

            {/* seeking chip */}
            {seeking && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex justify-center">
                <span className="rounded-md border border-[#E9B94E]/50 bg-[#021229]/95 px-3 py-1.5 text-[10px] font-extrabold tracking-[0.16em] text-[#E9B94E] backdrop-blur">
                  SEEKING…
                </span>
              </div>
            )}

            {/* idle cover */}
            {!ready && !loading && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#020B1A]/95 px-6 text-center">
                <div className="text-[11px] font-extrabold tracking-[0.2em] text-[#8AA2C2]">LIVE REPLAY DECK</div>
                <div className="max-w-md text-[10.5px] leading-relaxed text-[#5D6B8C]">
                  Pick any pair, any bar size, any number of bars (or ALL history) and press LOAD REAL HISTORY — the 3EL
                  bot will trade the real market bar-by-bar at whatever speed you set, until the period is done.
                </div>
              </div>
            )}
          </div>

          {/* legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[9px] text-[#5D6B8C]">
            <span>
              <span className="font-bold" style={{ color: sideColor(-1, "0.9") }}>─</span> armed level (pinned)
            </span>
            <span>
              <span className="font-bold" style={{ color: sideColor(-1, "0.9") }}>┄</span> dotted wick trigger (C3 must break it, then return)
            </span>
            <span>
              <span className="font-bold text-[#E9B94E]">▲▼</span> fire (instant at the line)
            </span>
            <span>
              <span className="font-bold" style={{ color: C.green }}>●</span>/<span className="font-bold" style={{ color: C.red }}>●</span> TP / SL hit
            </span>
            <span>◇ C1/C2 formation</span>
          </div>
        </div>

        {/* ── right: live state ── */}
        <div className="min-w-0 space-y-3">
          {/* status */}
          <div className="rounded-xl border border-[#0F2E58] bg-[#021229] px-3 py-2.5">
            <div className="text-[11px] font-extrabold tracking-wide" style={{ color: statusObj.fg }}>
              {statusObj.text}
            </div>
            <div className="mt-0.5 font-mono text-[9.5px] text-[#8AA2C2]">
              {eng ? `ATR ${eng.state.atr !== null ? eng.state.atr.toFixed(mt < 0.05 ? 4 : 2) : "warming up"} · burned ${statsE?.burned ?? 0} · skipped ${statsE?.skipped ?? 0} · crowded ${statsE?.tooClose ?? 0}` : "engine idle"}
            </div>
          </div>

          {/* KPIs */}
          <div className="rounded-xl border border-[#0F2E58] bg-[#021229] p-3">
            <div className="px-1 pb-2 text-[10px] font-bold tracking-[0.16em] text-[#8AA2C2]">LIVE PROFITABILITY (NET OF SPREAD)</div>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="NET PIPS" value={fmtPips(net)} color={net >= 0 ? C.green : C.red} big />
              <Kpi label="WIN RATE" value={winRate !== null ? `${winRate.toFixed(1)}%` : "—"} big />
              <Kpi
                label="PROFIT FACTOR"
                value={pf === null ? "—" : pf === Infinity ? "∞" : pf.toFixed(2)}
                color={pf !== null && pf !== Infinity && pf >= 1.5 ? C.green : pf !== null && pf < 1 ? C.red : undefined}
              />
              <Kpi label="EXPECTANCY" value={expectancy !== null ? `${fmtPips(expectancy)} p` : "—"} color={(expectancy ?? 0) >= 0 ? C.green : C.red} />
              <Kpi label="TRADES (W/L)" value={`${closedN} (${wRef.current}/${lRef.current})${tradesRef.current.length > closedN ? " +1 open" : ""}`} />
              <Kpi label="MAX DRAWDOWN" value={`−${ddRef.current.toFixed(1)}p`} color={ddRef.current > 0 ? C.red : undefined} />
              <Kpi label="AVG WIN" value={avgW !== null ? `+${avgW.toFixed(1)}p` : "—"} color={C.green} />
              <Kpi label="AVG LOSS" value={avgL !== null ? `−${avgL.toFixed(1)}p` : "—"} color={C.red} />
              <Kpi label="STREAK W / L" value={`${maxWsRef.current} / ${maxLsRef.current}`} />
              <Kpi label="BEST / WORST" value={bestWorst()} />
            </div>
          </div>

          {/* equity */}
          <div className="rounded-xl border border-[#0F2E58] bg-[#021229] p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-[10px] font-bold tracking-[0.16em] text-[#8AA2C2]">EQUITY CURVE · GROWING LIVE</span>
              <span className="font-mono text-sm font-extrabold" style={{ color: net >= 0 ? C.green : C.red }}>
                {fmtPips(net)}
              </span>
            </div>
            <EquityLive pts={equityRef.current} />
          </div>

          {/* open trade */}
          {trade && (
            <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: trade.dir === -1 ? A.red(0.45) : A.green(0.45), background: "rgba(2,18,41,0.9)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-wide" style={{ color: trade.dir === -1 ? C.red : C.green }}>
                  {trade.dir === -1 ? "▼ SELL IN PROGRESS" : "▲ BUY IN PROGRESS"}
                </span>
                {fp !== null && (
                  <span className="font-mono text-xs font-extrabold" style={{ color: fp >= 0 ? C.green : C.red }}>
                    {fmtPips(fp)}p
                  </span>
                )}
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[9.5px]">
                <span className="text-[#8AA2C2]">ENTRY <span className="text-[#EAF3FF]">{fmtPx(trade.entry, mt)}</span></span>
                <span className="text-[#8AA2C2]">SL <span style={{ color: C.red }}>{fmtPx(trade.sl, mt)}</span></span>
                <span className="text-[#8AA2C2]">TP <span style={{ color: C.green }}>{fmtPx(trade.tp, mt)}</span></span>
                <span className="text-[#8AA2C2]">HELD <span className="text-[#EAF3FF]">{holdSoFar !== null ? (holdSoFar < 60 ? `${holdSoFar.toFixed(0)}m` : `${(holdSoFar / 60).toFixed(1)}h`) : "—"}</span></span>
              </div>
            </div>
          )}

          {/* event tape */}
          <div className="rounded-xl border border-[#0F2E58] bg-[#021229] overflow-hidden">
            <div className="border-b border-[#0F2E58] px-3 py-2 text-[10px] font-bold tracking-[0.16em] text-[#8AA2C2]">EVENT TAPE · LIVE</div>
            <div className="max-h-56 overflow-y-auto halo-scroll">
              {tapeList.map((it, i) => {
                const st = TAPE_STYLE[it.kind];
                return (
                  <div key={`${it.t}-${i}`} className="flex gap-2 border-t border-[#061B38] px-3 py-1.5 first:border-t-0">
                    <span className="w-3 shrink-0 text-center font-bold" style={{ color: st.col }}>
                      {st.mark}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold" style={{ color: st.col }}>
                        {it.text}
                      </div>
                      <div className="truncate font-mono text-[9px] text-[#5D6B8C]">
                        {it.sub} · {dt(it.t)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {tapeList.length === 0 && (
                <div className="px-3 py-4 text-center text-[10px] text-[#5D6B8C]">Armed levels, fires and closes will stream here.</div>
              )}
            </div>
          </div>

          {/* trade log */}
          <div className="rounded-xl border border-[#0F2E58] bg-[#021229] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#0F2E58] px-3 py-2">
              <span className="text-[10px] font-bold tracking-[0.16em] text-[#8AA2C2]">TRADE LOG · LATEST {logList.length}</span>
              <span className="text-[9px] text-[#5D6B8C]">same-bar SL+TP = SL (conservative)</span>
            </div>
            <div className="max-h-64 overflow-y-auto halo-scroll">
              <table className="w-full text-[9.5px]">
                <tbody>
                  {logList.map((t, i) => (
                    <tr key={`${t.openTime}-${i}`} className="border-t border-[#061B38]">
                      <td className="px-2 py-1 font-mono text-[#8AA2C2]">{dt(t.openTime)}</td>
                      <td className="px-1 py-1 font-bold" style={{ color: t.dir === -1 ? C.red : C.green }}>
                        {t.dir === -1 ? "SELL" : "BUY"}
                      </td>
                      <td className="px-1 py-1 text-right font-mono text-[#EAF3FF]">{fmtPx(t.entry, mt)}</td>
                      <td className="px-2 py-1 text-right font-mono font-bold" style={{ color: t.result === "WIN" ? C.green : t.result === "LOSS" ? C.red : C.gold }}>
                        {t.result === "OPEN" ? "OPEN" : `${t.exitReason ?? ""} ${fmtPips(t.pips)}`}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[#8AA2C2]">
                        {t.holdMin !== null ? (t.holdMin < 60 ? `${t.holdMin.toFixed(0)}m` : `${(t.holdMin / 60).toFixed(1)}h`) : "—"}
                      </td>
                    </tr>
                  ))}
                  {logList.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-center text-[10px] text-[#5D6B8C]">No fires yet in this replay.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  function bestWorst(): string {
    const trades = tradesRef.current;
    const closed = trades.filter((t) => t.result !== "OPEN");
    if (closed.length === 0) return "—";
    let best = -Infinity;
    let worst = Infinity;
    for (const t of closed) {
      if (t.pips > best) best = t.pips;
      if (t.pips < worst) worst = t.pips;
    }
    return `${fmtPips(best)} / ${fmtPips(worst)}`;
  }
}

function Kpi({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-[#0F2E58] bg-[#020B1A] px-2.5 py-2">
      <div className="text-[8.5px] tracking-[0.14em] text-[#8AA2C2]">{label}</div>
      <div className={`font-mono font-extrabold ${big ? "text-base" : "text-xs"}`} style={{ color: color ?? C.txt }}>
        {value}
      </div>
    </div>
  );
}

/** Live equity curve — grows as trades close; stride-downsampled for huge runs. */
function EquityLive({ pts }: { pts: Array<{ t: number; pips: number }> }) {
  let data = pts;
  if (pts.length > 800) {
    const stride = Math.ceil(pts.length / 800);
    data = pts.filter((_, i) => i % stride === 0);
    if (data[data.length - 1] !== pts[pts.length - 1]) data.push(pts[pts.length - 1]);
  }
  if (data.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-[10.5px] text-[#8AA2C2]">
        The curve starts drawing when the first trade closes.
      </div>
    );
  }
  const w = 560;
  const h = 130;
  const padL = 6;
  const padR = 50;
  const vals = data.map((p) => p.pips);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = max - min || 1;
  const xOf = (i: number) => padL + (i / (vals.length - 1)) * (w - padL - padR);
  const yOf = (v: number) => 8 + ((max - v) / span) * (h - 16);
  const line = vals.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const last = vals[vals.length - 1];
  const col = last >= 0 ? C.green : C.red;
  const zeroY = yOf(0);
  const area = `${padL},${zeroY.toFixed(1)} ${line} ${xOf(vals.length - 1).toFixed(1)},${zeroY.toFixed(1)}`;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-[#0F2E58] bg-[#020B1A]" role="img" aria-label="Live replay equity curve">
        <defs>
          <linearGradient id="btLiveEq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.28" />
            <stop offset="100%" stopColor={col} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="#1C4478" strokeWidth="1" strokeDasharray="4 4" />
        <polyline points={area} fill="url(#btLiveEq)" stroke="none" />
        <polyline points={line} fill="none" stroke={col} strokeWidth="1.8" />
        <text x={w - padR + 6} y={yOf(max) + 4} fontSize="9" fill={C.muted} fontFamily="monospace">
          +{max.toFixed(0)}
        </text>
        <text x={w - padR + 6} y={yOf(min) + 4} fontSize="9" fill={C.muted} fontFamily="monospace">
          {min.toFixed(0)}
        </text>
        <text x={w - padR + 6} y={yOf(last) + 4} fontSize="10" fontWeight="700" fill={col} fontFamily="monospace">
          {last >= 0 ? "+" : "−"}
          {Math.abs(last).toFixed(0)}p
        </text>
      </svg>
    </div>
  );
}
