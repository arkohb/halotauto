// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · Capital Guardian
//  Checks EVERY new order (bot · scanner · sweep · Pine) inside
//  executeFire(), before anything reaches the paper book or a broker:
//    • daily loss limit   — today's closed result ≤ −N R → no new orders
//    • daily trade cap    — N orders opened today → no new orders
//    • losing-streak pause — N losses in a row → pause for M minutes
//    • drawdown size cuts — R drawdown from the equity peak scales size down
//  Everything is measured in R (result ÷ initial risk × size multiplier) so
//  the rules mean the same thing on gold, FX and crypto.
//  The same pure check runs inside the EDGE backtest, so the comparison
//  shows exactly what the Guardian would have done.
//  Monte Carlo risk-of-ruin: bootstraps the user's own closed-trade R
//  results into thousands of alternative orderings.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import type { GuardianSettings } from "./settings";

export interface GuardianTrade {
  openedAt: number;
  closedAt: number | null; // null = still open
  r: number | null; // signed R (null while open)
}

export interface GuardianStatus {
  todayR: number;
  todayTrades: number;
  streak: number; // current consecutive losses
  pauseUntil: number | null;
  equityR: number;
  peakR: number;
  ddR: number;
  sizeMult: number;
}

export interface GuardianVerdict {
  allow: boolean;
  reason: string; // empty when allowed
  sizeMult: number;
  status: GuardianStatus;
}

