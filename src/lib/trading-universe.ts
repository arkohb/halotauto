// ════════════════════════════════════════════════════════════════════════
//  TRADING UNIVERSE · which instruments HALO may scan and trade
//
//  For now the EA focuses on GOLD only (XAUUSD). Every scanner (Scanner Bot,
//  all-pairs sweep, Market Scanner watchlist) scans only these symbols, and
//  executeFire() refuses an order on anything else — the backstop for the
//  chart bot, Pine strategies and the TradingView webhook.
//
//  To trade more pairs later, set HALO_TRADING_SYMBOLS (comma-separated
//  internal ids, e.g. "XAUUSD,EURUSD,V75") or edit DEFAULT_TRADING_SYMBOLS.
//  The chart can still VIEW any market; only trading is restricted.
// ════════════════════════════════════════════════════════════════════════

import { SYMBOLS } from "./market-symbols";

const DEFAULT_TRADING_SYMBOLS = ["XAUUSD"];

function load(): string[] {
  const raw = (process.env.HALO_TRADING_SYMBOLS ?? "").trim();
  const wanted = raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : DEFAULT_TRADING_SYMBOLS;
  const known = new Set(SYMBOLS.map((s) => s.id));
  const list = wanted.filter((s) => known.has(s));
  return list.length > 0 ? list : DEFAULT_TRADING_SYMBOLS;
}

export const TRADING_SYMBOLS: readonly string[] = load();

const SET = new Set(TRADING_SYMBOLS);

/** may HALO scan / open trades on this symbol? */
export function isTradableSymbol(symbol: string): boolean {
  return SET.has(symbol);
}

/** human label for messages, e.g. "XAUUSD" or "XAUUSD, EURUSD" */
export function tradingUniverseLabel(): string {
  return TRADING_SYMBOLS.join(", ");
}
