// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · Adaptive Autopilot (walk-forward)
//  Per market (symbol + timeframe) it tests 486 setting combinations:
//    rrMult 3 × slATRm 3 × breakATR 3 × eqTolATR 3 × minScore 3 × manager 2
//  1. history is split by time: first 70% = in-sample, last 30% = unseen
//  2. the best combination is picked on IN-SAMPLE data only
//  3. it is then measured on the UNSEEN 30%, next to the current settings
//  A profile only goes live when, on the unseen data, it is profitable
//  (net R > 0, profit factor > 1, ≥ 5 trades) AND beats the current
//  settings. A live profile is an OVERLAY applied at runtime — the saved
//  BotConfig / strategy settings are never overwritten.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import type { HaloConfig, TradeManagerCfg } from "@/lib/halo/types";
import { getDeepHistory } from "@/lib/market-history";
import { tfSec } from "@/lib/market-symbols";
import { buildQualitySeries } from "./quality";
import { loadEdge, getEdgeSync, type EdgeSettings } from "./settings";
import { confirmedOnly, runSim, summarize, type SimSummary } from "./simulate";

export interface AutopilotParams {
  rrMult: number;
  slATRm: number;
  breakATR: number;
  eqTolATR: number;
  minScore: number;
  manager: boolean;
}

export const GRID = {
  rrMult: [1.5, 2, 3],
  slATRm: [1, 1.5, 2.5],
  breakATR: [0.02, 0.05, 0.1],
  eqTolATR: [0.05, 0.1, 0.2],
  minScore: [0, 55, 70],
  manager: [false, true],
} as const;

export function gridCombos(): AutopilotParams[] {
  const out: AutopilotParams[] = [];
  for (const rrMult of GRID.rrMult)
    for (const slATRm of GRID.slATRm)
      for (const breakATR of GRID.breakATR)
        for (const eqTolATR of GRID.eqTolATR)
          for (const minScore of GRID.minScore)
            for (const manager of GRID.manager) out.push({ rrMult, slATRm, breakATR, eqTolATR, minScore, manager });
  return out; // 3·3·3·3·3·2 = 486
}

export const IS_SPLIT = 0.7;
const MIN_IS_TRADES = 8;
const MIN_OOS_TRADES = 5;

export function overlayCfg(base: HaloConfig, p: AutopilotParams): HaloConfig {
  return { ...base, rrMult: p.rrMult, slMode: "atr", slATRm: p.slATRm, breakATR: p.breakATR, eqTolATR: p.eqTolATR };
}

export function overlayManager(edge: EdgeSettings, p: AutopilotParams): TradeManagerCfg | null {
  return p.manager ? { ...edge.manager, enabled: true } : null;
}

/** in-sample ranking: expectancy × √trades (SQN-style), profit factor must exceed 1 */
function rank(s: SimSummary): number {
  if (s.trades < MIN_IS_TRADES || (s.profitFactor ?? 0) <= 1 || s.expectancyR === null) return -Infinity;
  return s.expectancyR * Math.sqrt(s.trades);
}

// ─────────────────────────── job runtime ───────────────────────────

export interface AutopilotJob {
  running: boolean;
  symbol: string;
  tf: string;
  done: number;
  total: number;
  startedAt: number;
  finishedAt: number | null;
  error: string;
}

const gAp = globalThis as unknown as { __haloAp?: AutopilotJob; __haloApOverlays?: Map<string, AutopilotParams>; __haloApLoaded?: boolean };

export function getJob(): AutopilotJob {
  return (gAp.__haloAp ??= { running: false, symbol: "", tf: "", done: 0, total: 0, startedAt: 0, finishedAt: null, error: "" });
}

const keyOf = (symbol: string, tf: string): string => `${symbol}:${tf}`;

export async function refreshOverlays(): Promise<void> {
  try {
    const rows = await db.autopilotProfile.findMany({ where: { live: true } });
    gAp.__haloApOverlays = new Map(rows.map((r) => [r.id, JSON.parse(r.paramsJson) as AutopilotParams]));
  } catch {
    gAp.__haloApOverlays ??= new Map();
  }
  gAp.__haloApLoaded = true;
}

/** Hot-path: the live overlay for a market, or null (switch off / no passed profile). */
export function getOverlay(symbol: string, tf: string): AutopilotParams | null {
  if (!gAp.__haloApLoaded) void refreshOverlays();
  if (!getEdgeSync().autopilot.enabled) return null;
  return gAp.__haloApOverlays?.get(keyOf(symbol, tf)) ?? null;
}

export interface RunInput {
  symbol: string;
  tf: string;
  bars: number;
  baseCfg: HaloConfig;
  spreadPips: number;
}

/** Start a background walk-forward run (one at a time). */
export function startAutopilot(input: RunInput): AutopilotJob {
  const job = getJob();
  if (job.running) throw new Error(`Autopilot is already optimising ${job.symbol} ${job.tf}.`);
  Object.assign(job, { running: true, symbol: input.symbol, tf: input.tf, done: 0, total: 486, startedAt: Date.now(), finishedAt: null, error: "" });
  void runAutopilot(input)
    .catch((e) => {
      job.error = (e as Error).message;
    })
    .finally(() => {
      job.running = false;
      job.finishedAt = Date.now();
    });
  return job;
}