export function utcDayStart(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Pure Guardian check over a chronological trade history (oldest → newest). */
export function guardianCheck(history: GuardianTrade[], now: number, s: GuardianSettings): GuardianVerdict {
  const day0 = utcDayStart(now);
  let todayR = 0;
  let todayTrades = 0;
  let equity = 0;
  let peak = 0;
  let streak = 0;
  let lastLossAt = 0;
  const closed = history.filter((t) => t.closedAt !== null && t.r !== null).sort((a, b) => a.closedAt! - b.closedAt!);
  for (const t of closed) {
    equity += t.r!;
    peak = Math.max(peak, equity);
    if (t.r! < 0) {
      streak += 1;
      lastLossAt = t.closedAt!;
    } else if (t.r! > 0) streak = 0;
    if (t.closedAt! >= day0) todayR += t.r!;
  }
  for (const t of history) if (t.openedAt >= day0) todayTrades += 1;
  const dd = peak - equity;

  let sizeMult = 1;
  if (s.enabled) {
    if (s.ddCut2R > 0 && dd >= s.ddCut2R) sizeMult = s.ddCut2Mult;
    else if (s.ddCut1R > 0 && dd >= s.ddCut1R) sizeMult = s.ddCut1Mult;
  }
  const pauseUntil = s.enabled && s.streakLosses > 0 && streak >= s.streakLosses ? lastLossAt + s.streakPauseMin * 60_000 : null;
  const status: GuardianStatus = { todayR, todayTrades, streak, pauseUntil, equityR: equity, peakR: peak, ddR: dd, sizeMult };

  if (!s.enabled) return { allow: true, reason: "", sizeMult: 1, status };
  if (s.dailyLossR > 0 && todayR <= -s.dailyLossR) {
    return { allow: false, reason: `daily loss limit reached (${todayR.toFixed(2)}R of −${s.dailyLossR}R)`, sizeMult, status };
  }
  if (s.dailyTradeCap > 0 && todayTrades >= s.dailyTradeCap) {
    return { allow: false, reason: `daily trade cap reached (${todayTrades}/${s.dailyTradeCap})`, sizeMult, status };
  }
  if (pauseUntil !== null && now < pauseUntil) {
    const mins = Math.ceil((pauseUntil - now) / 60_000);
    return { allow: false, reason: `${streak} losses in a row — paused for another ${mins} min`, sizeMult, status };
  }
  return { allow: true, reason: "", sizeMult, status };
}

/** Signed R of a stored Trade row (null when it cannot be measured). */
export function tradeR(t: { status: string; resultPips: number | null; riskPips: number; sizeMult?: number | null }): number | null {
  if ((t.status !== "WIN" && t.status !== "LOSS") || t.resultPips === null || !(t.riskPips > 0)) return null;
  const signed = t.status === "WIN" ? Math.abs(t.resultPips) : -Math.abs(t.resultPips);
  return (signed / t.riskPips) * (t.sizeMult ?? 1);
}

/** Live trade history from the book (real orders only — no backtests, no rejects). */
export async function loadGuardianHistory(limit = 2000): Promise<GuardianTrade[]> {
  try {
    const rows = await db.trade.findMany({
      where: { mode: { not: "BACKTEST" }, status: { in: ["OPEN", "WIN", "LOSS"] } },
      orderBy: { openedAt: "desc" },
      take: limit,
      select: { openedAt: true, closedAt: true, status: true, resultPips: true, riskPips: true, sizeMult: true },
    });
    return rows.reverse().map((t) => ({
      openedAt: t.openedAt.getTime(),
      closedAt: t.closedAt ? t.closedAt.getTime() : null,
      r: tradeR(t),
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────── Monte Carlo ───────────────────────────

export interface MonteCarloResult {
  sample: number; // closed trades used
  sims: number;
  horizon: number; // trades per simulated path
  ruinR: number;
  ruinProb: number; // 0..1 — share of paths whose drawdown reached ruinR
  medianFinalR: number;
  p5FinalR: number;
  p95MaxDdR: number;
  bands: Array<{ step: number; p5: number; p25: number; p50: number; p75: number; p95: number }>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pctOf = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/** Bootstrap the R results into `sims` paths of `horizon` trades. Deterministic (seeded). */
export function monteCarlo(rs: number[], opts: { ruinR: number; sims?: number; horizon?: number; seed?: number }): MonteCarloResult | null {
  const sample = rs.filter((r) => isFinite(r));
  if (sample.length < 5) return null;
  const sims = Math.min(10_000, Math.max(100, opts.sims ?? 2000));
  const horizon = Math.min(1000, Math.max(20, opts.horizon ?? Math.max(100, sample.length)));
  const rnd = mulberry32(opts.seed ?? 0x3e1);
  const STEPS = 50;
  const stride = Math.max(1, Math.floor(horizon / STEPS));
  const checkpoints: number[][] = [];
  const finals: number[] = [];
  const maxDds: number[] = [];
  let ruined = 0;
  for (let s = 0; s < sims; s++) {
    let eq = 0;
    let peak = 0;
    let maxDd = 0;
    let row = 0;
    for (let k = 1; k <= horizon; k++) {
      eq += sample[Math.floor(rnd() * sample.length)];
      peak = Math.max(peak, eq);
      maxDd = Math.max(maxDd, peak - eq);
      if (k % stride === 0 || k === horizon) {
        (checkpoints[row] ??= []).push(eq);
        row += 1;
      }
    }
    if (maxDd >= opts.ruinR) ruined += 1;
    finals.push(eq);
    maxDds.push(maxDd);
  }
  finals.sort((a, b) => a - b);
  maxDds.sort((a, b) => a - b);
  const bands = checkpoints.map((vals, idx) => {
    const v = [...vals].sort((a, b) => a - b);
    return {
      step: Math.min(horizon, (idx + 1) * stride),
      p5: pctOf(v, 0.05),
      p25: pctOf(v, 0.25),
      p50: pctOf(v, 0.5),
      p75: pctOf(v, 0.75),
      p95: pctOf(v, 0.95),
    };
  });
  return {
    sample: sample.length,
    sims,
    horizon,
    ruinR: opts.ruinR,
    ruinProb: ruined / sims,
    medianFinalR: pctOf(finals, 0.5),
    p5FinalR: pctOf(finals, 0.05),
    p95MaxDdR: pctOf(maxDds, 0.95),
    bands: [{ step: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 }, ...bands],
  };
}
