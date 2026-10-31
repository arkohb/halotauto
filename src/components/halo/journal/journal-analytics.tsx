"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL ANALYTICS · P&L analysis (daily/weekly/monthly/cumulative),
//  win-vs-loss, performance breakdowns (instrument / direction / session /
//  weekday / recorded timeframe / recorded strategy) and the risk panel.
//  Everything renders the pre-computed AnalyticsPayload — no client math.
// ══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { BarChart3, CalendarRange, PieChart, Scale, TrendingUp } from "lucide-react";
import { PanelCard, StatCell, StateFrame } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { AnalyticsPayload, BreakdownRow } from "@/lib/journal/stats";
import { CumulativeLine, EquityCurve, OutcomeDonut, PnlBars } from "./journal-chart";
import { moneyPlain, num, pct, pnlColor } from "./journal-fmt";

export function JournalAnalytics({ data, ccy }: { data: AnalyticsPayload; ccy: string }) {
  const [bucket, setBucket] = useState<"daily" | "weekly" | "monthly">("daily");
  const c = data.core;
  if (c.totalTrades === 0) {
    return <StateFrame state="empty" title="No analytics yet for this selection" hint="Analytics fill in from your recorded closed trades — none fall inside the current filter." />;
  }

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      {/* A · equity curve */}
      <PanelCard
        className="xl:col-span-2"
        title={data.equity.mode === "snapshots" ? "EQUITY CURVE · RECORDED ACCOUNT SNAPSHOTS" : "EQUITY PROGRESSION · DERIVED FROM CLOSED-TRADE NET P&L"}
        icon={TrendingUp}
        accent="green"
        right={<span className="text-[8.5px] font-bold" style={{ color: C.label }}>{data.equity.mode === "snapshots" ? "Data source: broker account snapshots (MT5)" : "Data source: your journal records — cumulative realized net P&L (not account balance)"}</span>}
      >
        <div className="p-3">
          <EquityCurve points={data.equity.points} height={210} />
        </div>
      </PanelCard>

      {/* B · P&L analysis */}
      <PanelCard
        title="PROFIT & LOSS ANALYSIS"
        icon={BarChart3}
        accent="cyan"
        right={
          <div className="flex gap-1">
            {(["daily", "weekly", "monthly"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                aria-pressed={bucket === b}
                className="rounded-md border px-2 py-1 text-[8.5px] font-extrabold tracking-[0.1em] uppercase transition-all"
                style={bucket === b ? { borderColor: A.cyan(0.5), background: A.cyan(0.12), color: C.cyan } : { borderColor: C.line, background: C.navy2, color: C.muted }}
              >
                {b}
              </button>
            ))}
          </div>
        }
      >
        <div className="p-3">
          <PnlBars data={bucket === "daily" ? data.daily : bucket === "weekly" ? data.weekly : data.monthly} height={200} />
        </div>
      </PanelCard>

      <PanelCard title="CUMULATIVE NET P&L · WIN VS LOSS" icon={PieChart} accent="gold">
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          <div className="min-w-0">
            <OutcomeDonut wins={c.wins} losses={c.losses} breakeven={c.breakeven} />
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-1.5">
            <StatCell label="Gross profit" value={moneyPlain(c.grossProfit, ccy)} color={C.green} />
            <StatCell label="Gross loss" value={moneyPlain(-c.grossLoss, ccy)} color={C.red} />
            <StatCell label="Net P&L" value={moneyPlain(c.netPnl, ccy)} color={pnlColor(c.netPnl)} />
            <StatCell label="Expectancy / trade" value={moneyPlain(c.expectancy, ccy)} color={pnlColor(c.expectancy)} />
            <StatCell label="Win rate" value={pct(c.winRatePct)} color={C.green} />
            <StatCell label="Loss rate" value={pct(c.lossRatePct)} color={C.red} />
          </div>
          <div className="sm:col-span-2">
            <CumulativeLine points={data.cumulative} height={150} />
          </div>
        </div>
      </PanelCard>

      {/* D · performance breakdown */}
      <PanelCard title="PERFORMANCE BREAKDOWN" icon={CalendarRange} accent="cyan" className="xl:col-span-2">
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          <BreakTable title="By instrument" rows={data.bySymbol} ccy={ccy} />
          <BreakTable title="BUY vs SELL" rows={data.byDirection} ccy={ccy} />
          <BreakTable title="By session (derived from UTC open hour)" rows={data.bySession} ccy={ccy} />
          <BreakTable title="By day of week (UTC)" rows={data.byWeekday} ccy={ccy} />
          {data.byTimeframe.length > 0 && <BreakTable title="By recorded timeframe" rows={data.byTimeframe} ccy={ccy} note="Only trades whose timeframe was recorded appear here — none are assumed." />}
          {data.byStrategy.length > 0 && <BreakTable title="By recorded strategy / setup" rows={data.byStrategy} ccy={ccy} note="Only trades whose strategy was recorded appear here — none are assumed." />}
        </div>
      </PanelCard>

      {/* E · risk analysis */}
      <PanelCard title="RISK ANALYSIS" icon={Scale} accent="red" className="xl:col-span-2">
        <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatCell label="Max drawdown" value={moneyPlain(c.maxDrawdown, ccy)} color={C.red} sub={c.maxDrawdownPct !== null ? pct(c.maxDrawdownPct) + " of peak" : undefined} />
          <StatCell label="Avg risk / trade (price)" value={c.avgRiskPrice !== null ? num(c.avgRiskPrice, 4) : "—"} sub={`${c.riskCount} trades with SL`} />
          <StatCell label="Avg R-multiple" value={c.avgR !== null ? `${c.avgR.toFixed(2)}R` : "—"} sub={`${c.rCount} trades with SL`} color={c.avgR !== null ? pnlColor(c.avgR) : undefined} />
          <StatCell label="Largest win" value={moneyPlain(c.largestWin, ccy)} color={C.green} />
          <StatCell label="Largest loss" value={moneyPlain(c.largestLoss, ccy)} color={C.red} />
          <StatCell label="Reward : risk" value={c.rewardRiskRatio !== null ? `${c.rewardRiskRatio.toFixed(2)} : 1` : "—"} sub="avg win ÷ avg loss" />
          <StatCell label="Consecutive wins" value={String(c.consecutiveWins)} color={C.green} />
          <StatCell label="Consecutive losses" value={String(c.consecutiveLosses)} color={C.red} />
          <StatCell label="Trading costs (net)" value={moneyPlain(c.totalCosts, ccy)} sub="commission + swap + fees" />
          <StatCell label="Avg duration" value={c.avgDurationMin !== null ? `${c.avgDurationMin} min` : "—"} />
          <StatCell label="Breakeven trades" value={String(c.breakeven)} />
          <StatCell label="Currencies" value={c.currencies.join(" / ")} sub={c.mixedCurrency ? "MIXED — totals indicative" : undefined} color={c.mixedCurrency ? C.warn : undefined} />
        </div>
        <p className="px-3 pb-3 text-[8.5px] leading-relaxed" style={{ color: C.label }}>
          Drawdown is peak-to-trough on the cumulative realized net-P&L curve. R-multiples are price-based ((exit − entry) × direction ÷ |entry − SL|) and only exist for trades that recorded a stop loss — lot/currency risk is never guessed. Metrics that cannot be computed from the records show &ldquo;—&rdquo;.
        </p>
      </PanelCard>
    </div>
  );
}

