// ════════════════════════════════════════════════════════════════════════
//  MARKET DATA · multi-source candle fetcher with simulator fallback
//  FOREX/METALS/INDICES: Exness ONLY (HALO Bridge EA / Exness API); a feed
//                outage keeps serving the cached Exness bars
//  SYNTHETICS  : Deriv public feed → simulator
//  CRYPTO      : Binance → Bybit → OKX → Coinbase → built-in simulator
// ════════════════════════════════════════════════════════════════════════

import { Candle } from "./halo/types";
import { decimalsOf, getSymbolMeta, isSimOnlyGroup, simStyleOf, tfSec, YAHOO_INDEX_MAP, type SymbolMeta } from "./market-symbols";
import { brokerCandles, brokerFeedCovers } from "./exness-feed";
import { fetchDerivCandles } from "./deriv-feed";

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

async function jget(url: string, ms = 5000): Promise<unknown> {
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
  ...YAHOO_INDEX_MAP, // Deriv stock indices & energy (US30 → ^DJI, USOIL → CL=F …)
};

export function yahooTicker(sym: string): string {
  if (YAHOO_MAP[sym]) return YAHOO_MAP[sym];
  const g = getSymbolMeta(sym).group;
  return g === "CRYPTO" ? sym : `${sym}=X`;
}

// symbols a trader is looking at (chart) or the bot trades get priority on
// the broker feed (fresher EA polls)
const PRIORITY_MS = 5 * 60_000;
interface PriorityGate {
  active: number;
  queue: Array<() => void>;
  hot: Map<string, number>;
}
const gYq = globalThis as unknown as { __haloYahooGateV2?: PriorityGate };
const yGate: PriorityGate = (gYq.__haloYahooGateV2 ??= { active: 0, queue: [], hot: new Map<string, number>() });

/** symbols a trader is looking at (chart) or the bot trades jump the queue */
export function markPrioritySymbol(sym: string): void {
  yGate.hot.set(sym, Date.now());
}

async function fetchFromSources(sym: string, tf: string, limit: number): Promise<{ candles: Candle[]; source: string }> {
  // Deriv synthetic indices: no public OHLC feed exists anywhere (the prices
  // are generated inside Deriv), so serve the seeded simulator directly —
  // never touch Yahoo (it has no such tickers and would just burn requests).
  // Deriv now serves them on its public websocket (deriv-feed.ts): real
  // prices first, the seeded simulator only when Deriv is unreachable or
  // does not list the instrument.
  if (isSimOnlyGroup(getSymbolMeta(sym).group)) {
    try {
      const candles = await fetchDerivCandles(sym, tf, limit);
      if (candles.length > 0) return { candles: candles.slice(-limit), source: "deriv" };
    } catch {
      // unreachable / not listed → simulator
    }
    return { candles: simGet(sym, tf, limit, Date.now()), source: "simulator" };
  }
  // forex / metals / indices: EXNESS ONLY — candles at exactly the prices
  // your orders fill at (HALO Bridge EA / Exness cloud API). No Yahoo / OANDA
  // fallback: mixing a second feed put its differently-anchored, differently-
  // priced bars beside the broker's and the chart printed double candles.
  if (brokerFeedCovers(sym)) {
    const hot = Date.now() - (yGate.hot.get(sym) ?? 0) < PRIORITY_MS; // chart / bot symbol
    const candles = await brokerCandles(sym, tf, limit, hot);
    if (candles.length > 0) return { candles, source: "exness" };
    throw new Error("Exness feed returned no candles");
  }
  if (getSymbolMeta(sym).group !== "CRYPTO") throw new Error(`no live candle source for ${sym}`);
  const cryptoChain = async (): Promise<{ candles: Candle[]; source: string }> => {
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
  };
  // a chain of 4 exchanges × 5 s would burn 20 s on a dead network; bound the
  // whole attempt — past it the established simulator fallback takes over
  return await withDeadline(cryptoChain(), "crypto feeds");
}

