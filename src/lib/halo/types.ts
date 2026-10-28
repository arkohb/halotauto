// ════════════════════════════════════════════════════════════════════════
//  HALO 3-Candle Equal Level [3EL] · shared types
//  Faithful TypeScript port of the PineScript v5 indicator by Ant · HALO Suite
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
  // ② CANDLE 3 TRIGGER
  sigMode: SignalMode; // Instant (intrabar) | Bar close
  breakATR: number; // Min break beyond the line (× ATR) (0.02)
  eqTolATR: number; // Equal-level tolerance (× ATR) (0.05)
  minWickATR: number; // Min C3 wick through the line (× ATR) (0.10)
  wickInside: boolean; // C3 wick must stay inside C1/C2 wick extreme (false)
  // ③ TRADE
  slMode: SLMode; // Fixed points | C3 wick + buffer | ATR
  slPts: number; // Fixed SL (points) (1000)
  slBufPts: number; // C3 wick buffer (points) (50)
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
  sigMode: "instant",
  breakATR: 0.02,
  eqTolATR: 0.05,
  minWickATR: 0.1,
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
  ext: number;
  levelTop: number;
  levelBot: number;
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
