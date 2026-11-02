// ════════════════════════════════════════════════════════════════════════
//  TRADINGVIEW WEBHOOK BRIDGE · attaches the EA to any TradingView chart
//  Pine EA alert (signed JSON) → /api/webhook/tv → THIS pipeline →
//  the linked live broker account (MetaApi MT4/5, OANDA, IG, Binance,
//  bridge) — or a paper record when live routing is off. Server-only.
// ════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { db } from "@/lib/db";
import { gateOrder } from "./edge/gate";
import { engageTradeLock, getTradeLock, maybeReleaseLock } from "./trade-lock";
import { publishBotEvent } from "./halo/event-bus";
import type { FireEvent } from "./halo/types";
import { SYMBOLS, SYMBOL_BY_TV, getSymbolMeta } from "./market-symbols";
import { getKlines } from "./market";
import { getAdapter, parseCreds } from "./brokers";
import { loadExecSettings, resolveBroker, type ActiveBroker } from "./execution";
import { sendAlert } from "./alerts";
import { roundPx } from "./brokers/types";

// ── webhook config (singleton row id="tv") ─────────────────────────────

export interface TvWebhookInfo {
  id: "tv";
  secret: string;
  enabled: boolean;
  fireCount: number;
  lastFireAt: string | null;
}

function genSecret(): string {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += abc[b % abc.length];
  return s;
}

export async function getWebhookInfo(): Promise<TvWebhookInfo> {
  let row = await db.webhookConfig.findUnique({ where: { id: "tv" } });
  if (!row) {
    row = await db.webhookConfig.create({ data: { id: "tv", secret: genSecret() } });
  } else if (!row.secret) {
    row = await db.webhookConfig.update({ where: { id: "tv" }, data: { secret: genSecret() } });
  }
  return {
    id: "tv",
    secret: row.secret,
    enabled: row.enabled,
    fireCount: row.fireCount,
    lastFireAt: row.lastFireAt ? row.lastFireAt.toISOString() : null,
  };
}

export async function regenerateWebhookSecret(): Promise<TvWebhookInfo> {
  await getWebhookInfo(); // ensure row exists
  const row = await db.webhookConfig.update({ where: { id: "tv" }, data: { secret: genSecret() } });
  return {
    id: "tv",
    secret: row.secret,
    enabled: row.enabled,
    fireCount: row.fireCount,
    lastFireAt: row.lastFireAt ? row.lastFireAt.toISOString() : null,
  };
}

export async function setWebhookEnabled(enabled: boolean): Promise<TvWebhookInfo> {
  await getWebhookInfo();
  const row = await db.webhookConfig.update({ where: { id: "tv" }, data: { enabled } });
  return {
    id: "tv",
    secret: row.secret,
    enabled: row.enabled,
    fireCount: row.fireCount,
    lastFireAt: row.lastFireAt ? row.lastFireAt.toISOString() : null,
  };
}

async function bumpFireCount(): Promise<void> {
  try {
    const row = await db.webhookConfig.findUnique({ where: { id: "tv" } });
    if (row) {
      await db.webhookConfig.update({
        where: { id: "tv" },
        data: { fireCount: row.fireCount + 1, lastFireAt: new Date() },
      });
    }
  } catch {
    // non-fatal
  }
}

/** pip size used to convert price distances into pips (mirrors the engine) */
async function pipSizeOf(symbol: string): Promise<number> {
  const meta = getSymbolMeta(symbol);
  let mult = 10;
  try {
    const row = await db.botConfig.findUnique({ where: { id: "main" } });
    if (row) {
      const cfg = JSON.parse(row.configJson) as { pipMult?: number };
      if (cfg?.pipMult) mult = Math.max(1, Math.round(Number(cfg.pipMult) || 10));
    }
  } catch {
    // default 10
  }
  return meta.mintick * mult;
}

// ── payload parsing ─────────────────────────────────────────────────────

export interface TvAlert {
  action: "buy" | "sell" | "close";
  symbol: string; // internal id (EURUSD, XAUUSD, BTCUSDT…)
  rawSymbol: string;
  tf: string;
  price: number; // theoretical entry; 0 → use live feed price
  sl: number;
  tp: number;
  riskPips: number;
  comment: string;
}

