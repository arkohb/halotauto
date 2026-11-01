// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · Signal Quality Score
//  Every 3EL fire gets a 0–100 score and a letter grade (A+ … D) built from
//  six factors, each scored 0..1 and weighted:
//    trend 25 · room to target 20 · level freshness 15 · break quality 15
//    volatility 15 · trading session 10
//  Only data known BEFORE the fire bar is used (indicators run to i−1), so
//  backtests and live grading agree and nothing looks ahead.
//  The precomputed QualitySeries makes grading O(1) per fire, which keeps
//  the 486-combination Autopilot search fast.
// ════════════════════════════════════════════════════════════════════════

import type { Candle, FireEvent } from "@/lib/halo/types";
import type { GradeLetter } from "./settings";

export interface QualityFactor {
  key: "trend" | "room" | "fresh" | "break" | "vol" | "session";
  label: string;
  weight: number;
  score: number; // 0..1
  note: string;
}

export interface SignalGrade {
  score: number; // 0..100
  letter: GradeLetter;
  factors: QualityFactor[];
}

export interface QualitySeries {
  candles: Candle[];
  ema50: number[];
  ema200: number[];
  atr: number[];
  tfMs: number;
}

const ATR_LEN = 14;
const ROOM_LOOKBACK = 60;
const VOL_LOOKBACK = 200;

export function letterOf(score: number): GradeLetter {
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

function ema(values: number[], len: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (len + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    prev = isNaN(prev) ? values[i] : values[i] * k + prev * (1 - k);
    out[i] = i >= Math.min(len, values.length) - 1 ? prev : NaN;
  }
  return out;
}

function wilderAtr(c: Candle[], len: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let a = NaN;
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    const pc = i > 0 ? c[i - 1].close : null;
    const tr = pc === null ? c[i].high - c[i].low : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - pc), Math.abs(c[i].low - pc));
    if (i < len) {
      sum += tr;
      if (i === len - 1) a = sum / len;
    } else {
      a = (a * (len - 1) + tr) / len;
    }
    out[i] = a;
  }
  return out;
}

export function buildQualitySeries(candles: Candle[], tfMs: number): QualitySeries {
  const closes = candles.map((c) => c.close);
  return { candles, ema50: ema(closes, 50), ema200: ema(closes, 200), atr: wilderAtr(candles, ATR_LEN), tfMs };
}

const lerp = (x: number, x0: number, x1: number, y0: number, y1: number): number => {
  if (x1 === x0) return y1;
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return y0 + (y1 - y0) * t;
};

/** Index of the bar with open time `t` (binary search; falls back to the last bar ≤ t). */
export function indexAt(series: QualitySeries, t: number): number {
  const c = series.candles;
  let lo = 0;
  let hi = c.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid].time <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Grade a fire that happened on bar `i` of the series. `i` may be the live
 * bar (one past the last confirmed bar) — only bars < i feed indicators.
 */
