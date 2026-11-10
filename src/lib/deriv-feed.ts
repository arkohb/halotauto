// ════════════════════════════════════════════════════════════════════════
//  DERIV FEED · server-side real candles for Deriv synthetic indices
//
//  Deriv moved its public market data to a new endpoint:
//    wss://api.derivws.com/trading/v1/options/ws/public   (no auth)
//  The legacy wss://ws.derivws.com/websockets/v3 now answers Cloudflare 520
//  for every app_id, which is why synthetics had no live feed at all.
//
//  This module keeps ONE shared websocket (Node's global WebSocket) and
//  serves request/response `ticks_history` candle calls over it, so the
//  engine, scanners and charts get the REAL Volatility / Boom / Crash /
//  Step / Jump prices instead of the built-in simulator. Any failure throws
//  — market.ts then falls back to the simulator exactly as before.
//
//  Market data only — no account, no orders.
// ════════════════════════════════════════════════════════════════════════

import type { Candle } from "./halo/types";
import { DERIV_GRANULARITIES, DERIV_NAME_HINTS, DERIV_WS_CODE, getSymbolMeta, tfSec } from "./market-symbols";

const DERIV_URL = (process.env.DERIV_WS_URL ?? "wss://api.derivws.com/trading/v1/options/ws/public").trim();
const REQ_TIMEOUT_MS = 6_000;
const PING_MS = 25_000;
const MAX_COUNT = 5_000; // Deriv's per-request candle cap
const SKIP_MS = 15 * 60_000; // unknown symbol → don't ask again for 15 min
const CATALOG_TTL_MS = 30 * 60_000;
// live candle subscriptions held in memory (bot / chart / scanner hot keys):
// reads are instant and every Deriv tick lands here the moment it arrives
const MAX_LIVE_SERIES = 24;
const LIVE_IDLE_MS = 120_000;
const LIVE_SEED = 600;

type Msg = Record<string, unknown>;