/** pull the first JSON object out of a (possibly noisy) webhook body */
export function extractJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    // fall through
  }
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      const j = JSON.parse(t.slice(s, e + 1)) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {
      // not JSON
    }
  }
  return null;
}

const BUY_RE = /^(buy|long|enter[_-]?long|bull|open[_-]?long)/i;
const SELL_RE = /^(sell|short|enter[_-]?short|bear|open[_-]?short)/i;
const CLOSE_RE = /^(close|flat|exit|cover)/i;

/** map any broker/TV symbol spelling ("OANDA:XAUUSD", "xauusd.a", "EURUSD",
 *  "DERIV:VOLATILITY_75_INDEX") to an internal id */
export function resolveSymbol(raw: string): string | null {
  const t = String(raw ?? "").trim().toUpperCase();
  if (!t) return null;
  const tail = t.includes(":") ? (t.split(":").pop() as string) : t;
  // full pro symbol first — TradingView alerts for Deriv synthetics arrive as
  // "DERIV:VOLATILITY_75_INDEX", "DERIV:BOOM_1000_INDEX", …
  if (t.includes(":")) {
    const tvHit = SYMBOL_BY_TV[t];
    if (tvHit) return tvHit;
  }
  for (const cand of [t, tail]) {
    const hit = SYMBOLS.find((s) => s.id === cand);
    if (hit) return hit.id;
  }
  const base = tail.replace(/[^A-Z0-9]/g, "");
  const tvBase = SYMBOL_BY_TV[`DERIV:${tail}`] ?? SYMBOL_BY_TV[base];
  if (tvBase) return tvBase;
  const hit2 = SYMBOLS.find((s) => base.startsWith(s.id));
  return hit2 ? hit2.id : null;
}

export function parseTvAlert(payload: Record<string, unknown>): { alert?: TvAlert; error?: string } {
  const action = String(payload.action ?? payload.order_action ?? payload.side ?? "").trim();
  const rawSymbol = String(payload.symbol ?? payload.ticker ?? payload.sym ?? "").trim();
  if (!rawSymbol) return { error: "Payload has no symbol/ticker field." };

  const symbol = resolveSymbol(rawSymbol);
  if (!symbol) {
    return {
      error: `Unknown symbol "${rawSymbol}" — add it in HALO first (Deriv synthetics, forex majors/crosses/exotics, stock indices, metals and crypto are supported).`,
    };
  }

  let action2: TvAlert["action"];
  if (CLOSE_RE.test(action)) action2 = "close";
  else if (SELL_RE.test(action)) action2 = "sell";
  else if (BUY_RE.test(action)) action2 = "buy";
  else
    return {
      error: `Unknown action "${action || "(empty)"}" — expected buy / sell / close.`,
    };

  const numv = (v: unknown): number => {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  };

  return {
    alert: {
      action: action2,
      symbol,
      rawSymbol,
      tf: String(payload.tf ?? payload.interval ?? payload.timeframe ?? "5m").trim() || "5m",
      price: numv(payload.price ?? payload.close ?? payload.entry),
      sl: numv(payload.sl ?? payload.stop_loss ?? payload.stop),
      tp: numv(payload.tp ?? payload.take_profit ?? payload.target),
      riskPips: numv(payload.riskPips ?? payload.risk_pips),
      comment: String(payload.comment ?? payload.message ?? "TradingView EA alert").slice(0, 120),
    },
  };
}

// ── execution ───────────────────────────────────────────────────────────

export interface TvExecResult {
  ok: boolean;
  status: number; // suggested HTTP status for the receiver
  mode?: "PAPER" | "LIVE";
  tradeId?: string;
  broker?: string;
  detail?: string;
  error?: string;
}

