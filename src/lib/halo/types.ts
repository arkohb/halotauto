// ════════════════════════════════════════════════════════════════════════
//  HALO 3-Candle Equal Level [3EL] · shared types
//  TypeScript port of the PineScript v5 indicator by Ant · HALO Suite
//
//  ENTRY STRATEGY (v1.2 · WICK-LINE BREAK → RETURN):
//  • The highest wick of candle 1 & 2 (resistance) / lowest wick (support)
//    is marked with a DOTTED line — LevelSnapshot.ext is that price.
//  • Candle 3 must BREAK beyond the dotted wick line, and the moment price
//    COMES BACK to the dotted line the trade fires instantly — no delay.
// ════════════════════════════════════════════════════════════════════════

export type Side = -1 | 1; // -1 = resistance (SELL) · +1 = support (BUY)
export type SignalMode = "instant" | "barclose";
export type SLMode = "points" | "wick" | "atr";

export interface Candle {
  time: number; // open time, ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HaloConfig {
  // ① FORMATION
  atrLen: number; // ATR length (14)
  bodyMinATR: number; // Min body of C1 & C2 (× ATR) (0.15)
  pairTolATR: number; // Max gap C1 close ↔ C2 open (× ATR) (0.10)
  minSepATR: number; // Too-close distance (× ATR) (1.0)
  maxLevels: number; // Max fresh levels per side (3)
  expiryBars: number; // Level expiry (bars) (150)
  focusCurrent: boolean; // EA follows the CURRENT signal PER SIDE — a new C1/C2 pair replaces older fresh levels on ITS OWN side; one armed support + one armed resistance stay live together (true)
  // ② CANDLE 3 TRIGGER — WICK-LINE BREAK → RETURN
  sigMode: SignalMode; // Instant (intrabar) | Bar close
  breakATR: number; // Min break beyond the dotted wick line (× ATR) (0.02)
  eqTolATR: number; // Return-to-line tolerance (× ATR) (0.10)
  minWickATR: number; // DEPRECATED v1.2 — kept for persisted-config compat, ignored
  wickInside: boolean; // DEPRECATED v1.2 — kept for persisted-config compat, ignored
  // ③ TRADE
  slMode: SLMode; // Fixed points | Break extreme + buffer | ATR
  slPts: number; // Fixed SL (points) (1000)
  slBufPts: number; // Break-extreme SL buffer (points) (50)
  slATRm: number; // ATR SL multiple (1.5)
  rrMult: number; // Take profit (R multiple · 3 = 1:3) (3.0)
  pipMult: number; // Points per pip (10)
}

export const DEFAULT_CONFIG: HaloConfig = {
  atrLen: 14,
  bodyMinATR: 0.15,
  pairTolATR: 0.1,
  minSepATR: 1.0,
  maxLevels: 3,
  expiryBars: 150,
  focusCurrent: true,
  sigMode: "instant",
  breakATR: 0.02,
  eqTolATR: 0.1,
  minWickATR: 0,
  wickInside: false,
  slMode: "points",
  slPts: 1000,
  slBufPts: 50,
  slATRm: 1.5,
  rrMult: 3.0,
  pipMult: 10,
};

/** A level ever created — kept for chart rendering. */
export interface LevelSnapshot {
  id: number;
  side: Side;
  top: number;
  bot: number;
  ext: number; // C1/C2 wick extreme
  c1Close: number;
  c2Open: number;
  b1Time: number; // candle 1 open time
  b2Time: number; // candle 2 open time
  b1Index: number;
  endTime: number | null; // frozen at fire/burn bar; null = still extending
  state: "fresh" | "fired" | "burned";
}

export interface TradeSnapshot {
  dir: Side;
  entry: number;
  sl: number;
  tp: number;
  risk: number;
  riskPips: number;
  rewardPips: number;
  entryTime: number;
  ext: number; // C3 break extreme at fire time (wick-mode SL anchor)
  levelTop: number;
  levelBot: number;
  trigger: number; // the dotted wick line the trade fired at (= entry)
  slModeLabel: string;
}

export interface Stats {
  wins: number;
  losses: number;
  sumTP: number;
  sumSL: number;
  burned: number;
  skipped: number;
  tooClose: number;
  lastResult: { text: string; kind: "win" | "loss" | "none" };
}

export type LogKind = "fire" | "win" | "loss";
export interface LogEntry {
  time: number;
  kind: LogKind;
  dir: Side;
  pips: number; // pips at close for win/loss
  entry: number;
}

export interface FireEvent {
  type: "fire";
  dir: Side;
  entry: number;
  sl: number;
  tp: number;
  risk: number;
  riskPips: number;
  rewardPips: number;
  levelTop: number;
  levelBot: number;
  ext: number;
  time: number;
  message: string;
}

export interface CloseEvent {
  type: "win" | "loss";
  pips: number;
  entry: number;
  sl: number;
  tp: number;
  time: number;
  message: string;
}

export type EngineEvent =
  | FireEvent
  | CloseEvent
  | { type: "burned" }
  | { type: "skipped" }
  | { type: "expired"; id: number }
  | { type: "level"; id: number; side: Side };

export interface EngineSnapshot {
  barIndex: number;
  lastBarTime: number;
  atr: number | null;
  levels: LevelSnapshot[]; // fresh levels only
  drawings: LevelSnapshot[]; // all recent levels for chart rendering
  log: LogEntry[];
  trade: TradeSnapshot | null;
  stats: Stats;
}