interface DerivServerConn {
  ws: WebSocket | null;
  opening: Promise<WebSocket> | null;
  reqId: number;
  pending: Map<number, { resolve(m: Msg): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>;
  ping: ReturnType<typeof setInterval> | null;
  /** normalized code / display name → Deriv code */
  names: Map<string, string>;
  catalogAt: number;
  catalogLoading: Promise<void> | null;
  /** internal id → resolved code */
  resolved: Map<string, string>;
  /** internal id → skip-until epoch ms */
  skip: Map<string, number>;
  /** `${code}|${sec}` → live subscribed candle series */
  series: Map<string, LiveSeries>;
  /** deriv code → tick listeners (push wake-ups) */
  listeners: Map<string, Set<() => void>>;
  sweep: ReturnType<typeof setInterval> | null;
}

interface LiveSeries {
  bars: Candle[];
  subId: string | null;
  lastUse: number;
}

const g = globalThis as unknown as { __haloDerivServer?: DerivServerConn };

function conn(): DerivServerConn {
  const c = (g.__haloDerivServer ??= {
    ws: null,
    opening: null,
    reqId: 0,
    pending: new Map(),
    ping: null,
    names: new Map(),
    catalogAt: 0,
    catalogLoading: null,
    resolved: new Map(),
    skip: new Map(),
    series: new Map(),
    listeners: new Map(),
    sweep: null,
  });
  // a connection created by an older build (dev hot reload keeps globalThis)
  // may predate newer fields — fill them in so reads never throw into the
  // simulator fallback
  if (!c.series) {
    // older build: its socket carries the old message handler, which drops
    // live candle updates — close it so the next read opens a fresh one
    try {
      c.ws?.close();
    } catch {
      // already closed
    }
    c.ws = null;
    c.opening = null;
  }
  c.series ??= new Map();
  c.listeners ??= new Map();
  c.sweep ??= null;
  return c;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function failAll(c: DerivServerConn, why: string): void {
  for (const [, p] of c.pending) {
    clearTimeout(p.timer);
    p.reject(new Error(why));
  }
  c.pending.clear();
}

function open(c: DerivServerConn): Promise<WebSocket> {
  if (c.ws && c.ws.readyState === WebSocket.OPEN) return Promise.resolve(c.ws);
  if (c.opening) return c.opening;
  if (typeof WebSocket === "undefined") return Promise.reject(new Error("deriv: no WebSocket in this runtime"));
  c.opening = new Promise<WebSocket>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(DERIV_URL);
    } catch (e) {
      c.opening = null;
      reject(e as Error);
      return;
    }
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      c.opening = null;
      reject(new Error("deriv: connect timeout"));
    }, REQ_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(t);
      c.ws = ws;
      c.opening = null;
      if (c.ping) clearInterval(c.ping);
      c.ping = setInterval(() => {
        if (c.ws && c.ws.readyState === WebSocket.OPEN) {
          try {
            c.ws.send(JSON.stringify({ ping: 1 }));
          } catch {
            // close handler cleans up
          }
        }
      }, PING_MS);
      resolve(ws);
    };
    ws.onmessage = (ev) => {
      let m: Msg;
      try {
        m = JSON.parse(String(ev.data)) as Msg;
      } catch {
        return;
      }
      if (m.msg_type === "ohlc" && m.ohlc && !m.error) {
        onOhlc(c, m.ohlc as OhlcMsg);
        const pid = m.req_id as number | undefined;
        if (!pid || !c.pending.has(pid)) return; // stream update — the first frame still resolves its request
      }
      const id = m.req_id as number | undefined;
      if (!id) return;
      const p = c.pending.get(id);
      if (!p) return;
      c.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(m);
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
    ws.onclose = () => {
      clearTimeout(t);
      if (c.ws === ws) c.ws = null;
      if (c.opening) {
        c.opening = null;
        reject(new Error("deriv: socket closed during connect"));
      }
      if (c.ping) {
        clearInterval(c.ping);
        c.ping = null;
      }
      failAll(c, "deriv: socket closed");
      c.series.clear(); // subscriptions died with the socket — re-made on the next read
    };
  });
  return c.opening;
}

async function call(req: Msg): Promise<Msg> {
  const c = conn();
  const ws = await open(c);
  const id = ++c.reqId;
  return new Promise<Msg>((resolve, reject) => {
    const timer = setTimeout(() => {
      c.pending.delete(id);
      reject(new Error("deriv: request timeout"));
    }, REQ_TIMEOUT_MS);
    c.pending.set(id, { resolve, reject, timer });
    try {
      ws.send(JSON.stringify({ ...req, req_id: id }));
    } catch (e) {
      clearTimeout(timer);
      c.pending.delete(id);
      reject(e as Error);
    }
  });
}

async function loadCatalog(c: DerivServerConn): Promise<void> {
  if (c.names.size > 0 && Date.now() - c.catalogAt < CATALOG_TTL_MS) return;
  if (c.catalogLoading) return c.catalogLoading;
  c.catalogLoading = (async () => {
    try {
      const m = await call({ active_symbols: "brief" });
      const list = m.active_symbols as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(list)) return;
      const names = new Map<string, string>();
      for (const s of list) {
        // new API: underlying_symbol / underlying_symbol_name · legacy: symbol / display_name
        const code = String(s.underlying_symbol ?? s.symbol ?? "");
        if (!code) continue;
        names.set(norm(code), code);
        const label = s.underlying_symbol_name ?? s.display_name;
        if (label) names.set(norm(String(label)), code);
      }
      if (names.size > 0) {
        c.names = names;
        c.catalogAt = Date.now();
        c.resolved.clear();
      }
    } finally {
      c.catalogLoading = null;
    }
  })();
  return c.catalogLoading;
}

