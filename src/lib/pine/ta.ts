// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · ta.* — TradingView technical-analysis library
//  Every function follows TradingView's reference implementation (the
//  Pine pseudo-code in the official reference manual): EMA/RMA seeded
//  with an SMA, RSI/ATR on Wilder's RMA, WMA weighting the newest bar
//  highest, Supertrend/SAR/DMI exactly as TradingView computes them.
//  State lives per call site (and per user-function call path).
// ════════════════════════════════════════════════════════════════════════

import type { Call } from "./parser";
import { PineError, isNum, type PValue } from "./values";
import type { PineRuntime } from "./runtime";

// ── series buffers ───────────────────────────────────────────────────────
export class SB {
  h: (number | null)[] = [];
  push(v: PValue): void {
    this.h.push(isNum(v) ? v : null);
    if (this.h.length > 12000) this.h.splice(0, 6000);
  }
  /** value i bars back (0 = current) */
  get(i: number): number | null {
    const j = this.h.length - 1 - i;
    return j >= 0 ? this.h[j] : null;
  }
  /** last n values oldest-first; null when not enough history or any na */
  win(n: number): number[] | null {
    if (n <= 0 || this.h.length < n) return null;
    const out = this.h.slice(this.h.length - n);
    for (const x of out) if (x === null) return null;
    return out as number[];
  }
  /** last n values oldest-first including na (null when not enough history) */
  rawWin(n: number): (number | null)[] | null {
    if (n <= 0 || this.h.length < n) return null;
    return this.h.slice(this.h.length - n);
  }
}

/** EMA / RMA with TradingView seeding: first value = SMA(len); na source re-seeds */
class MA {
  prev: number | null = null;
  sb = new SB();
  constructor(private kind: "ema" | "rma") {}
  next(v: PValue, lenRaw: number): number | null {
    const len = Math.max(1, Math.round(lenRaw));
    this.sb.push(v);
    if (!isNum(v)) {
      this.prev = null;
      return null;
    }
    if (this.prev === null) {
      const w = this.sb.win(len);
      if (!w) return null;
      this.prev = w.reduce((a, b) => a + b, 0) / len;
      return this.prev;
    }
    const alpha = this.kind === "ema" ? 2 / (len + 1) : 1 / len;
    this.prev = alpha * v + (1 - alpha) * this.prev;
    return this.prev;
  }
}

const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);
const mean = (w: number[]) => sum(w) / w.length;
function wmaOf(w: number[]): number {
  // w oldest-first; newest bar gets the highest weight (TradingView)
  let n = 0, d = 0;
  for (let i = 0; i < w.length; i++) {
    const wt = i + 1;
    n += w[i] * wt;
    d += wt;
  }
  return n / d;
}
function stdevOf(w: number[], biased = true): number {
  const m = mean(w);
  const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (biased ? w.length : Math.max(1, w.length - 1));
  return Math.sqrt(v);
}
function len0(v: PValue): number | null {
  return isNum(v) && v > 0 ? Math.round(v) : null;
}

type St = Record<string, unknown>;
function sb(st: St, k: string): SB {
  return (st[k] ??= new SB()) as SB;
}
function ma(st: St, k: string, kind: "ema" | "rma"): MA {
  return (st[k] ??= new MA(kind)) as MA;
}

// windowed helpers usable from composite functions
function smaStep(st: St, k: string, v: PValue, n: number | null): number | null {
  const b = sb(st, k);
  b.push(v);
  if (!n) return null;
  const w = b.win(n);
  return w ? mean(w) : null;
}
function wmaStep(st: St, k: string, v: PValue, n: number | null): number | null {
  const b = sb(st, k);
  b.push(v);
  if (!n) return null;
  const w = b.win(n);
  return w ? wmaOf(w) : null;
}
function sumStep(st: St, k: string, v: PValue, n: number | null): number | null {
  const b = sb(st, k);
  b.push(v);
  if (!n) return null;
  const w = b.win(n);
  return w ? sum(w) : null;
}
function stdevStep(st: St, k: string, v: PValue, n: number | null, biased = true): number | null {
  const b = sb(st, k);
  b.push(v);
  if (!n) return null;
  const w = b.win(n);
  return w ? stdevOf(w, biased) : null;
}
function trOf(rt: PineRuntime, handleNa: boolean): number | null {
  const bar = rt.bar;
  const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), pc = rt.bClose.hist(bar, 1);
  if (!isNum(h) || !isNum(l)) return null;
  if (!isNum(pc)) return handleNa ? h - l : null;
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}
function changeStep(st: St, k: string, v: PValue, n = 1): number | null {
  const b = sb(st, k);
  b.push(v);
  const cur = b.get(0), past = b.get(n);
  return cur === null || past === null ? null : cur - past;
}

