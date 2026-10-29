// ════════════════════════════════════════════════════════════════════════
//  3EL · C3 FORMING TRACKER (visual only)
//  Mirrors the v1.2 entry trigger of the live engine to show WHEN candle 3
//  is working the dotted wick line of a fresh level:
//    touch  — price has reached the dotted C1/C2 wick line
//    break  — C3 broke BEYOND the wick line by breakATR × ATR
//    retest — broke AND the price has COME BACK to the dotted line
//             (instant mode fires on the very next engine tick)
//  ⚠ Presentation layer only. The engine itself decides fires; this module
//    never produces orders and never mutates engine state.
// ════════════════════════════════════════════════════════════════════════

import type { Candle, HaloConfig, LevelSnapshot, Side } from "./types";

export type C3Stage = "touch" | "break" | "retest";

export interface C3FormInfo {
  levelId: number;
  side: Side;
  stage: C3Stage;
}

/**
 * Check the LIVE (unconfirmed) candle against fresh levels — pure function,
 * read-only, client-safe. Returns one entry per level currently at the
 * dotted wick line.
 */
export function c3FormCheck(
  live: Candle | undefined,
  levels: LevelSnapshot[],
  atr: number | null,
  cfg: HaloConfig
): C3FormInfo[] {
  if (!live || levels.length === 0 || atr === null || !isFinite(atr) || atr <= 0) return [];
  const brk = Math.max(0, cfg.breakATR) * atr;
  const eqTol = Math.max(0, cfg.eqTolATR) * atr;
  const out: C3FormInfo[] = [];
  for (const L of levels) {
    if (L.side === -1) {
      // resistance: dotted line at the C1/C2 HIGH — C3 breaks UP through it
      const broke = live.high >= L.ext + brk;
      const back = live.close <= L.ext + eqTol;
      if (broke && back) out.push({ levelId: L.id, side: -1, stage: "retest" });
      else if (broke) out.push({ levelId: L.id, side: -1, stage: "break" });
      else if (live.high >= L.ext) out.push({ levelId: L.id, side: -1, stage: "touch" });
    } else {
      // support: dotted line at the C1/C2 LOW — C3 breaks DOWN through it
      const broke = live.low <= L.ext - brk;
      const back = live.close >= L.ext - eqTol;
      if (broke && back) out.push({ levelId: L.id, side: 1, stage: "retest" });
      else if (broke) out.push({ levelId: L.id, side: 1, stage: "break" });
      else if (live.low <= L.ext) out.push({ levelId: L.id, side: 1, stage: "touch" });
    }
  }
  return out;
}

/** Highest-priority forming info: "retest" > "break" > "touch", newest level wins ties. */
export function bestC3Form(forming: C3FormInfo[]): C3FormInfo | null {
  if (forming.length === 0) return null;
  return (
    forming.find((f) => f.stage === "retest") ??
    forming.find((f) => f.stage === "break") ??
    forming[forming.length - 1]
  );
}
