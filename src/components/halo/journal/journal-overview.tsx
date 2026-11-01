"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL OVERVIEW · the Performance-Journal command centre.
//
//  Visual blueprint: the owner's reference design — deep navy glass panels
//  with electric-cyan glow, metallic gold headers, six KPI cards with
//  previous-period deltas, an Equity/Balance/P&L curve, a monthly trading
//  calendar, win/loss donut, instrument bars, data-driven insights, a
//  performance badge, the recent-trades table and journal actions.
//
//  Every number comes from /api/journal (+stats) — computed from REAL
//  recorded trades. Where data is missing the panel says so; nothing is
//  invented. Isolated presentation only: no trading state lives here.
// ══════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Award,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  Eye,
  Lightbulb,
  LineChart,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Target,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import type { AnalyticsPayload, CoreStats, JournalRec } from "@/lib/journal/stats";
import { TrendArea, CenterDonut } from "./journal-viz";
import { TradeDetail } from "./journal-trades";
import { moneyPlain, pnlColor, pct, price, num, dur, MONTHS } from "./journal-fmt";

// ── shared option list (also used by the header selector) ────────────────
export const PERIOD_OPTIONS: { id: string; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "90d", label: "Last 90 days" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom range" },
];

export interface LiveStatus {
  tone: "live" | "error" | "journal" | "none";
  label: string;
  title: string;
}

export interface HeaderUser {
  initials: string;
  name: string;
  detail: string;
}

const MON_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDT(iso: string): string {
  const d = new Date(iso);
  if (!isFinite(+d)) return "—";
  return `${MON_S[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

interface Delta {
  text: string;
  up: boolean;
}

function deltaOf(cur: number | null, prev: number | null, kind: "pct" | "pp" | "abs"): Delta | null {
  if (cur === null || prev === null || !isFinite(cur) || !isFinite(prev)) return null;
  let d: number;
  if (kind === "pct") {
    if (prev === 0) return null; // no fair percentage against a zero base
    d = ((cur - prev) / Math.abs(prev)) * 100;
  } else {
    d = cur - prev;
  }
  const sign = d >= 0 ? "+" : "−";
  const abs = Math.abs(d);
  const text = kind === "abs" ? `${sign}${abs.toFixed(2)}` : `${sign}${abs >= 100 ? abs.toFixed(0) : abs.toFixed(1)}%`;
  return { text, up: d >= 0 };
}

// ── building blocks ──────────────────────────────────────────────────────

function JCard({
  title,
  icon: Icon,
  right,
  children,
  className,
}: {
  title: string;
  icon: LucideIcon;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-xl border ${className ?? ""}`}
      style={{
        borderColor: C.panelLine,
        background: `linear-gradient(180deg, ${A.blue(0.07)}, rgba(2,11,26,0.92))`,
        boxShadow: `0 0 20px 0 rgba(19,56,138,0.35), inset 0 1px 0 ${A.white(0.05)}`,
      }}
    >
      <header className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: A.white(0.06) }}>
        <span
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md"
          style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.goldHover})`, boxShadow: `0 0 10px 0 ${A.gold(0.35)}` }}
        >
          <Icon size={12.5} strokeWidth={2.6} style={{ color: "#1A1206" }} />
        </span>
        <h2 className="truncate text-[11px] font-extrabold tracking-[0.08em]" style={{ color: C.txt3 }}>
          {title}
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{right}</div>
      </header>
      {children}
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  valueColor,
  delta,
  deltaTitle,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  valueColor?: string;
  delta: Delta | null;
  deltaTitle: string;
}) {
  return (
    <div
      className="rounded-xl border px-3 py-2.5 transition-all hover:brightness-110"
      style={{
        borderColor: A.blue(0.4),
        background: `linear-gradient(180deg, ${A.blue(0.1)}, rgba(2,11,26,0.9))`,
        boxShadow: `0 0 14px 0 ${A.blue(0.16)}, inset 0 1px 0 ${A.white(0.06)}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-md"
          style={{ background: A.cyan(0.14), boxShadow: `inset 0 0 0 1px ${A.cyan(0.35)}, 0 0 8px 0 ${A.cyan(0.2)}` }}
        >
          <Icon size={13} strokeWidth={2.3} style={{ color: C.cyan }} />
        </span>
        <span className="truncate text-[10.5px] font-semibold" style={{ color: C.txt2 }}>
          {label}
        </span>
      </div>
      <div className="pt-2 font-mono text-[20px] font-extrabold leading-none" style={{ color: valueColor ?? C.txt }}>
        {value}
      </div>
      <div className="flex h-[15px] items-center pt-1.5 text-[9.5px] font-extrabold" title={deltaTitle} style={{ color: delta ? (delta.up ? C.green : C.red) : C.dim }}>
        {delta ? (
          <>
            <span aria-hidden>{delta.up ? "▲" : "▼"}</span>
            <span className="pl-1 font-mono">{delta.text}</span>
            <span className="pl-1 font-semibold" style={{ color: C.dim }}>
              vs prev
            </span>
          </>
        ) : (
          <span style={{ color: C.dim }}>—</span>
        )}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6">
      <p className="text-center text-[9.5px] leading-relaxed" style={{ color: C.label }}>
        {text}
      </p>
    </div>
  );
}

