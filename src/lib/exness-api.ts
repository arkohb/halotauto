// ════════════════════════════════════════════════════════════════════════
//  EXNESS TRADER API · market data only (www.exness-api.com)
//
//  Cloud price feed from your Exness trading account — no MT5 needed:
//    • candles → GET  /v1/market-data/accounts/{id}/candles   (bid, UTC)
//    • ticks   → WSS  /v1/server-events/accounts/{id}/ws/ticks
//  Every request is signed with your Ed25519 key (EXN-* headers). The base
//  URL is your account's Access Point, discovered once via the Gateway host
//  from Key Management (GET /v1/trading/access-point) and cached.
//
//  .env (server only, never committed):
//    EXNESS_API_KEY        exnsk-…            (public key id)
//    EXNESS_API_SECRET     128 hex chars, or an unencrypted PKCS#8 PEM
//    EXNESS_GATEWAY_URL    https://… (Gateway host from the DNS widget)
//    EXNESS_ACCOUNT_ID     your trading account number
//  Market data only: nothing here places, changes or closes an order.
// ════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import WebSocket from "ws";
import type { Candle } from "./halo/types";
import { tfSec } from "./market-symbols";

interface ExnessCfg {
  apiKey: string;
  key: crypto.KeyObject;
  gateway: string;
  accountId: string;
}

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** 128 hex chars (32-byte seed + 32-byte public) or a PKCS#8 PEM → private KeyObject */
export function loadExnessPrivateKey(secret: string): crypto.KeyObject {
  const s = secret.trim().replace(/\\n/g, "\n");
  if (/^[0-9a-fA-F]{64}([0-9a-fA-F]{64})?$/.test(s)) {
    return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(s.slice(0, 64), "hex")]), format: "der", type: "pkcs8" });
  }
  return crypto.createPrivateKey(s);
}

const g = globalThis as unknown as { __haloExnessCfg?: { sig: string; cfg: ExnessCfg | null; err: string } };

