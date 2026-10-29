// ════════════════════════════════════════════════════════════════════════
//  OANDA v20 REST adapter · REAL market orders with SL/TP
//  Practice: api-fxpractice.oanda.com · Live: api-fxtrade.oanda.com
//  Creds: { apiToken, accountId, environment: "practice" | "live", symbolMap? }
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
  roundPx,
} from "./types";

const DEFAULT_MAP: Record<string, string> = {
  // metals → OANDA underscore instruments
  PAXGUSDT: "XAU_USD",
  XAUUSD: "XAU_USD",
  XAGUSD: "XAG_USD",
  XPTUSD: "XPT_USD",
  XPDUSD: "XPD_USD",
  XCUUSD: "XCU_USD",
  // forex majors
  EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD",
  USDJPY: "USD_JPY",
  USDCHF: "USD_CHF",
  USDCAD: "USD_CAD",
  AUDUSD: "AUD_USD",
  NZDUSD: "NZD_USD",
  // forex crosses
  EURGBP: "EUR_GBP",
  EURJPY: "EUR_JPY",
  EURCHF: "EUR_CHF",
  EURAUD: "EUR_AUD",
  EURCAD: "EUR_CAD",
  EURNZD: "EUR_NZD",
  GBPJPY: "GBP_JPY",
  GBPCHF: "GBP_CHF",
  GBPAUD: "GBP_AUD",
  GBPCAD: "GBP_CAD",
  GBPNZD: "GBP_NZD",
  AUDJPY: "AUD_JPY",
  AUDCAD: "AUD_CAD",
  AUDNZD: "AUD_NZD",
  NZDJPY: "NZD_JPY",
  NZDCAD: "NZD_CAD",
  CADJPY: "CAD_JPY",
  CADCHF: "CAD_CHF",
  CHFJPY: "CHF_JPY",
  // crypto
  BTCUSDT: "BTC_USD",
  ETHUSDT: "ETH_USD",
  XRPUSDT: "XRP_USD",
  SOLUSDT: "SOL_USD",
  DOGEUSDT: "DOGE_USD",
  BNBUSDT: "BNB_USD",
};

function base(creds: BrokerCreds): string {
  const env = creds.environment === "live" ? "live" : "practice";
  return env === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
}

function headers(creds: BrokerCreds): Record<string, string> {
  return {
    Authorization: `Bearer ${String(creds.apiToken ?? "")}`,
    "Content-Type": "application/json",
    "Accept-Datetime-Format": "UNIX",
  };
}

async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
  const id = String(creds.accountId ?? "");
  if (!id) return { ok: false, error: "accountId missing" };
  if (!String(creds.apiToken ?? "")) return { ok: false, error: "apiToken missing" };
  try {
    const j = (await jfetch(`${base(creds)}/v3/accounts/${encodeURIComponent(id)}/summary`, {
      headers: headers(creds),
    })) as { account?: { id?: string; currency?: string; balance?: string; NAV?: string } };
    return {
      ok: true,
      id: j.account?.id,
      currency: j.account?.currency,
      balance: num(j.account?.balance),
      equity: num(j.account?.NAV),
      raw: j,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
  try {
    const inst = mapWith(creds, req.symbol, DEFAULT_MAP);
    const acct = await getAccount(creds);
    if (!acct.ok) return { ok: false, error: `account: ${acct.error}` };
    const equity = acct.equity ?? acct.balance ?? 0;

    let units: number;
    if (req.sizing.mode === "percent") {
      units = percentUnits(equity, req.sizing.percent, req.riskDistance, 1);
    } else {
      units = Math.max(1, Math.round(req.sizing.size * 10) / 10);
    }
    units = req.side === -1 ? -units : units;

    const body = {
      order: {
        type: "MARKET",
        instrument: inst,
        units: String(units),
        timeInForce: "FOK",
        positionFill: "DEFAULT",
        clientExtensions: { comment: req.comment.slice(0, 20) },
        stopLossOnFill: { price: String(roundPx(req.sl)), timeInForce: "GTC" },
        takeProfitOnFill: { price: String(roundPx(req.tp)), timeInForce: "GTC" },
      },
    };

    const j = (await jfetch(`${base(creds)}/v3/accounts/${encodeURIComponent(String(creds.accountId))}/orders`, {
      method: "POST",
      headers: headers(creds),
      body: JSON.stringify(body),
    })) as {
      orderFillTransaction?: { id?: string; price?: string; units?: string; instrument?: string };
      orderCreateTransaction?: { id?: string };
      errorCode?: string;
      errorMessage?: string;
    };

    if (j.orderFillTransaction) {
      return {
        ok: true,
        brokerOrderId: j.orderFillTransaction.id,
        fillPrice: num(j.orderFillTransaction.price),
        volume: Math.abs(num(j.orderFillTransaction.units, units)),
      };
    }
    if (j.orderCreateTransaction) {
      return { ok: true, brokerOrderId: j.orderCreateTransaction.id, volume: Math.abs(units) };
    }
    return { ok: false, error: j.errorMessage ?? j.errorCode ?? "order rejected", raw: j };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function closePosition(creds: BrokerCreds, symbol: string, side?: -1 | 1): Promise<OrderResult> {
  try {
    const inst = mapWith(creds, symbol, DEFAULT_MAP);
    const body = side === 1 ? { longUnits: "ALL" } : side === -1 ? { shortUnits: "ALL" } : { longUnits: "ALL", shortUnits: "ALL" };
    const j = (await jfetch(
      `${base(creds)}/v3/accounts/${encodeURIComponent(String(creds.accountId))}/positions/${encodeURIComponent(inst)}/close`,
      { method: "PUT", headers: headers(creds), body: JSON.stringify(body) }
    )) as Record<string, unknown>;
    return { ok: true, raw: j };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("404") || msg.toLowerCase().includes("no position")) return { ok: true };
    return { ok: false, error: msg };
  }
}

async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
  try {
    const j = (await jfetch(
      `${base(creds)}/v3/accounts/${encodeURIComponent(String(creds.accountId))}/openPositions`,
      { headers: headers(creds) }
    )) as {
      positions?: Array<{
        instrument: string;
        long?: { units?: string; averagePrice?: string; unrealizedPL?: string };
        short?: { units?: string; averagePrice?: string; unrealizedPL?: string };
      }>;
    };
    const out: PositionInfo[] = [];
    for (const p of j.positions ?? []) {
      const long = p.long && num(p.long.units) !== 0 ? p.long : null;
      const short = p.short && num(p.short.units) !== 0 ? p.short : null;
      if (long)
        out.push({
          id: `${p.instrument}:L`,
          symbol: p.instrument,
          side: 1,
          volume: Math.abs(num(long.units)),
          entryPrice: num(long.averagePrice),
          unrealizedPnl: num(long.unrealizedPL),
        });
      if (short)
        out.push({
          id: `${p.instrument}:S`,
          symbol: p.instrument,
          side: -1,
          volume: Math.abs(num(short.units)),
          entryPrice: num(short.averagePrice),
          unrealizedPnl: num(short.unrealizedPL),
        });
    }
    return symbol ? out.filter((x) => x.symbol === mapWith(creds, symbol, DEFAULT_MAP)) : out;
  } catch {
    return [];
  }
}

export const oandaAdapter: BrokerAdapter = {
  kind: "oanda",
  mapSymbol: (creds, symbol) => mapWith(creds, symbol, DEFAULT_MAP),
  testConnection: getAccount,
  getAccount,
  marketOrder,
  closePosition,
  getPositions,
};
