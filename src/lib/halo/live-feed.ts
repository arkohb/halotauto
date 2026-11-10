// ════════════════════════════════════════════════════════════════════════
//  LIVE FEED · client-side real-time price streams for the chart
//
//  The 3EL chart must move tick-by-tick like the real TradingView web
//  chart. REST polling (3s) plus server-side caches (3.5–30s) can never
//  achieve that — and Deriv's websocket is not reachable from the server
//  egress, but the BROWSER reaches everything directly (exactly how the
//  "TV WEB" tab gets its own real-time stream). So the live layer lives
//  here, in the browser:
//
//    • SYNTHETICS / FOREX / METALS → Deriv public websocket
//      (wss://api.derivws.com/trading/v1/options/ws/public · public market data):
//      `ticks_history` seeds REAL candles, then `ohlc` pushes the forming
//      candle on every tick (~1–2s for synthetics).
//    • CRYPTO → Binance combined stream: kline (authoritative OHLC + bar
//      rollover) AND aggTrade (every trade). Binance pushes kline updates
//      only every ~2 s, so on its own the candle lagged TradingView; the
//      trade stream moves the forming candle on EVERY trade, exactly like
//      the BINANCE: chart on TradingView. Same venue as the REST candles,
//      so history and live bars always agree.
//    • FOREX / METALS / INDICES via the server relay (/api/market/stream):
//      your broker's MT5 through the HALO Bridge EA when it is online,
//      otherwise OANDA practice when configured:
//      ticks relayed by /api/market/stream (SSE) — the same BID prices
//      TradingView charts as OANDA:XAUUSD. Tried first; when the server has
//      no OANDA feed the sub falls back to Deriv.
//    • Anything not covered → no stream; the polling feed keeps driving.
//
//  ⚠ Presentation layer only — no orders, no EA behaviour. Nothing here
//  touches the strategy engine, risk, or execution.
// ════════════════════════════════════════════════════════════════════════

import { DERIV_GRANULARITIES, DERIV_NAME_HINTS, DERIV_WS_CODE, getSymbolMeta, tfSec } from "@/lib/market-symbols";

