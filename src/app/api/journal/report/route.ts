// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/report — professional report payloads (daily / weekly /
//  monthly / custom / instrument / discipline). Rendered client-side for
//  print; the CSV of the same underlying records comes from /api/journal/
//  export with the identical filter contract.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { parseFilters, periodRange } from "@/lib/journal/filters";
import { toRec } from "@/lib/journal/records";
import { analyticsFor, type EquitySnapshot, type JournalRec, coreStats } from "@/lib/journal/stats";

export const dynamic = "force-dynamic";

const KINDS = ["daily", "weekly", "monthly", "custom", "instrument", "discipline"] as const;
type ReportKind = (typeof KINDS)[number];

function titleFor(kind: ReportKind, from: string | null, to: string | null): { title: string; sub: string } {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "…");
  switch (kind) {
    case "daily":
      return { title: "Daily Performance Report", sub: `Trading day of ${fmt(from)} (UTC)` };
    case "weekly":
      return { title: "Weekly Performance Report", sub: `Week of ${fmt(from)} → ${fmt(to)} (UTC)` };
    case "monthly":
      return { title: "Monthly Performance Report", sub: `${fmt(from)?.slice(0, 7) ?? ""} (UTC)` };
    case "instrument":
      return { title: "Instrument Performance Report", sub: `${fmt(from)} → ${fmt(to)} (UTC)` };
    case "discipline":
      return { title: "Trading Discipline Report", sub: `${fmt(from)} → ${fmt(to)} (UTC)` };
    default:
      return { title: "Custom Period Report", sub: `${fmt(from)} → ${fmt(to)} (UTC)` };
  }
}

export async function GET(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  const url = new URL(req.url);
  const kindRaw = (url.searchParams.get("kind") ?? "monthly").toLowerCase();
  const kind: ReportKind = (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as ReportKind) : "monthly";

  // reports derive their own narrow window unless the caller passed custom
  const now = new Date();
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const f = parseFilters(url);
  if (kind === "daily" && !f.from) Object.assign(f, periodRange("today", null, null));
  if (kind === "weekly" && !f.from) Object.assign(f, { from: new Date(day0 - 6 * 86400_000), to: null });
  if (kind === "monthly" && !f.from) Object.assign(f, periodRange("month", null, null));

  try {
    const [rows, snaps] = await Promise.all([
      db.journalTrade.findMany({ where: { userId, ...f.where }, orderBy: { closedAt: "asc" }, take: 20000 }),
      db.journalEquity.findMany({ where: { userId }, orderBy: { day: "asc" } }),
    ]);
    const recs: JournalRec[] = rows.map(toRec);
    const snapshots: EquitySnapshot[] = snaps.map((s) => ({ day: s.day, balance: s.balance, equity: s.equity, source: s.source }));
    const a = analyticsFor(recs, { year: f.year, month0: f.month0, snapshots });
    const { title, sub } = titleFor(kind, a.range.from, a.range.to);

    const winners = recs.filter((r) => r.netPnl > 0).sort((x, y) => y.netPnl - x.netPnl).slice(0, 10);
    const losers = recs.filter((r) => r.netPnl < 0).sort((x, y) => x.netPnl - y.netPnl).slice(0, 10);

    const observations: string[] = [];
    const c = a.core;
    if (c.totalTrades === 0) observations.push("No closed trades fall inside this report window.");
    if (c.totalTrades > 0) {
      observations.push(
        `${c.totalTrades} closed trades produced a net result of ${c.netPnl.toFixed(2)} ${c.currencies.join("/")} (win rate ${c.winRatePct.toFixed(1)}%, profit factor ${c.profitFactorLabel}).`
      );
      if (c.avgWin !== null && c.avgLoss !== null && c.avgLoss > 0)
        observations.push(`The average winner is ${c.avgWin.toFixed(2)} against an average loser of −${c.avgLoss.toFixed(2)} — reward-to-risk ${c.rewardRiskRatio?.toFixed(2) ?? "—"}.`);
      if (c.totalCosts > 0) observations.push(`Commissions, swap and fees consumed ${c.totalCosts.toFixed(2)} of gross results across the window.`);
      if (a.discipline.taggedTrades > 0 && a.discipline.topMistakes.length > 0)
        observations.push(`Most-recorded discipline item: ${a.discipline.topMistakes[0].label} (${a.discipline.topMistakes[0].count} tagged trades).`);
      if (c.maxDrawdown > 0) observations.push(`Peak-to-trough drawdown reached ${c.maxDrawdown.toFixed(2)}${c.maxDrawdownPct !== null ? ` (${c.maxDrawdownPct.toFixed(1)}% of peak)` : ""}.`);
    }

    return NextResponse.json({
      ok: true,
      report: {
        kind,
        title,
        sub,
        generatedAt: new Date().toISOString(),
        currency: c.currencies,
        core: c,
        daily: a.daily.slice(-62),
        bySymbol: a.bySymbol,
        byDirection: a.byDirection,
        bySession: a.bySession,
        byStrategy: a.byStrategy,
        discipline: a.discipline,
        winners: winners.map((r) => ({ id: r.id, symbol: r.symbol, direction: r.direction, netPnl: r.netPnl, closedAt: r.closedAt, isDemo: r.isDemo })),
        losers: losers.map((r) => ({ id: r.id, symbol: r.symbol, direction: r.direction, netPnl: r.netPnl, closedAt: r.closedAt, isDemo: r.isDemo })),
        observations,
        totals: coreStats(recs).totalTrades,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
