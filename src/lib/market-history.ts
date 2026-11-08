// ════════════════════════════════════════════════════════════════════════
//  DEEP MARKET HISTORY · unlimited-bar paginated fetcher (server-side)
//  The live feed in market.ts caps at 2000 bars for charting. The BACKTEST
//  dashboard needs "infinity": this module walks page-by-page backwards
//  through real feeds until it reaches the requested bar count, the user's
//  FROM date, or the FEED'S VERY FIRST BAR (genesis) — no artificial cap.
//
//  Sources:
//   · CRYPTO  : Binance (1k bars/page) → Bybit v5 (1k/page) → OKX (300/page)
//   · FX/METALS/STOCKS/ANY TICKER : Yahoo Finance chart API with chunked
//     period1/period2 windows (1m→30d back, 5m–30m→60d, 1h→730d, 1d→full)
//  Bar sizes a feed doesn't natively serve (M2/M10/H3/H8/D3…) are built by
//  grid-aggregating a native base interval fetched the same paginated way.
//  Demo/simulator data is NEVER produced for real instruments — if every
//  real feed fails, the call throws and the dashboard reports NO_LIVE_DATA.
//  (Exception: Deriv SYNTHETIC indices have no public feed anywhere, so they
//  get an honestly-labelled deterministic simulator run — see getDeepHistory.)
// ════════════════════════════════════════════════════════════════════════

import { fetchDerivCandles } from "./deriv-feed";
import { Candle } from "./halo/types";
import { SYMBOLS, tfSec, isBtTf, YAHOO_INDEX_MAP } from "./market-symbols";
import type { SymbolMeta, SymbolGroup } from "./market-symbols";
import { simulateCandles } from "./market";

// ───────────────────────── public surface ─────────────────────────

export interface DeepRequest {
  symbol: string;
  tf: string;
  /** max bars to return; null = ALL available history (down to feed genesis) */
  bars: number | null;
  /** optional epoch-ms floor — pagination stops once history reaches it */
  fromMs?: number | null;
}

export interface DeepResult {
  candles: Candle[]; // ascending by open time
  source: string; // binance | bybit | okx | yahoo
  /** true when the walk reached the feed's earliest bar (nothing older exists) */
  complete: boolean;
  meta: SymbolMeta;
}

// safety budgets so one request can never hammer a feed forever
const PAGE_MS_TIMEOUT = 15000;
const BUDGET_ALL_PAGES = 420; // × 1000 bars/page ≈ 420k bars max per ALL run
const ALL_MAX_BARS = 300_000; // hard memory guard for "ALL" walks
const ALL_RUN_DEADLINE_MS = 105_000; // wall-clock guard for "ALL" walks

// ───────────────────────── small helpers ─────────────────────────

type Row = [number, string | number, string | number, string | number, string | number, (string | number)?];

async function jget(url: string, ms = PAGE_MS_TIMEOUT): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function mkCandle(r: Row): Candle | null {
  const time = Number(r[0]);
  const open = Number(r[1]);
  const high = Number(r[2]);
  const low = Number(r[3]);
  const close = Number(r[4]);
  if (!isFinite(time) || !isFinite(close) || !isFinite(open) || close <= 0 || high < low) return null;
  return { time, open, high, low, close, volume: Number(r[5] ?? 0) };
}

/** sort ascending, drop duplicate timestamps, clip to `want` newest */
function finalize(rows: Candle[], want: number | null): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of rows) map.set(c.time, c);
  const out = [...map.values()].sort((a, b) => a.time - b.time);
  return want ? out.slice(-want) : out;
}

/**
 * Aggregate candles onto a larger grid of `sec` seconds, UTC-aligned.
 * Weekly buckets anchor to Monday 00:00 UTC; everything else floors to the
 * epoch grid (4h → 00/04/08… UTC, 3h → 00/03/06…, 8h → 00/08/16…).
 */
