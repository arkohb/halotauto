// ════════════════════════════════════════════════════════════════════════
//  ORDER BRIDGE adapter · real orders through a user-hosted bridge
//  Used for FXCM, cTrader, Deriv and ANY broker/platform whose API is not
//  directly reachable from a web app (MT5 EA bridge, cTrader cBot, local
//  gateway, cTrader Open API gateway …).
//
//  Contract — POST JSON to your bridge URL:
//    { action:"open",     symbol, side, sideLabel, entry, sl, tp,
//      riskDistance, riskAmount, size, sizing, comment, ts }
//    { action:"close",    symbol, side, ts }
//    { action:"positions",symbol, ts }
//    { action:"ping",     ts }
//  Bridge replies { ok:true, orderId?, price?, positions?: [...] } with 2xx.
//  If creds.secret is set the request gets an "X-HALO-SIGN" HMAC-SHA256
//  header (hex of the raw body) so the bridge can verify authenticity.
// ════════════════════════════════════════════════════════════════════════

import { createHmac } from "crypto";
import {
  AccountInfo,
  BrokerAdapter,
  BrokerCreds,
  BrokerKind,
  OrderRequest,
  OrderResult,
  PositionInfo,
  jfetch,
  num,
} from "./types";

export function createBridgeAdapter(kind: BrokerKind): BrokerAdapter {
  async function post(creds: BrokerCreds, payload: Record<string, unknown>): Promise<unknown> {
    const url = String(creds.bridgeUrl ?? "");
    if (!url || !/^https?:\/\//i.test(url)) throw new Error("bridgeUrl missing or invalid");
    const body = JSON.stringify({ ...payload, secret: creds.secret ? String(creds.secret) : undefined, ts: Date.now() });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (creds.secret) {
      headers["X-HALO-SIGN"] = createHmac("sha256", String(creds.secret)).update(body).digest("hex");
    }
    return jfetch(url, { method: "POST", headers, body }, 15000);
  }

  async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
    try {
      if (!String(creds.bridgeUrl ?? "")) return { ok: false, error: "bridgeUrl missing" };
      const j = (await post(creds, { action: "ping" })) as { ok?: boolean; balance?: number; equity?: number; currency?: string; error?: string };
      if (j && j.ok === false) return { ok: false, error: j.error ?? "bridge refused ping" };
      return {
        ok: true,
        id: `${kind}-bridge`,
        currency: j.currency ?? "USD",
        balance: num(j.balance, 0) || undefined,
        equity: num(j.equity, 0) || undefined,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
    try {
      const j = (await post(creds, {
        action: "open",
        symbol: req.symbol,
        bridgeSymbol: creds.symbolMap?.[req.symbol] ?? req.symbol,
        side: req.side,
        sideLabel: req.side === -1 ? "SELL" : "BUY",
        entry: req.entry,
        sl: req.sl,
        tp: req.tp,
        riskDistance: req.riskDistance,
        riskPips: req.riskPips,
        size: req.sizing.mode === "fixed" ? req.sizing.size : undefined,
        sizing: req.sizing,
        comment: req.comment,
      })) as { ok?: boolean; orderId?: string; price?: number; error?: string };
      if (j && j.ok === false) return { ok: false, error: j.error ?? "bridge rejected order" };
      return { ok: true, brokerOrderId: j.orderId ? String(j.orderId) : `bridge-${Date.now().toString(36)}`, fillPrice: num(j.price) || undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function closePosition(creds: BrokerCreds, symbol: string, side?: -1 | 1): Promise<OrderResult> {
    try {
      await post(creds, { action: "close", symbol, side: side ?? null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
    try {
      const j = (await post(creds, { action: "positions", symbol: symbol ?? null })) as
        | { positions?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>;
      const arr = Array.isArray(j) ? j : (j.positions ?? []);
      return arr.map((p) => ({
        id: String(p.id ?? ""),
        symbol: String(p.symbol ?? ""),
        side: String(p.side ?? p.direction ?? "").toUpperCase().startsWith("S") || num(p.side) === -1 ? -1 : 1,
        volume: num(p.volume ?? p.size ?? p.units, 0),
        entryPrice: num(p.entryPrice ?? p.entry ?? p.price),
        sl: p.sl != null ? num(p.sl) : undefined,
        tp: p.tp != null ? num(p.tp) : undefined,
      }));
    } catch {
      return [];
    }
  }

  return {
    kind,
    mapSymbol: (creds, symbol) => creds.symbolMap?.[symbol] ?? symbol,
    testConnection: getAccount,
    getAccount,
    marketOrder,
    closePosition,
    getPositions,
  };
}
