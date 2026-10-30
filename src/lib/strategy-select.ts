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