export function exnessConfig(): ExnessCfg | null {
  const apiKey = (process.env.EXNESS_API_KEY ?? "").trim();
  const secret = process.env.EXNESS_API_SECRET ?? "";
  const gateway = (process.env.EXNESS_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
  const accountId = (process.env.EXNESS_ACCOUNT_ID ?? "").trim();
  const sig = `${apiKey}|${gateway}|${accountId}|${secret.length}`;
  if (g.__haloExnessCfg?.sig === sig) return g.__haloExnessCfg.cfg;
  let cfg: ExnessCfg | null = null;
  let err = "";
  if (apiKey && secret && gateway && accountId) {
    try {
      cfg = { apiKey, key: loadExnessPrivateKey(secret), gateway, accountId };
    } catch (e) {
      err = `EXNESS_API_SECRET could not be loaded: ${(e as Error).message}`;
    }
  }
  g.__haloExnessCfg = { sig, cfg, err };
  return cfg;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** the EXN-* headers for one request (path = path + query exactly as sent) */
export function exnessHeaders(cfg: Pick<ExnessCfg, "apiKey" | "key">, method: string, path: string, body = "", idempotencyKey = "", now = Date.now()): Record<string, string> {
  const payload = {
    api_key: cfg.apiKey,
    idempotency_key: idempotencyKey,
    timestamp: now,
    sign_version: 1,
    method: method.toUpperCase(),
    path,
    body_hash: b64url(crypto.createHash("sha256").update(body).digest()),
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    "EXN-API-KEY": cfg.apiKey,
    "EXN-IDEMPOTENCY-KEY": idempotencyKey,
    "EXN-TIMESTAMP": String(now),
    "EXN-SIGN-VERSION": "1",
    "EXN-DATA": b64url(bytes),
    "EXN-SIGN": b64url(crypto.sign(null, bytes, cfg.key)),
  };
}

async function signedGet<T>(cfg: ExnessCfg, base: string, path: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(`${base}${path}`, { headers: { ...exnessHeaders(cfg, "GET", path), Accept: "application/json" }, signal: ctrl.signal, cache: "no-store" });
    const text = await r.text();
    if (!r.ok) throw new Error(`Exness HTTP ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────── access point + instruments ─────────────────────────

const mem = globalThis as unknown as {
  __haloExnessAp?: { at: number; url: string };
  __haloExnessInst?: { at: number; names: string[] };
};
const AP_TTL = 6 * 3_600_000;
const INST_TTL = 3_600_000;

export async function accessPoint(cfg: ExnessCfg): Promise<string> {
  const c = mem.__haloExnessAp;
  if (c && Date.now() - c.at < AP_TTL) return c.url;
  const j = await signedGet<{ access_point?: string }>(cfg, cfg.gateway, `/v1/trading/access-point?account_id=${encodeURIComponent(cfg.accountId)}`);
  // https only — plain http is accepted solely for a local test server
  if (!j.access_point || !(/^https:\/\//.test(j.access_point) || /^http:\/\/127\.0\.0\.1(:\d+)?\/?$/.test(j.access_point))) throw new Error("Exness gateway returned no valid access point");
  mem.__haloExnessAp = { at: Date.now(), url: j.access_point.replace(/\/+$/, "") };
  return mem.__haloExnessAp.url;
}

async function instruments(cfg: ExnessCfg): Promise<string[]> {
  const c = mem.__haloExnessInst;
  if (c && Date.now() - c.at < INST_TTL) return c.names;
  const base = await accessPoint(cfg);
  const j = await signedGet<{ instruments?: Array<string | { name?: string }> }>(cfg, base, `/v1/configuration/accounts/${encodeURIComponent(cfg.accountId)}/instruments`);
  const names = (j.instruments ?? []).map((x) => (typeof x === "string" ? x : String(x.name ?? ""))).filter(Boolean);
  mem.__haloExnessInst = { at: Date.now(), names };
  return names;
}

/** HALO symbol → this account's instrument name (exact, else the same name with a short suffix, e.g. XAUUSDm) */
export async function resolveInstrument(cfg: ExnessCfg, symbol: string): Promise<string | null> {
  const names = await instruments(cfg);
  if (names.includes(symbol)) return symbol;
  return names.find((n) => n.startsWith(symbol) && n.length <= symbol.length + 4) ?? null;
}

// ───────────────────────── candles ─────────────────────────

const TF: Record<string, string> = { "1m": "M1", "3m": "M3", "5m": "M5", "15m": "M15", "30m": "M30", "1h": "H1", "2h": "H2", "4h": "H4", "1d": "D1" };

export async function exnessCandles(symbol: string, tf: string, limit: number): Promise<Candle[]> {
  const cfg = exnessConfig();
  if (!cfg) throw new Error("Exness API not configured");
  const timeframe = TF[tf];
  if (!timeframe) throw new Error(`timeframe ${tf} not offered by Exness`);
  const inst = await resolveInstrument(cfg, symbol);
  if (!inst) throw new Error(`${symbol} is not available on this Exness account`);
  const base = await accessPoint(cfg);
  const tfMs = tfSec(tf) * 1000;
  // a window wide enough to hold `limit` bars across weekends; shrink if the account's candle limit is lower
  let span = Math.ceil(limit * 1.6) + 4;
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = Date.now();
    const from = new Date(Math.floor((now - span * tfMs) / tfMs) * tfMs).toISOString();
    const to = new Date(Math.floor(now / tfMs) * tfMs + tfMs).toISOString();
    const path = `/v1/market-data/accounts/${encodeURIComponent(cfg.accountId)}/candles?instrument=${encodeURIComponent(inst)}&timeframe=${timeframe}&price_type=bid&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    try {
      const j = await signedGet<{ candles?: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }> }>(cfg, base, path);
      const out = (j.candles ?? [])
        .map((c) => ({ time: Date.parse(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume ?? 0) }))
        .filter((c) => Number.isFinite(c.time) && c.close > 0 && c.high >= c.low)
        .sort((a, b) => a.time - b.time);
      return out.slice(-limit);
    } catch (e) {
      // too wide for this account's candle limit → halve the window and retry
      if (/INVALID_TIME_RANGE|INVALID_COUNT|limit/i.test((e as Error).message) && span > 10) {
        span = Math.ceil(span / 2);
        continue;
      }
      throw e;
    }
  }
  throw new Error("Exness candle request kept exceeding the account's candle limit");
}

// ───────────────────────── live ticks ─────────────────────────

export interface ExnessTick {
  bid: number;
  ask: number;
  time: number; // UTC ms
}
type TickFn = (t: ExnessTick) => void;

interface TickHub {
  ws: WebSocket | null;
  connecting: boolean;
  listeners: Map<string, Set<TickFn>>; // Exness instrument name → listeners
  last: Map<string, ExnessTick>;
  backoff: number;
  seq: number;
}
const gh = globalThis as unknown as { __haloExnessTicks?: TickHub };
const hub: TickHub = (gh.__haloExnessTicks ??= { ws: null, connecting: false, listeners: new Map(), last: new Map(), backoff: 1000, seq: 0 });

function subscribeOnSocket(names: string[]): void {
  if (!hub.ws || hub.ws.readyState !== WebSocket.OPEN || names.length === 0) return;
  hub.seq += 1;
  hub.ws.send(JSON.stringify({ id: `halo-ticks-${hub.seq}`, subscribe: { event: "ticks", instruments: names } }));
}

async function connectTicks(): Promise<void> {
  const cfg = exnessConfig();
  if (!cfg || hub.connecting || (hub.ws && hub.ws.readyState <= WebSocket.OPEN)) return;
  hub.connecting = true;
  try {
    const base = await accessPoint(cfg);
    const path = `/v1/server-events/accounts/${encodeURIComponent(cfg.accountId)}/ws/ticks`;
    const ws = new WebSocket(`${base.replace(/^http/, "ws")}${path}`, ["exness-ws-protocol"], { headers: exnessHeaders(cfg, "GET", path), handshakeTimeout: 10_000 });
    hub.ws = ws;
    ws.on("open", () => {
      hub.backoff = 1000;
      subscribeOnSocket([...hub.listeners.keys()]);
    });
    ws.on("message", (raw) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      // tick payloads: { instrument, bid, ask, timestamp } (possibly wrapped in "data"/"tick")
      const t = (m.data ?? m.tick ?? m) as Record<string, unknown>;
      const inst = String(t.instrument ?? "");
      const bid = Number(t.bid);
      const ask = Number(t.ask);
      if (!inst || !(bid > 0)) return;
      const ts = typeof t.timestamp === "string" ? Date.parse(t.timestamp) : Number(t.timestamp ?? t.time ?? Date.now());
      const tick = { bid, ask: ask > 0 ? ask : bid, time: Number.isFinite(ts) ? ts : Date.now() };
      hub.last.set(inst, tick);
      for (const fn of hub.listeners.get(inst) ?? []) {
        try {
          fn(tick);
        } catch {
          // a dead listener never stops the stream
        }
      }
    });
    const retry = () => {
      if (hub.ws === ws) hub.ws = null;
      if (hub.listeners.size === 0) return;
      const wait = hub.backoff;
      hub.backoff = Math.min(hub.backoff * 2, 30_000);
      setTimeout(() => void connectTicks(), wait);
    };
    ws.on("close", retry);
    ws.on("error", () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    });
  } catch {
    hub.ws = null;
    const wait = hub.backoff;
    hub.backoff = Math.min(hub.backoff * 2, 30_000);
    if (hub.listeners.size > 0) setTimeout(() => void connectTicks(), wait);
  } finally {
    hub.connecting = false;
  }
}

