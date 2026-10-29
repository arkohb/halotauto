// Client-safe helpers for the HALO 3EL Autotrader UI
import type { EngineSnapshot, HaloConfig } from "./types";

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

export interface BotStateRes {
  enabled: boolean;
  autoAttach: boolean;
  symbol: string;
  tf: string;
  mintick: number;
  feed: { source: string; note: string; price: number; lastTickAt: number; realizedPips: number };
  config: HaloConfig;
  engine: EngineSnapshot;
  exec: ExecRes;
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

export function fmtPips(p: number): string {
  const s = p >= 0 ? "+" : "−";
  return `${s}${Math.abs(p).toFixed(1)}`;
}

export function runPips(state: BotStateRes): number | null {
  const t = state.engine.trade;
  if (!t || !state.feed.price) return null;
  return ((state.feed.price - t.entry) * t.dir) / (state.mintick * state.config.pipMult);
}

export type StatusTone = "scan" | "wait" | "enterSell" | "enterBuy" | "runSell" | "runBuy";

export function statusOf(state: BotStateRes): { text: string; tone: StatusTone } {
  const t = state.engine.trade;
  if (t) {
    const dirTxt = t.dir === -1 ? "SELL" : "BUY";
    if (t.entryTime > state.engine.lastBarTime) {
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