export interface LiveBar {
  /** bar OPEN time in epoch ms */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type LiveFeedKind = "deriv" | "binance" | "oanda" | "exness";

export interface LiveStatus {
  /** true when a real stream is confirmed flowing for this symbol+tf */
  active: boolean;
  kind: LiveFeedKind | null;
  note?: string;
}

export interface LiveHandlers {
  onStatus?(st: LiveStatus): void;
  /** full real history snapshot (Deriv feed only — Binance history comes from the REST poll) */
  onHistory?(bars: LiveBar[]): void;
  /** forming-candle update — every tick */
  onUpdate?(bar: LiveBar): void;
}

// Deriv moved public market data to api.derivws.com; the legacy
// wss://ws.derivws.com/websockets/v3 now answers Cloudflare 520 for every
// app_id, which left the chart with no live stream. Override with
// NEXT_PUBLIC_DERIV_WS_URL if Deriv moves it again.
const DERIV_URL = (process.env.NEXT_PUBLIC_DERIV_WS_URL ?? "wss://api.derivws.com/trading/v1/options/ws/public").trim();
const BINANCE_URL = "wss://stream.binance.com:9443/stream?streams=";
const HISTORY_COUNT = 300;
const IDLE_CLOSE_MS = 45_000;
/** warm-socket window after the last viewer leaves a binance stream —
 *  covers view switches and dev StrictMode remounts without a cold handshake */
const BINANCE_GRACE_CLOSE_MS = 8_000;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ───────────────────────── shared sub registry ─────────────────────────

interface LiveSub {
  key: string; // `${symbol}|${tf}`
  symbol: string;
  tf: string;
  sec: number;
  cbs: Set<LiveHandlers>;
  kind: LiveFeedKind | null;
  active: boolean;
  note?: string;
  updates: number;
  // deriv state
  code: string | null;
  derivSubId: string | null;
  requested: boolean;
  history: LiveBar[];
  /** Deriv tick-stream subscription id (bid/ask feed for the BID view) */
  tickSubId?: string | null;
  /** BID view: the latest mid bar waiting for its same-second tick (exact spread) */
  pendBar?: LiveBar | null;
  pendEpoch?: number;
  pendTimer?: ReturnType<typeof setTimeout> | null;
  /** server-relayed stream: which source the server chose (broker EA or OANDA) */
  src?: LiveFeedKind;
}

interface SubKey {
  key: string;
  symbol: string;
  tf: string;
  sec: number;
}

function subKeyOf(symbol: string, tf: string): string {
  return `${symbol}|${tf}`;
}

function makeSub({ key, symbol, tf, sec }: SubKey): LiveSub {
  return { key, symbol, tf, sec, cbs: new Set(), kind: null, active: false, updates: 0, code: null, derivSubId: null, requested: false, history: [] };
}

// ───────────────────────── Deriv connection ─────────────────────────

interface DerivConn {
  ws: WebSocket | null;
  status: "idle" | "connecting" | "open" | "dead";
  reqId: number;
  /** req_id → response handler */
  pending: Map<number, (msg: Record<string, unknown>) => void>;
  /** `${derivCode}|${sec}` → sub key */
  byStream: Map<string, string>;
  subs: Map<string, LiveSub>;
  /** normalized display name / raw symbol → deriv code */
  names: Map<string, string>;
  /** deriv code → half spread (mid − bid) from the live tick stream */
  half: Map<string, number>;
  /** deriv code → last tick epoch (s) and its exact half spread */
  lastTick: Map<string, { epoch: number; half: number }>;
  /** internal id → resolved code (null = not available on Deriv) */
  resolved: Map<string, string | null>;
  namesLoaded: boolean;
  backoff: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  queue: string[];
}

function newDerivConn(): DerivConn {
  return {
    ws: null,
    status: "idle",
    reqId: 0,
    pending: new Map(),
    byStream: new Map(),
    subs: new Map(),
    names: new Map(),
    half: new Map(),
    lastTick: new Map(),
    resolved: new Map(),
    namesLoaded: false,
    backoff: 1000,
    reconnectTimer: null,
    idleTimer: null,
    queue: [],
  };
}

const g = globalThis as unknown as {
  __haloLiveFeedDeriv?: DerivConn;
  __haloLiveFeedBins?: Map<string, BinanceConn>;
  __haloLiveFeedSubs?: Map<string, LiveSub>;
  __haloLiveFeedOanda?: Map<string, EventSource>;
};

function deriv(): DerivConn {
  const c = (g.__haloLiveFeedDeriv ??= newDerivConn());
  // a connection created by an older build (hot reload keeps globalThis) may
  // predate newer fields — fill them in instead of crashing the chart
  c.half ??= new Map();
  c.lastTick ??= new Map();
  return c;
}

function allSubs(): Map<string, LiveSub> {
  return (g.__haloLiveFeedSubs ??= new Map<string, LiveSub>());
}

function derivSend(conn: DerivConn, req: Record<string, unknown>): void {
  if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(req));
  } else {
    conn.queue.push(JSON.stringify(req));
  }
}

function derivResolveCode(conn: DerivConn, symbol: string): string | null {
  if (conn.resolved.has(symbol)) return conn.resolved.get(symbol) ?? null;
  const meta = getSymbolMeta(symbol);
  let code: string | null = null;
  // 1. explicit stream codes
  const explicit = DERIV_WS_CODE[symbol];
  if (explicit && conn.names.size > 0) {
    // confirm the explicit code exists on the wire when the catalog is loaded
    const ok = conn.namesLoaded ? conn.names.has(norm(explicit)) || conn.names.has(norm(meta.label)) : true;
    code = ok ? explicit : null;
  } else if (explicit) {
    code = explicit;
  }
  // 2. forex / metals follow the frx<Pair> rule on Deriv
  if (!code && (meta.group === "FOREX" || meta.group === "METALS")) code = `frx${symbol}`;
  // 3. display-name / raw-symbol resolution against the live catalog
  if (!code && conn.names.size > 0) {
    const candidates = [...(DERIV_NAME_HINTS[symbol] ?? []), norm(meta.label), norm(symbol)];
    for (const c of candidates) {
      const hit = conn.names.get(c);
      if (hit) {
        code = hit;
        break;
      }
    }
  }
  conn.resolved.set(symbol, code);
  return code;
}

// ───────────────────────── price basis (BID / MID) ─────────────────────────
// Deriv quotes three prices per tick: bid, ask and the mid "quote". Candles
// (ticks_history / ohlc) are built on the MID — what Deriv's web trading
// chart shows. The Deriv MT5 terminal draws BID candles, half a spread lower.
// In BID view every Deriv bar is shifted down by the live half-spread taken
// from the tick stream, so HALO's chart sits exactly on the MT5 chart.
export type DerivPriceBasis = "bid" | "mid";
const BASIS_KEY = "halo.deriv.basis.v1";
const viewListeners = new Set<() => void>();
const gBasis = globalThis as unknown as { __haloDerivBasis?: DerivPriceBasis };

