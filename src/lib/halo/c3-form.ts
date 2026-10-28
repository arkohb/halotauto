// ════════════════════════════════════════════════════════════════════════
//  3EL · C3 FORMING TRACKER (visual only)
//  Mirrors the trigger thresholds of the live engine to show WHEN candle 3
//  is forming on a fresh level — touch (price at the line) and "through"
//  (wick broke beyond the line by breakATR × ATR).
//  ⚠ Presentation layer only. The engine itself still decides fires;
//    this module never produces orders and never mutates engine state.
// ════════════════════════════════════════════════════════════════════════

import type { Candle, HaloConfig, LevelSnapshot, Side } from "./types";

export type C3Stage = "touch" | "through";

export interface C3FormInfo {
  levelId: number;
  side: Side;
  stage: C3Stage;
}

/**
 * Check the LIVE (unconfirmed) candle against fresh levels — pure function,
 * read-only, client-safe. Returns one entry per level currently in contact.
 */
export function c3FormCheck(
  live: Candle | undefined,
  levels: LevelSnapshot[],
  atr: number | null,
  cfg: HaloConfig
): C3FormInfo[] {
  if (!live || levels.length === 0 || atr === null || !isFinite(atr) || atr <= 0) return [];
  const brk = Math.max(0, cfg.breakATR) * atr;
  const out: C3FormInfo[] = [];
  for (const L of levels) {
    if (L.side === -1) {
      // resistance: level band [bot..top] above price — C3 wicks UP into it
      if (live.high >= L.top + brk) out.push({ levelId: L.id, side: -1, stage: "through" });
      else if (live.high >= L.bot) out.push({ levelId: L.id, side: -1, stage: "touch" });
    } else {
      // support: level band [bot..top] below price — C3 wicks DOWN into it
      if (live.low <= L.bot - brk) out.push({ levelId: L.id, side: 1, stage: "through" });
      else if (live.low <= L.top) out.push({ levelId: L.id, side: 1, stage: "touch" });
    }
  }
  return out;
}

/** Highest-priority forming info: "through" beats "touch", newest level wins ties. */
export function bestC3Form(forming: C3FormInfo[]): C3FormInfo | null {
  if (forming.length === 0) return null;
  return forming.find((f) => f.stage === "through") ?? forming[forming.length - 1];
}