/** internal symbol id → Deriv code, resolved against the live catalog (null = not listed) */
export async function derivCodeOf(symbol: string): Promise<string | null> {
  const c = conn();
  try {
    await loadCatalog(c);
  } catch {
    // catalog unavailable — fall back to the static map below
  }
  const hit = c.resolved.get(symbol);
  if (hit) return hit;
  const meta = getSymbolMeta(symbol);
  const candidates: string[] = [];
  if (DERIV_WS_CODE[symbol]) candidates.push(norm(DERIV_WS_CODE[symbol]));
  for (const h of DERIV_NAME_HINTS[symbol] ?? []) candidates.push(h);
  candidates.push(norm(meta.label), norm(symbol));
  if (c.names.size === 0) {
    const code = DERIV_WS_CODE[symbol] ?? null;
    return code;
  }
  for (const cand of candidates) {
    const code = c.names.get(cand);
    if (code) {
      c.resolved.set(symbol, code);
      return code;
    }
  }
  return null;
}

interface OhlcMsg {
  symbol?: string;
  granularity?: number;
  open_time?: number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
}

function onOhlc(c: DerivServerConn, o: OhlcMsg): void {
  if (!o.symbol || !o.granularity) return;
  const s = c.series.get(`${o.symbol}|${o.granularity}`);
  if (s) {
    const bar: Candle = { time: Number(o.open_time) * 1000, open: Number(o.open), high: Number(o.high), low: Number(o.low), close: Number(o.close) };
    if (isFinite(bar.time) && isFinite(bar.close)) {
      const last = s.bars[s.bars.length - 1];
      if (last && last.time === bar.time) s.bars[s.bars.length - 1] = bar;
      else if (!last || bar.time > last.time) {
        s.bars.push(bar);
        if (s.bars.length > MAX_COUNT) s.bars.splice(0, s.bars.length - MAX_COUNT);
      }
    }
  }
  const ls = c.listeners.get(o.symbol);
  if (ls) for (const fn of ls) {
    try {
      fn();
    } catch {
      // a listener must never break the feed
    }
  }
}

function forgetSeries(c: DerivServerConn, key: string): void {
  const s = c.series.get(key);
  c.series.delete(key);
  if (s?.subId && c.ws && c.ws.readyState === WebSocket.OPEN) {
    try {
      c.ws.send(JSON.stringify({ forget: s.subId }));
    } catch {
      // socket dying anyway
    }
  }
}

function ensureSweep(c: DerivServerConn): void {
  if (c.sweep) return;
  c.sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, s] of [...c.series.entries()]) if (now - s.lastUse > LIVE_IDLE_MS) forgetSeries(c, k);
  }, 30_000);
  (c.sweep as unknown as { unref?: () => void }).unref?.();
}

function toCandles(rows: Array<{ epoch: number; open: number; high: number; low: number; close: number }>): Candle[] {
  const out: Candle[] = [];
  for (const r of rows) {
    const bar = { time: Number(r.epoch) * 1000, open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close) };
    if (isFinite(bar.time) && isFinite(bar.open) && isFinite(bar.high) && isFinite(bar.low) && isFinite(bar.close)) out.push(bar);
  }
  return out;
}

/**
 * Wake `fn` on every Deriv tick of this symbol (any timeframe it streams).
 * Used by the bot so the engine reacts the moment Deriv moves instead of on
 * its next 2 s poll. Returns an unsubscribe.
 */
export function onDerivTick(symbol: string, fn: () => void): () => void {
  const c = conn();
  let code: string | null = null;
  let dead = false;
  void derivCodeOf(symbol).then((cd) => {
    if (dead || !cd) return;
    code = cd;
    let set = c.listeners.get(cd);
    if (!set) c.listeners.set(cd, (set = new Set()));
    set.add(fn);
  });
  return () => {
    dead = true;
    if (code) c.listeners.get(code)?.delete(fn);
  };
}