export function getDerivPriceBasis(): DerivPriceBasis {
  if (!gBasis.__haloDerivBasis) {
    let b: DerivPriceBasis = "bid";
    try {
      const v = typeof localStorage !== "undefined" ? localStorage.getItem(BASIS_KEY) : null;
      if (v === "mid" || v === "bid") b = v;
    } catch {
      // storage blocked — default BID
    }
    gBasis.__haloDerivBasis = b;
  }
  return gBasis.__haloDerivBasis;
}

function notifyView(): void {
  for (const fn of viewListeners) {
    try {
      fn();
    } catch {
      // listener errors never break the feed
    }
  }
}

/** subscribe to BID/MID basis or half-spread changes (useSyncExternalStore) */
export function subscribeDerivView(fn: () => void): () => void {
  viewListeners.add(fn);
  return () => {
    viewListeners.delete(fn);
  };
}

/** price amount to SUBTRACT from mid prices for this symbol's current view (0 = no shift) */
export function derivViewOffset(symbol: string): number {
  if (getDerivPriceBasis() !== "bid") return 0;
  for (const sub of allSubs().values()) {
    if (sub.symbol === symbol && sub.kind === "deriv" && sub.code) {
      const h = deriv().half.get(sub.code);
      if (h && h > 0) return h;
    }
  }
  return 0;
}

function shiftBar(b: LiveBar, off: number): LiveBar {
  return off ? { time: b.time, open: b.open - off, high: b.high - off, low: b.low - off, close: b.close - off } : b;
}

function derivOff(sub: LiveSub): number {
  if (getDerivPriceBasis() !== "bid" || !sub.code) return 0;
  return deriv().half.get(sub.code) ?? 0;
}

function emitHistory(sub: LiveSub, only?: LiveHandlers): void {
  const off = derivOff(sub);
  const bars = sub.history.map((b) => shiftBar(b, off));
  for (const h of only ? [only] : sub.cbs) {
    try {
      h.onHistory?.(bars.slice());
    } catch {
      // ignore
    }
  }
}

function emitUpdate(sub: LiveSub, bar: LiveBar, off: number): void {
  const shown = shiftBar(bar, off);
  for (const h of sub.cbs) {
    try {
      h.onUpdate?.(shown);
    } catch {
      // ignore
    }
  }
}

/** re-draw every Deriv chart after the basis or a half-spread changed */
function reemitDeriv(code?: string): void {
  for (const sub of deriv().subs.values()) {
    if (sub.kind !== "deriv" || !sub.active || sub.history.length === 0) continue;
    if (code && sub.code !== code) continue;
    emitHistory(sub);
  }
}

export function setDerivPriceBasis(b: DerivPriceBasis): void {
  if (getDerivPriceBasis() === b) return;
  gBasis.__haloDerivBasis = b;
  try {
    localStorage.setItem(BASIS_KEY, b);
  } catch {
    // storage blocked — the choice lasts for this tab
  }
  reemitDeriv();
  notifyView();
}

function derivStatus(sub: LiveSub, active: boolean, note?: string): void {
  sub.active = active;
  sub.note = note;
  for (const h of sub.cbs) {
    try {
      h.onStatus?.({ active, kind: active ? "deriv" : null, note });
    } catch {
      // consumer errors must never kill the feed
    }
  }
}

function derivRequestSub(conn: DerivConn, sub: LiveSub): void {
  if (!sub.code || sub.requested || conn.status !== "open") return;
  sub.requested = true;
  const reqId = ++conn.reqId;
  conn.pending.set(reqId, (msg) => {
    const err = msg.error as { code?: string; message?: string } | undefined;
    if (err) {
      // rule/explicit code rejected → try the display-name resolver once
      if (conn.names.size > 0 && conn.namesLoaded) {
        const alt = derivResolveCode(conn, sub.symbol);
        if (alt && alt !== sub.code) {
          sub.code = alt;
          sub.requested = false;
          derivRequestSub(conn, sub);
          return;
        }
      }
      sub.requested = false;
      conn.resolved.set(sub.symbol, null);
      derivStatus(sub, false, err.message || err.code || "stream rejected");
      return;
    }
    const candles = msg.candles as Array<{ epoch: number; open: number; high: number; low: number; close: number }> | undefined;
    const subscription = msg.subscription as { id?: string } | undefined;
    if (subscription?.id) sub.derivSubId = subscription.id;
    if (Array.isArray(candles) && candles.length > 0) {
      sub.history = candles
        .map((c) => ({
          time: Number(c.epoch) * 1000,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        }))
        .filter((b) => isFinite(b.time) && isFinite(b.close));
      if (sub.derivSubId) conn.byStream.set(`${sub.code}|${sub.sec}`, sub.key);
      derivStatus(sub, true);
      emitHistory(sub);
      // bid/ask feed for the BID view — the ohlc stream carries the mid only
      if (!sub.tickSubId) {
        const tickReq = ++conn.reqId;
        sub.tickSubId = "pending";
        conn.pending.set(tickReq, (tm) => {
          conn.pending.delete(tickReq);
          const tsub = tm.subscription as { id?: string } | undefined;
          sub.tickSubId = tsub?.id ?? null;
          if (tm.tick) derivTick(conn, tm.tick as DerivTick);
        });
        derivSend(conn, { ticks: sub.code, subscribe: 1, req_id: tickReq });
      }
    }
    conn.pending.delete(reqId);
  });
  derivSend(conn, {
    ticks_history: sub.code,
    adjust_start_time: 1,
    count: HISTORY_COUNT,
    end: "latest",
    style: "candles",
    granularity: sub.sec,
    subscribe: 1,
    req_id: reqId,
  });
}

