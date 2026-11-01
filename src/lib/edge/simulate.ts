// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · replay simulator
//  Replays the UNCHANGED live HaloEngine over confirmed history, with the
//  optional EDGE layers switched on or off:
//    • tm        — Smart Trade Manager inside the engine (BE/partial/trail)
//    • quality   — grade every fire; skip below minScore; grade sizing
//    • guardian  — Capital Guardian on every would-be order
//  A skipped fire behaves exactly like a refused live order: the engine
//  keeps its internal trade (so the level board matches live), but nothing
//  is booked. Results are reported in pips AND in R (net pips ÷ initial
//  risk × size multiplier) so settings with different stops compare fairly.
// ════════════════════════════════════════════════════════════════════════

import { HaloEngine } from "@/lib/halo/engine";
import type { Candle, HaloConfig, TradeManagerCfg } from "@/lib/halo/types";
import { guardianCheck, type GuardianTrade } from "./guardian";
import { gradeFire, type QualitySeries } from "./quality";
import type { GradeLetter, GuardianSettings, QualitySettings } from "./settings";

export interface SimOptions {
  cfg: HaloConfig;
  mintick: number;
  spreadPips?: number;
  tm?: TradeManagerCfg | null;
  quality?: Pick<QualitySettings, "minScore" | "gradeSizing" | "sizeByGrade"> | null;
  guardian?: GuardianSettings | null;
}

export interface SimTrade {
  dir: -1 | 1;
  openTime: number;
  closeTime: number | null;
  entry: number;
  riskPips: number;
  grade: number;
  letter: GradeLetter;
  sizeMult: number;
  taken: boolean;
  skipReason: string;
  pips: number | null; // net of spread, unweighted (null while open / skipped)
  r: number | null; // net R × sizeMult (null while open / skipped)
  exit: "tp" | "sl" | "managed" | "manual" | null;
}

export interface SimSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netR: number;
  netPips: number;
  profitFactor: number | null;
  expectancyR: number | null;
  maxDdR: number;
  skipped: number;
}

export interface SimResult {
  trades: SimTrade[];
  summary: SimSummary;
  curve: Array<{ t: number; r: number }>;
}

export function runSim(series: QualitySeries, opts: SimOptions): SimTrade[] {
  const engine = new HaloEngine(opts.cfg, opts.mintick);
  engine.tm = opts.tm && opts.tm.enabled ? opts.tm : null;
  const spread = Math.max(0, opts.spreadPips ?? 0);
  const out: SimTrade[] = [];
  const hist: GuardianTrade[] = [];
  let open: SimTrade | null = null;
  let openHist: GuardianTrade | null = null;
  const c = series.candles;

  for (let i = 0; i < c.length; i++) {
    const evs = engine.processBar(c[i], true);
    for (const e of evs) {
      if (e.type === "fire") {
        const g = gradeFire(series, i, e);
        let taken = true;
        let reason = "";
        let size = 1;
        if (opts.quality) {
          if (g.score < opts.quality.minScore) {
            taken = false;
            reason = `grade ${g.score} < ${opts.quality.minScore}`;
          } else if (opts.quality.gradeSizing) size *= opts.quality.sizeByGrade[g.letter] ?? 1;
        }
        if (taken && opts.guardian) {
          const v = guardianCheck(hist, e.time, opts.guardian);
          if (!v.allow) {
            taken = false;
            reason = v.reason;
          } else size *= v.sizeMult;
        }
        open = {
          dir: e.dir,
          openTime: e.time,
          closeTime: null,
          entry: e.entry,
          riskPips: e.riskPips,
          grade: g.score,
          letter: g.letter,
          sizeMult: taken ? size : 0,
          taken,
          skipReason: reason,
          pips: null,
          r: null,
          exit: null,
        };
        out.push(open);
        openHist = null;
        if (taken) {
          openHist = { openedAt: e.time, closedAt: null, r: null };
          hist.push(openHist);
        }
      } else if ((e.type === "win" || e.type === "loss") && open) {
        open.closeTime = e.time;
        open.exit = e.reason ?? (e.type === "win" ? "tp" : "sl");
        if (open.taken) {
          const raw = e.type === "win" ? e.pips : -e.pips;
          const net = raw - spread;
          open.pips = net;
          open.r = open.riskPips > 0 ? (net / open.riskPips) * open.sizeMult : 0;
          if (openHist) {
            openHist.closedAt = e.time;
            openHist.r = open.r;
          }
        }
        open = null;
        openHist = null;
      }
    }
  }
  return out;
}

/** Metrics over taken + closed trades whose OPEN time falls in [from, to). */
export function summarize(trades: SimTrade[], from = -Infinity, to = Infinity): SimResult {
  const inWin = trades.filter((t) => t.openTime >= from && t.openTime < to);
  const closed = inWin.filter((t) => t.taken && t.r !== null);
  let eq = 0;
  let peak = 0;
  let maxDd = 0;
  let gw = 0;
  let gl = 0;
  let netPips = 0;
  let wins = 0;
  const curve: Array<{ t: number; r: number }> = [];
  for (const t of closed) {
    const r = t.r!;
    eq += r;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
    netPips += (t.pips ?? 0) * t.sizeMult;
    if (r > 0) {
      gw += r;
      wins += 1;
    } else gl += -r;
    curve.push({ t: t.closeTime ?? t.openTime, r: eq });
  }
  const n = closed.length;
  return {
    trades: inWin,
    summary: {
      trades: n,
      wins,
      losses: n - wins,
      winRate: n > 0 ? (wins * 100) / n : null,
      netR: eq,
      netPips,
      profitFactor: gl > 0 ? gw / gl : gw > 0 ? 99 : null,
      expectancyR: n > 0 ? eq / n : null,
      maxDdR: maxDd,
      skipped: inWin.filter((t) => !t.taken).length,
    },
    curve: downsample(curve, 600),
  };
}

export function downsample<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  const out = pts.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/** Does a higher grade actually earn more? Per-letter stats over ALL fires (no gate). */
export function gradeTable(trades: SimTrade[]): Array<{ letter: GradeLetter; trades: number; winRate: number | null; avgR: number | null; netR: number }> {
  const letters: GradeLetter[] = ["A+", "A", "B", "C", "D"];
  return letters.map((letter) => {
    const ts = trades.filter((t) => t.letter === letter && t.taken && t.r !== null);
    const n = ts.length;
    const net = ts.reduce((s, t) => s + t.r! / (t.sizeMult || 1), 0); // unweighted R per grade
    const w = ts.filter((t) => t.r! > 0).length;
    return { letter, trades: n, winRate: n ? (w * 100) / n : null, avgR: n ? net / n : null, netR: net };
  });
}

/** Confirmed bars only (drops the live, still-forming candle). */
export function confirmedOnly(candles: Candle[], tfMs: number, now = Date.now()): Candle[] {
  return candles.filter((c) => c.time + tfMs <= now);
}
