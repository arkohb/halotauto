// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/insights — HALO Performance Insights (journal-scoped AI)
//
//  HARD GUARANTEES (spec §10):
//    · every answer is grounded in the caller's ACTUAL journal records —
//      the model receives pre-computed statistics and is forbidden from
//      inventing numbers, history or explanations;
//    · common questions (month performance, best instrument, win rate,
//      average winner, best weekday, discipline, drawdown trend, MoM
//      comparison) are answered DETERMINISTICALLY from the records;
//    · anything else goes to the LLM with a strict analytics-only brief —
//      it may NEVER change the strategy, place orders or give advice;
//    · insufficient data is stated plainly instead of being papered over.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { parseFilters } from "@/lib/journal/filters";
import { toRec } from "@/lib/journal/records";
import { analyticsFor, type EquitySnapshot, type JournalRec } from "@/lib/journal/stats";

export const dynamic = "force-dynamic";

function money(v: number | null | undefined, ccy = "USD"): string {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}${ccy === "USD" ? "$" : `${ccy} `}${s}`;
}

const PCT = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

/** deterministic answers — computed, not generated */
function deterministicAnswer(q: string, recs: JournalRec[], a: ReturnType<typeof analyticsFor>, ccy: string): string | null {
  const t = q.toLowerCase();
  const c = a.core;
  const has = (n: number) => c.totalTrades >= n;

  if (/this month|monthly performance|how did i perform this month/.test(t)) {
    if (!has(1)) return "There are no closed trades recorded for this month yet — nothing to analyse.";
    const month = a.monthly.slice(-1)[0];
    return `This month (${month?.day ?? "current"}): ${c.totalTrades} closed trade${c.totalTrades === 1 ? "" : "s"} in the selected range, net ${money(c.netPnl, ccy)} · win rate ${PCT(c.winRatePct)} · profit factor ${c.profitFactorLabel} · max drawdown ${money(c.maxDrawdown, ccy)}. ${c.netPnl >= 0 ? "The month is net positive." : "The month is net negative."}`;
  }
  if (/highest net|best instrument|which instrument|most profitable instrument/.test(t)) {
    if (!has(1)) return "No trades are recorded yet, so no instrument ranking exists.";
    const top = a.bySymbol.filter((b) => b.key !== "DEMO")[0];
    return top
      ? `The highest net-profit instrument in your records is ${top.key}: ${top.trades} trades, net ${money(top.net, ccy)}, win rate ${PCT(top.winRatePct)}.`
      : "No instrument is recorded in the selection.";
  }
  if (/win rate/.test(t)) {
    if (!has(1)) return "Win rate needs at least one closed trade — the journal is empty for this range.";
    return `Your win rate in the selected range is ${PCT(c.winRatePct)} (${c.wins} wins / ${c.losses} losses${c.breakeven ? ` / ${c.breakeven} breakeven` : ""} of ${c.totalTrades} trades).`;
  }
  if (/average win|avg win|average winning/.test(t)) {
    if (c.avgWin === null) return "No winning trades are recorded in this range, so there is no average winning trade yet.";
    return `Your average winning trade is ${money(c.avgWin, ccy)} across ${c.wins} winners (largest single win: ${money(c.largestWin, ccy)}).`;
  }
  if (/day of the week|which days|best weekday|weekday/.test(t)) {
    if (!has(1)) return "No trades recorded for a weekday analysis yet.";
    const best = a.byWeekday.filter((d) => d.trades >= 2)[0];
    return best
      ? `Historically your best weekday (minimum 2 trades) is ${best.key}: net ${money(best.net, ccy)} over ${best.trades} trades (win rate ${PCT(best.winRatePct)}). Full ranking: ${a.byWeekday.map((d) => `${d.key} ${money(d.net, ccy)}`).join(" · ")}.`
      : "Not enough weekday history yet — each weekday needs at least 2 recorded trades before it can be ranked.";
  }
  if (/following my .*(strategy|plan)|follow(ing)? the plan|discipline|am i disciplined/.test(t)) {
    const d = a.discipline;
    if (d.taggedTrades === 0)
      return "No trades carry discipline tags yet — tag your trades (e.g. “Followed trading plan” vs “Emotional decision”) in the trade review panel and the discipline trend will build from that.";
    return `You have tagged ${d.taggedTrades} trade${d.taggedTrades === 1 ? "" : "s"}: ${d.positiveTags} positive-tag instances vs ${d.negativeTags} negative-tag instances (adherence ${PCT(d.adherencePct)} of tagged trades carry a positive tag). Most frequent: ${d.tagCounts.slice(0, 3).map((x) => `${x.label} ×${x.count}`).join(", ")}.`;
  }
  if (/mistake|mistakes appear|most frequent/.test(t)) {
    const m = a.discipline.topMistakes;
    if (m.length === 0) return "No mistakes are recorded in the journal — tag trades with the mistake classifications in the review panel and this analysis will fill in.";
    return `Your most frequently recorded mistakes: ${m.map((x) => `${x.label} ×${x.count}`).join(", ")}. These come only from your own tagging — nothing is auto-labeled.`;
  }
  if (/drawdown/.test(t)) {
    if (!has(1)) return "Drawdown needs closed trades — the selection is empty.";
    return `Maximum drawdown in the selected range is ${money(c.maxDrawdown, ccy)}${c.maxDrawdownPct !== null ? ` (≈${PCT(c.maxDrawdownPct)} of the pre-trough peak)` : ""}. It is measured on the cumulative realized net-P&L curve from ${c.totalTrades} closed trades.`;
  }
  if (/compare.*previous month|vs last month|versus previous|month.over.month/.test(t)) {
    if (a.monthly.length < 2)
      return "A month-over-month comparison needs at least two months of recorded trades — keep journaling and this becomes available.";
    const cur = a.monthly[a.monthly.length - 1];
    const prev = a.monthly[a.monthly.length - 2];
    const diff = cur.net - prev.net;
    return `${cur.day}: ${money(cur.net, ccy)} over ${cur.trades} trades vs ${prev.day}: ${money(prev.net, ccy)} over ${prev.trades} trades — a change of ${money(diff, ccy)}.`;
  }
  if (/profit factor|expectancy|r-multiple|average r/.test(t)) {
    if (!has(1)) return "The selected range has no closed trades yet.";
    const parts = [`profit factor ${c.profitFactorLabel}`, `expectancy ${money(c.expectancy, ccy)} per trade`];
    if (c.avgR !== null) parts.push(`average R-multiple ${c.avgR.toFixed(2)}R (from ${c.rCount} trades with a recorded SL)`);
    else parts.push("no R-multiple average yet — R becomes calculable once trades record a stop-loss");
    return `In the selected range: ${parts.join(" · ")}.`;
  }
  return null;
}

export async function GET(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 300);
  if (!q) return NextResponse.json({ ok: false, error: "Ask a question about your journal." }, { status: 400 });
  // the QUESTION is not a search term — strip it before parsing filters so
  // "What is my win rate?" never filters trades by text match
  const furl = new URL(url.toString());
  furl.searchParams.delete("q");
  const f = parseFilters(furl);

  try {
    const [rows, snaps] = await Promise.all([
      db.journalTrade.findMany({ where: { userId, ...f.where }, orderBy: { closedAt: "asc" }, take: 20000 }),
      db.journalEquity.findMany({ where: { userId }, orderBy: { day: "asc" } }),
    ]);
    const recs = rows.map(toRec);
    const snapshots: EquitySnapshot[] = snaps.map((s) => ({ day: s.day, balance: s.balance, equity: s.equity, source: s.source }));
    const a = analyticsFor(recs, { year: f.year, month0: f.month0, snapshots });
    const ccy = a.core.currencies.length === 1 ? a.core.currencies[0] : "USD";

    if (a.core.totalTrades === 0) {
      return NextResponse.json({
        ok: true,
        answer:
          "There is not enough recorded data to answer that — the selected range contains no closed trades. Synchronize MT5 history, import a CSV, add a manual entry, or widen the date filter.",
        grounded: true,
        deterministic: false,
      });
    }

    // 1) deterministic, computed from the records themselves
    const det = deterministicAnswer(q, recs, a, ccy);
    if (det) return NextResponse.json({ ok: true, answer: det, grounded: true, deterministic: true });

    // 2) grounded LLM narrative over the pre-computed statistics
    const statsBrief = {
      selection: {
        trades: a.core.totalTrades,
        period: f.period,
        from: a.range.from,
        to: a.range.to,
        currency: a.core.currencies,
        note: "All times UTC. R-multiples are price-based where SL was recorded.",
      },
      core: {
        net: Math.round(a.core.netPnl * 100) / 100,
        winRatePct: Math.round(a.core.winRatePct * 10) / 10,
        lossRatePct: Math.round(a.core.lossRatePct * 10) / 10,
        profitFactor: a.core.profitFactor === Infinity ? "∞" : a.core.profitFactor,
        avgWin: a.core.avgWin,
        avgLoss: a.core.avgLoss,
        expectancy: a.core.expectancy,
        avgR: a.core.avgR,
        maxDrawdown: a.core.maxDrawdown,
        maxDrawdownPct: a.core.maxDrawdownPct,
        totalCosts: Math.round(a.core.totalCosts * 100) / 100,
        consecutiveWins: a.core.consecutiveWins,
        consecutiveLosses: a.core.consecutiveLosses,
        largestWin: a.core.largestWin,
        largestLoss: a.core.largestLoss,
      },
      bySymbol: a.bySymbol.slice(0, 12),
      byDirection: a.byDirection,
      bySession: a.bySession,
      byWeekday: a.byWeekday,
      byTimeframe: a.byTimeframe,
      byStrategy: a.byStrategy,
      monthly: a.monthly.slice(-12),
      discipline: { tagged: a.discipline.taggedTrades, topTags: a.discipline.tagCounts.slice(0, 6) },
    };

    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              "You are HALO's Performance Journal analyst. You receive VERIFIED statistics computed from the trader's own journal records. RULES: (1) answer ONLY from the provided statistics — never invent trades, numbers, dates or explanations; (2) if the statistics cannot answer the question, say exactly that; (3) be analytical and educational — describe what the numbers show, not what the trader should trade; (4) NEVER suggest strategy changes, entries or exits, and NEVER offer financial advice; (5) keep it under 130 words, plain text, cite the concrete figures you use.",
          },
          { role: "user", content: `Trader's question: "${q}"\n\nVERIFIED JOURNAL STATISTICS:\n${JSON.stringify(statsBrief)}` },
        ],
        thinking: { type: "disabled" },
      });
      const answer = completion.choices[0]?.message?.content?.trim() ?? "";
      if (!answer) throw new Error("empty");
      return NextResponse.json({ ok: true, answer, grounded: true, deterministic: false });
    } catch {
      // LLM unavailable → fall back to an honest stats summary
      const c = a.core;
      return NextResponse.json({
        ok: true,
        answer: `Journal summary for the selected range: ${c.totalTrades} closed trades, net ${money(c.netPnl, ccy)}, win rate ${PCT(c.winRatePct)}, profit factor ${c.profitFactorLabel}, max drawdown ${money(c.maxDrawdown, ccy)}. Top instruments: ${a.bySymbol.slice(0, 3).map((s) => `${s.key} (${money(s.net, ccy)})`).join(", ") || "none"}. (The narrative analyst is temporarily unavailable — these figures are computed directly from your records.)`,
        grounded: true,
        deterministic: true,
      });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