interface DerivTick {
  symbol?: string;
  quote?: number;
  bid?: number;
  ask?: number;
  pip_size?: number;
}

/** learn the live half-spread (mid − bid) for a code; re-draw when it changes */
function derivTick(conn: DerivConn, t: DerivTick): void {
  if (!t.symbol || !isFinite(Number(t.quote)) || !isFinite(Number(t.bid))) return;
  const dp = Math.max(0, Math.min(8, Number(t.pip_size) || 0));
  const f = 10 ** (dp + 2);
  const half = Math.max(0, Math.round((Number(t.quote) - Number(t.bid)) * f) / f);
  const ep = Number((t as { epoch?: number }).epoch) || 0;
  conn.lastTick.set(t.symbol, { epoch: ep, half });
  // release any bar held for this exact tick
  for (const sub of conn.subs.values()) {
    if (sub.code !== t.symbol || !sub.pendBar || sub.pendEpoch !== ep) continue;
    if (sub.pendTimer) clearTimeout(sub.pendTimer);
    sub.pendTimer = null;
    const b = sub.pendBar;
    sub.pendBar = null;
    emitUpdate(sub, b, getDerivPriceBasis() === "bid" ? half : 0);
  }
  // the VIEW offset (history + engine overlays) only re-draws when the
  // spread moves meaningfully — live ticks above already use the exact one
  const prev = conn.half.get(t.symbol);
  if (prev !== undefined && Math.abs(half - prev) <= Math.max(prev * 0.2, 1e-9)) return;
  conn.half.set(t.symbol, half);
  if (getDerivPriceBasis() === "bid") reemitDeriv(t.symbol);
  notifyView();
}

