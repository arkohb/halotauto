// ════════════════════════════════════════════════════════════════════════
//  BROKER PRICE FEED · the prices of the account you trade
//
//  Forex / metals / index candles and live quotes, in this order:
//    1. Exness Trader API (cloud, when EXNESS_API_* is set)  → src/lib/exness-api.ts
//    2. your MT5 terminal via the HALO Bridge EA (when its EA is online)
//  Market data only. When neither works every caller falls back
//  (OANDA → Yahoo) in market.ts.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { parseCreds } from "@/lib/brokers";
import { eaCandles, eaLatestQuote, eaPresence, eaSubscribeQuotes, type EaQuote } from "@/lib/brokers/mt5-ea";
import type { BrokerCreds } from "@/lib/brokers/types";
import { getSymbolMeta } from "@/lib/market-symbols";
import { exnessCandles, exnessConfig, subscribeExnessTicks } from "@/lib/exness-api";

const g = globalThis as unknown as { __haloEaFeed?: { at: number; creds: BrokerCreds | null; label: string } };
const CACHE_MS = 30_000;
// after an Exness API failure, skip it for a minute instead of retrying on every refresh
const gApi = globalThis as unknown as { __haloExnessApiDownUntil?: number; __haloExnessApiErr?: string };
const apiUsable = () => !!exnessConfig() && Date.now() >= (gApi.__haloExnessApiDownUntil ?? 0);
export function exnessApiLastError(): string {
  return gApi.__haloExnessApiErr ?? "";
}

async function feedAccount(): Promise<{ creds: BrokerCreds; label: string } | null> {
  const c = g.__haloEaFeed;
  if (c && Date.now() - c.at < CACHE_MS) return c.creds ? { creds: c.creds, label: c.label } : null;
  const rows = await db.brokerAccount.findMany({ where: { kind: "mt5ea" }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], take: 1 });
  const row = rows[0];
  const creds = row ? parseCreds(row.credsJson) : null;
  g.__haloEaFeed = { at: Date.now(), creds: creds && creds.eaKey ? creds : null, label: row?.label ?? "" };
  return g.__haloEaFeed.creds ? { creds: g.__haloEaFeed.creds, label: g.__haloEaFeed.label } : null;
}

/** symbols an MT5 CFD broker quotes (crypto stays on Binance, synthetics on Deriv) */
export function brokerFeedCovers(symbol: string): boolean {
  const grp = getSymbolMeta(symbol).group;
  return grp === "FOREX" || grp === "METALS" || grp === "INDICES";
}

/** the EA feed's credentials when it can serve this symbol right now */
export async function brokerFeed(symbol: string): Promise<{ creds: BrokerCreds; label: string } | null> {
  if (!brokerFeedCovers(symbol)) return null;
  const acct = await feedAccount().catch(() => null);
  if (!acct || !eaPresence(acct.creds).online) return null;
  return acct;
}

/** which broker feed can serve this symbol now: the cloud API, the EA, or none */
export async function brokerFeedSource(symbol: string): Promise<"api" | "ea" | null> {
  if (!brokerFeedCovers(symbol)) return null;
  if (apiUsable()) return "api";
  return (await brokerFeed(symbol)) ? "ea" : null;
}

export async function brokerCandles(symbol: string, tf: string, limit: number) {
  if (brokerFeedCovers(symbol) && apiUsable()) {
    try {
      const c = await exnessCandles(symbol, tf, limit);
      gApi.__haloExnessApiErr = "";
      return c;
    } catch (e) {
      const msg = (e as Error).message;
      gApi.__haloExnessApiErr = msg;
      // instrument simply not on the account → no penalty; auth / network trouble → pause 60 s
      if (!/not available on this Exness account|not offered/.test(msg)) gApi.__haloExnessApiDownUntil = Date.now() + 60_000;
      if (!(await brokerFeed(symbol))) throw e;
    }
  }
  const f = await brokerFeed(symbol);
  if (!f) throw new Error("broker price feed offline");
  return eaCandles(f.creds, symbol, tf, limit);
}

export async function brokerQuote(symbol: string): Promise<EaQuote | null> {
  const f = await brokerFeed(symbol);
  return f ? eaLatestQuote(f.creds, symbol) : null;
}

export async function subscribeBrokerQuotes(symbol: string, fn: (q: EaQuote) => void): Promise<(() => void) | null> {
  if (brokerFeedCovers(symbol) && apiUsable()) {
    const u = await subscribeExnessTicks(symbol, (t) => fn({ bid: t.bid, ask: t.ask, time: t.time, at: Date.now() }));
    if (u) return u;
  }
  const f = await brokerFeed(symbol);
  return f ? eaSubscribeQuotes(f.creds, symbol, fn) : null;
}
