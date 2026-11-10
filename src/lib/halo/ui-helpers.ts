// Client-safe helpers for the HALO 3EL Autotrader UI
import type { EngineSnapshot, HaloConfig, TradeSnapshot } from "./types";

/** Voice activity of the HALO AI core — driven by the JARVIS console, mirrored onto the orb. */
export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export const C = {
  // ── surfaces · deep-space navy with an azure cast (mockup palette) ──
  navy: "#020B1A", // app background
  navy2: "#041428", // raised surface / hover
  navy3: "#07203F", // highest raise
  navy4: "#021229", // card surface
  line: "#0F2E58", // primary border
  gold: "#E9B94E", // metallic gold — brand mark only (logo)
  goldDim: "#8A7423",
  txt: "#EAF3FF", // primary text
  muted: "#8AA2C2", // muted text
  red: "#FF4D5E", // negative money color
  green: "#00D68F", // positive money color
  gray: "#787B86",
  cyan: "#2ECCFF", // electric azure — primary interactive accent
  blue: "#1E90FF", // azure blue — active fills / gradients
  ice: "#9BE8FF", // restrained ice-blue — secondary AI glow

  // ── v2 tokens: the previously-hardcoded palette, now first-class ──
  deep: "#000714", // near-black wells (deepest surface)
  panel: "#021430", // glass panel base (PanelCard)
  panelLine: "#13386A", // PanelCard border
  line2: "#1C4478", // input / hover border
  lineInner: "#0A2447", // inner dividers
  divider: "#061B38", // row dividers / chart grid
  txt2: "#B9CBE4", // secondary text
  txt3: "#DCE9FA", // panel title text
  label: "#6485AB", // label gray
  dim: "#51678A", // inactive / dot gray
  goldHover: "#F5CD6B", // gold hover / bright gold
  warn: "#FFB454", // warning amber
  teal: "#35E0C8", // teal — verified execution / positive AI activity
};

/** rgba() of a token — ONE syntax for translucent HALO colors: A.gold(0.12). */
export const A = {
  gold: (a: number) => `rgba(233,185,78,${a})`,
  cyan: (a: number) => `rgba(46,204,255,${a})`,
  blue: (a: number) => `rgba(30,144,255,${a})`,
  teal: (a: number) => `rgba(53,224,200,${a})`,
  ice: (a: number) => `rgba(155,232,255,${a})`,
  green: (a: number) => `rgba(0,214,143,${a})`,
  red: (a: number) => `rgba(255,77,94,${a})`,
  warn: (a: number) => `rgba(255,180,84,${a})`,
  white: (a: number) => `rgba(234,243,255,${a})`,
};

/** Unified status-pill tones — replaces the 6+ ad-hoc pill recipes. */
export type PillTone = "ok" | "live" | "warn" | "err" | "info" | "gold" | "muted";

export function pillStyle(tone: PillTone): { fg: string; bg: string; line: string } {
  switch (tone) {
    case "ok":
    case "live":
      return { fg: C.green, bg: A.green(0.13), line: A.green(tone === "live" ? 0.5 : 0.35) };
    case "warn":
      return { fg: C.warn, bg: A.warn(0.12), line: A.warn(0.4) };
    case "err":
      return { fg: C.red, bg: A.red(0.12), line: A.red(0.4) };
    case "info":
      return { fg: C.cyan, bg: A.cyan(0.1), line: A.cyan(0.35) };
    case "gold":
      return { fg: C.goldHover, bg: A.gold(0.1), line: A.gold(0.4) };
    default:
      return { fg: C.muted, bg: A.white(0.06), line: A.white(0.14) };
  }
}

export interface ExecRes {
  executionMode: "paper" | "live";
  sizingMode: "fixed" | "percent";
  sizeFixed: number;
  sizePercent: number;
  broker: { id: string; label: string; kind: string; status: string; statusMsg: string } | null;
}

/** which strategy the bot is trading — from /api/bot/state (additive) */
export interface StrategyRes {
  active: boolean;
  id: string | null;
  name: string;
  kind: "builtin" | "pine";
  symbol: string;
  tf: string;
  warmed: boolean;
  /** row updatedAt (epoch ms) — bumps on every switch/edit; the chart watches it to redraw instantly */
  rev: number;
  position: { dir: 1 | -1; entry: number; sl: number | null; tp: number | null; entryTime: number } | null;
  selected: { id: string | null; name: string; kind: "builtin" | "pine" };
}

/** custom-indicator overlay rendered on the 3EL chart (from /api/strategies/[id]/preview) */
export interface PineOverlayPlot {
  key: string;
  title: string;
  style: string;
  color: string;
  lineWidth: number;
  overlay: boolean;
  data: { time: number; value: number; color?: string }[];
}
export interface PineOverlayMarker {
  time: number;
  up: boolean;
  text: string;
  color: string;
  title: string;
}
export interface PineOverlayHLine {
  price: number;
  title: string;
  color?: string;
}
export interface PineOverlayInput {
  title: string;
  value: string;
}
export interface PineOverlayData {
  plots: PineOverlayPlot[];
  markers: PineOverlayMarker[];
  hlines?: PineOverlayHLine[];
  /** the indicator's input parameters with their resolved values — shown on
   *  the chart rail so the trader sees the exact settings it trades with */
  inputs?: PineOverlayInput[];
  name: string;
  /** line/box/label/table/fill/bgcolor objects drawn on the chart canvas */
  drawings?: import("@/lib/pine/drawings").PineDrawings;
  overlay?: boolean;
}