// ── signatures (named-argument binding) ──────────────────────────────────
export const TA_SIGS: Record<string, string[]> = {
  alma: ["series", "length", "offset", "sigma", "floor"],
  atr: ["length"],
  barssince: ["condition"],
  bb: ["series", "length", "mult"],
  bbw: ["series", "length", "mult"],
  cci: ["source", "length"],
  change: ["source", "length"],
  cmo: ["series", "length"],
  cog: ["source", "length"],
  correlation: ["source1", "source2", "length"],
  cross: ["source1", "source2"],
  crossover: ["source1", "source2"],
  crossunder: ["source1", "source2"],
  cum: ["source"],
  dev: ["source", "length"],
  dmi: ["diLength", "adxSmoothing"],
  ema: ["source", "length"],
  falling: ["source", "length"],
  highest: ["source", "length"],
  highestbars: ["source", "length"],
  hma: ["source", "length"],
  kc: ["series", "length", "mult", "useTrueRange"],
  kcw: ["series", "length", "mult", "useTrueRange"],
  linreg: ["source", "length", "offset"],
  lowest: ["source", "length"],
  lowestbars: ["source", "length"],
  macd: ["source", "fastlen", "slowlen", "siglen"],
  max: ["source"],
  median: ["source", "length"],
  mfi: ["series", "length"],
  min: ["source"],
  mode: ["source", "length"],
  mom: ["source", "length"],
  percentile_linear_interpolation: ["source", "length", "percentage"],
  percentile_nearest_rank: ["source", "length", "percentage"],
  percentrank: ["source", "length"],
  pivot_point_levels: ["type", "anchor", "developing"],
  pivothigh: ["source", "leftbars", "rightbars"],
  pivotlow: ["source", "leftbars", "rightbars"],
  range: ["source", "length"],
  rci: ["source", "length"],
  rising: ["source", "length"],
  rma: ["source", "length"],
  roc: ["source", "length"],
  rsi: ["source", "length"],
  sar: ["start", "inc", "max"],
  sma: ["source", "length"],
  stdev: ["source", "length", "biased"],
  stoch: ["source", "high", "low", "length"],
  supertrend: ["factor", "atrPeriod"],
  swma: ["source"],
  tr: ["handle_na"],
  tsi: ["source", "short_length", "long_length"],
  valuewhen: ["condition", "source", "occurrence"],
  variance: ["source", "length", "biased"],
  vwap: ["source", "anchor", "stdev_mult"],
  vwma: ["source", "length"],
  wma: ["source", "length"],
  wpr: ["length"],
};

export const TA_VARS = ["tr", "vwap", "obv", "accdist", "iii", "nvi", "pvi", "pvt", "wad", "wvad"];

export function bindArgs(sig: string[], pos: PValue[], named: Record<string, PValue>): PValue[] {
  const out: PValue[] = sig.map((_, i) => (i < pos.length ? pos[i] : null));
  for (let i = pos.length; i < sig.length; i++) out[i] = sig[i] in named ? named[sig[i]] : (undefined as unknown as PValue);
  return out;
}
const has = (v: PValue | undefined): boolean => v !== undefined;

