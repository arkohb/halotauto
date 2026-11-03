// ════════════════════════════════════════════════════════════════════════
//  OANDA PRACTICE FEED · market data only (never orders)
//
//  The same OANDA prices TradingView charts as OANDA:XAUUSD / OANDA:EURUSD,
//  read from a free fxTrade Practice account:
//    • candles → REST /v3/instruments/{inst}/candles (BID, like TradingView)
//    • ticks   → one streaming connection per instrument
//                (stream-fxpractice …/pricing/stream), fanned out to every
//                chart viewer through /api/market/stream (SSE)
//  The token stays on the server. Unset → every caller falls back (Yahoo
//  candles, no tick stream).
//
//  ⚠ Market data only — nothing here can place, modify or close a trade.
// ════════════════════════════════════════════════════════════════════════

import type { Candle } from "./halo/types";
import { getSymbolMeta, tfSec } from "./market-symbols";

const REST = "https://api-fxpractice.oanda.com";
const STREAM = "https://stream-fxpractice.oanda.com";

interface OandaConfig {
  token: string;
  account: string;
}

export function oandaConfig(): OandaConfig | null {
  const token = (process.env.OANDA_PRACTICE_TOKEN ?? "").trim();
  const account = (process.env.OANDA_PRACTICE_ACCOUNT ?? "").trim();
  if (!token || !account) return null;
  return { token, account };
}

/** HALO symbol → OANDA instrument (forex + metals only), null when not on OANDA */
export function oandaInstrument(sym: string): string | null {
  const g = getSymbolMeta(sym).group;
  if (g !== "FOREX" && g !== "METALS") return null;
  if (!/^[A-Z]{6}$/.test(sym)) return null;
  return `${sym.slice(0, 3)}_${sym.slice(3)}`;
}

// tf → [OANDA granularity, minutes per OANDA bar, bars aggregated into one HALO bar]
const GRAN: Record<string, [string, number]> = {
  "1m": ["M1", 1],
  "3m": ["M1", 3], // OANDA has no M3 — aggregate on 3-minute UTC boundaries
  "5m": ["M5", 1],
  "15m": ["M15", 1],
  "30m": ["M30", 1],
  "1h": ["H1", 1],
  "2h": ["H2", 1],
  "4h": ["H4", 1],
  "1d": ["D", 1],
};

function authHeaders(cfg: OandaConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.token}`, "Accept-Datetime-Format": "UNIX" };
}

/** fold bars into tf buckets aligned to UTC epoch boundaries (bar open time) */
function bucket(src: Candle[], tfMs: number): Candle[] {
  const out: Candle[] = [];
  for (const c of src) {
    const t = Math.floor(c.time / tfMs) * tfMs;
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume = (last.volume || 0) + (c.volume || 0);
    } else {
      out.push({ ...c, time: t });
    }
  }
  return out;
}

export async function fetchOandaCandles(sym: string, tf: string, limit: number): Promise<Candle[]> {
  const cfg = oandaConfig();
  const inst = oandaInstrument(sym);
  if (!cfg || !inst) throw new Error("oanda not configured for this symbol");
  const [gran, mult] = GRAN[tf] ?? ["M5", 1];
  const count = Math.min(5000, Math.max(2, limit * mult + mult));
  const url =
    `${REST}/v3/instruments/${inst}/candles?granularity=${gran}&count=${count}` +
    `&price=B&alignmentTimezone=UTC&dailyAlignment=0`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: authHeaders(cfg), signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`oanda HTTP ${r.status}`);
    const j = (await r.json()) as {
      candles?: Array<{ time: string; volume?: number; bid?: { o: string; h: string; l: string; c: string } }>;
    };
    const rows: Candle[] = [];
    for (const c of j.candles ?? []) {
      if (!c.bid) continue;
      const bar = {
        time: Math.round(Number(c.time) * 1000),
        open: Number(c.bid.o),
        high: Number(c.bid.h),
        low: Number(c.bid.l),
        close: Number(c.bid.c),
        volume: Number(c.volume ?? 0),
      };
      if (isFinite(bar.time) && bar.close > 0 && bar.high >= bar.low) rows.push(bar);
    }
    return (mult > 1 ? bucket(rows, tfSec(tf) * 1000) : rows).slice(-limit);
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────── tick stream hub ─────────────────────────

export interface OandaTick {
  time: number; // ms
  bid: number;
  ask: number;
}

type TickFn = (t: OandaTick) => void;

interface Upstream {
  inst: string;
  listeners: Set<TickFn>;
  ctrl: AbortController | null;
  backoff: number;
  last: OandaTick | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// one hub per process (dev bundles each route separately → globalThis)
const gHub = globalThis as unknown as { __haloOandaHub?: Map<string, Upstream> };
const hub = (gHub.__haloOandaHub ??= new Map<string, Upstream>());

const IDLE_MS = 30_000;

async function runUpstream(up: Upstream): Promise<void> {
  const cfg = oandaConfig();
  if (!cfg) return;
  const ctrl = new AbortController();
  up.ctrl = ctrl;
  try {
    const r = await fetch(
      `${STREAM}/v3/accounts/${encodeURIComponent(cfg.account)}/pricing/stream?instruments=${up.inst}`,
      { headers: authHeaders(cfg), signal: ctrl.signal, cache: "no-store" }
    );
    if (!r.ok || !r.body) throw new Error(`oanda stream HTTP ${r.status}`);
    up.backoff = 1000;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let m: { type?: string; time?: string; bids?: Array<{ price: string }>; asks?: Array<{ price: string }> };
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.type !== "PRICE") continue; // HEARTBEAT every ~5 s
        const tick = {
          time: Math.round(Number(m.time) * 1000),
          bid: Number(m.bids?.[0]?.price),
          ask: Number(m.asks?.[0]?.price),
        };
        if (!isFinite(tick.time) || !(tick.bid > 0)) continue;
        up.last = tick;
        for (const fn of up.listeners) {
          try {
            fn(tick);
          } catch {
            // a dead listener never stops the stream
          }
        }
      }
    }
  } catch {
    // aborted or dropped — reconnect below while anyone is listening
  } finally {
    up.ctrl = null;
  }
  if (up.listeners.size > 0 && !ctrl.signal.aborted) {
    const wait = up.backoff;
    up.backoff = Math.min(up.backoff * 2, 30_000);
    setTimeout(() => {
      if (up.listeners.size > 0 && !up.ctrl) void runUpstream(up);
    }, wait);
  }
}

/** subscribe to live OANDA ticks for an instrument; returns unsubscribe */
export function subscribeOandaTicks(inst: string, fn: TickFn): () => void {
  let up = hub.get(inst);
  if (!up) {
    up = { inst, listeners: new Set(), ctrl: null, backoff: 1000, last: null, idleTimer: null };
    hub.set(inst, up);
  }
  const u = up;
  if (u.idleTimer) {
    clearTimeout(u.idleTimer);
    u.idleTimer = null;
  }
  u.listeners.add(fn);
  if (u.last) fn(u.last);
  if (!u.ctrl) void runUpstream(u);
  return () => {
    u.listeners.delete(fn);
    if (u.listeners.size > 0 || u.idleTimer) return;
    // keep the upstream warm briefly so view switches re-attach instantly
    u.idleTimer = setTimeout(() => {
      u.idleTimer = null;
      if (u.listeners.size === 0) {
        u.ctrl?.abort();
        hub.delete(inst);
      }
    }, IDLE_MS);
  };
}
