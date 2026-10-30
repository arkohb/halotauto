// ════════════════════════════════════════════════════════════════════════
//  MetaApi cloud adapter · REAL MT4 / MT5 orders
//  Works with any MT broker: IC Markets, Pepperstone, XM, Exness, FTMO,
//  Vantage, Axi, FxPro, ThinkMarkets, Global Prime …
//
//  ZERO-MANUAL-API: the platform key ships inside HALO (metaapi-core).
//  Creds stored on the account row: { accountId, region?, login?, server?,
//  platform? } — a token may only appear as an explicit override.
//  All wire calls go through metaapi-core (auth-token header, correct
//  client-API hosts, TLS-resilient, friendly errors).
// ════════════════════════════════════════════════════════════════════════

import {
  AccountInfo,
  BrokerAdapter,
  BrokerCreds,
  OrderRequest,
  OrderResult,
  PendingOrderInfo,
  PositionInfo,
  mapWith,
  num,
} from "./types";
import {
  friendlyMetaApiError,
  METAAPI_MAGIC,
  mtAccountInformation,
  mtCancelOrder,
  mtClosePosition,
  mtMarketOrder,
  mtModifyPosition,
  mtOrders,
  mtPositions,
  mtSymbolSpec,
} from "./metaapi-core";

const DEFAULT_MAP: Record<string, string> = {
  // metals → MT names
  PAXGUSDT: "XAUUSD",
  XAUUSD: "XAUUSD",
  XAGUSD: "XAGUSD",
  XPTUSD: "XPTUSD",
  XPDUSD: "XPDUSD",
  XCUUSD: "XCUUSD",
  // forex majors (MT servers name them identically)
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USDCHF: "USDCHF",
  USDCAD: "USDCAD",
  AUDUSD: "AUDUSD",
  NZDUSD: "NZDUSD",
  // forex crosses
  EURGBP: "EURGBP",
  EURJPY: "EURJPY",
  EURCHF: "EURCHF",
  EURAUD: "EURAUD",
  EURCAD: "EURCAD",
  EURNZD: "EURNZD",
  GBPJPY: "GBPJPY",
  GBPCHF: "GBPCHF",
  GBPAUD: "GBPAUD",
  GBPCAD: "GBPCAD",
  GBPNZD: "GBPNZD",
  AUDJPY: "AUDJPY",
  AUDCAD: "AUDCAD",
  AUDNZD: "AUDNZD",
  NZDJPY: "NZDJPY",
  NZDCAD: "NZDCAD",
  CADJPY: "CADJPY",
  CADCHF: "CADCHF",
  CHFJPY: "CHFJPY",
  // crypto
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
  XRPUSDT: "XRPUSD",
  SOLUSDT: "SOLUSD",
  BNBUSDT: "BNBUSD",
  DOGEUSDT: "DOGEUSD",
};

function acct(creds: BrokerCreds): { id: string; region: string; token?: string } {
  return {
    id: encodeURIComponent(String(creds.accountId ?? "")),
    region: String(creds.region ?? "new-york"),
    token: creds.token ? String(creds.token) : undefined,
  };
}

const specCache = new Map<string, { spec: { contractSize: number; digits: number; volumeMin: number; volumeStep: number }; at: number }>();

async function spec(a: { id: string; region: string; token?: string }, symbol: string) {
  const key = `${a.id}:${symbol}`;
  const hit = specCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return hit.spec;
  const spec = await mtSymbolSpec(a.id, a.region, symbol, a.token);
  specCache.set(key, { spec, at: Date.now() });
  return spec;
}

function roundTo(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
  try {
    const a = acct(creds);
    if (!a.id) return { ok: false, error: "MetaApi accountId missing — reconnect the MT account" };
    // real trading info from the client API (balance, equity, margin, broker)
    const info = await mtAccountInformation(a.id, a.region, a.token);
    return {
      ok: true,
      id: String(creds.accountId ?? ""),
      currency: info.currency,
      balance: num(info.balance),
      equity: num(info.equity) || num(info.balance),
      margin: num(info.margin),
      freeMargin: num(info.freeMargin, num(info.equity) || num(info.balance)),
      marginLevel: num(info.marginLevel),
      leverage: num(info.leverage),
      login: info.accountNumber !== undefined ? String(info.accountNumber) : undefined,
      server: info.server,
      brokerName: info.broker,
      platform: info.platform,
      raw: { broker: info.broker, server: info.server, platform: info.platform, state: info.state },
    };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e, "account") };
  }
}

async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
  try {
    const a = acct(creds);
    if (!a.id) return { ok: false, error: "MetaApi accountId missing — reconnect the MT account" };
    const symbol = mapWith(creds, req.symbol, DEFAULT_MAP);
    const acq = await getAccount(creds);
    if (!acq.ok) return { ok: false, error: `account: ${acq.error}` };
    const equity = acq.equity ?? acq.balance ?? 0;

    const sp = await spec(a, symbol);
    let volume: number;
    if (req.sizing.mode === "percent") {
      const riskAmt = (equity * req.sizing.percent) / 100;
      const perLot = req.riskDistance * sp.contractSize;
      volume = perLot > 0 ? riskAmt / perLot : sp.volumeMin;
    } else {
      volume = req.sizing.size;
    }
    // snap to broker volume rules
    volume = Math.max(sp.volumeMin, Math.round(volume / sp.volumeStep) * sp.volumeStep);
    volume = Math.round(volume * 100) / 100;

    const res = await mtMarketOrder(a.id, a.region, {
      side: req.side,
      symbol,
      volume,
      stopLoss: sp.digits ? roundTo(req.sl, sp.digits) : req.sl,
      takeProfit: sp.digits ? roundTo(req.tp, sp.digits) : req.tp,
      comment: req.comment,
    }, a.token);
    const oid = res.orderId ?? res.numericOrderId;
    if (oid) return { ok: true, brokerOrderId: String(oid), volume };
    return {
      ok: false,
      error: friendlyMetaApiError(new Error(res.description ?? res.errorCode ?? "order rejected")),
      raw: res,
    };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e) };
  }
}