// ── the ta.* dispatcher ──────────────────────────────────────────────────
export function taCall(rt: PineRuntime, name: string, posIn: PValue[], named: Record<string, PValue>, site: Call): PValue {
  const sig = TA_SIGS[name];
  if (!sig) throw new PineError(`ta.${name} is not a TradingView function.`, site.line, site.col);
  let pos = posIn;
  // overloads that drop the source argument
  if ((name === "highest" || name === "lowest" || name === "highestbars" || name === "lowestbars") && posIn.length === 1 && !("source" in named) && !("length" in named)) {
    pos = [name.startsWith("high") ? rt.bHigh.at(rt.bar) : rt.bLow.at(rt.bar), posIn[0]];
  } else if ((name === "highest" || name === "lowest" || name === "highestbars" || name === "lowestbars") && posIn.length === 0 && "length" in named && !("source" in named)) {
    pos = [name.startsWith("high") ? rt.bHigh.at(rt.bar) : rt.bLow.at(rt.bar), named.length];
  } else if ((name === "pivothigh" || name === "pivotlow") && posIn.length === 2 && !("source" in named)) {
    pos = [name === "pivothigh" ? rt.bHigh.at(rt.bar) : rt.bLow.at(rt.bar), posIn[0], posIn[1]];
  }
  const a = bindArgs(sig, pos, named);
  const st = rt.siteState<St>(site.id, () => ({}));
  const bar = rt.bar;

  switch (name) {
    case "sma": return smaStep(st, "s", a[0], len0(a[1]));
    case "ema": return ma(st, "m", "ema").next(a[0], len0(a[1]) ?? 1);
    case "rma": return ma(st, "m", "rma").next(a[0], len0(a[1]) ?? 1);
    case "wma": return wmaStep(st, "s", a[0], len0(a[1]));
    case "vwma": {
      const n = len0(a[1]);
      const v = rt.bVolume.at(bar);
      const pv = isNum(a[0]) && isNum(v) ? a[0] * v : null;
      const s1 = smaStep(st, "pv", pv, n);
      const s2 = smaStep(st, "v", v, n);
      return s1 === null || s2 === null || s2 === 0 ? null : s1 / s2;
    }
    case "hma": {
      const n = len0(a[1]);
      if (!n) return null;
      const half = Math.max(1, Math.floor(n / 2));
      const sq = Math.max(1, Math.floor(Math.sqrt(n)));
      const w1 = wmaStep(st, "h1", a[0], half);
      const w2 = wmaStep(st, "h2", a[0], n);
      const diff = w1 === null || w2 === null ? null : 2 * w1 - w2;
      return wmaStep(st, "h3", diff, sq);
    }
    case "alma": {
      const n = len0(a[1]);
      const b = sb(st, "s");
      b.push(a[0]);
      if (!n) return null;
      const w = b.win(n);
      if (!w) return null;
      const offset = isNum(a[2]) ? a[2] : 0.85;
      const sigma = isNum(a[3]) ? a[3] : 6;
      let m = offset * (n - 1);
      if (a[4] === true) m = Math.floor(m);
      const s = n / sigma;
      let norm = 0, tot = 0;
      for (let i = 0; i < n; i++) {
        const wt = Math.exp(-((i - m) ** 2) / (2 * s * s));
        norm += wt;
        tot += w[i] * wt; // w oldest-first == series[n-1-i]
      }
      return tot / norm;
    }
    case "swma": {
      const b = sb(st, "s");
      b.push(a[0]);
      const w = b.win(4);
      return w ? w[0] / 6 + (w[1] * 2) / 6 + (w[2] * 2) / 6 + w[3] / 6 : null;
    }
    case "stdev": return stdevStep(st, "s", a[0], len0(a[1]), a[2] !== false);
    case "variance": {
      const s = stdevStep(st, "s", a[0], len0(a[1]), a[2] !== false);
      return s === null ? null : s * s;
    }
    case "dev": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      const m = mean(w);
      return w.reduce((x, y) => x + Math.abs(y - m), 0) / w.length;
    }
    case "median": case "mode": case "percentile_linear_interpolation": case "percentile_nearest_rank": case "range": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      const s = [...w].sort((x, y) => x - y);
      if (name === "range") return s[s.length - 1] - s[0];
      if (name === "median") {
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      }
      if (name === "mode") {
        let best = s[0], bestN = 0, cur = s[0], cn = 0;
        for (const x of s) {
          if (x === cur) cn++;
          else { cur = x; cn = 1; }
          if (cn > bestN) { bestN = cn; best = cur; }
        }
        return best;
      }
      const pct = isNum(a[2]) ? a[2] : 50;
      if (name === "percentile_nearest_rank") {
        const rank = Math.ceil((pct / 100) * s.length);
        return s[Math.max(0, Math.min(s.length - 1, rank - 1))];
      }
      const pos2 = (pct / 100) * (s.length - 1);
      const lo = Math.floor(pos2), hi = Math.ceil(pos2);
      return s[lo] + (s[hi] - s[lo]) * (pos2 - lo);
    }
    case "percentrank": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      if (!n) return null;
      const w = b.win(n + 1);
      if (!w) return null;
      const cur = w[w.length - 1];
      let cnt = 0;
      for (let i = 0; i < w.length - 1; i++) if (w[i] <= cur) cnt++;
      return (cnt / n) * 100;
    }
    case "highest": case "lowest": case "highestbars": case "lowestbars": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      const hi = name.startsWith("high");
      let bi = w.length - 1;
      for (let i = w.length - 1; i >= 0; i--) {
        if (hi ? w[i] > w[bi] : w[i] < w[bi]) bi = i;
      }
      if (name === "highest" || name === "lowest") return w[bi];
      return -(w.length - 1 - bi);
    }
    case "change": {
      const n = isNum(a[1]) ? Math.round(a[1]) : 1;
      if (typeof a[0] === "boolean") {
        const s = sb(st, "b");
        s.push(a[0] ? 1 : 0);
        const cur = s.get(0), past = s.get(n);
        return cur === null || past === null ? false : cur !== past;
      }
      return changeStep(st, "s", a[0], n);
    }
    case "mom": return changeStep(st, "s", a[0], isNum(a[1]) ? Math.round(a[1]) : 1);
    case "roc": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]) ?? 1;
      const cur = b.get(0), past = b.get(n);
      return cur === null || past === null || past === 0 ? null : (100 * (cur - past)) / past;
    }
    case "cum": {
      const s = (st.c ??= { v: 0 }) as { v: number };
      if (isNum(a[0])) s.v += a[0];
      return s.v;
    }
    case "max": case "min": {
      const s = (st.m ??= { v: null as number | null }) as { v: number | null };
      if (isNum(a[0])) s.v = s.v === null ? a[0] : name === "max" ? Math.max(s.v, a[0]) : Math.min(s.v, a[0]);
      return s.v;
    }
    case "crossover": case "crossunder": case "cross": {
      const sa = sb(st, "a"), sbb = sb(st, "b");
      sa.push(a[0]);
      sbb.push(a[1]);
      const a0 = sa.get(0), a1 = sa.get(1), b0 = sbb.get(0), b1 = sbb.get(1);
      if (a0 === null || a1 === null || b0 === null || b1 === null) return false;
      const up = a0 > b0 && a1 <= b1;
      const dn = a0 < b0 && a1 >= b1;
      return name === "crossover" ? up : name === "crossunder" ? dn : up || dn;
    }
    case "rising": case "falling": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      if (!n) return false;
      const cur = b.get(0);
      if (cur === null) return false;
      for (let i = 1; i <= n; i++) {
        const p = b.get(i);
        if (p === null) return false;
        if (name === "rising" ? !(cur > p) : !(cur < p)) return false;
      }
      return true;
    }
    case "rsi": {
      const n = len0(a[1]) ?? 14;
      const b = sb(st, "s");
      b.push(a[0]);
      const cur = b.get(0), prev = b.get(1);
      const ch = cur === null || prev === null ? null : cur - prev;
      const up = ma(st, "u", "rma").next(ch === null ? null : Math.max(ch, 0), n);
      const dn = ma(st, "d", "rma").next(ch === null ? null : Math.max(-ch, 0), n);
      if (up === null || dn === null) return null;
      return dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn);
    }
    case "tr": return trOf(rt, a[0] === true);
    case "atr": return ma(st, "m", "rma").next(trOf(rt, true), len0(a[0]) ?? 14);
    case "macd": {
      const f = ma(st, "f", "ema").next(a[0], len0(a[1]) ?? 12);
      const s = ma(st, "s", "ema").next(a[0], len0(a[2]) ?? 26);
      const line = f === null || s === null ? null : f - s;
      const sig2 = ma(st, "g", "ema").next(line, len0(a[3]) ?? 9);
      return [line, sig2, line === null || sig2 === null ? null : line - sig2];
    }
    case "bb": {
      const n = len0(a[1]);
      const basis = smaStep(st, "m", a[0], n);
      const sd = stdevStep(st, "d", a[0], n);
      const mult = isNum(a[2]) ? a[2] : 2;
      if (basis === null || sd === null) return [null, null, null];
      return [basis, basis + mult * sd, basis - mult * sd];
    }
    case "bbw": {
      const n = len0(a[1]);
      const basis = smaStep(st, "m", a[0], n);
      const sd = stdevStep(st, "d", a[0], n);
      const mult = isNum(a[2]) ? a[2] : 2;
      if (basis === null || sd === null || basis === 0) return null;
      return (2 * mult * sd) / basis;
    }
    case "kc": case "kcw": {
      const n = len0(a[1]) ?? 20;
      const mult = isNum(a[2]) ? a[2] : 1.5;
      const useTR = a[3] !== false;
      const basis = ma(st, "b", "ema").next(a[0], n);
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar);
      const span = useTR ? trOf(rt, false) : isNum(h) && isNum(l) ? h - l : null;
      const rng = ma(st, "r", "ema").next(span, n);
      if (basis === null || rng === null) return name === "kc" ? [null, null, null] : null;
      const up = basis + rng * mult, lo = basis - rng * mult;
      return name === "kc" ? [basis, up, lo] : basis === 0 ? null : (up - lo) / basis;
    }
    case "cci": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      const m = mean(w);
      const md = w.reduce((x, y) => x + Math.abs(y - m), 0) / w.length;
      return md === 0 ? 0 : (w[w.length - 1] - m) / (0.015 * md);
    }
    case "cmo": {
      const n = len0(a[1]);
      const mom = changeStep(st, "s", a[0], 1);
      const s1 = sumStep(st, "u", mom === null ? null : mom >= 0 ? mom : 0, n);
      const s2 = sumStep(st, "d", mom === null ? null : mom >= 0 ? 0 : -mom, n);
      return s1 === null || s2 === null || s1 + s2 === 0 ? null : (100 * (s1 - s2)) / (s1 + s2);
    }
    case "cog": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      const s = sum(w);
      let nm = 0;
      for (let i = 0; i < n!; i++) nm += w[w.length - 1 - i] * (i + 1);
      return s === 0 ? null : -nm / s;
    }
    case "correlation": {
      const s1 = sb(st, "a"), s2 = sb(st, "b");
      s1.push(a[0]);
      s2.push(a[1]);
      const n = len0(a[2]);
      const w1 = n ? s1.win(n) : null, w2 = n ? s2.win(n) : null;
      if (!w1 || !w2) return null;
      const m1 = mean(w1), m2 = mean(w2);
      let cv = 0, v1 = 0, v2 = 0;
      for (let i = 0; i < w1.length; i++) {
        cv += (w1[i] - m1) * (w2[i] - m2);
        v1 += (w1[i] - m1) ** 2;
        v2 += (w2[i] - m2) ** 2;
      }
      return v1 === 0 || v2 === 0 ? null : cv / Math.sqrt(v1 * v2);
    }
    case "dmi": {
      const diLen = len0(a[0]) ?? 14;
      const adxLen = len0(a[1]) ?? 14;
      const up = changeStep(st, "h", rt.bHigh.at(bar), 1);
      const dch = changeStep(st, "l", rt.bLow.at(bar), 1);
      const down = dch === null ? null : -dch;
      const plusDM = up === null || down === null ? null : up > down && up > 0 ? up : 0;
      const minusDM = up === null || down === null ? null : down > up && down > 0 ? down : 0;
      const trur = ma(st, "t", "rma").next(trOf(rt, false), diLen);
      const p = ma(st, "p", "rma").next(plusDM, diLen);
      const m = ma(st, "n", "rma").next(minusDM, diLen);
      const fx = (st.fx ??= { p: null as number | null, m: null as number | null }) as { p: number | null; m: number | null };
      const plus = trur && p !== null ? (100 * p) / trur : null;
      const minus = trur && m !== null ? (100 * m) / trur : null;
      if (plus !== null) fx.p = plus;
      if (minus !== null) fx.m = minus;
      const P = fx.p, M = fx.m;
      const s = P !== null && M !== null ? P + M : null;
      const adx = ma(st, "a", "rma").next(s === null || P === null || M === null ? null : Math.abs(P - M) / (s === 0 ? 1 : s), adxLen);
      return [P, M, adx === null ? null : 100 * adx];
    }
    case "linreg": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      const off = isNum(a[2]) ? a[2] : 0;
      const d = w.length;
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let i = 0; i < d; i++) { sx += i; sy += w[i]; sxy += i * w[i]; sxx += i * i; }
      const slope = (d * sxy - sx * sy) / (d * sxx - sx * sx || 1);
      const inter = (sy - slope * sx) / d;
      return inter + slope * (d - 1 - off);
    }
    case "mfi": {
      const n = len0(a[1]);
      const ch = changeStep(st, "c", a[0], 1);
      const v = rt.bVolume.at(bar);
      const src = isNum(a[0]) ? a[0] : null;
      const upper = sumStep(st, "u", ch === null || src === null || !isNum(v) ? null : v * (ch <= 0 ? 0 : src), n);
      const lower = sumStep(st, "d", ch === null || src === null || !isNum(v) ? null : v * (ch >= 0 ? 0 : src), n);
      if (upper === null || lower === null) return null;
      return lower === 0 ? 100 : 100 - 100 / (1 + upper / lower);
    }
    case "rci": {
      const b = sb(st, "s");
      b.push(a[0]);
      const n = len0(a[1]);
      const w = n ? b.win(n) : null;
      if (!w) return null;
      // rank by price (desc) vs rank by time (newest = 1)
      const idx = w.map((v, i) => ({ v, t: w.length - i }));
      const byPrice = [...idx].sort((x, y) => y.v - x.v);
      const rankP = new Map<number, number>();
      byPrice.forEach((x, i) => rankP.set(x.t, i + 1));
      let d2 = 0;
      for (const x of idx) d2 += (x.t - rankP.get(x.t)!) ** 2;
      return (1 - (6 * d2) / (n! * (n! * n! - 1))) * 100;
    }
    case "stoch": {
      const n = len0(a[3]);
      const hh = sb(st, "h"), ll = sb(st, "l");
      hh.push(a[1]);
      ll.push(a[2]);
      if (!n || !isNum(a[0])) return null;
      const wh = hh.win(n), wl = ll.win(n);
      if (!wh || !wl) return null;
      const H = Math.max(...wh), L = Math.min(...wl);
      return H === L ? null : (100 * (a[0] - L)) / (H - L);
    }
    case "tsi": {
      const pc = changeStep(st, "c", a[0], 1);
      const s = len0(a[1]) ?? 13, l = len0(a[2]) ?? 25;
      const d1 = ma(st, "a2", "ema").next(ma(st, "a1", "ema").next(pc, l), s);
      const d2 = ma(st, "b2", "ema").next(ma(st, "b1", "ema").next(pc === null ? null : Math.abs(pc), l), s);
      return d1 === null || d2 === null || d2 === 0 ? null : d1 / d2;
    }
    case "wpr": {
      const n = len0(a[0]);
      const hh = sb(st, "h"), ll = sb(st, "l");
      hh.push(rt.bHigh.at(bar));
      ll.push(rt.bLow.at(bar));
      const c = rt.bClose.at(bar);
      const wh = n ? hh.win(n) : null, wl = n ? ll.win(n) : null;
      if (!wh || !wl || !isNum(c)) return null;
      const H = Math.max(...wh), L = Math.min(...wl);
      return H === L ? null : (100 * (c - H)) / (H - L);
    }
    case "supertrend": {
      const factor = isNum(a[0]) ? a[0] : 3;
      const per = len0(a[1]) ?? 10;
      const s = (st.st ??= { atr: new MA("rma"), atrPrev: null as number | null, ub: null as number | null, lb: null as number | null, sup: null as number | null }) as
        { atr: MA; atrPrev: number | null; ub: number | null; lb: number | null; sup: number | null };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), c = rt.bClose.at(bar), pc = rt.bClose.hist(bar, 1);
      const atr = s.atr.next(trOf(rt, true), per);
      if (!isNum(h) || !isNum(l) || !isNum(c) || atr === null) {
        s.atrPrev = atr;
        return [null, null];
      }
      const src = (h + l) / 2;
      let ub = src + factor * atr;
      let lb = src - factor * atr;
      const prevLb = s.lb ?? 0, prevUb = s.ub ?? 0;
      lb = lb > prevLb || (isNum(pc) && pc < prevLb) ? lb : prevLb;
      ub = ub < prevUb || (isNum(pc) && pc > prevUb) ? ub : prevUb;
      let dir: number;
      if (s.atrPrev === null) dir = 1;
      else if (s.sup === prevUb) dir = c > ub ? -1 : 1;
      else dir = c < lb ? 1 : -1;
      const sup = dir === -1 ? lb : ub;
      s.ub = ub;
      s.lb = lb;
      s.sup = sup;
      s.atrPrev = atr;
      return [sup, dir];
    }
    case "sar": {
      const start = isNum(a[0]) ? a[0] : 0.02, inc = isNum(a[1]) ? a[1] : 0.02, mx = isNum(a[2]) ? a[2] : 0.2;
      const s = (st.sar ??= { n: 0, result: null as number | null, maxMin: null as number | null, acc: null as number | null, below: false, ph: [] as number[], pl: [] as number[], pc: null as number | null }) as
        { n: number; result: number | null; maxMin: number | null; acc: number | null; below: boolean; ph: number[]; pl: number[]; pc: number | null };
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), c = rt.bClose.at(bar);
      if (!isNum(h) || !isNum(l) || !isNum(c)) return null;
      const idx = s.n++;
      const low1 = s.pl[s.pl.length - 1], low2 = s.pl[s.pl.length - 2];
      const high1 = s.ph[s.ph.length - 1], high2 = s.ph[s.ph.length - 2];
      let firstTrend = false;
      let out: number | null = null;
      if (idx === 1) {
        if (s.pc !== null && c > s.pc) { s.below = true; s.maxMin = h; s.result = low1; }
        else { s.below = false; s.maxMin = l; s.result = high1; }
        firstTrend = true;
        s.acc = start;
      }
      if (idx >= 1 && s.result !== null && s.maxMin !== null && s.acc !== null) {
        let r = s.result + s.acc * (s.maxMin - s.result);
        if (s.below) {
          if (r > l) { firstTrend = true; s.below = false; r = Math.max(h, s.maxMin); s.maxMin = l; s.acc = start; }
        } else if (r < h) { firstTrend = true; s.below = true; r = Math.min(l, s.maxMin); s.maxMin = h; s.acc = start; }
        if (!firstTrend) {
          if (s.below) { if (h > s.maxMin) { s.maxMin = h; s.acc = Math.min(s.acc + inc, mx); } }
          else if (l < s.maxMin) { s.maxMin = l; s.acc = Math.min(s.acc + inc, mx); }
        }
        if (s.below) {
          r = Math.min(r, low1);
          if (idx > 1) r = Math.min(r, low2);
        } else {
          r = Math.max(r, high1);
          if (idx > 1) r = Math.max(r, high2);
        }
        s.result = r;
        out = r;
      }
      s.ph.push(h); s.pl.push(l);
      if (s.ph.length > 3) { s.ph.shift(); s.pl.shift(); }
      s.pc = c;
      return out;
    }
    case "pivothigh": case "pivotlow": {
      const left = isNum(a[1]) ? Math.round(a[1]) : 5;
      const right = isNum(a[2]) ? Math.round(a[2]) : 5;
      const b = sb(st, "s");
      b.push(a[0]);
      const w = b.rawWin(left + right + 1);
      if (!w) return null;
      const cand = w[left];
      if (cand === null) return null;
      const isHigh = name === "pivothigh";
      for (let i = 0; i < w.length; i++) {
        if (i === left) continue;
        const x = w[i];
        if (x === null) return null;
        // TradingView: strictly beyond the right side, at least equal to the left side
        if (isHigh ? (i < left ? x > cand : x >= cand) : (i < left ? x < cand : x <= cand)) return null;
      }
      return cand;
    }
    case "valuewhen": {
      const s = (st.vw ??= { hits: [] as PValue[] }) as { hits: PValue[] };
      if (a[0] === true || (typeof a[0] === "number" && a[0] !== 0 && Number.isFinite(a[0]))) {
        s.hits.push(a[1] ?? null);
        if (s.hits.length > 5000) s.hits.shift();
      }
      const occ = Math.max(0, Math.round(isNum(a[2]) ? a[2] : 0));
      const i = s.hits.length - 1 - occ;
      return i >= 0 ? s.hits[i] : null;
    }
    case "barssince": {
      const s = (st.bs ??= { n: null as number | null }) as { n: number | null };
      s.n = s.n === null ? null : s.n + 1;
      if (a[0] === true || (typeof a[0] === "number" && a[0] !== 0 && Number.isFinite(a[0]))) s.n = 0;
      return s.n;
    }
    case "vwap": {
      const src = has(a[0]) && a[0] !== null ? a[0] : rt.bHlc3.at(bar);
      const anchorGiven = has(a[1]) && a[1] !== null;
      const s = (st.vw ??= { day: -1, pv: 0, vv: 0, pv2: 0 }) as { day: number; pv: number; vv: number; pv2: number };
      let reset: boolean;
      if (anchorGiven) reset = a[1] === true || s.day === -1;
      else {
        const t = rt.barTime();
        const day = Math.floor(t / 86400000);
        reset = day !== s.day;
        if (reset) s.day = day;
      }
      if (anchorGiven && s.day === -1) s.day = 0;
      if (reset) { s.pv = 0; s.vv = 0; s.pv2 = 0; }
      const v = rt.bVolume.at(bar);
      if (isNum(src) && isNum(v)) { s.pv += src * v; s.vv += v; s.pv2 += src * src * v; }
      const vw = s.vv > 0 ? s.pv / s.vv : null;
      if (has(a[2]) && a[2] !== null) {
        const mult = isNum(a[2]) ? a[2] : 1;
        if (vw === null) return [null, null, null];
        const sd = Math.sqrt(Math.max(0, s.pv2 / s.vv - vw * vw));
        return [vw, vw + mult * sd, vw - mult * sd];
      }
      return vw;
    }
    case "pivot_point_levels": {
      // classic floor pivots from the previous anchor period (developing=false)
      const type = typeof a[0] === "string" ? a[0] : "Traditional";
      const s = (st.pp ??= { h: null as number | null, l: null as number | null, c: null as number | null, ph: null as number | null, pl: null as number | null, pcl: null as number | null }) as
        { h: number | null; l: number | null; c: number | null; ph: number | null; pl: number | null; pcl: number | null };
      const anchor = a[1] === true;
      const h = rt.bHigh.at(bar), l = rt.bLow.at(bar), c = rt.bClose.at(bar);
      if (anchor && s.h !== null) { s.ph = s.h; s.pl = s.l; s.pcl = s.c; s.h = null; s.l = null; }
      if (isNum(h) && isNum(l) && isNum(c)) {
        s.h = s.h === null ? h : Math.max(s.h, h);
        s.l = s.l === null ? l : Math.min(s.l, l);
        s.c = c;
      }
      if (s.ph === null || s.pl === null || s.pcl === null) return Array(11).fill(null);
      const H = s.ph, L = s.pl, C = s.pcl;
      const P = (H + L + C) / 3, R = H - L;
      if (/fib/i.test(type)) return [P, P + 0.382 * R, P - 0.382 * R, P + 0.618 * R, P - 0.618 * R, P + R, P - R, null, null, null, null];
      if (/cam/i.test(type)) return [P, C + (R * 1.1) / 12, C - (R * 1.1) / 12, C + (R * 1.1) / 6, C - (R * 1.1) / 6, C + (R * 1.1) / 4, C - (R * 1.1) / 4, C + (R * 1.1) / 2, C - (R * 1.1) / 2, null, null];
      return [P, 2 * P - L, 2 * P - H, P + R, P - R, H + 2 * (P - L), L - 2 * (H - P), P * 3 + (H - 3 * L), P * 3 - (3 * H - L), P * 4 + (H - 4 * L), P * 4 - (4 * H - L)];
    }
  }
  throw new PineError(`ta.${name} is not supported yet.`, site.line, site.col);
}

