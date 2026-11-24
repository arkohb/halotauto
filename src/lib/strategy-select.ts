// ════════════════════════════════════════════════════════════════════════
//  ACTIVE STRATEGY SELECTION · leaf module (no heavy imports)
//
//  Exactly ONE strategy trades at a time:
//    • id = null           → the built-in HALO 3EL v1.2 engine (default)
//    • id = PineStrategyId → a trader-authored Pine strategy auto-trades
//
//  The bot runtime (bot.ts) registers a probe here so the Pine auto-trade
//  loop can read enabled/pauseNew/symbol/tf WITHOUT importing bot.ts
//  (no circular imports — bot.ts → pine-bot.ts → this leaf only).
// ════════════════════════════════════════════════════════════════════════

export interface ActiveStrategySel {
  id: string | null;
  name: string; // display name
  kind: "builtin" | "pine";
}

export interface BotProbe {
  enabled: boolean;
  pauseNew: boolean;
  symbol: string;
  tf: string;
}

const g = globalThis as unknown as {
  __haloActiveStrategy?: ActiveStrategySel;
  __haloBotProbe?: () => BotProbe;
};

export const BUILTIN_STRATEGY_NAME = "HALO 3EL v1.2";

export function setActiveStrategySel(sel: ActiveStrategySel): void {
  g.__haloActiveStrategy = sel;
}

/** null id → built-in 3EL */
export function getActiveStrategySel(): ActiveStrategySel {
  return g.__haloActiveStrategy ?? { id: null, name: BUILTIN_STRATEGY_NAME, kind: "builtin" };
}

/**
 * TIMEFRAME SPLIT · the built-in HALO 3EL bot owns 30m · 1h · 2h · 4h — only
 * it trades or scans those, whether or not a Pine strategy is attached. The
 * attached Pine strategy owns every other timeframe (1m · 3m · 5m · 15m · 1d);
 * with no Pine strategy attached those timeframes do not trade.
 */
export const THREE_EL_TFS: readonly string[] = ["30m", "1h", "2h", "4h"];

/** may the built-in 3EL bot scan / trade this timeframe? */
export function threeElTradesTf(tf: string): boolean {
  return THREE_EL_TFS.includes(tf);
}

/** may the attached Pine strategy scan / trade this timeframe? */
export function pineTradesTf(tf: string): boolean {
  return pineAutoTradeActive() && !threeElTradesTf(tf);
}

/** true when a trader-authored Pine strategy is selected for auto-trading */
export function pineAutoTradeActive(): boolean {
  return !!g.__haloActiveStrategy?.id;
}

/** bot.ts registers the live runtime probe at module init */
export function registerBotProbe(probe: () => BotProbe): void {
  g.__haloBotProbe = probe;
}

/** live bot facts (enabled / pauseNew / symbol / tf); safe defaults before registration */
export function botProbe(): BotProbe {
  return g.__haloBotProbe?.() ?? { enabled: false, pauseNew: false, symbol: "", tf: "5m" };
}

// ── SCANNER BOT PROBE · tf-scanner.ts registers it (same no-cycle pattern) ──
// When a Pine strategy is attached, the Scanner Bot scans with THAT strategy
// (pine-bot.ts runs it on every tradable timeframe); this tells pine-bot
// whether the trader has the Scanner Bot started or paused.
const gs = globalThis as unknown as { __haloScannerProbe?: () => { enabled: boolean } };

export function registerScannerProbe(probe: () => { enabled: boolean }): void {
  gs.__haloScannerProbe = probe;
}

/** is the Scanner Bot started? false before tf-scanner.ts registers */
export function scannerEnabled(): boolean {
  return gs.__haloScannerProbe?.().enabled ?? false;
}