// DEGRADED-EGRESS DEADLINE — healthy networks answer in well under a second,
// so this only bites when the feed is already lost.
const SOURCE_DEADLINE_MS = 7000;
function withDeadline<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: deadline ${SOURCE_DEADLINE_MS}ms`)), SOURCE_DEADLINE_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
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

  // ── Deriv synthetic flavour (pre-computed) ──────────────────────────
  // Boom indices drift down and spike up on average once every N 1-second
  // ticks; Crash mirror it; CBF does both; JUMP jumps 3×/hour; STEP walks
  // a fixed 0.1 lattice. Purely cosmetic — makes SIM charts read like the
  // real instruments without touching any trading behaviour.
  const style = simStyleOf(meta.id);
  let spikeP = 0;
  let drift = 0; // per-step compensating drift so spikes don't decay the price
  if (style.kind === "boom" || style.kind === "crash" || style.kind === "cbf") {
    // k = average seconds between spikes/drops (N ticks × 1s tick)
    spikeP = Math.min(0.5, sec / style.k);
    // real Boom/Crash spikes move 0.5–2% in a single tick; between spikes the
    // price drifts the other way so the expected move per bar is ~zero
    if (style.kind === "boom") drift = -(spikeP * meta.base * 0.012) / steps;
    else if (style.kind === "crash") drift = (spikeP * meta.base * 0.012) / steps;
  }

  for (let i = 0; i < steps; i++) {
    close = close + simStep(st, vol) + drift;
    // gentle mean reversion keeps long-lived simulator state anchored near
    // the real instrument level instead of wandering over days of uptime
    close += (meta.base - close) * 0.0005;
    if (close < meta.base * 0.2) close = meta.base * 0.2;
    high = Math.max(high, close);
    low = Math.min(low, close);
  }
  st.price = close;

  if (spikeP > 0) {
    if (st.rng() < spikeP) {
      const mag = meta.base * (0.006 + st.rng() * 0.012);
      const dir = style.kind === "boom" ? 1 : style.kind === "crash" ? -1 : st.rng() < 0.5 ? 1 : -1;
      close = Math.max(close + dir * mag, meta.base * 0.2);
      high = Math.max(high, close);
      low = Math.min(low, close);
      st.price = close;
    }
  } else if (style.kind === "jump") {
    if (st.rng() < Math.min(0.5, sec / 1200)) {
      close += (st.rng() < 0.5 ? -1 : 1) * meta.base * (0.0015 + st.rng() * 0.003);
      high = Math.max(high, close);
      low = Math.min(low, close);
      st.price = close;
    }
  } else if (style.kind === "step") {
    // Step Index moves in fixed 0.1 ticks — snap the close to the lattice
    close = Math.round(close / 0.1) * 0.1;
    st.price = close;
  }

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
    // step-style symbols must stay on their fixed lattice even while ticking
    if (simStyleOf(meta.id).kind === "step") st.price = Math.round(st.price / 0.1) * 0.1;
    last.close = st.price;
    last.high = Math.max(last.high, st.price);
    last.low = Math.min(last.low, st.price);
  }
  return st.candles.slice(-limit).map((c) => ({ ...c }));
}

// ───────────────────────── PUBLIC API ─────────────────────────

/** merge fresh bars into the cache window, keyed by the timeframe's grid slot:
 *  a bar stamped off-grid (another feed's bucket anchor, a snapshot bar) folds
 *  into its slot instead of becoming a second candle beside it */
function mergeInto(target: Candle[], fresh: Candle[], tf?: string): void {
  const sec = tf ? tfSec(tf) : 0;
  const ms = sec > 0 && sec < 86400 ? sec * 1000 : 0;
  const slot = (t: number) => (ms ? Math.floor(t / ms) * ms : t);
  const map = new Map<number, Candle>();
  for (const c of target) {
    const k = slot(c.time);
    const prev = map.get(k);
    // an existing off-grid duplicate loses to the bar that sits ON the grid
    if (!prev || c.time === k) map.set(k, { ...c, time: k });
  }
  for (const c of fresh) map.set(slot(c.time), { ...c, time: slot(c.time) });
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
        mergeInto(entry.candles, r.candles, tf);
        entry.source = r.source;
        entry.at = Date.now();
      } else {
        cache.set(key, { candles: r.candles.slice(-MAX_BARS), source: r.source, at: Date.now() });
      }
      return { candles: r.candles, source: r.source };
    } catch (e) {
      // a transient broker-feed hiccup keeps serving the REAL bars already
      // cached (never swaps them for simulated ones mid-chart)
      const prev = cache.get(key);
      if (prev && prev.source !== "simulator" && prev.candles.length > 0) {
        console.error(`[market] ${sym}:${tf} live feed failed — serving cached ${prev.source} bars:`, (e as Error).message);
        return { candles: prev.candles.slice(), source: prev.source };
      }
      // nothing real cached yet → simulator; the source stamp lets the UI warn
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

  // refresh cadence: crypto and synthetic indices tick every ~3.5s (exchange
  // feeds tolerate it, and the simulator is free); Yahoo's FX/metals/indices
  // chart API rate-limits aggressively, so refresh at most every 30s —
  // confirmed-bar engines and charts don't need faster FX ticks.
  const group = getSymbolMeta(sym).group;
  const isFx = group !== "CRYPTO" && group !== "SYNTHETICS";
  // the EA feed is our own terminal (no third-party rate limit): refresh fast
  // an explicit fresh request (the chart's poll for the ONE symbol on screen)
  // drops the FX floor to 8 s so the chart tracks the market; bulk scanner and
  // sweep paths keep the 30 s guard
  const refreshMs = entry?.source === "exness" ? 3000 : isFx ? (opts?.fresh ? 8_000 : 30_000) : 3500;
  if (
    entry &&
    entry.candles.length >= Math.min(want, 50) &&
    now - entry.at < refreshMs &&
    (!opts?.fresh || isFx)
  ) {
    return { candles: entry.candles.slice(-want), source: entry.source };
  }

  // incremental refresh from live sources — only when the cache already
  // holds a usable window; a short one (first filled by a small scanner
  // request) gets a full fetch, or a 3-bar top-up would never grow it
  if (entry && entry.candles.length >= Math.min(want, 50)) {
    try {
      const freshBars = await fetchFromSources(sym, tf, 3);
      if (freshBars.candles.length) mergeInto(entry.candles, freshBars.candles, tf);
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

/**
 * Pure deterministic simulator run for BACKTEST deep history: generates
 * `count` bars of `sym`/`tf` ending at the current grid point, seeded by the
 * symbol+tf. Used by market-history.ts for synthetic indices, which have no
 * public OHLC feed anywhere — the result is always surfaced with source
 * "simulator" so dashboards can label it honestly.
 */
export function simulateCandles(sym: string, tf: string, count: number, now: number): Candle[] {
  const meta = getSymbolMeta(sym);
  const sec = tfSec(tf);
  const n = Math.max(50, Math.min(Math.round(count), 50_000));
  const st: SimState = {
    candles: [],
    price: meta.base,
    momentum: 0,
    rng: mulberry32(hashStr(`deep:${sym}:${tf}`)),
  };
  const secMs = sec * 1000;
  let t = Math.floor(now / secMs) * secMs - n * secMs;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push(simBar(st, t, sec, meta));
    t += secMs;
  }
  return out;
}