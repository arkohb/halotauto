// ════════════════════════════════════════════════════════════════════════
//  PRICE GUARD (Decision B) · may this order be sent at all?
//
//  Runs before every NEW order (executeFire: bot · scanner · sweep · Pine,
//  and the TradingView webhook). It never changes the strategy, never
//  touches open positions, stops or closes — it only refuses to OPEN a
//  position when the price data behind it cannot be trusted:
//    1. simulated prices      — feed source "simulator"
//    2. stale prices          — refresh failed (cached candles) or the newest
//                               candle is older than its timeframe allows
//    3. missing/invalid quote — no candles, non-finite or non-positive price
//    4. feed unavailable      — the price lookup itself failed
//  LIVE orders additionally need the live-quote deviation check: a fresh
//  bid/ask from the execution broker must be within maxDeviationAtr × ATR
//  of the order price. Until a Super Admin sets that threshold, live orders
//  are refused (mandatory prerequisite for live trading).
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { getAdapter, parseCreds } from "@/lib/brokers";
import type { ActiveBroker } from "@/lib/execution";
import type { Candle } from "@/lib/halo/types";
import { getKlines } from "@/lib/market";
import { tfSec } from "@/lib/market-symbols";

export const PRICE_GUARD_SETTING_KEY = "price_guard.max_deviation_atr";
/** a broker quote older than this is not "fresh" */
export const MAX_QUOTE_AGE_MS = 15_000;
/** grace on top of one timeframe before the newest candle counts as stale */
const BAR_GRACE_MS = 90_000;

export type GuardVerdict = { ok: true; px: number; atr: number | null } | { ok: false; reason: string };

/** pure: is the signal feed real, fresh and sane? */
export function evaluateFeed(input: { source: string; stale?: boolean; candles: Candle[]; tfMs: number; now: number }): GuardVerdict {
  if (input.source === "simulator") return { ok: false, reason: "simulated prices — no live feed for this market" };
  if (input.stale) return { ok: false, reason: "stale prices — the live feed refresh failed (cached candles)" };
  const last = input.candles[input.candles.length - 1];
  if (!last) return { ok: false, reason: "no price data" };
  const px = last.close;
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(last.time) || last.high < last.low) {
    return { ok: false, reason: "invalid price data" };
  }
  if (last.time > input.now + 60_000) return { ok: false, reason: "invalid price data (candle time in the future)" };
  const age = input.now - last.time;
  if (age > input.tfMs + BAR_GRACE_MS) {
    return { ok: false, reason: `stale prices — newest candle is ${Math.round(age / 60_000)} min old (market closed or feed frozen)` };
  }
  return { ok: true, px, atr: atrOf(input.candles) };
}

/** pure: is the order price close enough to a fresh broker quote? */
export function evaluateDeviation(input: {
  entry: number;
  dir: -1 | 1;
  quote: { bid?: number; ask?: number; time?: number } | null;
  atr: number | null;
  maxDeviationAtr: number | null;
  now: number;
}): { ok: true; deviationAtr: number } | { ok: false; reason: string } {
  if (input.maxDeviationAtr === null) {
    return { ok: false, reason: "live-quote deviation check is not configured (Super Admin must set the threshold before live trading)" };
  }
  const q = input.quote;
  if (!q) return { ok: false, reason: "no quote from the execution broker" };
  // the side we would trade at: BUY pays the ask, SELL hits the bid
  const side = input.dir === 1 ? q.ask : q.bid;
  if (side === undefined || !Number.isFinite(side) || side <= 0) return { ok: false, reason: "invalid quote from the execution broker" };
  if (q.time !== undefined && Number.isFinite(q.time) && input.now - q.time > MAX_QUOTE_AGE_MS) {
    return { ok: false, reason: `broker quote is stale (${Math.round((input.now - q.time) / 1000)} s old)` };
  }
  if (!input.atr || !Number.isFinite(input.atr) || input.atr <= 0) return { ok: false, reason: "cannot size the deviation limit (no ATR)" };
  const dev = Math.abs(side - input.entry) / input.atr;
  if (dev > input.maxDeviationAtr) {
    return { ok: false, reason: `broker price ${side} is ${dev.toFixed(2)} ATR from the order price ${input.entry} (limit ${input.maxDeviationAtr} ATR)` };
  }
  return { ok: true, deviationAtr: dev };
}

function atrOf(c: Candle[], len = 14): number | null {
  if (c.length < len + 1) return null;
  let a = 0;
  for (let i = c.length - len; i < c.length; i++) {
    const p = c[i - 1].close;
    a += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - p), Math.abs(c[i].low - p));
  }
  return a / len;
}

/** Super-Admin-protected live deviation threshold (× ATR); null = not set */
export async function getMaxDeviationAtr(): Promise<number | null> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key: PRICE_GUARD_SETTING_KEY } });
    if (!row) return null;
    const v = JSON.parse(row.valueJson) as unknown;
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** the full check for one new order */
export async function verifyOrderPrice(job: {
  symbol: string;
  tf: string;
  entry: number;
  dir: -1 | 1;
  live: boolean;
  broker: ActiveBroker | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let feed: GuardVerdict;
  try {
    const k = await getKlines(job.symbol, job.tf, 50, { fresh: true });
    feed = evaluateFeed({ source: k.source, stale: k.stale, candles: k.candles, tfMs: tfSec(job.tf) * 1000, now: Date.now() });
  } catch {
    feed = { ok: false, reason: "price feed unavailable" };
  }
  if (!feed.ok) return feed;
  if (!job.live) return { ok: true };

  if (!job.broker) return { ok: false, reason: "no execution broker to verify the price with" };
  const adapter = getAdapter(job.broker.kind);
  if (!adapter.getQuote) {
    return { ok: false, reason: `${job.broker.label} cannot provide a live quote — live-quote verification unavailable for this broker` };
  }
  let quote: { bid?: number; ask?: number; time?: number } | null = null;
  try {
    const q = await adapter.getQuote(parseCreds(job.broker.credsJson), job.symbol);
    quote = q.ok ? q : null;
  } catch {
    quote = null;
  }
  const dev = evaluateDeviation({ entry: job.entry, dir: job.dir, quote, atr: feed.atr, maxDeviationAtr: await getMaxDeviationAtr(), now: Date.now() });
  return dev.ok ? { ok: true } : dev;
}
