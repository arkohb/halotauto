// ════════════════════════════════════════════════════════════════════════
//  IG MARKETS REST (dealing API v3) adapter · REAL CFD orders
//  Demo: demo-api.ig.com · Live: api.ig.com
//  Creds: { apiKey, identifier, password, environment: "demo"|"live",
//           symbolMap?: {PAXGUSDT: "CS.D.XAUUSD.CFDR.IP"}, pointSizes?: {"CS.D.XAUUSD...": 0.1} }
//  NOTE: IG stop/limit distances are expressed in "points"; the point size
//  per epic is auto-inferred (FX pip 0.0001, JPY 0.01, metals 0.1, crypto 1)
//  and can be overridden via creds.pointSizes[brokerSymbol].
// ════════════════════════════════════════════════════════════════════════

import {
  AccountInfo,
  BrokerAdapter,
  BrokerCreds,
  OrderRequest,
  OrderResult,
  PendingOrderInfo,
  PositionInfo,
  jfetch,
  mapWith,
  num,
  percentUnits,
} from "./types";

const DEFAULT_MAP: Record<string, string> = {
  PAXGUSDT: "CS.D.XAUUSD.CFDR.IP",
  BTCUSDT: "CS.D.BITCOIN.CFDR.IP",
  ETHUSDT: "CS.D.ETHUSD.CFDR.IP",
  XRPUSDT: "CS.D.XRPUSD.CFDR.IP",
  SOLUSDT: "CS.D.SOLUSD.CFDR.IP",
};

function base(creds: BrokerCreds): string {
  return creds.environment === "live" ? "https://api.ig.com/gateway/deal" : "https://demo-api.ig.com/gateway/deal";
}

interface IgSession {
  cst: string;
  xst: string;
  at: number;
}
const sessions = new Map<string, IgSession>();

function credsKey(creds: BrokerCreds): string {
  return `${creds.environment}|${creds.apiKey}|${creds.identifier}|${creds.password}`;
}

function baseHeaders(creds: BrokerCreds): Record<string, string> {
  return {
    "X-IG-API-KEY": String(creds.apiKey ?? ""),
    "Content-Type": "application/json; charset=UTF-8",
    Accept: "application/json; charset=UTF-8",
  };
}

async function igFetch(
  creds: BrokerCreds,
  path: string,
  init: RequestInit & { version: string }
): Promise<unknown> {
  const s = await getSession(creds);
  const headers: Record<string, string> = {
    ...baseHeaders(creds),
    Version: init.version,
    CST: s.cst,
    "X-SECURITY-TOKEN": s.xst,
  };
  return jfetch(`${base(creds)}${path}`, { method: init.method, headers, body: init.body }, 15000);
}