async function runAutopilot(input: RunInput): Promise<void> {
  const job = getJob();
  const edge = await loadEdge();
  const tfMs = tfSec(input.tf) * 1000;
  const deep = await getDeepHistory({ symbol: input.symbol, tf: input.tf, bars: input.bars, fromMs: null });
  if (deep.source === "simulator") throw new Error("Autopilot only optimises on real market history — this market has no live feed.");
  const candles = confirmedOnly(deep.candles, tfMs);
  if (candles.length < 600) throw new Error(`Not enough history (${candles.length} bars) — need at least 600.`);
  const series = buildQualitySeries(candles, tfMs);
  const split = candles[Math.floor(candles.length * IS_SPLIT)].time;
  const mintick = deep.meta.mintick;

  const combos = gridCombos();
  job.total = combos.length;
  let best: { p: AutopilotParams; is: SimSummary; score: number } | null = null;
  for (let k = 0; k < combos.length; k++) {
    const p = combos[k];
    const trades = runSim(series, {
      cfg: overlayCfg(input.baseCfg, p),
      mintick,
      spreadPips: input.spreadPips,
      tm: overlayManager(edge, p),
      quality: { minScore: p.minScore, gradeSizing: false, sizeByGrade: edge.quality.sizeByGrade },
    });
    const is = summarize(trades, -Infinity, split).summary;
    const score = rank(is);
    if (score > (best?.score ?? -Infinity)) best = { p, is, score };
    job.done = k + 1;
    if (k % 6 === 5) await new Promise((r) => setImmediate(r)); // keep the server responsive
  }

  // current settings, measured on the same unseen window
  const baseTrades = runSim(series, {
    cfg: input.baseCfg,
    mintick,
    spreadPips: input.spreadPips,
    tm: edge.manager.enabled ? edge.manager : null,
    quality: { minScore: edge.quality.minScore, gradeSizing: false, sizeByGrade: edge.quality.sizeByGrade },
  });
  const base = summarize(baseTrades, split).summary;

  let oos: SimSummary | null = null;
  let passed = false;
  let verdict: string;
  if (!best) {
    verdict = `No combination was profitable in-sample with at least ${MIN_IS_TRADES} trades — current settings kept.`;
  } else {
    oos = summarize(
      runSim(series, {
        cfg: overlayCfg(input.baseCfg, best.p),
        mintick,
        spreadPips: input.spreadPips,
        tm: overlayManager(edge, best.p),
        quality: { minScore: best.p.minScore, gradeSizing: false, sizeByGrade: edge.quality.sizeByGrade },
      }),
      split
    ).summary;
    const profitable = oos.trades >= MIN_OOS_TRADES && oos.netR > 0 && (oos.profitFactor ?? 0) > 1;
    const beats = oos.netR > base.netR;
    passed = profitable && beats;
    verdict = passed
      ? `Passed: +${oos.netR.toFixed(2)}R on unseen data vs ${base.netR >= 0 ? "+" : ""}${base.netR.toFixed(2)}R for current settings — profile is live.`
      : !profitable
        ? `Rejected: the best in-sample profile was not profitable on unseen data (${oos.trades} trades, ${oos.netR.toFixed(2)}R, PF ${(oos.profitFactor ?? 0).toFixed(2)}).`
        : `Rejected: profitable on unseen data (${oos.netR.toFixed(2)}R) but does not beat current settings (${base.netR.toFixed(2)}R).`;
  }

  const id = keyOf(input.symbol, input.tf);
  const data = {
    symbol: input.symbol,
    timeframe: input.tf,
    paramsJson: JSON.stringify(best?.p ?? null),
    inSampleJson: JSON.stringify(best?.is ?? null),
    oosJson: JSON.stringify(oos),
    baseJson: JSON.stringify(base),
    combos: combos.length,
    bars: candles.length,
    passed,
    live: passed,
    verdict,
  };
  await db.autopilotProfile.upsert({ where: { id }, create: { id, ...data }, update: data });
  await refreshOverlays();
}

export async function setProfileLive(id: string, live: boolean): Promise<void> {
  const row = await db.autopilotProfile.findUnique({ where: { id } });
  if (!row) throw new Error("Profile not found.");
  if (live && !row.passed) throw new Error("Only a profile that passed the unseen-data test can go live.");
  await db.autopilotProfile.update({ where: { id }, data: { live } });
  await refreshOverlays();
}

export async function listProfiles() {
  const rows = await db.autopilotProfile.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    tf: r.timeframe,
    params: JSON.parse(r.paramsJson) as AutopilotParams | null,
    inSample: JSON.parse(r.inSampleJson) as SimSummary | null,
    oos: JSON.parse(r.oosJson) as SimSummary | null,
    base: JSON.parse(r.baseJson) as SimSummary | null,
    combos: r.combos,
    bars: r.bars,
    passed: r.passed,
    live: r.live,
    verdict: r.verdict,
    updatedAt: r.updatedAt.getTime(),
  }));
}
