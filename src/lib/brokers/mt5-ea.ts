// ════════════════════════════════════════════════════════════════════════
//  MT5 EA BRIDGE adapter · real orders through YOUR running MetaTrader 5
//
//  Free alternative to the MetaApi cloud: the HALO Bridge EA
//  (mt5/HALO_Bridge.mq5) runs inside the trader's own MT5 terminal and
//  POLLS HALO every ~0.5 s (MT5 cannot accept incoming connections):
//
//    EA → POST /api/bridge/mt5   header X-HALO-EA-KEY: <pairing key>
//         body { account:{…}, results:[{ id, ok, … }] }
//    ←    text/plain, one command per line (tab-separated):
//         id  action  symbol  side  sl  tp  sizeMode  size  percent  riskDistance  ticket  comment
//
//  Commands wait in an in-memory queue per pairing key (single instance).
//  An order the EA never collected is a clean rejection; an order it
//  collected but did not confirm in time is reported as a TIMEOUT so the
//  execution lock marks it UNCERTAIN (never retried blindly).
// ════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import type {
  OrderLookup,
  AccountInfo,
  BrokerAdapter,
  BrokerCreds,
  OrderRequest,
  OrderResult,
  PositionInfo,
  QuoteResult,
} from "./types";
import { num } from "./types";

/** EA silent for longer than this → offline */
const ONLINE_MS = 6_000;
const KEY_MIN = 24;
const MAX_CHANNELS = 200;

export interface EaAccount {
  login?: string;
  server?: string;
  company?: string;
  currency?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  leverage?: number;
  /** "demo" | "real" | "contest" — from ACCOUNT_TRADE_MODE */
  mode?: string;
}

export interface EaResult {
  id: string;
  ok: boolean;
  error?: string;
  orderId?: string;
  price?: number;
  volume?: number;
  bid?: number;
  ask?: number;
  time?: number;
  positions?: Array<Record<string, unknown>>;
  /** lookup: open | closed | absent */
  status?: string;
  detail?: string;
}

interface Cmd {
  id: string;
  line: string;
  sentAt: number | null;
  resolve: (r: EaResult) => void;
}

interface Channel {
  queue: Cmd[];
  inflight: Map<string, Cmd>;
  lastSeen: number;
  account: EaAccount | null;
}

const gEa = globalThis as unknown as { __haloMt5Ea?: Map<string, Channel> };
const channels = (gEa.__haloMt5Ea ??= new Map<string, Channel>());

export function channelId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function eaKey(creds: BrokerCreds): string {
  return String(creds.eaKey ?? "").trim();
}

function channelFor(id: string, create: boolean): Channel | null {
  let ch = channels.get(id);
  if (!ch && create && channels.size < MAX_CHANNELS) {
    ch = { queue: [], inflight: new Map(), lastSeen: 0, account: null };
    channels.set(id, ch);
  }
  return ch ?? null;
}

/** one field of a command line — tabs/newlines can never break the framing */
function f(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/[\t\r\n|]/g, " ").slice(0, 40);
}

let seq = 0;
function nextId(): string {
  seq = (seq + 1) % 1_000_000;
  return `${Date.now().toString(36)}${seq.toString(36)}`;
}

class EaOffline extends Error {}

