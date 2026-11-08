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
// after an Exness API failure, skip it briefly instead of retrying on every refresh
const gApi = globalThis as unknown as { __haloExnessApiDownUntil?: number; __haloExnessApiErr?: string; __haloExnessNoSym?: Map<string, number> };
const apiUsable = () => !!exnessConfig() && Date.now() >= (gApi.__haloExnessApiDownUntil ?? 0);
// a symbol Exness does not serve (404 MARKET_INSTRUMENT_NOT_FOUND) is skipped on
// its own for 15 minutes — it must never pause the API for every other symbol
const NO_SYMBOL_MS = 15 * 60_000;
const noSym = (gApi.__haloExnessNoSym ??= new Map<string, number>());
const symbolUsable = (symbol: string) => Date.now() >= (noSym.get(symbol) ?? 0);
const SYMBOL_ERR = /not available on this Exness account|MARKET_INSTRUMENT_NOT_FOUND|HTTP 404/;
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
  if (apiUsable() && symbolUsable(symbol)) return "api";
  return (await brokerFeed(symbol)) ? "ea" : null;
}

/** hot = the chart's or the bot's symbol (served first under Exness's rate limit) */
export async function brokerCandles(symbol: string, tf: string, limit: number, hot = true) {
  if (brokerFeedCovers(symbol) && apiUsable() && symbolUsable(symbol)) {
    try {
      const c = await exnessCandles(symbol, tf, limit, hot);
      gApi.__haloExnessApiErr = "";
      return c;
    } catch (e) {
      const msg = (e as Error).message;
      gApi.__haloExnessApiErr = msg;
      // this symbol not served → skip just this symbol; timeframe not offered or
      // rate-limit queue busy → no penalty; auth / network trouble → pause 60 s
      if (SYMBOL_ERR.test(msg)) noSym.set(symbol, Date.now() + NO_SYMBOL_MS);
      else if (!/not offered|Exness busy/.test(msg)) {
        // auth refused even after the retry → 60 s; transient trouble (timeout,
        // 5xx, 429) → 15 s, so the chart and bot return to Exness quickly
        const pause = /HTTP 40[13]/.test(msg) ? 60_000 : 15_000;
        gApi.__haloExnessApiDownUntil = Date.now() + pause;
        console.warn(`[exness] API paused ${pause / 1000} s (${symbol} ${tf}): ${msg.slice(0, 160)}`);
      }
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
  if (brokerFeedCovers(symbol) && apiUsable() && symbolUsable(symbol)) {
    const u = await subscribeExnessTicks(symbol, (t) => fn({ bid: t.bid, ask: t.ask, time: t.time, at: Date.now() }));
    if (u) return u;
  }
  const f = await brokerFeed(symbol);
  return f ? eaSubscribeQuotes(f.creds, symbol, fn) : null;
}
