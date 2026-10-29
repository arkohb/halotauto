// Client-safe helpers for the HALO 3EL Autotrader UI
import type { EngineSnapshot, HaloConfig } from "./types";

/** Voice activity of the HALO AI core — driven by the JARVIS console, mirrored onto the orb. */
export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export const C = {
  navy: "#0B1426",
  navy2: "#101C33",
  navy3: "#16233D",
  navy4: "#0F1A30",
  line: "#1C2A47",
  gold: "#D4AF37",
  goldDim: "#8A7423",
  txt: "#E8ECF4",
  muted: "#8C98AE",
  red: "#F23645",
  green: "#089981",
  gray: "#787B86",
  cyan: "#4FD8FF", // electric cyan — AI core / telemetry illumination
  ice: "#9BE8FF", // restrained ice-blue — secondary AI glow
};

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