export async function processTvAlert(
  alert: TvAlert,
  opts: { forcePaper?: boolean; source?: string } = {}
): Promise<TvExecResult> {
  const info = await getWebhookInfo();
  const exec = await loadExecSettings();
  const live = !opts.forcePaper && info.enabled && exec.executionMode === "live";
  const src = opts.source ?? "TV";

  const meta = getSymbolMeta(alert.symbol);
  const pip = await pipSizeOf(alert.symbol);

  // current feed price (paper entry + close bookkeeping)
  let feedPx = 0;
  if (!alert.price || alert.action === "close") {
    try {
      const k = await getKlines(alert.symbol, alert.tf, 1, { fresh: true });
      feedPx = k.candles[k.candles.length - 1]?.close ?? 0;
    } catch {
      feedPx = 0;
    }
  }

  // ═══ CLOSE ═══
  if (alert.action === "close") {
    // only a trade TradingView itself opened — a close alert must never
    // close a position the bot, scanner or sweep is managing
    const open = await db.trade.findFirst({
      where: { symbol: alert.symbol, status: "OPEN", mode: src },
      orderBy: { openedAt: "desc" },
    });
    if (!open) {
      return { ok: true, status: 200, detail: "No open trade to close — nothing done." };
    }
    if (open.execMode === "LIVE" && open.brokerKind) {
      let acct = await resolveBroker(exec.brokerAccountId);
      if (!acct || acct.kind !== open.brokerKind) {
        const row = await db.brokerAccount.findFirst({
          where: { kind: open.brokerKind },
          orderBy: { createdAt: "desc" },
        });
        acct = row
          ? ({ id: row.id, kind: row.kind as ActiveBroker["kind"], label: row.label, credsJson: row.credsJson } as ActiveBroker)
          : null;
      }
      if (acct) {
        const adapter = getAdapter(acct.kind);
        await adapter
          .closePosition(parseCreds(acct.credsJson), alert.symbol)
          .catch(() => null);
      }
    }
    const exitPx = feedPx || open.entry;
    const resultPips = ((exitPx - open.entry) * open.direction) / pip;
    await db.trade.update({
      where: { id: open.id },
      data: {
        status: resultPips >= 0 ? "WIN" : "LOSS",
        resultPips: Math.abs(resultPips),
        closedAt: new Date(),
        note: `${open.note} | TV close`.slice(0, 250),
      },
    });
    void sendAlert({
      kind: resultPips >= 0 ? "win" : "loss",
      title: `HALO 3EL · TV CLOSE ${resultPips >= 0 ? "+" : "−"}${Math.abs(resultPips).toFixed(1)} PIPS · ${meta.label.split("·")[0].trim()}`,
      body: `TradingView EA closed the ${open.direction === -1 ? "SELL" : "BUY"} at ${roundPx(exitPx)}.`,
    });
    await bumpFireCount();
    // GLOBAL TRADE LOCK release — scanning everywhere resumes
    const lock = getTradeLock();
    if (lock && lock.source === "TV" && lock.symbol === alert.symbol) {
      maybeReleaseLock("TV", alert.symbol, lock.tf, resultPips >= 0 ? "win" : "loss", Math.abs(resultPips));
    }
    return { ok: true, status: 200, mode: open.execMode === "LIVE" ? "LIVE" : "PAPER", tradeId: open.id, detail: "closed" };
  }

  // ═══ OPEN (buy / sell) ═══
  const dir: -1 | 1 = alert.action === "sell" ? -1 : 1;
  const entry = alert.price || feedPx;
  if (!entry || entry <= 0) {
    return { ok: false, status: 400, error: "No entry price available (payload price missing and feed unreachable)." };
  }
  const riskDist = Math.abs(entry - alert.sl);
  const riskPips = alert.sl ? riskDist / pip : alert.riskPips;
  const rewardPips = alert.tp ? Math.abs(alert.tp - entry) / pip : riskPips * 3;
  const label = meta.label.split("·")[0].trim() || alert.symbol;

  const refuse = (reason: string): TvExecResult => {
    void sendAlert({
      kind: "status",
      title: `HALO 3EL · TV ${dir === -1 ? "SELL" : "BUY"} NOT EXECUTED · ${label}`,
      body: `TradingView alert ${alert.symbol} ${alert.tf} @ ${roundPx(entry)} was refused — ${reason}.`,
    });
    publishBotEvent({
      kind: "status",
      prio: "low",
      symbol: alert.symbol,
      tf: alert.tf,
      time: Date.now(),
      title: `TV ALERT REFUSED · ${label}`,
      spoken: `A TradingView ${dir === -1 ? "sell" : "buy"} alert on ${label} was not traded. ${reason}.`,
    });
    return { ok: false, status: 409, error: `Not executed — ${reason}.` };
  };

  // ── ONE TRADE AT A TIME (global trade lock) ──
  // the bot trades the same 3EL signals itself; without this a TradingView
  // alert would open a second position on the very same setup
  const lock = getTradeLock();
  if (lock) return refuse(`a trade is already running on ${lock.symbol} ${lock.tf} (${lock.source})`);

  // ── EDGE gate: Signal Quality Score + Capital Guardian ──
  const fire: FireEvent = {
    type: "fire",
    dir,
    entry,
    sl: alert.sl,
    tp: alert.tp,
    risk: riskDist,
    riskPips: riskPips || 0,
    rewardPips,
    levelTop: 0,
    levelBot: 0,
    ext: entry, // TradingView does not send the C3 break extreme
    time: Date.now(),
    message: alert.comment,
  };
  const gate = await gateOrder(alert.symbol, alert.tf, fire);
  if (!gate.allow) return refuse(gate.reason);
  const mult = gate.sizeMult;
  const edgeFields = { grade: gate.grade?.score ?? null, gradeLetter: gate.grade?.letter ?? "", sizeMult: mult };
  const lockFor = (tradeDbId: string): void =>
    engageTradeLock({ source: "TV", symbol: alert.symbol, tf: alert.tf, dir, entry, sl: alert.sl, tp: alert.tp, tradeDbId, openedAt: Date.now() });

  const base = {
    mode: src,
    symbol: alert.symbol,
    timeframe: alert.tf,
    direction: dir,
    entry,
    sl: alert.sl,
    tp: alert.tp,
    riskPips: riskPips || riskDist / pip,
    rewardPips,
    levelTop: 0,
    levelBot: 0,
    slMode: "Webhook alert",
    openedAt: new Date(),
    ...edgeFields,
  };

  // ── PAPER ──
  if (!live) {
    const tr = await db.trade.create({
      data: { ...base, execMode: "PAPER", status: "OPEN", note: alert.comment.slice(0, 250) },
    });
    lockFor(tr.id);
    await bumpFireCount();
    void sendAlert({
      kind: "fire",
      title: `HALO 3EL · TV ${dir === -1 ? "SELL" : "BUY"} · ${meta.label.split("·")[0].trim()}`,
      body: `${alert.comment}\nSymbol: ${alert.symbol} · TF ${alert.tf}\nEntry ${roundPx(entry)} · SL ${roundPx(alert.sl)} · TP ${roundPx(alert.tp)}\nMode: PAPER (live routing off)`,
    });
    return { ok: true, status: 200, mode: "PAPER", tradeId: tr.id };
  }

  // ── LIVE → linked broker account ──
  if (!alert.sl) {
    const tr = await db.trade.create({
      data: { ...base, execMode: "LIVE", status: "REJECTED", note: "webhook alert had no SL" },
    });
    void tr;
    return { ok: false, status: 400, error: "Live orders require an SL in the alert payload (sl)." };
  }

  const broker = await resolveBroker(exec.brokerAccountId);
  if (!broker) {
    const tr = await db.trade.create({
      data: { ...base, execMode: "LIVE", status: "REJECTED", note: "no linked broker account" },
    });
    void tr;
    void sendAlert({
      kind: "broker",
      title: "HALO 3EL · TV ORDER SKIPPED",
      body: `No linked broker account. Link one in BROKERS (MT login card) and press GO LIVE. Signal: ${alert.symbol} ${dir === -1 ? "SELL" : "BUY"}`,
    });
    return {
      ok: false,
      status: 409,
      error: "No linked broker account — open BROKERS, connect via the MT4/MT5 login card (or any broker API) and press GO LIVE.",
    };
  }

  const adapter = getAdapter(broker.kind);
  const res = await adapter.marketOrder(parseCreds(broker.credsJson), {
    symbol: alert.symbol,
    side: dir,
    entry,
    sl: alert.sl,
    tp: alert.tp,
    riskDistance: riskDist,
    riskPips: riskPips,
    sizing:
      exec.sizingMode === "percent"
        ? { mode: "percent", percent: Math.max(0.01, exec.sizePercent * mult), size: 0 }
        : { mode: "fixed", size: Math.max(0.01, Math.round(exec.sizeFixed * mult * 100) / 100), percent: 0 },
    comment: `HALO3EL ${src}`,
  });

  if (!res.ok) {
    await db.trade.create({
      data: {
        ...base,
        execMode: "LIVE",
        brokerKind: broker.kind,
        status: "REJECTED",
        note: (res.error ?? "unknown error").slice(0, 250),
      },
    });
    void sendAlert({
      kind: "broker",
      title: `HALO 3EL · ${broker.label} TV ORDER REJECTED`,
      body: `${alert.symbol} ${dir === -1 ? "SELL" : "BUY"} @ ${roundPx(entry)} — ${res.error ?? "unknown error"}`,
    });
    await bumpFireCount();
    return { ok: false, status: 502, error: res.error ?? "Broker rejected the order." };
  }

  const tr = await db.trade.create({
    data: {
      ...base,
      execMode: "LIVE",
      brokerKind: broker.kind,
      brokerOrderId: (res.brokerOrderId ?? "").slice(0, 120),
      status: "OPEN",
      note: alert.comment.slice(0, 250),
    },
  });
  lockFor(tr.id);
  await bumpFireCount();
  void sendAlert({
    kind: "fire",
    title: `HALO 3EL · TV ${dir === -1 ? "SELL" : "BUY"} FILLED · ${meta.label.split("·")[0].trim()}`,
    body: `${alert.comment}\nSymbol: ${alert.symbol} · TF ${alert.tf}\nEntry ${roundPx(res.fillPrice ?? entry)} · SL ${roundPx(alert.sl)} · TP ${roundPx(alert.tp)}\nMode: LIVE · ${broker.label}`,
  });
  return { ok: true, status: 200, mode: "LIVE", tradeId: tr.id, broker: broker.label };
}