export interface BotStateRes {
  enabled: boolean;
  autoAttach: boolean;
  pauseNew?: boolean;
  symbol: string;
  tf: string;
  mintick: number;
  feed: { source: string; note: string; price: number; lastTickAt: number; realizedPips: number };
  config: HaloConfig;
  engine: EngineSnapshot;
  exec: ExecRes;
  strategy?: StrategyRes;
  /** GLOBAL TRADE LOCK — a trade is running somewhere; scanning is paused until TP/SL */
  scanLock?: { source: string; symbol: string; tf: string; dir: number; entry: number; sl: number; tp: number; openedAt: number } | null;
}

export function decimalsOf(mintick: number): number {
  if (!isFinite(mintick) || mintick <= 0) return 2;
  if (mintick >= 1) return 0;
  return Math.min(8, Math.max(0, Math.round(-Math.log10(mintick))));
}

export function fmtPx(px: number, mintick: number): string {
  if (!isFinite(px)) return "—";
  return px.toLocaleString("en-US", {
    minimumFractionDigits: decimalsOf(mintick),
    maximumFractionDigits: decimalsOf(mintick),
  });
}

/** a trade's result in SIGNED pips. The book stores most LOSS rows as a
 *  positive magnitude (and TV-closed rows signed), so the sign always comes
 *  from the status — never from the raw number. */
export function signedPips(status: string, resultPips: number | null | undefined): number {
  const v = Math.abs(Number(resultPips ?? 0)) || 0;
  return status === "WIN" ? v : status === "LOSS" ? -v : 0;
}

export function fmtPips(p: number): string {
  const s = p >= 0 ? "+" : "−";
  return `${s}${Math.abs(p).toFixed(1)}`;
}

/**
 * THE running trade, wherever it lives: the chart bot's own engine trade, or
 * — when the chart bot is flat — the trade a Scanner Bot / Market Scanner /
 * sweep / TradingView fire is running (the global trade lock). Every
 * dashboard panel reads this so a scanner-fired trade never shows "FLAT".
 */
export function openTrade(state: BotStateRes): (TradeSnapshot & { source?: string; symbol?: string; tf?: string }) | null {
  const t = state.engine.trade;
  if (t && t.traded !== false) return t;
  const l = state.scanLock;
  if (l && l.sl > 0 && l.tp > 0) {
    const meta = l.symbol === state.symbol ? state.mintick : 0;
    const pip = (meta || state.mintick) * (state.config.pipMult || 10);
    const risk = Math.abs(l.entry - l.sl);
    return {
      dir: l.dir === -1 ? -1 : 1,
      entry: l.entry,
      sl: l.sl,
      tp: l.tp,
      risk,
      riskPips: pip > 0 ? risk / pip : 0,
      rewardPips: pip > 0 ? Math.abs(l.tp - l.entry) / pip : 0,
      entryTime: l.openedAt,
      ext: l.entry,
      levelTop: l.entry,
      levelBot: l.entry,
      trigger: l.entry,
      slModeLabel: `${l.source === "SCAN" ? "Scanner" : l.source === "SWEEP" ? "Sweep" : l.source === "TV" ? "TradingView" : "EA"} ${l.tf}`,
      traded: true,
      source: l.source,
      symbol: l.symbol,
      tf: l.tf,
    };
  }
  return t ?? null;
}

export function runPips(state: BotStateRes): number | null {
  const t = openTrade(state);
  if (!t || !state.feed.price) return null;
  // the feed price is the chart symbol's — only valid for a trade on it
  if (t.symbol && t.symbol !== state.symbol) return null;
  return ((state.feed.price - t.entry) * t.dir) / (state.mintick * state.config.pipMult);
}

export type StatusTone = "scan" | "wait" | "enterSell" | "enterBuy" | "runSell" | "runBuy";

export function statusOf(state: BotStateRes): { text: string; tone: StatusTone } {
  const t = openTrade(state);
  if (t) {
    const dirTxt = t.dir === -1 ? "SELL" : "BUY";
    if (!t.source && t.entryTime > state.engine.lastBarTime) {
      return { text: `ENTER ${dirTxt} NOW @ ${fmtPx(t.entry, state.mintick)}`, tone: t.dir === -1 ? "enterSell" : "enterBuy" };
    }
    return { text: `${t.dir === -1 ? "▼ SELL" : "▲ BUY"} RUNNING`, tone: t.dir === -1 ? "runSell" : "runBuy" };
  }
  const levels = state.engine.levels;
  const n = levels.length;
  if (n > 0) {
    const sup = levels.some((l) => l.side === 1);
    const res = levels.some((l) => l.side === -1);
    if (sup && res) return { text: "WAITING FOR C3 WICK BREAK · SUPPORT + RESISTANCE ARMED", tone: "wait" };
    return { text: `WAITING FOR C3 WICK BREAK · ${n} ARMED LEVEL${n > 1 ? "S" : ""}`, tone: "wait" };
  }
  return { text: "SCANNING FOR C1 / C2", tone: "scan" };
}

export function toneClasses(tone: StatusTone): { bg: string; fg: string } {
  switch (tone) {
    case "enterSell":
      return { bg: C.red, fg: "#FFFFFF" };
    case "enterBuy":
      return { bg: C.green, fg: "#FFFFFF" };
    case "runSell":
      return { bg: "rgba(242,54,69,0.28)", fg: "#FFD9DC" };
    case "runBuy":
      return { bg: "rgba(8,153,129,0.28)", fg: "#C8F5E8" };
    case "wait":
      return { bg: "#2A2410", fg: C.gold };
    default:
      return { bg: C.navy3, fg: C.txt };
  }
}
