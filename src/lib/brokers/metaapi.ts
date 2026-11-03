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
  QuoteResult,
  mapWith,
  num,
} from "./types";
import {
  friendlyMetaApiError,
  METAAPI_MAGIC,
  mtAccountInformation,
  mtCancelOrder,
  mtClosePosition,
  mtClosePositionPartially,
  mtCurrentPrice,
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
  // ── Deriv synthetic indices → Deriv MT5 symbol names ──
  V5: "Volatility 5 Index",
  V10: "Volatility 10 Index",
  V15: "Volatility 15 Index",
  V25: "Volatility 25 Index",
  V30: "Volatility 30 Index",
  V50: "Volatility 50 Index",
  V75: "Volatility 75 Index",
  V90: "Volatility 90 Index",
  V100: "Volatility 100 Index",
  V5S: "Volatility 5 (1s) Index",
  V10S: "Volatility 10 (1s) Index",
  V15S: "Volatility 15 (1s) Index",
  V25S: "Volatility 25 (1s) Index",
  V30S: "Volatility 30 (1s) Index",
  V50S: "Volatility 50 (1s) Index",
  V75S: "Volatility 75 (1s) Index",
  V90S: "Volatility 90 (1s) Index",
  V100S: "Volatility 100 (1s) Index",
  V150S: "Volatility 150 (1s) Index",
  V250S: "Volatility 250 (1s) Index",
  BOOM50: "Boom 50 Index",
  BOOM99: "Boom 99 Index",
  BOOM100: "Boom 100 Index",
  BOOM150: "Boom 150 Index",
  BOOM200: "Boom 200 Index",
  BOOM300: "Boom 300 Index",
  BOOM400: "Boom 400 Index",
  BOOM500: "Boom 500 Index",
  BOOM550: "Boom 550 Index",
  BOOM600: "Boom 600 Index",
  BOOM750: "Boom 750 Index",
  BOOM900: "Boom 900 Index",
  BOOM1000: "Boom 1000 Index",
  CRASH50: "Crash 50 Index",
  CRASH99: "Crash 99 Index",
  CRASH100: "Crash 100 Index",
  CRASH150: "Crash 150 Index",
  CRASH200: "Crash 200 Index",
  CRASH300: "Crash 300 Index",
  CRASH400: "Crash 400 Index",
  CRASH500: "Crash 500 Index",
  CRASH550: "Crash 550 Index",
  CRASH600: "Crash 600 Index",
  CRASH750: "Crash 750 Index",
  CRASH900: "Crash 900 Index",
  CRASH1000: "Crash 1000 Index",
  VBOOM400: "Volatility Boom 400 Index",
  VBOOM550: "Volatility Boom 550 Index",
  VBOOM750: "Volatility Boom 750 Index",
  VCRASH400: "Volatility Crash 400 Index",
  VCRASH550: "Volatility Crash 550 Index",
  VCRASH750: "Volatility Crash 750 Index",
  CBF150: "Crash Boom Flip 150 Index",
  CBF300: "Crash Boom Flip 300 Index",
  CBF500: "Crash Boom Flip 500 Index",
  CBF1000: "Crash Boom Flip 1000 Index",
  STEP: "Step Index",
  SKEWSTEP: "Skew Step Index",
  MS2: "Multi Step 2 Index",
  MS3: "Multi Step 3 Index",
  MS4: "Multi Step 4 Index",
  JUMP10: "Jump 10 Index",
  JUMP25: "Jump 25 Index",
  JUMP50: "Jump 50 Index",
  JUMP75: "Jump 75 Index",
  JUMP100: "Jump 100 Index",
  RB100: "Range Break 100 Index",
  RB200: "Range Break 200 Index",
  HFVOL10: "High Frequency Vol 10 Index",
  HFVOL25: "High Frequency Vol 25 Index",
  HFVOL50: "High Frequency Vol 50 Index",
  HFVOL75: "High Frequency Vol 75 Index",
  HFVOL100: "High Frequency Vol 100 Index",
  DS10: "Drift Switch Index 10",
  DS20: "Drift Switch Index 20",
  DS30: "Drift Switch Index 30",
  VSWLOW: "VolSwitch Low Vol Index",
  VSWMED: "VolSwitch Medium Vol Index",
  VSWHIGH: "VolSwitch High Vol Index",
  LADDERUP: "Ladder Volatility Up Index",
  LADDERDOWN: "Ladder Volatility Down Index",
  TREKUP: "Trek Up Index",
  TREKDOWN: "Trek Down Index",
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
      clientId: req.clientOrderId,
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

async function partialClose(creds: BrokerCreds, positionId: string, volume: number): Promise<OrderResult> {
  try {
    const a = acct(creds);
    const res = await mtClosePositionPartially(a.id, a.region, positionId, volume, a.token);
    if (res.errorCode || (res.description && !/done|success/i.test(res.description))) {
      return { ok: false, error: `${res.errorCode ?? ""} ${res.description ?? ""}`.trim(), raw: res };
    }
    return { ok: true, brokerOrderId: res.orderId, volume, raw: res };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e) };
  }
}

async function getQuote(creds: BrokerCreds, symbol: string): Promise<QuoteResult> {
  try {
    const a = acct(creds);
    const j = await mtCurrentPrice(a.id, a.region, mapWith(creds, symbol, DEFAULT_MAP), a.token);
    const t = j.time ? new Date(j.time).getTime() : undefined;
    return { ok: true, bid: num(j.bid) || undefined, ask: num(j.ask) || undefined, time: t && Number.isFinite(t) ? t : undefined };
  } catch (e) {
    return { ok: false, error: friendlyMetaApiError(e) };
  }
}

async function volumeSpec(creds: BrokerCreds, brokerSymbol: string): Promise<{ volumeMin: number; volumeStep: number }> {
  const a = acct(creds);
  const spec = await mtSymbolSpec(a.id, a.region, brokerSymbol, a.token);
  return { volumeMin: spec.volumeMin, volumeStep: spec.volumeStep };
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
  partialClose,
  volumeSpec,
  getQuote,
};