async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
  try {
    const a = acct(creds);
    const j = await mtPositions(a.id, a.region, a.token);
    const out: PositionInfo[] = j.map((p) => {
      const rec = p as Record<string, unknown>;
      const t = String(rec.type ?? "");
      const comment = String(rec.comment ?? "");
      const magic = num(rec.magic);
      const openTimeRaw = rec.openTime ?? rec.time;
      const openTime = openTimeRaw ? new Date(String(openTimeRaw)).getTime() : undefined;
      return {
        id: String(rec.id ?? ""),
        symbol: String(rec.symbol ?? ""),
        side: t.includes("SELL") ? -1 : 1,
        volume: num(rec.volume),
        entryPrice: num(rec.openPrice),
        sl: rec.stopLoss !== undefined && num(rec.stopLoss) > 0 ? num(rec.stopLoss) : undefined,
        tp: rec.takeProfit !== undefined && num(rec.takeProfit) > 0 ? num(rec.takeProfit) : undefined,
        unrealizedPnl: num(rec.profit ?? rec.unrealizedProfit),
        currentPrice: num(rec.currentPrice) || undefined,
        swap: num(rec.swap),
        commission: rec.commission !== undefined ? num(rec.commission) : undefined,
        openTime: openTime && isFinite(openTime) ? openTime : undefined,
        comment: comment || undefined,
        ea: magic === METAAPI_MAGIC || /halo/i.test(comment) || undefined,
      };
    });
    return symbol ? out.filter((x) => x.symbol === mapWith(creds, symbol, DEFAULT_MAP)) : out;
  } catch {
    return [];
  }
}

async function closePosition(creds: BrokerCreds, symbol: string, side?: -1 | 1): Promise<OrderResult> {
  try {
    const a = acct(creds);
    const positions = await getPositions(creds, symbol);
    const targets = positions.filter((p) => (side ? p.side === side : true));
    if (targets.length === 0) return { ok: true };
    for (const p of targets) {
      await mtClosePosition(a.id, a.region, p.id, a.token).catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e) };
  }
}

async function getOrders(creds: BrokerCreds, symbol?: string): Promise<PendingOrderInfo[]> {
  try {
    const a = acct(creds);
    const j = await mtOrders(a.id, a.region, a.token);
    const out: PendingOrderInfo[] = j.map((o) => {
      const rec = o as Record<string, unknown>;
      const t = String(rec.type ?? "");
      const upper = t.toUpperCase();
      const comment = String(rec.comment ?? "");
      const magic = num(rec.magic);
      const placedRaw = rec.time ?? rec.openTime ?? rec.createdAt;
      const placed = placedRaw ? new Date(String(placedRaw)).getTime() : undefined;
      return {
        id: String(rec.id ?? ""),
        symbol: String(rec.symbol ?? ""),
        type: upper || "PENDING",
        side: upper.includes("SELL") ? -1 : 1,
        volume: num(rec.volume),
        entryPrice: num(rec.openPrice) || undefined,
        currentPrice: num(rec.currentPrice) || undefined,
        sl: rec.stopLoss !== undefined && num(rec.stopLoss) > 0 ? num(rec.stopLoss) : undefined,
        tp: rec.takeProfit !== undefined && num(rec.takeProfit) > 0 ? num(rec.takeProfit) : undefined,
        placedAt: placed && isFinite(placed) ? placed : undefined,
        status: String(rec.state ?? "PLACED").toUpperCase(),
        comment: comment || undefined,
        ea: magic === METAAPI_MAGIC || /halo/i.test(comment) || undefined,
      };
    });
    return symbol ? out.filter((x) => x.symbol === mapWith(creds, symbol, DEFAULT_MAP)) : out;
  } catch {
    return [];
  }
}

async function cancelOrder(creds: BrokerCreds, orderId: string): Promise<OrderResult> {
  try {
    const a = acct(creds);
    const res = await mtCancelOrder(a.id, a.region, orderId, a.token);
    if (res.errorCode || res.description) {
      return { ok: false, error: `${res.errorCode ?? ""} ${res.description ?? ""}`.trim(), raw: res };
    }
    return { ok: true, brokerOrderId: res.orderId ?? orderId, raw: res };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e) };
  }
}

async function modifyPosition(
  creds: BrokerCreds,
  positionId: string,
  patch: { sl?: number | null; tp?: number | null }
): Promise<OrderResult> {
  try {
    const a = acct(creds);
    const res = await mtModifyPosition(a.id, a.region, positionId, patch, a.token);
    if (res.errorCode || res.description) {
      return { ok: false, error: `${res.errorCode ?? ""} ${res.description ?? ""}`.trim(), raw: res };
    }
    return { ok: true, raw: res };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e) };
  }
}

export const metaapiAdapter: BrokerAdapter = {
  kind: "metaapi",
  mapSymbol: (creds, symbol) => mapWith(creds, symbol, DEFAULT_MAP),
  testConnection: getAccount,
  getAccount,
  marketOrder,
  closePosition,
  getPositions,
  getOrders,
  cancelOrder,
  modifyPosition,
};