function derivOpen(conn: DerivConn): void {
  if (conn.status === "connecting" || conn.status === "open") return;
  if (typeof WebSocket === "undefined") return; // SSR safety — never runs here
  conn.status = "connecting";
  let ws: WebSocket;
  try {
    ws = new WebSocket(DERIV_URL);
  } catch {
    conn.status = "dead";
    derivScheduleReconnect(conn);
    return;
  }
  conn.ws = ws;

  ws.onopen = () => {
    conn.status = "open";
    conn.backoff = 1000;
    // load the symbol catalog once per connection → powers name resolution
    const reqId = ++conn.reqId;
    conn.pending.set(reqId, (msg) => {
      // new API: underlying_symbol / underlying_symbol_name · legacy: symbol / display_name
      const list = msg.active_symbols as
        | Array<{ symbol?: string; display_name?: string; underlying_symbol?: string; underlying_symbol_name?: string }>
        | undefined;
      if (Array.isArray(list)) {
        for (const s of list) {
          const code = s.underlying_symbol ?? s.symbol;
          if (!code) continue;
          conn.names.set(norm(code), code);
          const label = s.underlying_symbol_name ?? s.display_name;
          if (label) conn.names.set(norm(label), code);
        }
        conn.namesLoaded = true;
        // explicit codes are now confirmable — drop rule-based caches that
        // were resolved before the catalog arrived so they re-resolve
        for (const [sym, code] of [...conn.resolved.entries()]) {
          if (code && !DERIV_WS_CODE[sym]) conn.resolved.delete(sym);
        }
        // subs still waiting for a code (name-hint symbols) start now
        for (const sub of conn.subs.values()) {
          if (sub.code || sub.requested) continue;
          conn.resolved.delete(sub.symbol);
          sub.code = derivResolveCode(conn, sub.symbol);
          if (sub.code) derivRequestSub(conn, sub);
          else if (sub.cbs.size > 0) derivStatus(sub, false, "not listed on Deriv");
        }
      }
      conn.pending.delete(reqId);
    });
    derivSend(conn, { active_symbols: "brief", req_id: reqId }); // product_type is rejected by the new API
    for (const req of conn.queue.splice(0)) {
      try {
        ws.send(req);
      } catch {
        // dead socket — reconnect loop will resubscribe
      }
    }
    for (const sub of conn.subs.values()) {
      sub.requested = false;
      // a sub that joined while the socket was closed has no code yet —
      // resolve it now (explicit map / frx rule); hint-only symbols resolve
      // once the catalog lands (below)
      if (!sub.code) sub.code = derivResolveCode(conn, sub.symbol);
      derivRequestSub(conn, sub);
    }
  };

  ws.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.msg_type === "ping") {
      derivSend(conn, { ping: (msg.ping as number) ?? 1 });
      return;
    }
    if (msg.msg_type === "tick" && msg.tick && !msg.error) {
      const reqT = msg.req_id as number | undefined;
      if (reqT && conn.pending.has(reqT)) {
        conn.pending.get(reqT)!(msg);
        return;
      }
      derivTick(conn, msg.tick as DerivTick);
      return;
    }
    const reqId = msg.req_id as number | undefined;
    if (reqId && conn.pending.has(reqId)) {
      conn.pending.get(reqId)!(msg);
      return;
    }
    if (msg.msg_type === "ohlc") {
      const o = msg.ohlc as { symbol?: string; granularity?: number; open_time?: number; open?: number; high?: number; low?: number; close?: number; id?: string };
      if (!o?.symbol || !o.granularity) return;
      const key = conn.byStream.get(`${o.symbol}|${o.granularity}`);
      const sub = key ? allSubs().get(key) : undefined;
      if (!sub || sub.cbs.size === 0) return;
      const bar: LiveBar = {
        time: Number(o.open_time) * 1000,
        open: Number(o.open),
        high: Number(o.high),
        low: Number(o.low),
        close: Number(o.close),
      };
      if (!isFinite(bar.time) || !isFinite(bar.close)) return;
      if (o.id && !sub.derivSubId) sub.derivSubId = o.id;
      sub.updates++;
      // keep the history current so a BID/MID re-draw never loses newer bars
      const last = sub.history[sub.history.length - 1];
      if (last && last.time === bar.time) sub.history[sub.history.length - 1] = bar;
      else if (!last || bar.time > last.time) {
        sub.history.push(bar);
        if (sub.history.length > 1000) sub.history.splice(0, sub.history.length - 1000);
      }
      if (getDerivPriceBasis() !== "bid") {
        emitUpdate(sub, bar, 0);
      } else {
        // BID = mid − THIS tick's half spread. The ohlc frame and the tick
        // frame for the same second can arrive in either order: use the tick
        // if it is already here, otherwise hold the bar until it lands
        // (≤150 ms fallback to the last known spread).
        const ep = Number((o as { epoch?: number }).epoch) || 0;
        const lt = conn.lastTick.get(sub.code ?? "");
        if (lt && ep && lt.epoch === ep) {
          emitUpdate(sub, bar, lt.half);
        } else {
          if (sub.pendTimer) clearTimeout(sub.pendTimer);
          sub.pendBar = bar;
          sub.pendEpoch = ep;
          sub.pendTimer = setTimeout(() => {
            sub.pendTimer = null;
            const b = sub.pendBar;
            sub.pendBar = null;
            if (b) emitUpdate(sub, b, derivOff(sub));
          }, 150);
        }
      }
    }
  };

  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      // already closed
    }
  };

  ws.onclose = () => {
    conn.ws = null;
    const hadSubs = conn.subs.size > 0;
    conn.status = "dead";
    conn.pending.clear();
    for (const sub of conn.subs.values()) {
      sub.requested = false;
      sub.derivSubId = null;
      sub.tickSubId = null;
      if (sub.cbs.size > 0) derivStatus(sub, false, "reconnecting…");
    }
    if (hadSubs) derivScheduleReconnect(conn);
  };
}

function derivScheduleReconnect(conn: DerivConn): void {
  if (conn.reconnectTimer) return;
  const wait = conn.backoff;
  conn.backoff = Math.min(conn.backoff * 2, 30_000);
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null;
    if (conn.subs.size > 0) {
      derivOpen(conn);
    } else {
      conn.status = "idle";
      conn.backoff = 1000;
    }
  }, wait);
}

