// ════════════════════════════════════════════════════════════════════════
//  BROKER PRICE FEED (HALO Bridge EA) · the prices of the account you trade
//
//  When a "MT5 · HALO Bridge EA" broker account exists and its EA is online,
//  forex / metals / index candles and live quotes come from that MT5
//  terminal (e.g. Exness) — the same prices the orders fill at. Market data
//  only. When the EA is offline every caller falls back (OANDA → Yahoo).
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { parseCreds } from "@/lib/brokers";
import { eaCandles, eaLatestQuote, eaPresence, eaSubscribeQuotes, type EaQuote } from "@/lib/brokers/mt5-ea";
import type { BrokerCreds } from "@/lib/brokers/types";
import { getSymbolMeta } from "@/lib/market-symbols";

const g = globalThis as unknown as { __haloEaFeed?: { at: number; creds: BrokerCreds | null; label: string } };
const CACHE_MS = 30_000;

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

export async function brokerCandles(symbol: string, tf: string, limit: number) {
  const f = await brokerFeed(symbol);
  if (!f) throw new Error("broker price feed offline");
  return eaCandles(f.creds, symbol, tf, limit);
}

export async function brokerQuote(symbol: string): Promise<EaQuote | null> {
  const f = await brokerFeed(symbol);
  return f ? eaLatestQuote(f.creds, symbol) : null;
}

export async function subscribeBrokerQuotes(symbol: string, fn: (q: EaQuote) => void): Promise<(() => void) | null> {
  const f = await brokerFeed(symbol);
  return f ? eaSubscribeQuotes(f.creds, symbol, fn) : null;
}