export function gradeFire(series: QualitySeries, i: number, fire: Pick<FireEvent, "dir" | "entry" | "tp" | "ext" | "time" | "levelTime">): SignalGrade {
  const c = series.candles;
  const p = Math.max(0, Math.min(i - 1, c.length - 1)); // last fully known bar
  const atr = series.atr[p];
  const a = isFinite(atr) && atr > 0 ? atr : Math.max(1e-12, Math.abs(c[p]?.high - c[p]?.low) || 1e-12);
  const dir = fire.dir;
  const factors: QualityFactor[] = [];

  // ── 1 · TREND (EMA50 vs EMA200 + EMA50 slope) ──
  {
    const e50 = series.ema50[p];
    const e200 = series.ema200[p];
    const e50Prev = series.ema50[Math.max(0, p - 10)];
    let score = 0.5;
    let note = "not enough history — neutral";
    if (isFinite(e50) && isFinite(e200)) {
      const spread = (e50 - e200) / a; // + = uptrend
      const slope = isFinite(e50Prev) ? (e50 - e50Prev) / a : 0;
      const bias = spread + slope * 0.5;
      const strength = Math.min(1, Math.abs(bias) / 2);
      if (Math.abs(bias) < 0.2) {
        score = 0.55;
        note = "flat / no clear trend";
      } else if (Math.sign(bias) === dir) {
        score = 0.65 + 0.35 * strength;
        note = `with the ${dir === 1 ? "up" : "down"}trend`;
      } else {
        score = 0.4 - 0.35 * strength;
        note = `against the ${dir === 1 ? "down" : "up"}trend`;
      }
    }
    factors.push({ key: "trend", label: "Trend", weight: 25, score, note });
  }

  // ── 2 · ROOM TO TARGET (nearest swing obstacle vs TP distance) ──
  {
    const tpDist = Math.abs(fire.tp - fire.entry);
    let obstacle: number | null = null;
    for (let k = Math.max(0, p - ROOM_LOOKBACK); k <= p; k++) {
      const lvl = dir === 1 ? c[k].high : c[k].low;
      const ahead = (lvl - fire.entry) * dir;
      if (ahead > a * 0.25) {
        const dist = ahead;
        if (obstacle === null || dist < obstacle) obstacle = dist;
      }
    }
    let score = 1;
    let note = "clear path to target";
    if (obstacle !== null && tpDist > 0) {
      score = Math.min(1, obstacle / tpDist);
      note = score >= 1 ? "nearest swing is beyond the target" : `swing ${(score * 100).toFixed(0)}% of the way to target`;
    }
    factors.push({ key: "room", label: "Room to target", weight: 20, score, note });
  }

  // ── 3 · LEVEL FRESHNESS (bars since the C1/C2 level formed) ──
  {
    let score = 0.6;
    let note = "level age unknown";
    if (fire.levelTime && series.tfMs > 0) {
      const age = Math.max(0, Math.round((fire.time - fire.levelTime) / series.tfMs));
      score = lerp(age, 3, 80, 1, 0.15);
      note = `${age} bar${age === 1 ? "" : "s"} old`;
    }
    factors.push({ key: "fresh", label: "Level freshness", weight: 15, score, note });
  }

  // ── 4 · BREAK QUALITY (C3 break depth beyond the line, × ATR) ──
  {
    const depth = Math.abs(fire.ext - fire.entry) / a;
    let score: number;
    if (depth < 0.15) score = lerp(depth, 0, 0.15, 0.3, 1);
    else if (depth <= 0.9) score = 1;
    else score = lerp(depth, 0.9, 2.5, 1, 0.15);
    const note = depth < 0.15 ? `shallow break (${depth.toFixed(2)} ATR)` : depth <= 0.9 ? `clean break (${depth.toFixed(2)} ATR)` : `over-extended break (${depth.toFixed(2)} ATR)`;
    factors.push({ key: "break", label: "Break quality", weight: 15, score, note });
  }

  // ── 5 · VOLATILITY REGIME (ATR percentile over the last 200 bars) ──
  {
    let below = 0;
    let n = 0;
    for (let k = Math.max(0, p - VOL_LOOKBACK); k <= p; k++) {
      const v = series.atr[k];
      if (!isFinite(v)) continue;
      n += 1;
      if (v <= a) below += 1;
    }
    const pct = n > 0 ? below / n : 0.5;
    let score: number;
    if (pct < 0.3) score = lerp(pct, 0, 0.3, 0.35, 1);
    else if (pct <= 0.8) score = 1;
    else score = lerp(pct, 0.8, 1, 1, 0.3);
    const note = pct < 0.3 ? "quiet market" : pct <= 0.8 ? "normal volatility" : "volatility spike";
    factors.push({ key: "vol", label: "Volatility", weight: 15, score, note: `${note} (${Math.round(pct * 100)}th pct)` });
  }

  // ── 6 · TRADING SESSION (UTC hour · weekend) ──
  {
    const d = new Date(fire.time);
    const h = d.getUTCHours();
    const dow = d.getUTCDay();
    let score: number;
    let note: string;
    if (h >= 12 && h < 16) [score, note] = [1, "London/New York overlap"];
    else if (h >= 7 && h < 12) [score, note] = [0.85, "London session"];
    else if (h >= 16 && h < 20) [score, note] = [0.75, "New York session"];
    else if (h < 7) [score, note] = [0.45, "Asian session"];
    else [score, note] = [0.35, "late / thin session"];
    if (dow === 0 || dow === 6) {
      score *= 0.5;
      note += " · weekend";
    }
    factors.push({ key: "session", label: "Session", weight: 10, score, note });
  }

  const total = factors.reduce((s, f) => s + f.weight * f.score, 0);
  const score = Math.round(Math.min(100, Math.max(0, total)));
  return { score, letter: letterOf(score), factors };
}
