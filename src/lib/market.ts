// ════════════════════════════════════════════════════════════════════════
//  MARKET DATA · multi-source candle fetcher with simulator fallback
//  Order: Binance → Bybit → OKX → Coinbase → built-in simulator
// ════════════════════════════════════════════════════════════════════════

import { Candle } from "./halo/types";
import { decimalsOf, getSymbolMeta, tfSec, type SymbolMeta } from "./market-symbols";

export { getSymbolMeta, SYMBOLS, tfSec, TIMEFRAMES, decimalsOf } from "./market-symbols";
export type { SymbolMeta, Timeframe } from "./market-symbols";

const MAX_BARS = 720;

interface CacheEntry {
  candles: Candle[];
  source: string;
  at: number;
}
const cache = new Map<string, CacheEntry>();

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

type Row = [number, string | number, string | number, string | number, string | number, string | number?];

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

async function fetchFromSources(sym: string, tf: string, limit: number): Promise<{ candles: Candle[]; source: string }> {
  // forex / metals have no crypto-exchange feed — jump straight to the
  // simulator instead of burning 4 × 7 s of dead timeouts. A real FX feed
  // (OANDA candles via the broker adapter) can be plugged in here later.
  if (getSymbolMeta(sym).group !== "CRYPTO") {
    throw new Error("no public feed for this asset class — simulator");
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

const simStore = new Map<string, SimState>();

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
const inflight = new Map<string, Promise<{ candles: Candle[]; source: string }>>();

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
    return { candles: simGet(sym, tf, want, now), source: "simulator" };
  }

  // deep requests (warm-up / backtest) demand the full window
  if (opts?.deep && (!entry || entry.candles.length < want)) {
    const r = await fullFetch(sym, tf, key, want, now);
    return { candles: r.candles.slice(-want), source: r.source };
  }

  if (
    !opts?.fresh &&
    entry &&
    entry.candles.length >= Math.min(want, 50) &&
    now - entry.at < 3500
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