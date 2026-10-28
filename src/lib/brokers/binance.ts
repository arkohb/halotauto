// ════════════════════════════════════════════════════════════════════════
//  BINANCE spot adapter · REAL orders (crypto side of the book)
//  Creds: { apiKey, apiSecret, testnet?: boolean, symbolMap? }
//  Spot market order + OCO (SL / TP). Long side only (spot has no native short).
// ════════════════════════════════════════════════════════════════════════

import { createHmac } from "crypto";
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
} from "./types";

const DEFAULT_MAP: Record<string, string> = {
  PAXGUSDT: "PAXGUSDT",
  BTCUSDT: "BTCUSDT",
  ETHUSDT: "ETHUSDT",
  XRPUSDT: "XRPUSDT",
  SOLUSDT: "SOLUSDT",
  BNBUSDT: "BNBUSDT",
  DOGEUSDT: "DOGEUSDT",
};

function base(creds: BrokerCreds): string {
  return creds.testnet ? "https://testnet.binance.vision" : "https://api.binance.com";
}

function sign(creds: BrokerCreds, params: string): string {
  return createHmac("sha256", String(creds.apiSecret ?? "")).update(params).digest("hex");
}

async function signedFetch(creds: BrokerCreds, path: string, params: Record<string, string | number>, method: "GET" | "POST" | "DELETE"): Promise<unknown> {
  const qs0 = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const qs = `${qs0}&timestamp=${Date.now()}&recvWindow=8000`;
  const sig = sign(creds, qs);
  return jfetch(`${base(creds)}${path}?${qs}&signature=${sig}`, {
    method,
    headers: { "X-MBX-APIKEY": String(creds.apiKey ?? "") },
  });
}

interface Filters {
  stepSize: number;
  tickSize: number;
  minQty: number;
}
const filterCache = new Map<string, { f: Filters; at: number }>();

async function filters(creds: BrokerCreds, symbol: string): Promise<Filters> {
  const hit = filterCache.get(symbol);
  if (hit && Date.now() - hit.at < 3600_000) return hit.f;
  try {
    const j = (await jfetch(`${base(creds)}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`)) as {
      symbols?: Array<{ filters?: Array<{ filterType?: string; stepSize?: string; tickSize?: string; minQty?: string }> }>;
    };
    const lf = j.symbols?.[0]?.filters ?? [];
    const lot = lf.find((f) => f.filterType === "LOT_SIZE");
    const price = lf.find((f) => f.filterType === "PRICE_FILTER");
    const f: Filters = {
      stepSize: num(lot?.stepSize, 0.00001) || 0.00001,
      tickSize: num(price?.tickSize, 0.01) || 0.01,
      minQty: num(lot?.minQty, 0) || 0,
    };
    filterCache.set(symbol, { f, at: Date.now() });
    return f;
  } catch {
    return { stepSize: 0.00001, tickSize: 0.01, minQty: 0 };
  }
}

function floorTo(v: number, step: number): number {
  if (step <= 0) return v;
  const dp = Math.max(0, Math.min(8, Math.round(-Math.log10(step))));
  return Math.floor(v / step) * step >= 0 ? Number((Math.floor(v / step) * step).toFixed(dp)) : 0;
}