/**
 * Real OHLC candles for a Deriv synthetic index. Throws on any failure
 * (unreachable, unknown symbol, unsupported timeframe) so the caller can
 * fall back to the simulator.
 */
export async function fetchDerivCandles(symbol: string, tf: string, limit: number): Promise<Candle[]> {
  const c = conn();
  const until = c.skip.get(symbol);
  if (until && Date.now() < until) throw new Error("deriv: symbol not listed (cached)");
  const sec = tfSec(tf);
  if (!DERIV_GRANULARITIES.has(sec)) throw new Error(`deriv: no ${tf} candles`);
  const code = await derivCodeOf(symbol);
  if (!code) {
    c.skip.set(symbol, Date.now() + SKIP_MS);
    throw new Error("deriv: symbol not listed");
  }
  const want = Math.max(1, Math.min(Math.round(limit), MAX_COUNT));
  const key = `${code}|${sec}`;
  const live = c.series.get(key);
  // 1 · live subscription in memory — instant, current to the last tick
  if (live && c.ws && c.ws.readyState === WebSocket.OPEN && live.bars.length >= Math.min(want, LIVE_SEED)) {
    live.lastUse = Date.now();
    if (want <= live.bars.length) return live.bars.slice(-want);
  }
  // 2 · open a live subscription for this key (LRU-capped)
  if (!live) {
    if (c.series.size >= MAX_LIVE_SERIES) {
      const oldest = [...c.series.entries()].sort((x, y) => x[1].lastUse - y[1].lastUse)[0];
      if (oldest) forgetSeries(c, oldest[0]);
    }
    const seed = Math.max(want, LIVE_SEED);
    const sm = await call({ ticks_history: code, adjust_start_time: 1, count: seed, end: "latest", style: "candles", granularity: sec, subscribe: 1 });
    const serr = sm.error as { code?: string; message?: string } | undefined;
    if (!serr && Array.isArray(sm.candles) && sm.candles.length > 0) {
      const bars = toCandles(sm.candles as Array<{ epoch: number; open: number; high: number; low: number; close: number }>);
      const subId = (sm.subscription as { id?: string } | undefined)?.id ?? null;
      if (bars.length > 0) {
        c.series.set(key, { bars, subId, lastUse: Date.now() });
        ensureSweep(c);
        return bars.slice(-want);
      }
    }
    if (serr && (serr.code === "InvalidSymbol" || serr.code === "InputValidationFailed")) {
      c.skip.set(symbol, Date.now() + SKIP_MS);
      throw new Error(`deriv: ${serr.code} ${serr.message ?? ""}`.trim());
    }
    // subscribe refused (e.g. market closed) — fall through to a one-shot read
  }
  // 3 · one-shot read (deeper than the live window, or no subscription)
  const m = await call({
    ticks_history: code,
    adjust_start_time: 1,
    count: want,
    end: "latest",
    style: "candles",
    granularity: sec,
  });
  const err = m.error as { code?: string; message?: string } | undefined;
  if (err) {
    if (err.code === "InvalidSymbol" || err.code === "InputValidationFailed") c.skip.set(symbol, Date.now() + SKIP_MS);
    throw new Error(`deriv: ${err.code ?? "error"} ${err.message ?? ""}`.trim());
  }
  const rows = m.candles as Array<{ epoch: number; open: number; high: number; low: number; close: number }> | undefined;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("deriv: no candles");
  const out: Candle[] = [];
  for (const r of rows) {
    const bar = {
      time: Number(r.epoch) * 1000,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
    };
    if (isFinite(bar.time) && isFinite(bar.open) && isFinite(bar.high) && isFinite(bar.low) && isFinite(bar.close)) out.push(bar);
  }
  if (out.length === 0) throw new Error("deriv: no valid candles");
  const held = c.series.get(key);
  if (held) {
    held.lastUse = Date.now();
    const lastT = out[out.length - 1].time;
    for (const b of held.bars) if (b.time > lastT) out.push(b);
  }
  return out;
}