/** per-bar built-in ta.* series variables (ta.tr, ta.obv, ta.vwap …) */
export function computeTaVarsImpl(rt: PineRuntime, box: (name: string) => { write: (bar: number, v: PValue) => void; hist: (bar: number, n: number) => PValue }): void {
  const bar = rt.bar;
  const h = rt.bHigh.at(bar) as number, l = rt.bLow.at(bar) as number, c = rt.bClose.at(bar) as number, v = (rt.bVolume.at(bar) as number) ?? 0;
  const pc = rt.bClose.hist(bar, 1);
  const prev = (n: string) => box(n).hist(bar, 1);
  box("ta.tr").write(bar, isNum(pc) ? Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)) : null);
  const ch = isNum(pc) ? c - pc : null;
  const obvPrev = prev("ta.obv");
  box("ta.obv").write(bar, (isNum(obvPrev) ? obvPrev : 0) + (ch === null ? 0 : Math.sign(ch) * v));
  const ad = (c === h && c === l) || h === l ? 0 : ((2 * c - l - h) / (h - l)) * v;
  const adPrev = prev("ta.accdist");
  box("ta.accdist").write(bar, (isNum(adPrev) ? adPrev : 0) + ad);
  box("ta.iii").write(bar, h === l || v === 0 ? null : (2 * c - h - l) / ((h - l) * v));
  const vPrev = rt.bVolume.hist(bar, 1);
  const roc = isNum(pc) && pc !== 0 ? (c - pc) / pc : 0;
  const nviP = prev("ta.nvi"), pviP = prev("ta.pvi");
  const nviBase = isNum(nviP) ? nviP : 1, pviBase = isNum(pviP) ? pviP : 1;
  box("ta.nvi").write(bar, isNum(vPrev) && v < vPrev ? nviBase + roc * nviBase : nviBase);
  box("ta.pvi").write(bar, isNum(vPrev) && v > vPrev ? pviBase + roc * pviBase : pviBase);
  const pvtP = prev("ta.pvt");
  box("ta.pvt").write(bar, (isNum(pvtP) ? pvtP : 0) + roc * v);
  const wadP = prev("ta.wad");
  const trh = isNum(pc) ? Math.max(h, pc) : h, trl = isNum(pc) ? Math.min(l, pc) : l;
  const wadStep = ch === null ? 0 : ch > 0 ? c - trl : ch < 0 ? c - trh : 0;
  box("ta.wad").write(bar, (isNum(wadP) ? wadP : 0) + wadStep);
  const o = rt.bOpen.at(bar) as number;
  const wvadP = prev("ta.wvad");
  box("ta.wvad").write(bar, (isNum(wvadP) ? wvadP : 0) + (h === l ? 0 : ((c - o) / (h - l)) * v));
  // session VWAP (daily anchor)
  const st = rt.siteState<{ day: number; pv: number; vv: number }>(-777, () => ({ day: -1, pv: 0, vv: 0 }));
  const day = Math.floor(rt.barTime() / 86400000);
  if (day !== st.day) { st.day = day; st.pv = 0; st.vv = 0; }
  const tp = (h + l + c) / 3;
  if (isNum(tp) && isNum(v)) { st.pv += tp * v; st.vv += v; }
  box("ta.vwap").write(bar, st.vv > 0 ? st.pv / st.vv : tp);
}
