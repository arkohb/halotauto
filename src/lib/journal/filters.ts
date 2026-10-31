// shared journal filter parsing — one definition used by list / stats /
// export / report routes so every surface answers with the SAME numbers

import type { Prisma } from "@prisma/client";

export interface JournalFilters {
  where: Prisma.JournalTradeWhereInput;
  period: string;
  from: Date | null;
  to: Date | null;
  symbol: string;
  direction: string;
  outcome: string;
  strategy: string;
  timeframe: string;
  source: string;
  q: string;
  year: number;
  month0: number;
}

export function periodRange(period: string, fromS: string | null, toS: string | null): { from: Date | null; to: Date | null } {
  const now = new Date();
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  switch (period) {
    case "today":
      return { from: new Date(day(now)), to: null };
    case "week": {
      const mon = day(now) - ((now.getUTCDay() + 6) % 7) * 86400_000;
      return { from: new Date(mon), to: null };
    }
    case "month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: null };
    case "lastmonth":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      };
    case "90d":
      return { from: new Date(+now - 90 * 86400_000), to: null };
    case "year":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: null };
    case "custom": {
      const f = fromS ? new Date(fromS) : null;
      const t = toS ? new Date(toS) : null;
      return { from: f && isFinite(+f) ? f : null, to: t && isFinite(+t) ? t : null };
    }
    default:
      return { from: null, to: null };
  }
}

export function parseFilters(url: URL): JournalFilters {
  const p = url.searchParams;
  const period = p.get("period") ?? "all";
  const { from, to } = periodRange(period, p.get("from"), p.get("to"));
  const symbol = (p.get("symbol") ?? "").trim().toUpperCase();
  const direction = (p.get("direction") ?? "").trim().toUpperCase();
  const outcome = (p.get("outcome") ?? "").trim().toLowerCase();
  const strategy = (p.get("strategy") ?? "").trim();
  const timeframe = (p.get("timeframe") ?? "").trim();
  const source = (p.get("source") ?? "").trim().toUpperCase();
  const q = (p.get("q") ?? "").trim();
  const now = new Date();
  const yRaw = parseInt(p.get("year") ?? "", 10);
  const mRaw = parseInt(p.get("month") ?? "", 10);
  const year = Number.isFinite(yRaw) ? Math.min(2100, Math.max(2000, yRaw)) : now.getUTCFullYear();
  const month0 = Number.isFinite(mRaw) ? Math.min(11, Math.max(0, mRaw)) : now.getUTCMonth();

  const where: Prisma.JournalTradeWhereInput = {};
  if (from || to) {
    where.closedAt = {};
    if (from) where.closedAt.gte = from;
    if (to) where.closedAt.lte = to;
  }
  if (symbol) where.symbol = symbol;
  if (direction === "BUY" || direction === "SELL") where.direction = direction;
  if (outcome === "win") where.netPnl = { gt: 0 };
  else if (outcome === "loss") where.netPnl = { lt: 0 };
  else if (outcome === "breakeven") where.netPnl = 0;
  if (strategy) where.strategy = strategy;
  if (timeframe) where.timeframe = timeframe;
  if (source) where.source = source;
  if (q) {
    where.OR = [
      { symbol: { contains: q } },
      { notes: { contains: q } },
      { strategy: { contains: q } },
    ];
  }
  return { where, period, from, to, symbol, direction, outcome, strategy, timeframe, source, q, year, month0 };
}