/** queue a command for the EA and wait for its result */
function call(
  creds: BrokerCreds,
  action: string,
  args: { symbol?: string; side?: number; sl?: number; tp?: number; mode?: string; size?: number; percent?: number; riskDistance?: number; ticket?: string; comment?: string },
  timeoutMs: number,
  id = nextId()
): Promise<EaResult> {
  const key = eaKey(creds);
  if (key.length < KEY_MIN) return Promise.reject(new Error(`pairing key missing or shorter than ${KEY_MIN} characters`));
  const ch = channelFor(channelId(key), true);
  if (!ch) return Promise.reject(new Error("too many MT5 EA channels"));
  if (Date.now() - ch.lastSeen > ONLINE_MS) {
    return Promise.reject(new EaOffline("MT5 EA offline — open MetaTrader 5 with the HALO Bridge EA attached (AutoTrading on)"));
  }
  const line = [
    id,
    action,
    f(args.symbol),
    f(args.side),
    f(args.sl),
    f(args.tp),
    f(args.mode),
    f(args.size),
    f(args.percent),
    f(args.riskDistance),
    f(args.ticket),
    f(args.comment),
  ].join("\t");
  return new Promise<EaResult>((resolve, reject) => {
    const cmd: Cmd = { id, line, sentAt: null, resolve: () => {} };
    const timer = setTimeout(() => {
      ch.inflight.delete(id);
      const qi = ch.queue.indexOf(cmd);
      if (qi >= 0) ch.queue.splice(qi, 1);
      // collected but unconfirmed → TIMEOUT (uncertain); never collected → offline (clean reject)
      reject(
        cmd.sentAt
          ? new Error(`MT5 EA timed out confirming "${action}" — check the MT5 Trade/Journal tabs before retrying`)
          : new EaOffline(`MT5 EA did not collect the "${action}" command — is MT5 running with the EA attached?`)
      );
    }, timeoutMs);
    cmd.resolve = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    ch.queue.push(cmd);
  });
}

/** EA poll: record presence + results, hand over queued commands */
export function eaPoll(key: string, account: EaAccount | null, results: EaResult[]): string[] | null {
  if (key.length < KEY_MIN) return null;
  const ch = channelFor(channelId(key), true);
  if (!ch) return null;
  ch.lastSeen = Date.now();
  if (account) ch.account = account;
  for (const r of results) {
    const cmd = ch.inflight.get(String(r.id));
    if (!cmd) continue; // late result for a timed-out command — the lock already marked it
    ch.inflight.delete(cmd.id);
    cmd.resolve(r);
  }
  const out: string[] = [];
  while (ch.queue.length > 0 && out.length < 10) {
    const cmd = ch.queue.shift()!;
    cmd.sentAt = Date.now();
    ch.inflight.set(cmd.id, cmd);
    out.push(cmd.line);
  }
  return out;
}

/** presence for the UI / status checks */
export function eaPresence(creds: BrokerCreds): { online: boolean; lastSeen: number; account: EaAccount | null } {
  const key = eaKey(creds);
  const ch = key.length >= KEY_MIN ? channels.get(channelId(key)) : undefined;
  return { online: !!ch && Date.now() - ch.lastSeen <= ONLINE_MS, lastSeen: ch?.lastSeen ?? 0, account: ch?.account ?? null };
}

function accountInfo(a: EaAccount): AccountInfo {
  return {
    ok: true,
    id: a.login ? `mt5-${a.login}` : "mt5-ea",
    login: a.login,
    server: a.server,
    brokerName: a.company,
    platform: "mt5",
    currency: a.currency ?? "USD",
    balance: num(a.balance, 0),
    equity: num(a.equity, 0),
    margin: num(a.margin, 0),
    freeMargin: num(a.freeMargin, 0),
    leverage: num(a.leverage, 0) || undefined,
  };
}

const sym = (creds: BrokerCreds, s: string) => creds.symbolMap?.[s] ?? s;