export function BreakTable({ title, rows, ccy, note }: { title: string; rows: BreakdownRow[]; ccy: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className="pb-1.5 text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>{title.toUpperCase()}</div>
      {rows.length === 0 ? (
        <p className="text-[9px]" style={{ color: C.dim }}>Nothing recorded in this bucket yet.</p>
      ) : (
        <div className="halo-scroll overflow-x-auto rounded-lg border" style={{ borderColor: C.lineInner }}>
          <table className="w-full min-w-[300px] border-collapse text-left">
            <thead>
              <tr style={{ background: A.blue(0.07) }}>
                {["", "TRADES", "W / L", "NET", "WIN %"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-[7.5px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t" style={{ borderColor: C.lineInner }}>
                  <td className="max-w-[130px] truncate px-2 py-1.5 text-[9.5px] font-bold" style={{ color: C.txt }} title={r.key}>{r.key}</td>
                  <td className="px-2 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{r.trades}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[9.5px]">
                    <span style={{ color: C.green }}>{r.wins}</span>/<span style={{ color: C.red }}>{r.losses}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[9.5px] font-bold" style={{ color: pnlColor(r.net) }}>{moneyPlain(r.net, ccy)}</td>
                  <td className="px-2 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{pct(r.winRatePct, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="pt-1 text-[8px] leading-relaxed" style={{ color: C.label }}>{note}</p>}
    </div>
  );
}
