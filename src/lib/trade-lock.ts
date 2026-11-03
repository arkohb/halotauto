// ════════════════════════════════════════════════════════════════════════
//  GLOBAL TRADE LOCK · one trade at a time across the whole app
//
//  "…if found and a trade fire, all armed levels are deleted until a
//   running trade hit TP or SL, then scanning activates."
//
//  When ANY 3EL fire actually executes (EA bot, Scanner watchlist row or
//  the ALL-PAIRS SWEEP) the lock engages:
//    • every armed level on every engine is deleted (board wiped),
//    • scanning is PAUSED everywhere except the engine that holds the
//      running trade (it keeps ticking so TP/SL are detected),
//  and when that trade hits TP or SL (or is closed manually) the lock
//  releases and scanning re-activates — announced on the event bus so the
//  bot says both moments out loud.
//
//  Participants (bot / scanner / sweep) register a clearLevels callback
//  here so this leaf module never imports the runtimes (no cycles).
// ════════════════════════════════════════════════════════════════════════

import { publishBotEvent } from "./halo/event-bus";
import { sendAlert } from "./alerts";

export type TradeLockSource = "BOT" | "SCAN" | "SWEEP" | "TV";

export interface TradeLockState {
  source: TradeLockSource;
  symbol: string;
  tf: string;
  dir: -1 | 1;
  entry: number;
  sl: number;
  tp: number;
  tradeDbId: string | null;
  openedAt: number; // ms epoch
}

interface LockParticipant {
  key: string;
  /** burn every fresh armed level on this runtime's engines; returns count cleared */
  clearLevels: (time: number) => number;
}

const g = globalThis as unknown as {
  __haloTradeLock?: TradeLockState | null;
  __haloLockParticipants?: Map<string, LockParticipant>;
};

function participants(): Map<string, LockParticipant> {
  if (!g.__haloLockParticipants) g.__haloLockParticipants = new Map();
  return g.__haloLockParticipants;
}

/** Bot / scanner / sweep register their board-wipe hook at module load. */
export function registerLockParticipant(p: LockParticipant): void {
  participants().set(p.key, p);
}

export function getTradeLock(): TradeLockState | null {
  return g.__haloTradeLock ?? null;
}

/** True while a trade is running anywhere — scanning engines must stay frozen. */
export function isTradeLocked(): boolean {
  return g.__haloTradeLock != null;
}

/**
 * True when THIS engine is allowed to keep processing bars during a lock
 * (it holds the running trade). `source`+`symbol`+`tf` identify the holder.
 */
export function isLockHolder(source: TradeLockSource, symbol: string, tf: string): boolean {
  const lock = getTradeLock();
  if (!lock) return true; // no lock → everything runs
  return lock.source === source && lock.symbol === symbol && lock.tf === tf;
}

/**
 * Engage the lock after a fire executed successfully: wipe every armed
 * level on every registered runtime and announce the pause. Low priority
 * on the event bus so it never cuts the fire announcement mid-sentence.
 */
export function engageTradeLock(state: TradeLockState): void {
  g.__haloTradeLock = state;
  const now = Date.now();
  let cleared = 0;
  for (const p of participants().values()) {
    try {
      cleared += p.clearLevels(now);
    } catch {
      // a broken participant never blocks the lock
    }
  }
  const side = state.dir === -1 ? "SELL" : "BUY";
  publishBotEvent({
    kind: "status",
    prio: "low",
    symbol: state.symbol,
    tf: state.tf,
    time: now,
    title: `SCANNING PAUSED · TRADE RUNNING · ${state.symbol} ${state.tf}`,
    spoken: `All armed levels are deleted and scanning is paused until the ${side.toLowerCase()} trade on ${state.symbol} hits take profit or stop loss. I will resume scanning the moment it closes.`,
  });
  void sendAlert({
    kind: "status",
    title: "HALO 3EL · SCANNING PAUSED — TRADE RUNNING",
    body: `${side} ${state.symbol} ${state.tf} @ ${state.entry} is running (SL ${state.sl} · TP ${state.tp}).\nAll armed levels deleted${cleared > 0 ? ` (${cleared} cleared)` : ""} — scanning stays paused until TP or SL, then re-activates automatically.`,
  });
}

/**
 * Release the lock when the running trade closed (TP / SL / manual close).
 * Only the holder's release matters; everything else is a no-op. Low
 * priority so it queues after the TP/SL announcement instead of cutting it.
 */
export function maybeReleaseLock(
  source: TradeLockSource,
  symbol: string,
  tf: string,
  result: "win" | "loss",
  pips: number
): void {
  const lock = getTradeLock();
  if (!lock) return;
  if (lock.source !== source || lock.symbol !== symbol || lock.tf !== tf) return;
  g.__haloTradeLock = null;
  // persistent execution lock: the trade closed — release it (dynamic import
  // avoids a circular module dependency)
  void import("./exec-lock").then((m) => m.releaseForTrade(lock.tradeDbId, `closed: ${result} ${pips.toFixed(1)} pips`)).catch(() => {});
  const now = Date.now();
  const how = result === "win" ? `take profit hit, plus ${pips.toFixed(1)} pips` : `stop loss hit, minus ${pips.toFixed(1)} pips`;
  publishBotEvent({
    kind: "status",
    prio: "low",
    symbol,
    tf,
    time: now,
    title: `SCANNING RESUMED · ${result === "win" ? "TP" : "SL"} · ${symbol} ${tf}`,
    spoken: `The trade on ${symbol} is closed — ${how}. Scanning all pairs on the one-hour and four-hour timeframes is back on, hunting fresh levels to arm.`,
  });
  void sendAlert({
    kind: "status",
    title: "HALO 3EL · SCANNING RESUMED",
    body: `The running trade on ${symbol} ${tf} closed (${result === "win" ? "TP" : "SL"}, ${pips.toFixed(1)} pips).\nAll-pairs scanning on the 1h–4h window re-activates — fresh C1/C2 levels will arm again.`,
  });
}

/** Wipe every registered board without engaging the lock (restart edge-cases). */
export function clearAllArmedLevels(): number {
  const now = Date.now();
  let cleared = 0;
  for (const p of participants().values()) {
    try {
      cleared += p.clearLevels(now);
    } catch {
      // ignore
    }
  }
  return cleared;
}