function derivSubscribe(sub: LiveSub): void {
  const conn = deriv();
  conn.subs.set(sub.key, sub);
  if (conn.idleTimer) {
    clearTimeout(conn.idleTimer);
    conn.idleTimer = null;
  }
  if (conn.namesLoaded) sub.code = derivResolveCode(conn, sub.symbol);
  if (conn.status === "open") {
    if (!sub.code) sub.code = derivResolveCode(conn, sub.symbol);
    derivRequestSub(conn, sub);
  } else {
    derivOpen(conn);
  }
}

function derivUnsubscribe(sub: LiveSub): void {
  const conn = deriv();
  conn.subs.delete(sub.key);
  if (sub.derivSubId && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
    try {
      conn.ws.send(JSON.stringify({ forget: sub.derivSubId }));
    } catch {
      // socket dying anyway
    }
  }
  if (sub.tickSubId && sub.tickSubId !== "pending" && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
    try {
      conn.ws.send(JSON.stringify({ forget: sub.tickSubId }));
    } catch {
      // socket dying anyway
    }
  }
  sub.tickSubId = null;
  if (sub.code) conn.byStream.delete(`${sub.code}|${sub.sec}`);
  if (conn.subs.size === 0 && !conn.reconnectTimer) {
    conn.idleTimer = setTimeout(() => {
      conn.idleTimer = null;
      if (conn.subs.size === 0 && conn.ws) {
        try {
          conn.ws.close();
        } catch {
          // ignore
        }
      }
    }, IDLE_CLOSE_MS);
  }
}

// ───────────────────────── Binance connection ─────────────────────────

interface BinanceConn {
  ws: WebSocket | null;
  key: string;
  stream: string;
  backoff: number;
  closed: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** grace-period close — the socket stays warm for fast re-attach */
  closeTimer: ReturnType<typeof setTimeout> | null;
  /** forming candle built from kline + trades */
  bar: LiveBar | null;
  /** trade time (ms) of the last trade folded into `bar` */
  lastTradeAt: number;
}

function binanceInterval(tf: string): string | null {
  const allowed = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"]);
  return allowed.has(tf) ? tf : null;
}

function binanceOpen(conn: BinanceConn, sub: LiveSub): void {
  if (typeof WebSocket === "undefined") return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(`${BINANCE_URL}${conn.stream}`);
  } catch {
    binanceScheduleReconnect(conn, sub);
    return;
  }
  conn.ws = ws;
  ws.onopen = () => {
    conn.backoff = 1000;
    sub.active = true;
    sub.note = undefined;
    for (const h of sub.cbs) {
      try {
        h.onStatus?.({ active: true, kind: "binance" });
      } catch {
        // ignore
      }
    }
  };
  const tfMs = sub.sec * 1000;
  const emit = (bar: LiveBar): void => {
    sub.updates++;
    for (const h of sub.cbs) {
      try {
        h.onUpdate?.({ ...bar });
      } catch {
        // ignore
      }
    }
  };
  ws.onmessage = (ev) => {
    let msg: {
      data?: {
        e?: string;
        E?: number;
        k?: { t?: number; o?: string; h?: string; l?: string; c?: string };
        p?: string;
        T?: number;
      };
    };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const d = msg.data;
    if (!d) return;

    if (d.e === "aggTrade") {
      // ── every trade: move the forming candle immediately ──
      const px = Number(d.p);
      const t = Number(d.T);
      if (!isFinite(px) || !isFinite(t) || px <= 0) return;
      const cur = conn.bar;
      if (!cur) return; // wait for the first kline to anchor the bar
      if (t < cur.time) return; // late trade from a closed bar
      if (t >= cur.time + tfMs) {
        // bar rollover between kline pushes — open the new bar on this trade
        const open = Math.floor(t / tfMs) * tfMs;
        conn.bar = { time: open, open: px, high: px, low: px, close: px };
      } else {
        cur.close = px;
        if (px > cur.high) cur.high = px;
        if (px < cur.low) cur.low = px;
      }
      conn.lastTradeAt = t;
      emit(conn.bar!);
      return;
    }

    const k = d.k;
    if (!k?.t || k.c === undefined) return;
    const kb: LiveBar = { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c) };
    if (!isFinite(kb.time) || !isFinite(kb.close)) return;
    const cur = conn.bar;
    if (cur && kb.time < cur.time) return; // final push of an older bar — the chart already moved on
    if (!cur || kb.time > cur.time) {
      conn.bar = kb;
    } else {
      // same bar: kline is authoritative for open/high/low; its close is up
      // to ~2 s old, so keep the newer trade price when we have one
      cur.open = kb.open;
      cur.high = Math.max(cur.high, kb.high);
      cur.low = Math.min(cur.low, kb.low);
      if (!(conn.lastTradeAt > Number(d.E ?? 0))) cur.close = kb.close;
    }
    emit(conn.bar!);
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      // already closed
    }
  };
  ws.onclose = () => {
    conn.ws = null;
    if (conn.closed) return;
    if (sub.cbs.size > 0) {
      sub.active = false;
      for (const h of sub.cbs) {
        try {
          h.onStatus?.({ active: false, kind: null, note: "reconnecting…" });
        } catch {
          // ignore
        }
      }
      binanceScheduleReconnect(conn, sub);
    }
  };
}