async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
  try {
    if (!String(creds.apiKey ?? "") || !String(creds.apiSecret ?? "")) {
      return { ok: false, error: "apiKey / apiSecret missing" };
    }
    const j = (await signedFetch(creds, "/api/v3/account", {}, "GET")) as {
      accountType?: string;
      canTrade?: boolean;
      balances?: Array<{ asset?: string; free?: string; locked?: string }>;
    };
    const usdt = j.balances?.find((b) => b.asset === "USDT");
    return {
      ok: true,
      id: creds.testnet ? "binance-testnet" : "binance-spot",
      currency: "USDT",
      balance: num(usdt?.free) + num(usdt?.locked),
      equity: num(usdt?.free) + num(usdt?.locked),
      raw: { canTrade: j.canTrade },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
  try {
    if (req.side !== 1) return { ok: false, error: "Binance spot supports long (BUY) only — no native short" };
    const symbol = mapWith(creds, req.symbol, DEFAULT_MAP);
    const f = await filters(creds, symbol);
    const acct = await getAccount(creds);
    if (!acct.ok) return { ok: false, error: `account: ${acct.error}` };
    const equity = acct.equity ?? acct.balance ?? 0;

    let qty: number;
    if (req.sizing.mode === "percent") {
      const riskAmt = (equity * req.sizing.percent) / 100;
      qty = req.riskDistance > 0 ? riskAmt / req.riskDistance : 0;
    } else {
      qty = req.sizing.size;
    }
    qty = floorTo(qty, f.stepSize);
    if (qty <= 0 || qty < f.minQty) return { ok: false, error: `quantity ${qty} below min ${f.minQty} — raise fixed size` };

    const o = (await signedFetch(creds, "/api/v3/order", { symbol, side: "BUY", type: "MARKET", quantity: qty }, "POST")) as {
      orderId?: number;
      executedQty?: string;
      cummulativeQuoteQty?: string;
    };
    const executed = num(o.executedQty, qty) || qty;
    const fill = num(o.cummulativeQuoteQty) > 0 && executed > 0 ? num(o.cummulativeQuoteQty) / executed : req.entry;

    // OCO protective order (SELL leg with TP limit + SL stop)
    const stopPrice = floorTo(req.sl, f.tickSize);
    const stopLimitPrice = floorTo(req.sl * 0.998, f.tickSize);
    const limitPrice = floorTo(req.tp, f.tickSize);
    let ocoId = "";
    try {
      const oco = (await signedFetch(
        creds,
        "/api/v3/oco",
        {
          symbol,
          side: "SELL",
          quantity: executed,
          limitPrice,
          stopPrice,
          stopLimitPrice,
          stopLimitTimeInForce: "GTC",
        },
        "POST"
      )) as { orderListId?: number };
      ocoId = oco.orderListId ? String(oco.orderListId) : "";
    } catch (e) {
      return { ok: true, brokerOrderId: String(o.orderId ?? ""), fillPrice: fill, volume: executed, error: `filled but OCO failed: ${(e as Error).message}` };
    }
    return { ok: true, brokerOrderId: [String(o.orderId ?? ""), ocoId].filter(Boolean).join("/"), fillPrice: fill, volume: executed };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function closePosition(creds: BrokerCreds, symbol: string): Promise<OrderResult> {
  try {
    const sym = mapWith(creds, symbol, DEFAULT_MAP);
    await signedFetch(creds, "/api/v3/openOrders", { symbol }, "DELETE").catch(() => {});
    const baseAsset = sym.replace(/USDT$|BUSD$|USDC$|FDUSD$/, "") || sym;
    const j = (await signedFetch(creds, "/api/v3/account", {}, "GET")) as {
      balances?: Array<{ asset?: string; free?: string; locked?: string }>;
    };
    const bal = j.balances?.find((b) => b.asset === baseAsset);
    const qty = floorTo(num(bal?.free), await filters(creds, sym).then((f) => f.stepSize));
    if (qty <= 0) return { ok: true };
    await signedFetch(creds, "/api/v3/order", { symbol: sym, side: "SELL", type: "MARKET", quantity: qty }, "POST");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
  try {
    const j = (await signedFetch(creds, "/api/v3/account", {}, "GET")) as {
      balances?: Array<{ asset?: string; free?: string; locked?: string }>;
    };
    const out: PositionInfo[] = [];
    for (const b of j.balances ?? []) {
      const qty = num(b.free) + num(b.locked);
      if (!b.asset || qty <= 0) continue;
      if (["USDT", "BUSD", "USDC", "FDUSD", "BNF", "TUSD"].includes(b.asset)) continue;
      if (symbol && !mapWith(creds, symbol, DEFAULT_MAP).startsWith(b.asset)) continue;
      out.push({ id: `${b.asset}:spot`, symbol: `${b.asset}USDT`, side: 1, volume: qty });
    }
    return out;
  } catch {
    return [];
  }
}

export const binanceAdapter: BrokerAdapter = {
  kind: "binance",
  mapSymbol: (creds, symbol) => mapWith(creds, symbol, DEFAULT_MAP),
  testConnection: getAccount,
  getAccount,
  marketOrder,
  closePosition,
  getPositions,
};