async function testConnection(creds: BrokerCreds): Promise<AccountInfo> {
  try {
    const r = await call(creds, "ping", {}, 8000);
    if (!r.ok) return { ok: false, error: r.error ?? "EA refused ping" };
    const a = eaPresence(creds).account;
    if (!a) return { ok: false, error: "EA answered without account details" };
    if (a.mode !== "demo") return { ok: false, error: `this MT5 account is ${a.mode ?? "not confirmed as demo"} — the HALO Bridge is limited to DEMO accounts during testing` };
    return accountInfo(a);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
  const p = eaPresence(creds);
  if (!p.online || !p.account) return { ok: false, error: "MT5 EA offline" };
  return accountInfo(p.account);
}

async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
  const p = eaPresence(creds);
  if (!p.online) return { ok: false, error: "MT5 EA offline — open MetaTrader 5 with the HALO Bridge EA attached (AutoTrading on)" };
  if (!p.account || p.account.mode !== "demo") {
    return { ok: false, error: "refused: the connected MT5 account is not a DEMO account" };
  }
  try {
    const r = await call(
      creds,
      "open",
      {
        symbol: sym(creds, req.symbol),
        side: req.side,
        sl: req.sl,
        tp: req.tp,
        mode: req.sizing.mode,
        size: req.sizing.size,
        percent: req.sizing.percent,
        riskDistance: req.riskDistance,
        comment: req.comment,
      },
      20_000,
      req.clientOrderId ? f(req.clientOrderId).slice(0, 32) : undefined
    );
    if (!r.ok) return { ok: false, error: r.error ?? "MT5 rejected the order" };
    return { ok: true, brokerOrderId: r.orderId, fillPrice: num(r.price) || undefined, volume: num(r.volume) || undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function closePosition(creds: BrokerCreds, symbol?: string, side?: -1 | 1): Promise<OrderResult> {
  try {
    const r = await call(creds, "close", { symbol: symbol ? sym(creds, symbol) : "", side: side ?? 0 }, 15_000);
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "close failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
  const r = await call(creds, "positions", { symbol: symbol ? sym(creds, symbol) : "" }, 8000);
  if (!r.ok) throw new Error(r.error ?? "positions failed");
  return (r.positions ?? []).map((p) => ({
    id: String(p.id ?? ""),
    symbol: String(p.symbol ?? ""),
    side: num(p.side) === -1 ? -1 : 1,
    volume: num(p.volume, 0),
    entryPrice: num(p.entryPrice) || undefined,
    sl: num(p.sl) || undefined,
    tp: num(p.tp) || undefined,
    currentPrice: num(p.currentPrice) || undefined,
    unrealizedPnl: num(p.profit),
    swap: num(p.swap),
    openTime: num(p.openTime) || undefined,
    comment: p.comment != null ? String(p.comment) : undefined,
    ea: Boolean(p.ea),
  }));
}

async function getQuote(creds: BrokerCreds, symbol: string): Promise<QuoteResult> {
  try {
    const r = await call(creds, "quote", { symbol: sym(creds, symbol) }, 6000);
    if (!r.ok) return { ok: false, error: r.error ?? "no quote" };
    return { ok: true, bid: num(r.bid), ask: num(r.ask), time: num(r.time) || undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function modifyPosition(creds: BrokerCreds, positionId: string, patch: { sl?: number | null; tp?: number | null }): Promise<OrderResult> {
  try {
    const r = await call(creds, "modify", { ticket: positionId, sl: patch.sl ?? undefined, tp: patch.tp ?? undefined }, 10_000);
    return r.ok ? { ok: true } : { ok: false, error: r.error ?? "modify failed" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** uncertain-order reconciliation: the EA stamps HALO's order id as the MT5 comment */
async function findByClientOrderId(creds: BrokerCreds, clientOrderId: string, symbol: string): Promise<OrderLookup> {
  try {
    const r = await call(creds, "lookup", { symbol: sym(creds, symbol), ticket: clientOrderId }, 10_000);
    if (!r.ok) return { status: "unknown", detail: r.error ?? "EA lookup failed" };
    const st = r.status === "open" || r.status === "closed" || r.status === "absent" ? r.status : "unknown";
    return { status: st, positionId: r.orderId, detail: `EA: ${r.detail ?? st}` };
  } catch (e) {
    return { status: "unknown", detail: (e as Error).message };
  }
}

export const mt5EaAdapter: BrokerAdapter = {
  kind: "mt5ea",
  mapSymbol: sym,
  testConnection,
  getAccount,
  marketOrder,
  closePosition,
  getPositions,
  getQuote,
  modifyPosition,
  findByClientOrderId,
};