function binanceScheduleReconnect(conn: BinanceConn, sub: LiveSub): void {
  if (conn.reconnectTimer) return;
  const wait = conn.backoff;
  conn.backoff = Math.min(conn.backoff * 2, 30_000);
  conn.reconnectTimer = setTimeout(() => {
    conn.reconnectTimer = null;
    if (!conn.closed && sub.cbs.size > 0) binanceOpen(conn, sub);
  }, wait);
}

// ───────────────────────── OANDA (server relay) ─────────────────────────

function oandaStatus(sub: LiveSub, active: boolean, note?: string): void {
  sub.active = active;
  sub.note = note;
  for (const h of sub.cbs) {
    try {
      h.onStatus?.({ active, kind: active ? (sub.src ?? "oanda") : null, note });
    } catch {
      // ignore
    }
  }
}

function oandaOpen(sub: LiveSub): void {
  const conns = (g.__haloLiveFeedOanda ??= new Map<string, EventSource>());
  let got = false;
  let es: EventSource;
  try {
    es = new EventSource(`/api/market/stream?symbol=${encodeURIComponent(sub.symbol)}&tf=${encodeURIComponent(sub.tf)}`);
  } catch {
    oandaFallback(sub);
    return;
  }
  conns.set(sub.key, es);
  // the server says which source it relays: your broker's MT5 ("exness") or OANDA
  es.addEventListener("source", (ev) => {
    const v = String((ev as MessageEvent).data);
    sub.src = v === "exness" ? "exness" : "oanda";
  });
  es.onmessage = (ev) => {
    let bar: LiveBar;
    try {
      bar = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!isFinite(bar.time) || !isFinite(bar.close)) return;
    if (!got || !sub.active) {
      got = true;
      oandaStatus(sub, true);
    }
    sub.updates++;
    for (const h of sub.cbs) {
      try {
        h.onUpdate?.({ ...bar });
      } catch {
        // ignore
      }
    }
  };
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) {
      // browser is retrying on its own (dropped connection)
      if (sub.active) oandaStatus(sub, false, "reconnecting…");
      return;
    }
    conns.delete(sub.key);
    if (sub.cbs.size === 0) return;
    if (!got) {
      // server has no OANDA feed for this market → use Deriv instead
      oandaFallback(sub);
    } else {
      oandaStatus(sub, false, "reconnecting…");
      setTimeout(() => {
        if (sub.cbs.size > 0 && sub.kind === "oanda" && !conns.has(sub.key)) oandaOpen(sub);
      }, 3000);
    }
  };
}

function oandaFallback(sub: LiveSub): void {
  // Exness only for forex / metals / indices: never fall back to Deriv's
  // prices (a different feed → candles that disagree with the broker's).
  // Keep retrying the Exness relay; the polled Exness candles drive the
  // chart meanwhile.
  oandaStatus(sub, false, "waiting for the Exness feed…");
  setTimeout(() => {
    const conns = g.__haloLiveFeedOanda;
    if (sub.cbs.size > 0 && sub.kind === "oanda" && !conns?.has(sub.key)) oandaOpen(sub);
  }, 5000);
}

function oandaClose(sub: LiveSub): void {
  const conns = g.__haloLiveFeedOanda;
  const es = conns?.get(sub.key);
  if (es) {
    es.close();
    conns!.delete(sub.key);
  }
}

// ───────────────────────── public API ─────────────────────────

/**
 * Subscribe to real-time bars for `symbol` + `tf`.
 * Returns an unsubscribe function. Never throws.
 */
