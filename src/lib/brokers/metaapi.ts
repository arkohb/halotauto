// ════════════════════════════════════════════════════════════════════════
//  MetaApi cloud adapter · REAL MT4 / MT5 orders
//  Works with any MT broker: IC Markets, Pepperstone, XM, Exness, FTMO,
//  Vantage, Axi, FxPro, ThinkMarkets, Global Prime …
//  Creds: { token (metaapi.cloud API token), accountId, symbolMap? }
// ════════════════════════════════════════════════════════════════════════

import {
  AccountInfo,
  BrokerAdapter,
  BrokerCreds,
  OrderRequest,
  OrderResult,
  PositionInfo,
  jfetch,
  mapWith,
  num,
  percentUnits,
} from "./types";

const BASE = "https://api.metaapi.cloud";
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

function headers(creds: BrokerCreds): Record<string, string> {
  return { "auth-auth0": String(creds.token ?? ""), "Content-Type": "application/json" };
}

function aid(creds: BrokerCreds): string {
  return encodeURIComponent(String(creds.accountId ?? ""));
}

const specCache = new Map<string, { contractSize: number; digits: number; at: number }>();

async function symbolSpec(creds: BrokerCreds, symbol: string): Promise<{ contractSize: number; digits: number }> {
  const key = `${creds.accountId}:${symbol}`;
  const hit = specCache.get(key);
  if (hit && Date.now() - hit.at < 3600_000) return { contractSize: hit.contractSize, digits: hit.digits };
  try {
    const j = (await jfetch(`${BASE}/cloud-api/trading/${aid(creds)}/symbols/${encodeURIComponent(symbol)}`, {
      headers: headers(creds),
    })) as { contractSize?: number; digits?: number };
    const out = { contractSize: num(j.contractSize, 100000) || 100000, digits: Math.round(num(j.digits, 2)) };
    specCache.set(key, { ...out, at: Date.now() });
    return out;
  } catch {
    return { contractSize: 100000, digits: 2 };
  }
}

async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
  try {
    if (!String(creds.token ?? "")) return { ok: false, error: "token missing" };
    if (!String(creds.accountId ?? "")) return { ok: false, error: "accountId missing" };
    const j = (await jfetch(`${BASE}/cloud-api/trading-accounts/${aid(creds)}`, {
      headers: headers(creds),
    })) as { _id?: string; state?: string; currency?: string; balance?: number; equity?: number; broker?: string };
    // ensure deployed so trading REST works
    if (j.state && j.state !== "DEPLOYED") {
      await jfetch(`${BASE}/cloud-api/trading-accounts/${aid(creds)}/deploy`, {
        method: "PUT",
        headers: headers(creds),
        body: JSON.stringify({}),
      }).catch(() => {});
    }
    return {
      ok: true,
      id: j._id,
      currency: j.currency,
      balance: num(j.balance),
      equity: num(j.equity) || num(j.balance),
      raw: { broker: j.broker, state: j.state },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
  try {
    const symbol = mapWith(creds, req.symbol, DEFAULT_MAP);
    const acct = await getAccount(creds);
    if (!acct.ok) return { ok: false, error: `account: ${acct.error}` };
    const equity = acct.equity ?? acct.balance ?? 0;

    let volume: number;
    if (req.sizing.mode === "percent") {
      const spec = await symbolSpec(creds, symbol);
      const riskAmt = (equity * req.sizing.percent) / 100;
      const perLot = req.riskDistance * spec.contractSize;
      volume = perLot > 0 ? Math.max(0.01, Math.floor((riskAmt / perLot) * 100) / 100) : 0.01;
    } else {
      volume = Math.max(0.01, Math.round(req.sizing.size * 100) / 100);
    }

    const body = {
      actionType: req.side === -1 ? "ORDER_TYPE_SELL" : "ORDER_TYPE_BUY",
      symbol,
      volume,
      stopLoss: req.sl,
      takeProfit: req.tp,
      comment: req.comment.slice(0, 26),
      clientOrderId: `halo3el-${Date.now()}`,
    };
    const j = (await jfetch(`${BASE}/cloud-api/trading/${aid(creds)}/orders`, {
      method: "POST",
      headers: headers(creds),
      body: JSON.stringify(body),
    })) as { orderId?: string; numericOrderId?: string; errorCode?: string; description?: string };
    const oid = j.orderId ?? j.numericOrderId;
    if (oid) return { ok: true, brokerOrderId: String(oid), volume };
    return { ok: false, error: j.description ?? j.errorCode ?? "order rejected", raw: j };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function closePosition(creds: BrokerCreds, symbol: string, side?: -1 | 1): Promise<OrderResult> {
  try {
    const brokerSym = mapWith(creds, symbol, DEFAULT_MAP);
    const positions = await getPositions(creds, symbol);
    const targets = positions.filter((p) => (side ? p.side === side : true));
    if (targets.length === 0) return { ok: true };
    for (const p of targets) {
      await jfetch(`${BASE}/cloud-api/trading/${aid(creds)}/positions/${encodeURIComponent(p.id)}`, {
        method: "DELETE",
        headers: headers(creds),
      }).catch(() => {});
    }
    void brokerSym;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
  try {
    const j = (await jfetch(`${BASE}/cloud-api/trading/${aid(creds)}/positions`, {
      headers: headers(creds),
    })) as Array<{
      id?: string;
      symbol?: string;
      type?: string | number;
      volume?: number;
      openPrice?: number;
      stopLoss?: number;
      takeProfit?: number;
      unrealizedProfit?: number;
    }>;
    const arr = Array.isArray(j) ? j : [];
    const out: PositionInfo[] = arr.map((p) => ({
      id: String(p.id ?? ""),
      symbol: String(p.symbol ?? ""),
      side: String(p.type ?? "").includes("SELL") || p.type === 1 ? -1 : 1,
      volume: num(p.volume),
      entryPrice: num(p.openPrice),
      sl: p.stopLoss ?? undefined,
      tp: p.takeProfit ?? undefined,
      unrealizedPnl: num(p.unrealizedProfit),
    }));
    return symbol ? out.filter((x) => x.symbol === mapWith(creds, symbol, DEFAULT_MAP)) : out;
  } catch {
    return [];
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
};