/** live Exness ticks for a HALO symbol; returns unsubscribe (null when unavailable) */
export async function subscribeExnessTicks(symbol: string, fn: TickFn): Promise<(() => void) | null> {
  const cfg = exnessConfig();
  if (!cfg) return null;
  const inst = await resolveInstrument(cfg, symbol).catch(() => null);
  if (!inst) return null;
  let set = hub.listeners.get(inst);
  const fresh = !set;
  if (!set) hub.listeners.set(inst, (set = new Set()));
  set.add(fn);
  const last = hub.last.get(inst);
  if (last) fn(last);
  if (!hub.ws) void connectTicks();
  else if (fresh) subscribeOnSocket([inst]);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) hub.listeners.delete(inst);
    if (hub.listeners.size === 0 && hub.ws) {
      const ws = hub.ws;
      hub.ws = null;
      ws.close();
    }
  };
}

/** is the Exness API configured (credentials present and the key loads)? */
export function exnessStatus(): { configured: boolean; error: string } {
  const cfg = exnessConfig();
  return { configured: !!cfg, error: g.__haloExnessCfg?.err ?? "" };
}

/** tests only */
export function resetExnessCaches(): void {
  mem.__haloExnessAp = undefined;
  mem.__haloExnessInst = undefined;
  g.__haloExnessCfg = undefined;
  hub.last.clear();
}