async function getSession(creds: BrokerCreds): Promise<IgSession> {
  const key = credsKey(creds);
  const hit = sessions.get(key);
  if (hit && Date.now() - hit.at < 50 * 60 * 1000) return hit;
  const res = await fetch(`${base(creds)}/session`, {
    method: "POST",
    headers: { ...baseHeaders(creds), Version: "1" },
    body: JSON.stringify({ identifier: creds.identifier, password: creds.password }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`IG login HTTP ${res.status} — ${text.slice(0, 200)}`);
  const cst = res.headers.get("CST") ?? "";
  const xst = res.headers.get("X-SECURITY-TOKEN") ?? "";
  if (!cst) throw new Error("IG login succeeded but no CST header — check API key / credentials");
  const s: IgSession = { cst, xst, at: Date.now() };
  sessions.set(key, s);
  return s;
}

function pointSizeFor(creds: BrokerCreds, epic: string, price: number): number {
  const overrides = creds.pointSizes as Record<string, number> | undefined;
  if (overrides && typeof overrides === "object" && overrides[epic]) return Number(overrides[epic]) || 1;
  const up = epic.toUpperCase();
  if (/JPY/.test(up)) return 0.01;
  if (/XAU|GOLD|XAG|SILV/.test(up)) return 0.1;
  if (price >= 500) return 1; // crypto / big indices
  if (price >= 20) return 0.1;
  return 0.0001; // FX
}

async function marketPrice(creds: BrokerCreds, epic: string): Promise<{ bid: number; offer: number }> {
  try {
    const j = (await igFetch(creds, `/markets/${encodeURIComponent(epic)}`, { version: "3", method: "GET" })) as {
      snapshot?: { bid?: number; offer?: number };
    };
    return { bid: num(j.snapshot?.bid), offer: num(j.snapshot?.offer) };
  } catch {
    return { bid: 0, offer: 0 };
  }
}

async function getAccount(creds: BrokerCreds): Promise<AccountInfo> {
  try {
    if (!String(creds.apiKey ?? "") || !String(creds.identifier ?? "")) {
      return { ok: false, error: "apiKey / identifier / password missing" };
    }
    await getSession(creds);
    const j = (await igFetch(creds, "/accounts", { version: "1", method: "GET" })) as {
      accounts?: Array<{
        accountId?: string;
        accountName?: string;
        currency?: string;
        balance?: { balance?: number; deposit?: number; profitLoss?: number };
      }>;
    };
    const a = j.accounts?.[0];
    if (!a) return { ok: false, error: "no accounts returned" };
    return {
      ok: true,
      id: a.accountId,
      currency: a.currency,
      balance: num(a.balance?.balance),
      equity: num(a.balance?.balance) + num(a.balance?.profitLoss),
      raw: j.accounts?.map((x) => ({ id: x.accountId, name: x.accountName })),
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult> {
  try {
    const epic = mapWith(creds, req.symbol, DEFAULT_MAP);
    const acct = await getAccount(creds);
    if (!acct.ok) return { ok: false, error: `account: ${acct.error}` };
    const equity = acct.equity ?? acct.balance ?? 0;

    const { bid, offer } = await marketPrice(creds, epic);
    const refPx = req.side === -1 ? bid : offer;
    const pt = pointSizeFor(creds, epic, refPx || req.entry);

    const size =
      req.sizing.mode === "percent"
        ? percentUnits(equity, req.sizing.percent, req.riskDistance, 0.5)
        : Math.max(0.01, Math.round(req.sizing.size * 100) / 100);

    const stopDistPts = Math.max(1, Math.round(req.riskDistance / pt));
    const limitDistPts = Math.max(1, Math.round(Math.abs(req.tp - req.entry) / pt));

    const body = {
      epic,
      direction: req.side === -1 ? "SELL" : "BUY",
      orderType: "MARKET",
      size,
      currencyCode: String(acct.currency ?? "USD"),
      forceOpen: true,
      guaranteedStop: false,
      stopLevel: stopDistPts,
      limitLevel: limitDistPts,
      timeInForce: null,
    };

    const j = (await igFetch(creds, "/positions/otc", {
      version: "2",
      method: "POST",
      body: JSON.stringify(body),
    })) as { dealReference?: string };
    if (!j.dealReference) return { ok: false, error: "no deal reference returned", raw: j };

    // confirm the deal
    await new Promise((r) => setTimeout(r, 350));
    const c = (await igFetch(creds, `/confirms/${encodeURIComponent(j.dealReference)}`, {
      version: "1",
      method: "GET",
    })) as { dealStatus?: string; dealId?: string; level?: number; size?: number; reason?: string };
    if (c.dealStatus === "ACCEPTED") {
      return { ok: true, brokerOrderId: c.dealId, fillPrice: num(c.level), volume: num(c.size, size) };
    }
    return { ok: false, error: `deal ${c.dealStatus ?? "REJECTED"}: ${c.reason ?? "unknown"}`, raw: c };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function closePosition(creds: BrokerCreds, symbol?: string, side?: -1 | 1): Promise<OrderResult> {
  try {
    // close-all: iterate every open IG position
    if (!symbol) {
      const open = await getPositions(creds);
      for (const p of open) {
        await closePosition(creds, p.symbol, undefined).catch(() => {});
      }
      return { ok: true };
    }
    const epic = mapWith(creds, symbol, DEFAULT_MAP);
    const positions = await getPositions(creds, symbol);
    const targets = positions.filter((p) => (side ? p.side === side : true));
    if (targets.length === 0) return { ok: true }; // nothing open (maybe broker-side SL/TP already fired)
    for (const p of targets) {
      const { bid, offer } = await marketPrice(creds, p.symbol);
      const body = {
        dealId: p.id,
        epic: p.symbol,
        expiry: "-",
        direction: p.side === 1 ? "SELL" : "BUY",
        size: p.volume,
        level: p.side === 1 ? bid : offer,
        bid,
        offer,
        orderType: "MARKET",
        timeInForce: null,
      };
      await igFetch(creds, `/positions/otc/${encodeURIComponent(p.id)}?_METHOD=DELETE`, {
        version: "1",
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]> {
  try {
    const j = (await igFetch(creds, "/positions", { version: "2", method: "GET" })) as {
      positions?: Array<{
        position?: { dealId?: string; direction?: string; size?: number; level?: number; limitLevel?: number; stopLevel?: number; currency?: string };
        market?: { epic?: string; instrumentName?: string };
      }>;
    };
    const out: PositionInfo[] = (j.positions ?? []).map((p) => ({
      id: String(p.position?.dealId ?? ""),
      symbol: String(p.market?.epic ?? ""),
      side: p.position?.direction === "SELL" ? -1 : 1,
      volume: num(p.position?.size),
      entryPrice: num(p.position?.level),
      tp: p.position?.limitLevel ?? undefined,
      sl: p.position?.stopLevel ?? undefined,
    }));
    return symbol ? out.filter((x) => x.symbol === mapWith(creds, symbol, DEFAULT_MAP)) : out;
  } catch {
    return [];
  }
}

// ── pending (working) orders ──────────────────────────────────────────
// GET   /workingorders (v2)          → resting orders
// POST  /positions/otc/:dealId?_METHOD=DELETE with dealId of the working order → cancel

async function getOrders(creds: BrokerCreds, symbol?: string): Promise<PendingOrderInfo[]> {
  try {
    const j = (await igFetch(creds, "/workingorders", { version: "2", method: "GET" })) as {
      workingOrders?: Array<{
        workingOrderData?: {
          dealId?: string;
          direction?: string;
          size?: number;
          level?: number;
          limitDistance?: number;
          stopDistance?: number;
          createdDate?: string;
          orderType?: string;
        };
        marketData?: { epic?: string; instrumentName?: string };
      }>;
    };
    const out: PendingOrderInfo[] = (j.workingOrders ?? []).map((w) => {
      const d = w.workingOrderData ?? {};
      const typeRaw = String(d.orderType ?? "LIMIT").toUpperCase();
      return {
        id: String(d.dealId ?? ""),
        symbol: String(w.marketData?.epic ?? ""),
        type: typeRaw.includes("STOP") ? "STOP" : "LIMIT",
        side: d.direction === "SELL" ? -1 : 1,
        volume: num(d.size),
        entryPrice: num(d.level) || undefined,
        tp: num(d.limitDistance) || undefined,
        sl: num(d.stopDistance) || undefined,
        placedAt: d.createdDate ? new Date(d.createdDate).getTime() : undefined,
        status: "WORKING",
      };
    });
    return symbol ? out.filter((x) => x.symbol === mapWith(creds, symbol, DEFAULT_MAP)) : out;
  } catch {
    return [];
  }
}

async function cancelOrder(creds: BrokerCreds, orderId: string): Promise<OrderResult> {
  try {
    // IG cancels a working order by deleting it OTC (dealId = working order id)
    await igFetch(creds, `/workingorders/otc/${encodeURIComponent(orderId)}?_METHOD=DELETE`, {
      version: "1",
      method: "POST",
      body: JSON.stringify({}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const igAdapter: BrokerAdapter = {
  kind: "ig",
  mapSymbol: (creds, symbol) => mapWith(creds, symbol, DEFAULT_MAP),
  testConnection: getAccount,
  getAccount,
  marketOrder,
  closePosition,
  getPositions,
  getOrders,
  cancelOrder,
};