export function subscribeLiveBars(symbol: string, tf: string, handlers: LiveHandlers): () => void {
  const key = subKeyOf(symbol, tf);
  const subs = allSubs();
  let sub = subs.get(key);
  if (!sub) {
    const sec = tfSec(tf);
    const meta = getSymbolMeta(symbol);
    sub = makeSub({ key, symbol, tf, sec });
    if (meta.group === "CRYPTO" && binanceInterval(tf)) sub.kind = "binance";
    else if ((meta.group === "FOREX" || meta.group === "METALS" || meta.group === "INDICES") && typeof EventSource !== "undefined") sub.kind = "oanda";
    else if (DERIV_GRANULARITIES.has(sec)) sub.kind = "deriv";
    else sub.note = "no live stream for this timeframe";
    subs.set(key, sub);
  }
  sub.cbs.add(handlers);
  handlers.onStatus?.({ active: sub.active, kind: sub.active ? sub.kind : null, note: sub.note });

  if (sub.cbs.size === 1) {
    if (sub.kind === "binance") {
      const bins = (g.__haloLiveFeedBins ??= new Map<string, BinanceConn>());
      const sym = sub.symbol.toLowerCase();
      const stream = `${sym}@kline_${binanceInterval(sub.tf)}/${sym}@aggTrade`;
      let conn = bins.get(key);
      if (!conn || conn.closed) {
        conn = { ws: null, key, stream, backoff: 1000, closed: false, reconnectTimer: null, closeTimer: null, bar: null, lastTradeAt: 0 };
        bins.set(key, conn);
        binanceOpen(conn, sub);
      } else {
        // warm re-attach: a pending grace close is cancelled and the live
        // socket is reused — re-entering a view answers on the first tick
        if (conn.closeTimer) {
          clearTimeout(conn.closeTimer);
          conn.closeTimer = null;
        }
        conn.closed = false;
        if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
          sub.active = true;
          handlers.onStatus?.({ active: true, kind: "binance" });
        }
      }
    } else if (sub.kind === "oanda") {
      oandaOpen(sub);
    } else if (sub.kind === "deriv") {
      derivSubscribe(sub);
    }
  } else if (sub.active && sub.kind) {
    handlers.onStatus?.({ active: true, kind: sub.kind });
    if (sub.kind === "deriv" && sub.history.length > 0) emitHistory(sub, handlers);
  }

  return () => {
    sub.cbs.delete(handlers);
    if (sub.cbs.size > 0) return;
    if (sub.kind === "binance") {
      const bins = g.__haloLiveFeedBins;
      const conn = bins?.get(key);
      if (conn) {
        if (conn.reconnectTimer) {
          clearTimeout(conn.reconnectTimer);
          conn.reconnectTimer = null;
        }
        // GRACE-PERIOD CLOSE (mirrors the deriv idle timer): the last
        // viewer leaving a chart no longer slams the socket shut mid-stream
        // — an in-flight server ping arriving after a hard close logs
        // "Ping received after close" in the console. The socket stays
        // warm for BINANCE_GRACE_CLOSE_MS so a quick view switch re-attaches
        // instantly; the timer re-checks subscribers before really closing.
        if (conn.closeTimer) clearTimeout(conn.closeTimer);
        conn.closeTimer = setTimeout(() => {
          conn.closeTimer = null;
          if (sub.cbs.size > 0) return; // re-subscribed during the grace window
          conn.closed = true;
          try {
            conn.ws?.close();
          } catch {
            // already closed
          }
          bins!.delete(key);
        }, BINANCE_GRACE_CLOSE_MS);
      }
    } else if (sub.kind === "oanda") {
      oandaClose(sub);
    } else if (sub.kind === "deriv") {
      derivUnsubscribe(sub);
    }
    subs.delete(key);
  };
}

/** test/diagnostic hook — current stream status for a symbol+tf */
export function liveStatusOf(symbol: string, tf: string): LiveStatus {
  const sub = allSubs().get(subKeyOf(symbol, tf));
  if (!sub) return { active: false, kind: null };
  return { active: sub.active, kind: sub.active ? sub.kind : null, note: sub.note };
}

/** diagnostics — bar updates flowed for a symbol+tf since subscribe */
export function liveStatsOf(symbol: string, tf: string): { active: boolean; kind: LiveFeedKind | null; updates: number } {
  const sub = allSubs().get(subKeyOf(symbol, tf));
  return { active: sub?.active ?? false, kind: sub?.active ? sub.kind ?? null : null, updates: sub?.updates ?? 0 };
}

// browser-only debug hook (used by E2E + the console): window.__haloLiveFeed
if (typeof window !== "undefined") {
  (window as unknown as { __haloLiveFeed?: { stats: typeof liveStatsOf } }).__haloLiveFeed = { stats: liveStatsOf };
}