/** constant-time secret compare (hashing first hides the length too) */
export function secretMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ── replay protection ──────────────────────────────────────────────────
// Every alert must carry `ts` (TradingView `timenow`, epoch ms) and `id`
// (a per-event id built by the Pine EA). An alert is accepted only when it
// is fresh and its id has never been accepted before. The id is claimed in
// the TvAlertEvent table BEFORE any execution: the primary-key insert is
// atomic, so concurrent copies and replays after a restart both fail.

export const TV_MAX_AGE_MS = Math.max(15, Math.min(900, Number(process.env.HALO_TV_MAX_AGE_SEC) || 120)) * 1000;
export const TV_MAX_FUTURE_MS = 30_000;
const EVENT_ID_RE = /^[A-Za-z0-9:._|+!/^=\-]{8,200}$/;

export type FreshnessResult = { ok: true; ts: number; eventId: string } | { ok: false; status: number; error: string };

/** validate the alert's timestamp + event id (no side effects) */
export function checkAlertFreshness(payload: Record<string, unknown>, now = Date.now()): FreshnessResult {
  const rawTs = payload.ts ?? payload.timestamp;
  const eventId = String(payload.id ?? payload.eventId ?? "").trim();
  if (rawTs === undefined || rawTs === null || rawTs === "" || !eventId) {
    return {
      ok: false,
      status: 400,
      error: "Alert has no timestamp/event id — re-copy the Pine EA from Settings → EA attach (alerts now carry \"ts\" and \"id\").",
    };
  }
  const ts = Number(rawTs);
  if (!Number.isFinite(ts) || ts < 1e12 || ts > 1e14) {
    return { ok: false, status: 400, error: "Alert timestamp is malformed (expected epoch milliseconds)." };
  }
  if (!EVENT_ID_RE.test(eventId)) {
    return { ok: false, status: 400, error: "Alert event id is malformed." };
  }
  if (ts > now + TV_MAX_FUTURE_MS) {
    return { ok: false, status: 400, error: "Alert timestamp is in the future — check the clock." };
  }
  if (now - ts > TV_MAX_AGE_MS) {
    return { ok: false, status: 410, error: `Alert expired — older than ${Math.round(TV_MAX_AGE_MS / 1000)} s.` };
  }
  return { ok: true, ts, eventId };
}

let lastPrune = 0;

/** claim an event id; false when it was already accepted (duplicate / replay) */
export async function claimAlertEvent(eventId: string, alert: TvAlert, ts: number): Promise<boolean> {
  const id = crypto.createHash("sha256").update(eventId, "utf8").digest("hex");
  try {
    await db.tvAlertEvent.create({ data: { id, action: alert.action, symbol: alert.symbol, alertTs: new Date(ts) } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return false; // unique violation → seen before
    throw e;
  }
  if (Date.now() - lastPrune > 3_600_000) {
    lastPrune = Date.now();
    void db.tvAlertEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } }).catch(() => {});
  }
  return true;
}
