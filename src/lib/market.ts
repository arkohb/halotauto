// ════════════════════════════════════════════════════════════════════════
//  MARKET DATA · multi-source candle fetcher with simulator fallback
//  FOREX/METALS: Yahoo Finance chart API (real OHLC) → simulator fallback
//  CRYPTO      : Binance → Bybit → OKX → Coinbase → built-in simulator
// ════════════════════════════════════════════════════════════════════════

import { Candle } from "./halo/types";
import { decimalsOf, getSymbolMeta, tfSec, type SymbolMeta } from "./market-symbols";

export { getSymbolMeta, SYMBOLS, tfSec, TIMEFRAMES, decimalsOf } from "./market-symbols";
export type { SymbolMeta, Timeframe } from "./market-symbols";

const MAX_BARS = 2000;

interface CacheEntry {
  candles: Candle[];
  source: string;
  at: number;
}
// Cache, simulator state and in-flight dedup MUST live on globalThis:
// Next.js dev bundles each route separately, so module-scope Maps would be
// per-route copies (bot route sees "simulator" while the chart route sees
// "yahoo"). globalThis gives every bundle one shared feed cache.
const gStore = globalThis as unknown as {
  __haloCandleCache?: Map<string, CacheEntry>;
};
const cache = (gStore.__haloCandleCache ??= new Map<string, CacheEntry>());

async function jget(url: string, ms = 7000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

type Row = [number, string | number, string | number, string | number, string | number, (string | number)?];

function toCandles(rows: Row[], order: "asc" | "desc"): Candle[] {
  const out = rows.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5] ?? 0),
  }));
  const ok = out.filter((c) => isFinite(c.time) && isFinite(c.close) && c.high >= c.low && c.close > 0);
  return order === "desc" ? ok.reverse() : ok;
}

async function fBinance(sym: string, tf: string, limit: number): Promise<Candle[]> {
  const d = (await jget(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=${limit}`)) as Row[];
  return toCandles(d, "asc");
}

async function fBybit(sym: string, tf: string, limit: number): Promise<Candle[]> {
  const iv = tf === "1d" ? "D" : String(parseInt(tf, 10));
  const d = (await jget(
    `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${iv}&limit=${limit}`
  )) as { result?: { list?: Row[] } };
  return toCandles(d?.result?.list ?? [], "desc");
}

const OKX_TF: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "2h": "2H",
  "4h": "4H",
  "1d": "1D",
};

async function fOKX(sym: string, tf: string, limit: number): Promise<Candle[]> {
  const inst = sym.replace("USDT", "-USDT");
  const d = (await jget(
    `https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=${OKX_TF[tf] ?? "5m"}&limit=${Math.min(limit, 300)}`
  )) as { data?: Row[] };
  return toCandles(d?.data ?? [], "desc");
}

const CB_TF: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400 };

async function fCoinbase(sym: string, tf: string, limit: number): Promise<Candle[]> {
  const gran = CB_TF[tf];
  if (!gran) throw new Error("tf unsupported");
  const prod = sym.replace("USDT", "-USD");
  const d = (await jget(`https://api.exchange.coinbase.com/products/${prod}/candles?granularity=${gran}`)) as Row[];
  return toCandles(d, "desc").slice(-limit);
}

// ─────────────── YAHOO FINANCE · real forex & metals OHLC ───────────────

/** internal symbol → Yahoo ticker (spot FX pairs + COMEX/NYMEX metals futures) */
const YAHOO_MAP: Record<string, string> = {
  XAUUSD: "GC=F", // gold
  XAGUSD: "SI=F", // silver
  XPTUSD: "PL=F", // platinum
  XPDUSD: "PA=F", // palladium
  XCUUSD: "HG=F", // copper
};

function yahooTicker(sym: string): string {
  if (YAHOO_MAP[sym]) return YAHOO_MAP[sym];
  const g = getSymbolMeta(sym).group;
  return g === "CRYPTO" ? sym : `${sym}=X`;
}

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

/** aggregate n consecutive base bars into one (3m→1m×3, 2h→30m×4, 4h→1h×4) */
function aggregate(src: Candle[], mult: number): Candle[] {
  if (mult <= 1) return src;
  const out: Candle[] = [];
  for (let i = 0; i + mult <= src.length; i += mult) {
    const chunk = src.slice(i, i + mult);
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((a, c) => a + (c.volume || 0), 0),
    });
  }
  return out;
}

