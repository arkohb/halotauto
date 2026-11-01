// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · order gate
//  Called by executeFire() for EVERY new order (bot · scanner · sweep ·
//  Pine) before the paper book or a broker sees it:
//    1. Signal Quality Score — grade the fire from recent candles
//    2. quality gate         — skip below the minimum score
//    3. Capital Guardian     — daily loss / trade cap / streak pause
//    4. size                 — grade multiplier × drawdown multiplier
// ════════════════════════════════════════════════════════════════════════

import type { FireEvent } from "@/lib/halo/types";
import { getKlines } from "@/lib/market";
import { tfSec } from "@/lib/market-symbols";
import { getOverlay } from "./autopilot";
import { guardianCheck, loadGuardianHistory, type GuardianStatus } from "./guardian";
import { buildQualitySeries, gradeFire, indexAt, type SignalGrade } from "./quality";
import { loadEdge } from "./settings";

export interface GateResult {
  allow: boolean;
  reason: string;
  grade: SignalGrade | null;
  sizeMult: number;
  guardian: GuardianStatus | null;
}

/** Grade a live fire from the cached feed (null when the feed has too little history). */
export async function gradeLiveFire(symbol: string, tf: string, fire: FireEvent): Promise<SignalGrade | null> {
  try {
    const { candles } = await getKlines(symbol, tf, 400);
    if (candles.length < 30) return null;
    const series = buildQualitySeries(candles, tfSec(tf) * 1000);
    let i = indexAt(series, fire.time);
    if (i < 0) i = candles.length - 1;
    return gradeFire(series, i, fire);
  } catch {
    return null;
  }
}

export async function gateOrder(symbol: string, tf: string, fire: FireEvent): Promise<GateResult> {
  const edge = await loadEdge();
  const grade = await gradeLiveFire(symbol, tf, fire);
  let size = 1;

  if (edge.quality.enabled && grade) {
    const overlay = getOverlay(symbol, tf);
    const minScore = overlay ? overlay.minScore : edge.quality.minScore;
    if (grade.score < minScore) {
      return { allow: false, reason: `Signal grade ${grade.letter} (${grade.score}) is below the minimum of ${minScore}`, grade, sizeMult: 0, guardian: null };
    }
    if (edge.quality.gradeSizing) size *= edge.quality.sizeByGrade[grade.letter] ?? 1;
  }

  let guardian: GuardianStatus | null = null;
  if (edge.guardian.enabled) {
    const v = guardianCheck(await loadGuardianHistory(), Date.now(), edge.guardian);
    guardian = v.status;
    if (!v.allow) return { allow: false, reason: `Capital Guardian: ${v.reason}`, grade, sizeMult: 0, guardian };
    size *= v.sizeMult;
  }

  return { allow: true, reason: "", grade, sizeMult: Math.max(0.01, size), guardian };
}
