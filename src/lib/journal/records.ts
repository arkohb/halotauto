// server-side normalizer: JournalTrade DB rows → pure JournalRec records

import type { JournalTrade } from "@prisma/client";
import type { JournalRec, JournalReview } from "./stats";

export function parseTags(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseReview(json: string): JournalReview {
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as JournalReview) : {};
  } catch {
    return {};
  }
}

export function toRec(r: JournalTrade): JournalRec {
  return {
    id: r.id,
    source: r.source,
    brokerLabel: r.brokerLabel,
    symbol: r.symbol,
    direction: r.direction,
    volume: r.volume,
    volumeExit: r.volumeExit,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    sl: r.sl,
    tp: r.tp,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt.toISOString(),
    durationMin: r.durationMin,
    grossProfit: r.grossProfit,
    commission: r.commission,
    swap: r.swap,
    fees: r.fees,
    netPnl: r.netPnl,
    currency: r.currency,
    riskPrice: r.riskPrice,
    rMultiple: r.rMultiple,
    strategy: r.strategy,
    timeframe: r.timeframe,
    session: r.session,
    notes: r.notes,
    tags: parseTags(r.tagsJson),
    review: parseReview(r.reviewJson),
    isDemo: r.source === "DEMO",
  };
}