async function fYahoo(sym: string, tf: string, limit: number): Promise<{ candles: Candle[]; source: string }> {
  const ticker = yahooTicker(sym);
  // (interval, range, aggregate-mult) — Yahoo has no native 3m/2h/4h FX bars
  const plan: Record<string, [string, string, number]> = {
    "1m": ["1m", "5d", 1],
    "3m": ["1m", "5d", 3],
    "5m": ["5m", "1mo", 1],
    "15m": ["15m", "1mo", 1],
    "30m": ["30m", "1mo", 1],
    "1h": ["1h", "3mo", 1],
    "2h": ["30m", "1mo", 4],
    "4h": ["1h", "1y", 4],
    "1d": ["1d", "2y", 1],
  };
  const [iv, range, mult] = plan[tf] ?? ["5m", "1mo", 1];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${iv}&range=${range}&includePrePost=false`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!r.ok) throw new Error(`yahoo HTTP ${r.status}`);
    const j = (await r.json()) as YahooChart;
    const res = j.chart?.result?.[0];
    const q = res?.indicators?.quote?.[0];
    const ts = res?.timestamp;
    if (!res || !q || !ts || !ts.length) throw new Error(j.chart?.error?.description ?? "yahoo empty");
    const rows: Row[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i];
      const h = q.high?.[i];
      const l = q.low?.[i];
      const c = q.close?.[i];
      if (o == null || h == null || l == null || c == null) continue; // skip null slots
      rows.push([ts[i] * 1000, o, h, l, c, q.volume?.[i] ?? 0]);
    }
    const base = toCandles(rows, "asc");
    // Yahoo appends a "last trade snapshot" bar stamped at the CURRENT MINUTE
    // (not aligned to the interval grid) to intraday series. Merging it by
    // exact timestamp would append a new degenerate flat bar on every 30s
    // poll, poisoning the cache (1h windows filling with 1m flat bars).
    // Keep only bars that sit on the interval grid (skip daily — exchange
    // sessions stamp those off-grid legitimately).
    const IV_MS: Record<string, number> = { "1m": 60e3, "5m": 300e3, "15m": 900e3, "30m": 1800e3, "1h": 3600e3 };
    const stepMs = IV_MS[iv];
    const clean = stepMs ? base.filter((c) => c.time % stepMs === 0) : base;
    if (clean.length < 10) throw new Error("yahoo too few bars");
    return { candles: aggregate(clean, mult).slice(-limit), source: "yahoo" };
  } finally {
    clearTimeout(t);
  }
}

async function fetchFromSources(sym: string, tf: string, limit: number): Promise<{ candles: Candle[]; source: string }> {
  // forex / metals: real OHLC from Yahoo Finance's chart API (majors, crosses,
  // XAU/XAG/XPT/XPD + copper) — falls through to the simulator when blocked.
  if (getSymbolMeta(sym).group !== "CRYPTO") {
    return await fYahoo(sym, tf, limit);
  }
  const sources: Array<[string, () => Promise<Candle[]>]> = [
    ["binance", () => fBinance(sym, tf, limit)],
    ["bybit", () => fBybit(sym, tf, limit)],
    ["okx", () => fOKX(sym, tf, limit)],
    ["coinbase", () => fCoinbase(sym, tf, limit)],
  ];
  let lastErr: unknown = null;
  for (const [name, fn] of sources) {
    try {
      const candles = await fn();
      if (candles.length > 0) return { candles, source: name };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("no source reachable");
}

// ───────────────────────── SIMULATOR ─────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimState {
  candles: Candle[];
  price: number;
  momentum: number;
  rng: () => number;
}

const gSim = globalThis as unknown as { __haloSimStore?: Map<string, SimState> };
const simStore = (gSim.__haloSimStore ??= new Map<string, SimState>());

function simStep(st: SimState, vol: number): number {
  st.momentum = st.momentum * 0.82 + (st.rng() - 0.5) * vol * 0.55;
  return st.momentum + (st.rng() - 0.5) * vol;
}

function simBar(st: SimState, time: number, sec: number, meta: SymbolMeta): Candle {
  const vol = meta.base * 0.0009 * Math.sqrt(sec / 300);
  const open = st.price;
  let high = open;
  let low = open;
  let close = open;
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    close = close + simStep(st, vol);
    if (close < meta.base * 0.2) close = meta.base * 0.2;
    high = Math.max(high, close);
    low = Math.min(low, close);
  }
  st.price = close;
  return { time, open, high, low, close, volume: 0 };
}

function simGet(sym: string, tf: string, limit: number, now: number): Candle[] {
  const key = `${sym}:${tf}`;
  const meta = getSymbolMeta(sym);
  const sec = tfSec(tf);
  const secMs = sec * 1000;
  let st = simStore.get(key);
  if (!st) {
    st = { candles: [], price: meta.base, momentum: 0, rng: mulberry32(hashStr(key)) };
    let t = Math.floor(now / secMs) * secMs - 520 * secMs;
    for (let i = 0; i < 520; i++) {
      st.candles.push(simBar(st, t, sec, meta));
      t += secMs;
    }
    simStore.set(key, st);
  }
  const openOfNow = Math.floor(now / secMs) * secMs;
  let last = st.candles[st.candles.length - 1];
  if (last && last.time < openOfNow) {
    let t = last.time + secMs;
    while (t <= openOfNow) {
      st.candles.push(simBar(st, t, sec, meta));
      t += secMs;
    }
    if (st.candles.length > 800) st.candles.splice(0, st.candles.length - 800);
  }
  // live tick mutation on the current candle
  last = st.candles[st.candles.length - 1];
  if (last) {
    const vol = meta.base * 0.0005;
    const move = simStep(st, vol);
    st.price = Math.max(st.price + move, meta.base * 0.2);
    last.close = st.price;
    last.high = Math.max(last.high, st.price);
    last.low = Math.min(last.low, st.price);
  }
  return st.candles.slice(-limit).map((c) => ({ ...c }));
}

// ───────────────────────── PUBLIC API ─────────────────────────

function mergeInto(target: Candle[], fresh: Candle[]): void {
  const map = new Map<number, Candle>();
  for (const c of target) map.set(c.time, c);
  for (const c of fresh) map.set(c.time, c);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  target.length = 0;
  for (const c of merged.slice(-MAX_BARS)) target.push(c);
}

export interface KlineResult {
  candles: Candle[];
  source: string;
  stale?: boolean;
}

// in-flight full-fetch dedup so a small request (e.g. bot tick limit=4)
// can never race a large warm-up/chart request and shrink the cache
const gInf = globalThis as unknown as {
  __haloInflight?: Map<string, Promise<{ candles: Candle[]; source: string }>>;
};
const inflight = (gInf.__haloInflight ??= new Map<string, Promise<{ candles: Candle[]; source: string }>>());

async function fullFetch(sym: string, tf: string, key: string, want: number, now: number) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const r = await fetchFromSources(sym, tf, want);
      const entry = cache.get(key);
      if (entry && entry.source !== "simulator") {
        mergeInto(entry.candles, r.candles);
        entry.source = r.source;
        entry.at = Date.now();
      } else {
        cache.set(key, { candles: r.candles.slice(-MAX_BARS), source: r.source, at: Date.now() });
      }
      return { candles: r.candles, source: r.source };
    } catch (e) {
      // fall back to simulator; mark the feed so the UI can warn
      console.error(`[market] ${sym}:${tf} live feed failed — simulator fallback:`, (e as Error).message);
      const sim = simGet(sym, tf, want, Date.now());
      cache.set(key, { candles: sim.slice(), source: "simulator", at: Date.now() });
      return { candles: sim, source: "simulator" };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  void now;
  return p;
}

export async function getKlines(
  sym: string,
  tf: string,
  limit: number,
  opts?: { fresh?: boolean; deep?: boolean }
): Promise<KlineResult> {
  const want = Math.max(10, Math.min(limit, MAX_BARS));
  const key = `${sym}:${tf}`;
  const now = Date.now();
  const entry = cache.get(key);

  if (entry && entry.source === "simulator") {
    // a transient outage must never pin the feed to the simulator forever —
    // retry the live sources at most once a minute
    if (now - entry.at > 60_000) {
      try {
        const r = await fetchFromSources(sym, tf, want);
        cache.set(key, { candles: r.candles.slice(-MAX_BARS), source: r.source, at: now });
        return { candles: r.candles.slice(-want), source: r.source };
      } catch (e) {
        console.error(`[market] ${sym}:${tf} simulator-retry failed:`, (e as Error).message);
        entry.at = now; // back off another minute
      }
    }
    return { candles: simGet(sym, tf, want, now), source: "simulator" };
  }

  // deep requests (warm-up / backtest) demand the full window
  if (opts?.deep && (!entry || entry.candles.length < want)) {
    const r = await fullFetch(sym, tf, key, want, now);
    return { candles: r.candles.slice(-want), source: r.source };
  }

  // refresh cadence: crypto ticks every ~3.5s (exchange feeds tolerate it);
  // Yahoo's FX/metals chart API rate-limits aggressively, so refresh at most
  // every 30s — confirmed-bar engines and charts don't need faster FX ticks.
  const isFx = getSymbolMeta(sym).group !== "CRYPTO";
  const refreshMs = isFx ? 30_000 : 3500;
  if (
    entry &&
    entry.candles.length >= Math.min(want, 50) &&
    now - entry.at < refreshMs &&
    (!opts?.fresh || isFx)
  ) {
    return { candles: entry.candles.slice(-want), source: entry.source };
  }

  // incremental refresh from live sources
  if (entry && entry.candles.length > 0) {
    try {
      const freshBars = await fetchFromSources(sym, tf, 3);
      if (freshBars.candles.length) mergeInto(entry.candles, freshBars.candles);
      entry.source = freshBars.source;
      entry.at = now;
      return { candles: entry.candles.slice(-want), source: freshBars.source };
    } catch {
      entry.at = now;
      return { candles: entry.candles.slice(-want), source: entry.source, stale: true };
    }
  }

  // full fetch (deduped per symbol:tf)
  const r = await fullFetch(sym, tf, key, want, now);
  return { candles: r.candles.slice(-want), source: r.source };
}

export function fmtPrice(px: number, mintick: number): string {
  return px.toFixed(decimalsOf(mintick));
}