// ── header (masthead of the whole journal view) ──────────────────────────

export function JournalHeader({
  period,
  onPeriod,
  live,
  user,
  loading,
  onRefresh,
}: {
  period: string;
  onPeriod: (p: string) => void;
  live: LiveStatus;
  user: HeaderUser | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const liveStyle =
    live.tone === "live"
      ? { fg: C.green, bg: A.green(0.12), line: A.green(0.45) }
      : live.tone === "error"
        ? { fg: C.red, bg: A.red(0.12), line: A.red(0.45) }
        : live.tone === "journal"
          ? { fg: C.cyan, bg: A.cyan(0.1), line: A.cyan(0.4) }
          : { fg: C.muted, bg: A.white(0.05), line: A.white(0.14) };
  return (
    <header
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: C.panelLine,
        background: `linear-gradient(120deg, ${A.blue(0.1)}, rgba(2,11,26,0.94) 55%, ${A.gold(0.05)})`,
        boxShadow: `0 0 24px 0 rgba(19,56,138,0.4), inset 0 1px 0 ${A.white(0.06)}`,
      }}
    >
      <span
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl"
        style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.goldHover})`, boxShadow: `0 0 16px 0 ${A.gold(0.45)}` }}
      >
        <BarChart3 size={21} strokeWidth={2.4} style={{ color: "#1A1206" }} />
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-extrabold leading-tight tracking-wide" style={{ color: C.txt }}>
          HALO <span style={{ color: C.goldHover }}>PERFORMANCE JOURNAL</span>
        </h1>
        <p className="truncate text-[10px] font-semibold tracking-wide" style={{ color: C.muted }}>
          Track • Analyse • Improve Your Trading Performance
        </p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* date-range selector — Last 30 Days default */}
        <div className="relative">
          <CalendarDays size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.label }} aria-hidden />
          <select
            value={period}
            onChange={(e) => onPeriod(e.target.value)}
            aria-label="Date range"
            className="appearance-none rounded-lg border py-2 pl-8 pr-7 text-[10.5px] font-bold outline-none transition-all hover:brightness-125"
            style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronRight size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90" style={{ color: C.label }} aria-hidden />
        </div>

        {/* live-data status — reflects ACTUAL synchronization, never faked */}
        <span
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-extrabold"
          title={live.title}
          style={{ borderColor: liveStyle.line, background: liveStyle.bg, color: liveStyle.fg }}
          role="status"
        >
          <i
            className={`inline-block h-1.5 w-1.5 rounded-full ${live.tone === "live" ? "animate-pulse" : ""}`}
            style={{ background: liveStyle.fg }}
            aria-hidden
          />
          {live.label}
        </span>

        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh journal data"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border transition-all hover:brightness-125"
          style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>

        {/* authenticated user profile */}
        {user && (
          <div className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3" style={{ borderColor: C.line2, background: C.navy2 }} title={`${user.name} · ${user.detail}`}>
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold"
              style={{ background: `linear-gradient(135deg, ${A.gold(0.25)}, ${A.blue(0.2)})`, color: C.goldHover, boxShadow: `inset 0 0 0 1px ${A.gold(0.5)}` }}
              aria-hidden
            >
              {user.initials}
            </span>
            <span className="hidden min-w-0 flex-col leading-tight md:flex">
              <span className="max-w-[130px] truncate text-[10px] font-bold" style={{ color: C.txt }}>
                {user.name}
              </span>
              <span className="max-w-[130px] truncate text-[8px]" style={{ color: C.label }}>
                {user.detail}
              </span>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

// ── overview body ────────────────────────────────────────────────────────

interface OverviewProps {
  stats: AnalyticsPayload;
  prev: CoreStats | null;
  ccy: string;
  recent: JournalRec[];
  filterQS: string;
  calMonth: number;
  calYear: number;
  onMonthShift: (d: number) => void;
  onSelectDay: (day: string) => void;
  onTab: (t: "trades" | "analytics") => void;
  onAddNote: () => void;
  notify: (title: string, desc?: string, bad?: boolean) => void;
  onChanged: () => void;
}

export function JournalOverview({ stats, prev, ccy, recent, filterQS, calMonth, calYear, onMonthShift, onSelectDay, onTab, onAddNote, notify, onChanged }: OverviewProps) {
  const c = stats.core;
  const [series, setSeries] = useState<"equity" | "balance" | "pnl">("equity");
  const [openTrade, setOpenTrade] = useState<JournalRec | null>(null);
  const hasData = c.totalTrades > 0;

  // cumulative realized P&L per day (display aggregation of computed dailies)
  const pnlPoints = useMemo(() => {
    const out: { day: string; value: number }[] = [];
    stats.daily.reduce((acc, d) => {
      const v = Math.round((acc + d.net) * 100) / 100;
      out.push({ day: d.day, value: v });
      return v;
    }, 0);
    return out;
  }, [stats.daily]);

  const balanceOk = stats.balance.mode === "snapshots" && stats.balance.points.length > 1;
  const curve = (() => {
    if (series === "balance") {
      if (!balanceOk) return { points: [], name: "", hint: "The balance curve needs broker equity snapshots — synchronize MT5 history daily to build it." };
      return { points: stats.balance.points, name: "Balance (broker snapshots)", hint: null as string | null };
    }
    if (series === "pnl") {
      if (pnlPoints.length === 0) return { points: [], name: "", hint: "The realized P&L curve builds as closed trades accumulate in the selected range." };
      return { points: pnlPoints, name: "Cumulative realized P&L", hint: null as string | null };
    }
    if (stats.equity.points.length < 2) {
      return {
        points: [],
        name: "",
        hint:
          stats.equity.mode === "snapshots"
            ? "Not enough broker snapshots yet — synchronize MT5 daily to build the equity curve."
            : "The curve builds as closed trades accumulate in the selected range.",
      };
    }
    return {
      points: stats.equity.points,
      name: stats.equity.mode === "snapshots" ? "Equity (broker snapshots)" : "Cumulative net (derived from realized P&L)",
      hint: null as string | null,
    };
  })();

  // calendar month aggregates (from the grid cells themselves)
  const monthAgg = useMemo(() => {
    let net = 0;
    let trades = 0;
    let green = 0;
    let red = 0;
    for (const w of stats.calendar.weeks)
      for (const d of w) {
        if (!d.inMonth || d.net === null) continue;
        net += d.net;
        trades += d.trades;
        if (d.net > 0) green += 1;
        else if (d.net < 0) red += 1;
      }
    return { net: Math.round(net * 100) / 100, trades, green, red };
  }, [stats.calendar.weeks]);

  // Sunday-first display of the Monday-first grid (matches the reference)
  const calRows = useMemo(() => stats.calendar.weeks.map((w) => [6, 0, 1, 2, 3, 4, 5].map((i) => w[i])), [stats.calendar.weeks]);

  const maxAbsInst = Math.max(1, ...stats.bySymbol.slice(0, 5).map((r) => Math.abs(r.net)));
  const positiveNetPool = stats.bySymbol.reduce((a, r) => a + Math.max(0, r.net), 0);

  // deterministic, data-driven insights — never invented
  const insights = useMemo(() => {
    const out: string[] = [];
    const bs = stats.bySymbol;
    if (bs.length > 0 && bs[0].net > 0) out.push(`Best performance: ${bs[0].key} (${moneyPlain(bs[0].net, ccy)}) — ${bs[0].trades} trades, ${pct(bs[0].winRatePct, 0)} win rate.`);
    if (bs.length > 1 && bs[bs.length - 1].net < 0) out.push(`Weakest instrument: ${bs[bs.length - 1].key} (${moneyPlain(bs[bs.length - 1].net, ccy)}) — review these setups.`);
    const bestDay = stats.daily.reduce<{ day: string; net: number } | null>((acc, d) => (!acc || d.net > acc.net) && d.net > 0 ? { day: d.day, net: d.net } : acc, null);
    if (bestDay) out.push(`Most profitable day: ${bestDay.day} (${moneyPlain(bestDay.net, ccy)}).`);
    if (stats.bySession.length >= 2) out.push(`Strongest session: ${stats.bySession[0].key} (${moneyPlain(stats.bySession[0].net, ccy)} net, derived from UTC open hour).`);
    if (prev && prev.totalTrades > 0) {
      out.push(`Win rate ${pct(c.winRatePct)} vs ${pct(prev.winRatePct)} in the previous period.`);
      out.push(`Net P&L ${moneyPlain(c.netPnl, ccy)} vs ${moneyPlain(prev.netPnl, ccy)} in the previous period.`);
    }
    if (stats.discipline.taggedTrades >= 5 && stats.discipline.adherencePct !== null) {
      out.push(`Plan adherence: ${pct(stats.discipline.adherencePct, 0)} of ${stats.discipline.taggedTrades} reviewed trades followed the plan.`);
    }
    return out.slice(0, 6);
  }, [stats, prev, c, ccy]);

  // performance badge — % change vs previous period (only when fair)
  const perfPct = prev && prev.netPnl !== 0 && c.totalTrades > 0 ? ((c.netPnl - prev.netPnl) / Math.abs(prev.netPnl)) * 100 : null;
  const spark = stats.daily.slice(-10);
  const sparkMax = Math.max(1, ...spark.map((d) => Math.abs(d.net)));

  const toggle = (s: "equity" | "balance" | "pnl", enabled: boolean) => {
    if (!enabled) return;
    setSeries(s);
  };
  const toggleStyle = (active: boolean, enabled = true) => ({
    borderColor: active ? A.gold(0.65) : enabled ? C.line2 : C.lineInner,
    background: active ? A.gold(0.12) : C.navy2,
    color: active ? C.goldHover : enabled ? C.txt2 : C.dim,
    opacity: enabled ? 1 : 0.55,
    cursor: enabled ? "pointer" : "not-allowed",
  });

  const winRateShare = c.totalTrades > 0 ? (c.wins / c.totalTrades) * 100 : 0;
  const lossShare = c.totalTrades > 0 ? (c.losses / c.totalTrades) * 100 : 0;

  return (
    <>
      {/* ═══ KPI CARDS ═══ */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={ArrowLeftRight}
          label="Total Trades"
          value={String(c.totalTrades)}
          delta={deltaOf(c.totalTrades, prev?.totalTrades ?? null, "pct")}
          deltaTitle={prev && prev.totalTrades > 0 ? `Previous period: ${prev.totalTrades} trades` : "No previous-period trades to compare"}
        />
        <KpiCard
          icon={Coins}
          label="Net Profit / Loss"
          value={moneyPlain(c.netPnl, ccy)}
          valueColor={pnlColor(c.netPnl)}
          delta={deltaOf(c.netPnl, prev?.netPnl ?? null, "pct")}
          deltaTitle={prev && prev.netPnl !== 0 ? `Previous period: ${moneyPlain(prev.netPnl, ccy)}` : "No previous-period net P&L to compare"}
        />
        <KpiCard
          icon={Trophy}
          label="Win Rate"
          value={pct(c.winRatePct)}
          valueColor={C.green}
          delta={deltaOf(c.winRatePct, prev && prev.totalTrades > 0 ? prev.winRatePct : null, "pp")}
          deltaTitle={prev && prev.totalTrades > 0 ? `Previous period: ${pct(prev.winRatePct)}` : "No previous-period trades to compare"}
        />
        <KpiCard
          icon={BarChart3}
          label="Profit Factor"
          value={c.profitFactorLabel}
          delta={deltaOf(c.profitFactor !== null && isFinite(c.profitFactor) ? c.profitFactor : null, prev && prev.profitFactor !== null && isFinite(prev.profitFactor) ? prev.profitFactor : null, "abs")}
          deltaTitle="Gross profit ÷ gross loss — compared with the previous period"
        />
        <KpiCard
          icon={ShieldCheck}
          label="Max Drawdown"
          value={c.maxDrawdownPct !== null ? pct(c.maxDrawdownPct) : moneyPlain(c.maxDrawdown, ccy)}
          valueColor={C.red}
          delta={deltaOf(c.maxDrawdownPct, prev && prev.maxDrawdownPct !== null ? prev.maxDrawdownPct : null, "pp")}
          deltaTitle={c.maxDrawdownPct !== null ? `Peak-to-trough of the realized curve — ${moneyPlain(c.maxDrawdown, ccy)}` : `Drawdown ${moneyPlain(c.maxDrawdown, ccy)} — percentage needs a positive cumulative peak`}
        />
        <KpiCard
          icon={Target}
          label="Average R-Multiple"
          value={c.avgR !== null ? c.avgR.toFixed(2) : "—"}
          valueColor={c.avgR !== null ? pnlColor(c.avgR) : undefined}
          delta={deltaOf(c.avgR, prev?.avgR ?? null, "abs")}
          deltaTitle={c.rCount > 0 ? `Mean of ${c.rCount} price-based R-multiples (trades with an SL recorded)` : "R-multiples need a stop loss recorded on the trade"}
        />
      </div>

      {/* ═══ EQUITY CURVE + CALENDAR ═══ */}
      <div className="grid gap-2.5 xl:grid-cols-5">
        <JCard
          title="Equity Curve"
          icon={LineChart}
          className="xl:col-span-3"
          right={
            <div className="flex gap-1">
              {(["equity", "balance", "pnl"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s, s !== "balance" || balanceOk)}
                  disabled={s === "balance" && !balanceOk}
                  title={s === "balance" && !balanceOk ? "Balance curve needs broker snapshots" : s === "equity" ? "Equity (or the derived realized curve)" : s === "balance" ? "Account balance from broker snapshots" : "Cumulative realized profit & loss"}
                  className="rounded-md border px-2.5 py-1 text-[9px] font-extrabold tracking-wide transition-all hover:brightness-125"
                  style={toggleStyle(series === s, s !== "balance" || balanceOk)}
                >
                  {s === "pnl" ? "P&L" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          }
        >
          <div className="px-2 pb-2 pt-1">
            {curve.points.length > 1 ? (
              <>
                <TrendArea points={curve.points} name={curve.name} height={252} />
                <p className="px-1.5 pt-1 text-[8px]" style={{ color: C.label }}>
                  {series === "equity" && stats.equity.mode === "derived" ? "DERIVED · realized net P&L (no broker snapshots yet)" : series === "pnl" ? "REALIZED · cumulative net P&L of closed trades" : "BROKER SNAPSHOTS · observed values only"}
                </p>
              </>
            ) : (
              <EmptyHint text={curve.hint ?? "Not enough data yet."} />
            )}
          </div>
        </JCard>

        <JCard
          title="Trading Calendar"
          icon={CalendarDays}
          className="xl:col-span-2"
          right={
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onMonthShift(-1)} aria-label="Previous month" className="rounded-md border px-1.5 py-1 transition-all hover:brightness-125" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }}>
                <ChevronLeft size={11} />
              </button>
              <span className="min-w-[92px] text-center text-[9.5px] font-extrabold" style={{ color: C.txt3 }}>
                {MONTHS[calMonth]} {calYear}
              </span>
              <button type="button" onClick={() => onMonthShift(1)} aria-label="Next month" className="rounded-md border px-1.5 py-1 transition-all hover:brightness-125" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }}>
                <ChevronRight size={11} />
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-2 p-3 xl:flex-row">
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-7 gap-1">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="pb-1 text-center text-[7.5px] font-extrabold tracking-[0.1em]" style={{ color: C.label }}>
                    {d}
                  </div>
                ))}
                {calRows.flat().map((cell, i) => {
                  if (!cell.inMonth) return <div key={`e${i}`} className="min-h-[42px] rounded-md border border-dashed opacity-25" style={{ borderColor: C.lineInner }} aria-hidden />;
                  const tone = cell.net === null ? null : cell.net > 0 ? "win" : cell.net < 0 ? "loss" : "flat";
                  const bg = tone === "win" ? A.green(0.16) : tone === "loss" ? A.red(0.16) : A.white(0.03);
                  const border = tone === "win" ? A.green(0.45) : tone === "loss" ? A.red(0.45) : C.lineInner;
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      onClick={() => onSelectDay(cell.day)}
                      title={`${cell.day} — ${cell.trades} trade${cell.trades === 1 ? "" : "s"}, net ${moneyPlain(cell.net ?? 0, ccy)}`}
                      className="flex min-h-[42px] cursor-pointer flex-col rounded-md border px-1 py-0.5 text-left transition-all hover:brightness-125"
                      style={{ borderColor: border, background: bg }}
                      aria-label={`${cell.day}: ${cell.trades} trades, net ${cell.net ?? 0}`}
                    >
                      <span className="text-[8.5px] font-extrabold" style={{ color: C.txt2 }}>
                        {cell.dayOfMonth}
                      </span>
                      {cell.trades > 0 && (
                        <span className="mt-auto font-mono text-[7.5px] font-bold leading-tight" style={{ color: pnlColor(cell.net) }}>
                          {moneyPlain(cell.net, ccy)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1 text-[8.5px] xl:w-[104px] xl:flex-col xl:items-start xl:gap-y-1.5 xl:border-l xl:pl-3" style={{ borderColor: A.white(0.06) }}>
              <span className="inline-flex items-center gap-1.5" style={{ color: C.label }}>
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: A.green(0.85) }} aria-hidden /> Profitable (+$)
              </span>
              <span className="inline-flex items-center gap-1.5" style={{ color: C.label }}>
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: A.red(0.85) }} aria-hidden /> Losing (−$)
              </span>
              <span className="inline-flex items-center gap-1.5" style={{ color: C.label }}>
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: A.white(0.14) }} aria-hidden /> No Trade
              </span>
              <span className="xl:mt-auto xl:pt-1" style={{ color: C.label }}>
                {MONTHS[calMonth].slice(0, 3)} {calYear} net
                <b className="block font-mono text-[11px]" style={{ color: pnlColor(monthAgg.net) }}>
                  {moneyPlain(monthAgg.net, ccy)}
                </b>
                <span className="block">
                  {monthAgg.trades} trades · {monthAgg.green}P / {monthAgg.red}L
                </span>
              </span>
            </div>
          </div>
        </JCard>
      </div>

      {/* ═══ BREAKDOWN + INSTRUMENTS + INSIGHTS + BADGE ═══ */}
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
        <JCard title="Performance Breakdown" icon={BarChart3}>
          {hasData ? (
            <div className="flex items-center gap-3 p-3">
              <div className="shrink-0">
                <CenterDonut wins={c.wins} losses={c.losses} breakeven={c.breakeven} centerLabel={pct(c.winRatePct, c.winRatePct % 1 === 0 ? 0 : 1)} height={140} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 text-[9.5px]">
                <span className="inline-flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5" style={{ color: C.txt2 }}>
                    <i className="inline-block h-2 w-2 rounded-full" style={{ background: C.green }} aria-hidden /> Winning Trades
                  </span>
                  <b className="font-mono" style={{ color: C.green }}>
                    {c.wins} ({pct(winRateShare, 1)})
                  </b>
                </span>
                <span className="inline-flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5" style={{ color: C.txt2 }}>
                    <i className="inline-block h-2 w-2 rounded-full" style={{ background: C.red }} aria-hidden /> Losing Trades
                  </span>
                  <b className="font-mono" style={{ color: C.red }}>
                    {c.losses} ({pct(lossShare, 1)})
                  </b>
                </span>
                {c.breakeven > 0 && (
                  <span className="inline-flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5" style={{ color: C.txt2 }}>
                      <i className="inline-block h-2 w-2 rounded-full" style={{ background: C.gray }} aria-hidden /> Breakeven
                    </span>
                    <b className="font-mono" style={{ color: C.muted }}>
                      {c.breakeven}
                    </b>
                  </span>
                )}
                <span className="pt-1 text-[8px] leading-relaxed" style={{ color: C.label }}>
                  Win rate counts breakeven trades in the base — the professional net convention.
                </span>
              </div>
            </div>
          ) : (
            <EmptyHint text="No closed trades in this range yet — the win/loss breakdown fills in from your records." />
          )}
        </JCard>

        <JCard title="By Instrument" icon={Coins}>
          {stats.bySymbol.length > 0 ? (
            <div className="space-y-2.5 p-3">
              {stats.bySymbol.slice(0, 5).map((r, i) => {
                const w = Math.max(2, (Math.abs(r.net) / maxAbsInst) * 100);
                const contrib = r.net > 0 && positiveNetPool > 0 ? (r.net / positiveNetPool) * 100 : null;
                return (
                  <div key={r.key}>
                    <div className="flex items-center gap-2">
                      <span className="w-[64px] shrink-0 truncate text-[10px] font-extrabold" style={{ color: C.txt }}>
                        {r.key}
                      </span>
                      <span className="h-[13px] min-w-0 flex-1 overflow-hidden rounded-sm" style={{ background: A.white(0.05) }}>
                        <span
                          className="block h-full rounded-sm"
                          style={{
                            width: `${w}%`,
                            background: i % 2 === 0 ? `linear-gradient(90deg, ${A.blue(0.55)}, ${A.cyan(0.9)})` : `linear-gradient(90deg, ${A.gold(0.4)}, ${C.goldHover})`,
                            boxShadow: i % 2 === 0 ? `0 0 8px 0 ${A.cyan(0.35)}` : `0 0 8px 0 ${A.gold(0.3)}`,
                          }}
                        />
                      </span>
                      <b className="w-[76px] shrink-0 text-right font-mono text-[9.5px]" style={{ color: pnlColor(r.net) }}>
                        {moneyPlain(r.net, ccy)}
                      </b>
                    </div>
                    <div className="pl-[72px] pt-0.5 text-[7.5px]" style={{ color: C.label }}>
                      {r.trades} trades · {pct(r.winRatePct, 0)} win{contrib !== null ? ` · ${pct(contrib, 0)} of net profit` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyHint text="Instrument statistics appear once trades are recorded in this range." />
          )}
        </JCard>

        <JCard title="Trading Insights" icon={Lightbulb}>
          <div className="flex-1 space-y-2 p-3">
            {insights.length > 0 ? (
              insights.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CheckCircle2 size={12} className="mt-[1px] shrink-0" style={{ color: C.green }} aria-hidden />
                  <p className="text-[9px] leading-relaxed" style={{ color: C.txt2 }}>
                    {t}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[9px] leading-relaxed" style={{ color: C.label }}>
                Not enough recorded data for reliable insights yet — synchronize MT5 history, import a CSV or record trades, and this panel will report best instruments, days, sessions and trends strictly from your own records.
              </p>
            )}
          </div>
        </JCard>

        <JCard
          title="Performance"
          icon={Award}
          right={<span className="text-[8px] font-bold" style={{ color: C.label }}>vs Previous Period</span>}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-3">
            <Award size={22} style={{ color: C.goldHover, filter: `drop-shadow(0 0 8px ${A.gold(0.5)})` }} aria-hidden />
            <span className="font-mono text-[24px] font-extrabold leading-none" style={{ color: perfPct === null ? C.dim : perfPct >= 0 ? C.goldHover : C.red }}>
              {perfPct === null ? "—" : `${perfPct >= 0 ? "+" : "−"}${Math.abs(perfPct) >= 100 ? Math.abs(perfPct).toFixed(0) : Math.abs(perfPct).toFixed(1)}%`}
            </span>
            <span className="text-[8.5px] font-bold tracking-[0.16em]" style={{ color: C.label }}>
              {prev && prev.totalTrades > 0 ? "NET P&L CHANGE" : "NO PREVIOUS-PERIOD DATA YET"}
            </span>
            {spark.length > 0 && (
              <div className="flex h-9 items-end gap-[3px] pt-1.5" aria-hidden>
                {spark.map((d, i) => (
                  <span
                    key={i}
                    className="w-[6px] rounded-t-sm"
                    style={{
                      height: `${Math.max(3, (Math.abs(d.net) / sparkMax) * 30)}px`,
                      background: d.net > 0 ? A.cyan(0.85) : d.net < 0 ? A.red(0.8) : A.white(0.2),
                      boxShadow: d.net > 0 ? `0 0 6px 0 ${A.cyan(0.4)}` : undefined,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </JCard>
      </div>

      {/* ═══ RECENT TRADES + JOURNAL ACTIONS ═══ */}
      <div className="grid gap-2.5 xl:grid-cols-4">
        <JCard
          title="Recent Trades"
          icon={CalendarDays}
          className="xl:col-span-3"
          right={
            <button type="button" onClick={() => onTab("trades")} className="flex items-center gap-1 text-[9px] font-extrabold tracking-wide transition-all hover:brightness-125" style={{ color: C.cyan }}>
              View All Trades <ChevronRight size={11} aria-hidden />
            </button>
          }
        >
          {recent.length > 0 ? (
            <div className="halo-scroll overflow-x-auto p-2">
              <table className="w-full min-w-[780px] border-collapse text-left">
                <thead>
                  <tr>
                    {["Date & Time", "Instrument", "Direction", "Entry", "Exit", "Lots", "P/L", "R", "Duration", "Status", "Action"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5 text-[7.5px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.slice(0, 6).map((r) => (
                    <tr key={r.id} className="border-t transition-colors hover:bg-[#07203F]/60" style={{ borderColor: A.white(0.05) }}>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[9px]" style={{ color: C.txt2 }}>
                        {fmtDT(r.closedAt)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[9.5px] font-extrabold" style={{ color: C.txt }}>
                        {r.symbol} {r.isDemo && <span className="text-[7px] font-bold" style={{ color: C.goldHover }}>DEMO</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-[9px] font-extrabold" style={{ color: r.direction === "BUY" ? C.green : C.red }}>
                        {r.direction === "BUY" ? "▲ BUY" : "▼ SELL"}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[9px]" style={{ color: C.txt2 }}>
                        {price(r.entryPrice)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[9px]" style={{ color: C.txt2 }}>
                        {price(r.exitPrice)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[9px]" style={{ color: C.txt2 }}>
                        {num(r.volume, 2)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[9.5px] font-bold" style={{ color: pnlColor(r.netPnl) }}>
                        {moneyPlain(r.netPnl, r.currency)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[9px]" style={{ color: r.rMultiple !== null ? pnlColor(r.rMultiple) : C.label }}>
                        {r.rMultiple !== null ? `${r.rMultiple > 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[9px]" style={{ color: C.txt2 }}>
                        {dur(r.durationMin)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className="rounded-full border px-2 py-0.5 text-[8px] font-extrabold"
                          style={
                            r.netPnl > 0
                              ? { color: C.green, borderColor: A.green(0.45), background: A.green(0.12) }
                              : r.netPnl < 0
                                ? { color: C.red, borderColor: A.red(0.45), background: A.red(0.12) }
                                : { color: C.muted, borderColor: A.white(0.14), background: A.white(0.06) }
                          }
                        >
                          {r.netPnl > 0 ? "Win" : r.netPnl < 0 ? "Loss" : "BE"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenTrade(r)}
                          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[8.5px] font-extrabold transition-all hover:brightness-125"
                          style={{ borderColor: A.cyan(0.4), background: A.cyan(0.08), color: C.cyan }}
                          aria-label={`View trade ${r.symbol} ${r.direction}`}
                        >
                          <Eye size={9} aria-hidden /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyHint text="No recorded trades in this range — synchronize MT5 history, import a CSV or add a manual entry below." />
          )}
        </JCard>

        <JCard title="Journal Actions" icon={PenLine}>
          <div className="flex flex-1 flex-col justify-center gap-2.5 p-3">
            <a
              href={`/api/journal/export?${filterQS}`}
              className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[10px] font-extrabold tracking-[0.1em] transition-all hover:brightness-125"
              style={{ borderColor: A.cyan(0.45), background: `linear-gradient(135deg, ${A.blue(0.16)}, ${A.cyan(0.08)})`, color: C.cyan, boxShadow: `0 0 12px 0 ${A.blue(0.18)}` }}
            >
              <Download size={13} aria-hidden /> Export Report
            </a>
            <button
              type="button"
              onClick={onAddNote}
              className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[10px] font-extrabold tracking-[0.1em] transition-all hover:brightness-125"
              style={{ borderColor: A.gold(0.45), background: A.gold(0.08), color: C.goldHover }}
            >
              <PenLine size={13} aria-hidden /> Add Note
            </button>
            <button
              type="button"
              onClick={() => onTab("analytics")}
              className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[10px] font-extrabold tracking-[0.1em] transition-all hover:brightness-125"
              style={{ borderColor: A.teal(0.45), background: A.teal(0.08), color: C.teal }}
            >
              <BarChart3 size={13} aria-hidden /> View Analytics
            </button>
            <p className="pt-0.5 text-center text-[7.5px] leading-relaxed" style={{ color: C.label }}>
              Export downloads the CSV of the current selection · Add Note records a journal entry · Analytics opens the deep-dive tab.
            </p>
          </div>
        </JCard>
      </div>

      {openTrade && <TradeDetail rec={openTrade} onClose={() => setOpenTrade(null)} notify={notify} onChanged={onChanged} />}
    </>
  );
}