export function aggregateGrid(src: Candle[], sec: number): Candle[] {
  if (sec <= 0 || src.length === 0) return src;
  const WEEK = 604800_000;
  const bucketOf = (t: number): number => {
    if (sec === WEEK) {
      const day = Math.floor(t / 86400_000) * 86400_000;
      const dow = (new Date(day).getUTCDay() + 6) % 7; // Mon=0
      return day - dow * 86400_000;
    }
    return Math.floor(t / (sec * 1000)) * sec * 1000;
  };
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curKey = Number.NaN;
  for (const c of src) {
    const key = bucketOf(c.time);
    if (!cur || key !== curKey) {
      if (cur) out.push(cur);
      curKey = key;
      cur = { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ───────────────────────── symbol resolution ─────────────────────────

const CRYPTO_BASES = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LTC", "LINK", "DOT", "TRX", "TON",
  "NEAR", "ATOM", "ARB", "OP", "SUI", "PEPE", "SHIB", "XLM", "XMR", "BCH", "ETC", "FIL", "APT",
  "INJ", "LDO", "UNI", "AAVE", "MATIC", "POL", "SEI", "TIA", "JUP", "WIF", "BONK", "FLOKI",
  "HBAR", "VET", "ALGO", "FTM", "GRT", "SAND", "MANA", "AXS", "GALA", "CRV", "MKR", "RUNE",
]);

export type SymClass = "crypto" | "fx" | "synth" | "any";

/** Best-effort routing of an ARBITRARY user-typed symbol to the right feeds. */
export function classifySymbol(raw: string): SymClass {
  const s = raw.toUpperCase().trim();
  const known = SYMBOLS.find((k) => k.id === s);
  if (known) {
    if (known.group === "CRYPTO") return "crypto";
    if (known.group === "SYNTHETICS") return "synth"; // simulated feed (no public OHLC exists)
    return "fx"; // forex, metals, stock indices, energy → Yahoo
  }
  if (/^(USDT|USDC|FDUSD|TUSD|BUSD|USDP|DAI)/.test(s) && s.length > 4) return "crypto";
  if (/(USDT|USDC|FDUSD|TUSD|BUSD)$/.test(s)) return "crypto";
  const m6 = /^([A-Z]{2,10})(USD)$/.exec(s);
  if (m6) {
    const base = m6[1];
    if (base === "USDT" || base === "USDC") return "crypto";
    if (CRYPTO_BASES.has(base)) return "crypto";
    if (base.length === 3 || /^(XAU|XAG|XPT|XPD|XCU|XBR|XNG)/.test(base)) return "fx";
    return "crypto";
  }
  if (/^[A-Z]{6}$/.test(s)) return "fx"; // EURJPY, GBPCHF, AUDNZD…
  if (/(USDT|USDT$)/.test(s)) return "crypto";
  return "any"; // stocks, indices, futures, ^GSPC, AAPL, GC=F, BTC-USD…
}

const YAHOO_METAL: Record<string, string> = {
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
  XPTUSD: "PL=F",
  XPDUSD: "PA=F",
  XCUUSD: "HG=F",
  ...YAHOO_INDEX_MAP, // Deriv stock indices & energy (US30 → ^DJI, NGAS → NG=F …)
};

function yahooTickerOf(sym: string): string {
  const s = sym.toUpperCase().trim();
  if (YAHOO_METAL[s]) return YAHOO_METAL[s];
  if (/^[A-Z]{6}$/.test(s)) return `${s}=X`; // EURUSD → EURUSD=X
  const mm = /^([A-Z0-9]{2,10})(?:USDT|USD)$/.exec(s);
  if (mm && (CRYPTO_BASES.has(mm[1]) || s.endsWith("USDT"))) return `${mm[1]}-USD`; // BTCUSD → BTC-USD
  return s; // pass through: AAPL, ^GSPC, GC=F, EURUSD=X, BTC-USD…
}

/** per-feed crypto tickers: BTCUSD / BTCUSDT / BTC-USDT … */
function cryptoTickers(sym: string): { binance: string; bybit: string; okx: string } {
  const t = sym.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = t.replace(/(USDT|USDC|FDUSD|TUSD|USD)$/, "") || t;
  const quote = t.endsWith("USDC") ? "USDC" : "USDT";
  const binance = t.endsWith("USDT") || t.endsWith("USDC") || t.endsWith("FDUSD") ? t : base + quote;
  const bybit = binance;
  const okx = `${base}-${quote}`;
  return { binance, bybit, okx };
}

function inferMintick(refPx: number): number {
  const p = Math.abs(refPx);
  if (p >= 100) return 0.01;
  if (p >= 1) return 0.001;
  if (p >= 0.05) return 0.0001;
  if (p >= 0.001) return 0.00001;
  return 0.0000001;
}

/**
 * Exact metadata for the known HALO symbols; for ANY other user-typed
 * ticker, infer a sensible SymbolMeta from the fetched price itself.
 */
export function resolveAnySymbol(sym: string, refPx: number, clsHint?: SymClass): SymbolMeta {
  const s = sym.toUpperCase().trim();
  const known = SYMBOLS.find((k) => k.id === s);
  if (known) return known;
  const cls = clsHint ?? classifySymbol(s);
  const group: SymbolGroup =
    cls === "crypto" ? "CRYPTO" : cls === "synth" ? "SYNTHETICS" : YAHOO_METAL[s] ? "METALS" : "FOREX";
  const tv = cls === "crypto" ? `BINANCE:${cryptoTickers(s).binance}` : /^[A-Z]{6}$/.test(s) ? `OANDA:${s}` : s;
  return {
    id: s,
    label: s,
    mintick: inferMintick(refPx),
    base: refPx,
    group,
    tv,
  };
}

// ───────────────────────── BINANCE · paginated walk-back ─────────────────────────

const BINANCE_NATIVE = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"]);
const BYBIT_NATIVE = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"]);
const OKX_NATIVE = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"]);

/** smallest native base whose interval divides the tf (for local aggregation) */
function aggBase(native: Set<string>, tf: string): { base: string; mult: number } | null {
  const sec = tfSec(tf);
  const natives = [...native].sort((a, b) => tfSec(b) - tfSec(a));
  for (const b of natives) {
    const bs = tfSec(b);
    if (bs < sec && sec % bs === 0 && sec / bs >= 2) return { base: b, mult: sec / bs };
  }
  return null;
}

function binanceIv(tf: string): string {
  return tf; // Binance interval ids match ours for every native tf
}

function bybitIv(tf: string): string {
  if (tf === "1d") return "D";
  if (tf === "1w") return "W";
  return String(tfSec(tf) / 60);
}

function okxBar(tf: string): string {
  if (tf === "1d") return "1D";
  if (tf === "1w") return "1W";
  return tfSec(tf) >= 3600 ? `${tfSec(tf) / 3600}H` : tf;
}

interface WalkOpts {
  want: number | null;
  fromMs: number | null;
  deadline: number;
}

async function binanceDeep(
  ticker: string,
  tf: string,
  opts: WalkOpts
): Promise<{ candles: Candle[]; complete: boolean }> {
  const native = BINANCE_NATIVE.has(tf);
  const fetchTf = native ? binanceIv(tf) : (aggBase(BINANCE_NATIVE, tf)?.base ?? "5m");
  const mult = native ? 1 : (aggBase(BINANCE_NATIVE, tf)?.mult ?? 2);
  const need = opts.want ? opts.want * mult : null;

  const out: Candle[] = [];
  let end: number | null = null;
  let complete = false;
  const budget = Math.min(opts.want ? Math.ceil(need! / 1000) + 2 : BUDGET_ALL_PAGES * mult, 900);

  for (let i = 0; i < budget; i++) {
    if (Date.now() > opts.deadline) break;
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(ticker)}&interval=${fetchTf}&limit=1000` +
      (end ? `&endTime=${end}` : "");
    const rows = (await jget(url)) as Row[] | { code?: number; msg?: string };
    if (!Array.isArray(rows) || rows.length === 0) {
      complete = true;
      break;
    }
    for (const r of rows) {
      const c = mkCandle(r as Row);
      if (c) out.push(c);
    }
    end = Number((rows as Row[])[0][0]) - 1;
    const oldest = Number((rows as Row[])[0][0]);
    // FROM floor reached, or the feed simply has nothing older (genesis) —
    // either way the walk has captured every bar that exists
    if ((opts.fromMs && oldest <= opts.fromMs) || (rows as Row[]).length < 1000) {
      complete = true;
      break;
    }
    if (need && out.length >= need) break;
    if (!need && out.length >= ALL_MAX_BARS) break;
  }
  let candles = finalize(out, need);
  if (!native) candles = aggregateGrid(candles, tfSec(tf));
  return { candles: opts.want ? candles.slice(-opts.want) : candles, complete };
}

async function bybitDeep(
  ticker: string,
  tf: string,
  opts: WalkOpts
): Promise<{ candles: Candle[]; complete: boolean }> {
  const native = BYBIT_NATIVE.has(tf);
  const plan = native ? null : aggBase(BYBIT_NATIVE, tf);
  const fetchTf = native ? bybitIv(tf) : bybitIv(plan!.base);
  const mult = native ? 1 : plan!.mult;
  const need = opts.want ? opts.want * mult : null;

  const out: Candle[] = [];
  let end: number | null = null;
  let complete = false;
  const budget = Math.min(opts.want ? Math.ceil(need! / 1000) + 2 : BUDGET_ALL_PAGES * mult, 900);

  for (let i = 0; i < budget; i++) {
    if (Date.now() > opts.deadline) break;
    const url =
      `https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(ticker)}&interval=${fetchTf}&limit=1000` +
      (end ? `&end=${end}` : "");
    const j = (await jget(url)) as { result?: { list?: Row[] } };
    const list = j?.result?.list ?? [];
    if (list.length === 0) {
      complete = true;
      break;
    }
    for (const r of list) {
      const c = mkCandle(r);
      if (c) out.push(c);
    }
    end = Number(list[0][0]) - 1;
    const oldest = Number(list[0][0]);
    if ((opts.fromMs && oldest <= opts.fromMs) || list.length < 1000) {
      complete = true;
      break;
    }
    if (need && out.length >= need) break;
    if (!need && out.length >= ALL_MAX_BARS) break;
  }
  let candles = finalize(out, need);
  if (!native) candles = aggregateGrid(candles, tfSec(tf));
  return { candles: opts.want ? candles.slice(-opts.want) : candles, complete };
}

async function okxDeep(
  ticker: string,
  tf: string,
  opts: WalkOpts
): Promise<{ candles: Candle[]; complete: boolean }> {
  const native = OKX_NATIVE.has(tf);
  const plan = native ? null : aggBase(OKX_NATIVE, tf);
  const bar = native ? okxBar(tf) : okxBar(plan!.base);
  const mult = native ? 1 : plan!.mult;
  const need = opts.want ? opts.want * mult : null;

  const out: Candle[] = [];
  let after: number | null = null;
  let complete = false;
  const budget = Math.min(opts.want ? Math.ceil(need! / 300) + 2 : BUDGET_ALL_PAGES * mult, 1200);

  for (let i = 0; i < budget; i++) {
    if (Date.now() > opts.deadline) break;
    const url =
      `https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(ticker)}&bar=${bar}&limit=300` +
      (after ? `&after=${after}` : "");
    const j = (await jget(url)) as { data?: Row[] };
    const data = j?.data ?? [];
    if (data.length === 0) {
      complete = true;
      break;
    }
    for (const r of data) {
      const c = mkCandle(r);
      if (c) out.push(c);
    }
    after = Number(data[data.length - 1][0]);
    const oldest = Number(data[data.length - 1][0]);
    if ((opts.fromMs && oldest <= opts.fromMs) || data.length < 300) {
      complete = true;
      break;
    }
    if (need && out.length >= need) break;
    if (!need && out.length >= ALL_MAX_BARS) break;
  }
  let candles = finalize(out, need);
  if (!native) candles = aggregateGrid(candles, tfSec(tf));
  return { candles: opts.want ? candles.slice(-opts.want) : candles, complete };
}

// ───────────────────────── YAHOO · chunked period windows ─────────────────────────

interface YahooPlan {
  iv: "1m" | "5m" | "15m" | "30m" | "60m" | "1d";
  mult: number; // aggregate factor (1 = native); 99 = calendar-week from 1d
  backDays: number; // how far back Yahoo offers this interval (0 = full history)
  chunkDays: number; // request-window size (0 = single request)
}

const YAHOO_PLAN: Record<string, YahooPlan> = {
  "1m": { iv: "1m", mult: 1, backDays: 30, chunkDays: 7 },
  "2m": { iv: "1m", mult: 2, backDays: 30, chunkDays: 7 },
  "3m": { iv: "1m", mult: 3, backDays: 30, chunkDays: 7 },
  "5m": { iv: "5m", mult: 1, backDays: 60, chunkDays: 30 },
  "10m": { iv: "5m", mult: 2, backDays: 60, chunkDays: 30 },
  "15m": { iv: "15m", mult: 1, backDays: 60, chunkDays: 60 },
  "30m": { iv: "30m", mult: 1, backDays: 60, chunkDays: 60 },
  "1h": { iv: "60m", mult: 1, backDays: 730, chunkDays: 365 },
  "2h": { iv: "60m", mult: 2, backDays: 730, chunkDays: 365 },
  "3h": { iv: "60m", mult: 3, backDays: 730, chunkDays: 365 },
  "4h": { iv: "60m", mult: 4, backDays: 730, chunkDays: 365 },
  "6h": { iv: "60m", mult: 6, backDays: 730, chunkDays: 365 },
  "8h": { iv: "60m", mult: 8, backDays: 730, chunkDays: 365 },
  "12h": { iv: "60m", mult: 12, backDays: 730, chunkDays: 365 },
  "1d": { iv: "1d", mult: 1, backDays: 0, chunkDays: 0 },
  "3d": { iv: "1d", mult: 3, backDays: 0, chunkDays: 0 },
  "1w": { iv: "1d", mult: 99, backDays: 0, chunkDays: 0 },
};

const YAHOO_IV_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "60m": 3_600_000,
};

interface YahooChart {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
    }>;
    error?: { description?: string } | null;
  };
}

async function yahooWindow(
  ticker: string,
  iv: string,
  p1Sec: number,
  p2Sec: number
): Promise<Candle[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=${iv}&period1=${Math.floor(p1Sec)}&period2=${Math.floor(p2Sec)}&includePrePost=false`;
  const j = (await jget(url, 20000)) as YahooChart;
  const res = j.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  const ts = res?.timestamp;
  if (!res || !q || !ts || !ts.length) {
    throw new Error(j.chart?.error?.description ?? "yahoo empty window");
  }
  const rows: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const time = ts[i] * 1000;
    // keep only bars on the interval grid (drops Yahoo's off-grid snapshot bar)
    const stepMs = YAHOO_IV_MS[iv];
    if (stepMs && time % stepMs !== 0) continue;
    if (!isFinite(c) || c <= 0 || h < l) continue;
    rows.push({ time, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  return rows;
}

async function yahooDeep(
  ticker: string,
  tf: string,
  opts: WalkOpts
): Promise<{ candles: Candle[]; complete: boolean }> {
  const plan = YAHOO_PLAN[tf] ?? YAHOO_PLAN["5m"];
  const now = Date.now();
  const out: Candle[] = [];
  let complete = true;

  if (plan.iv === "1d") {
    // ONE request covers the full listed history (decades)
    const p1 = Math.max(opts.fromMs ? opts.fromMs / 1000 : 0, 0);
    const rows = await yahooWindow(ticker, "1d", p1, now / 1000);
    out.push(...rows);
  } else {
    const backMs = plan.backDays * 86400_000;
    const floorMs = Math.max(opts.fromMs ?? 0, now - backMs);
    let p2 = now;
    const chunkMs = plan.chunkDays * 86400_000;
    const budget = Math.min(Math.ceil(backMs / chunkMs) + 1, 12);
    complete = false;
    for (let i = 0; i < budget; i++) {
      if (Date.now() > opts.deadline) break;
      const p1 = Math.max(p2 - chunkMs, floorMs);
      try {
        const rows = await yahooWindow(ticker, plan.iv, p1 / 1000, p2 / 1000);
        out.push(...rows);
      } catch (e) {
        // a chunk with zero trading days (e.g. holiday span) is not fatal —
        // only abort the walk when the FIRST window fails
        if (out.length === 0) throw e;
      }
      if (opts.want && out.length >= opts.want * plan.mult) break;
      if (p1 <= floorMs) {
        complete = true;
        break;
      }
      p2 = p1;
      await sleep(120); // Yahoo throttles bursts
    }
  }

  let candles = finalize(out, null);
  if (plan.iv === "1d" && plan.mult === 99) candles = aggregateGrid(candles, 604800_000); // W1
  else if (plan.mult > 1 && plan.mult !== 99) candles = aggregateGrid(candles, tfSec(tf));
  // trim to requested bars AFTER aggregation so `want` counts final tf bars
  return { candles: opts.want ? candles.slice(-opts.want) : candles, complete };
}

// ───────────────────────── orchestrator ─────────────────────────

interface FeedAttempt {
  name: string;
  run: () => Promise<{ candles: Candle[]; complete: boolean }>;
}

function cryptoAttempts(sym: string, tf: string, opts: WalkOpts): FeedAttempt[] {
  const t = cryptoTickers(sym);
  return [
    { name: "binance", run: () => binanceDeep(t.binance, tf, opts) },
    { name: "bybit", run: () => bybitDeep(t.bybit, tf, opts) },
    { name: "okx", run: () => okxDeep(t.okx, tf, opts) },
  ];
}

function yahooAttempts(sym: string, tf: string, opts: WalkOpts): FeedAttempt[] {
  const ticker = yahooTickerOf(sym);
  return [{ name: "yahoo", run: () => yahooDeep(ticker, tf, opts) }];
}

// deep-result cache so re-running the same config is instant
interface DeepCacheEntry {
  res: DeepResult;
  at: number;
}
const gDeep = globalThis as unknown as { __haloDeepCache?: Map<string, DeepCacheEntry> };
const deepCache = (gDeep.__haloDeepCache ??= new Map<string, DeepCacheEntry>());
const DEEP_TTL = 10 * 60_000;

export async function getDeepHistory(req: DeepRequest): Promise<DeepResult> {
  const sym = req.symbol.toUpperCase().trim().replace(/\s+/g, "");
  if (!sym || sym.length > 24 || !/^[A-Z0-9^.\-=]{1,24}$/.test(sym)) {
    throw new Error("Invalid symbol — use tickers like EURUSD, XAUUSD, BTCUSDT, BTCUSD, AAPL, ^GSPC");
  }
  const tf = isBtTf(req.tf) ? req.tf : "5m";
  const want = req.bars === null ? null : Math.max(50, Math.min(Math.round(req.bars), 500_000));
  const fromMs = req.fromMs && req.fromMs > 0 ? req.fromMs : null;

  const cacheKey = `${sym}:${tf}:${want ?? "all"}:${fromMs ?? 0}`;
  const hit = deepCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DEEP_TTL) return hit.res;

  // ── Deriv synthetic indices: no public OHLC feed exists anywhere ──
  // (Deriv generates these prices internally and exposes no history API).
  // Serve a deterministic seeded simulator run, honestly labelled
  // "simulator", so backtests stay functional instead of erroring.
  if (classifySymbol(sym) === "synth") {
    const knownMeta = SYMBOLS.find((k) => k.id === sym);
    // real Deriv history first (public websocket, ≤5 000 bars per request)
    if (knownMeta && (want ?? 50_000) <= 5_000) {
      try {
        const real = (await fetchDerivCandles(sym, tf, want ?? 5_000)).filter((c) => !fromMs || c.time >= fromMs);
        if (real.length >= 50) {
          const res: DeepResult = { candles: real, source: "deriv", complete: true, meta: knownMeta };
          deepCache.set(cacheKey, { res, at: Date.now() });
          return res;
        }
      } catch {
        // unreachable / not listed → simulator below
      }
    }
    if (knownMeta) {
      const candles = simulateCandles(sym, tf, want ?? 50_000, Date.now()).filter(
        (c) => !fromMs || c.time >= fromMs
      );
      const res: DeepResult = { candles, source: "simulator", complete: true, meta: knownMeta };
      deepCache.set(cacheKey, { res, at: Date.now() });
      if (deepCache.size > 8) {
        const oldest = [...deepCache.entries()].sort((x, y) => x[1].at - y[1].at)[0];
        if (oldest) deepCache.delete(oldest[0]);
      }
      return res;
    }
  }

  const cls = classifySymbol(sym);
  const opts: WalkOpts = { want, fromMs, deadline: Date.now() + ALL_RUN_DEADLINE_MS + 30_000 };

  // routing: crypto names try exchanges first; FX/metals/anything else tries
  // Yahoo first — every path falls through to the other family on failure
  const crypto = cryptoAttempts(sym, tf, opts);
  const yahoo = yahooAttempts(sym, tf, opts);
  const attempts: FeedAttempt[] = cls === "crypto" ? [...crypto, ...yahoo] : [...yahoo, ...crypto];

  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      const r = await a.run();
      // clip anything older than the user's FROM floor (a walk page can
      // overshoot it — the floor only decides when to STOP walking)
      const candles = fromMs ? r.candles.filter((c) => c.time >= fromMs) : r.candles;
      if (candles.length >= 30) {
        const refPx = candles[candles.length - 1].close;
        const res: DeepResult = {
          candles,
          source: a.name,
          complete: r.complete,
          meta: resolveAnySymbol(sym, refPx, a.name === "yahoo" && cls !== "crypto" ? "fx" : "crypto"),
        };
        deepCache.set(cacheKey, { res, at: Date.now() });
        if (deepCache.size > 8) {
          const oldest = [...deepCache.entries()].sort((x, y) => x[1].at - y[1].at)[0];
          if (oldest) deepCache.delete(oldest[0]);
        }
        return res;
      }
      lastErr = new Error(`${a.name} returned ${r.candles.length} bars`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `NO_LIVE_DATA — every real feed failed for ${sym} ${tf} (${(lastErr as Error)?.message ?? "unknown"})`
  );
}
