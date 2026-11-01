"use client";

// ══════════════════════════════════════════════════════════════════════════
//  HALO PERFORMANCE JOURNAL · main view
//
//  Isolated premium feature inside the existing HALO 3EL command centre:
//  records, reviews, analyses and explains ACTUAL trading performance.
//  It owns no trading state, touches no engine/execution surface and polls
//  gently (60 s, visibility-gated) — the heavy charts are lazy-loaded.
//
//  MASTHEAD: gold HALO PERFORMANCE JOURNAL header with the date-range
//  selector (Last 30 Days default), a Live-Data pill driven by the REAL
//  MT5 synchronization state and the authenticated user's profile.
//
//  TABS  : Overview · Trade Book · Analytics · Calendar · Discipline ·
//          Insights · Reports
//  DATA  : /api/journal (+ stats/sync/import/export/demo/report/insights)
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  Database,
  PenLine,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { PanelCard, Pill, StateFrame } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { AnalyticsPayload, CoreStats, JournalRec } from "@/lib/journal/stats";
import { JournalSyncCard } from "./journal-sync-card";
import { JournalHeader, JournalOverview, type LiveStatus, type HeaderUser } from "./journal-overview";
import { ManualEntryDialog } from "./journal-manual-entry";
import { moneyPlain, pnlColor, dt, MONTHS } from "./journal-fmt";

// lazy tabs — the journal opens light; heavy panels load on first use
const JournalTrades = dynamic(() => import("./journal-trades").then((m) => m.JournalTrades), {
  ssr: false,
  loading: () => <StateFrame state="loading" title="Loading the trade book" />,
});
const JournalAnalytics = dynamic(() => import("./journal-analytics").then((m) => m.JournalAnalytics), {
  ssr: false,
  loading: () => <StateFrame state="loading" title="Loading analytics" />,
});
const JournalCalendar = dynamic(() => import("./journal-calendar").then((m) => m.JournalCalendar), {
  ssr: false,
  loading: () => <StateFrame state="loading" title="Loading the calendar" />,
});
const JournalDiscipline = dynamic(() => import("./journal-discipline").then((m) => m.JournalDiscipline), {
  ssr: false,
  loading: () => <StateFrame state="loading" title="Loading the discipline tracker" />,
});
const JournalInsights = dynamic(() => import("./journal-insights").then((m) => m.JournalInsights), {
  ssr: false,
  loading: () => <StateFrame state="loading" title="Loading insights" />,
});
const JournalReports = dynamic(() => import("./journal-reports").then((m) => m.JournalReports), {
  ssr: false,
  loading: () => <StateFrame state="loading" title="Loading reports" />,
});

type Tab = "overview" | "trades" | "analytics" | "calendar" | "discipline" | "insights" | "reports";

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "trades", label: "Trade Book", icon: BookOpenCheck },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "discipline", label: "Discipline", icon: ShieldCheck },
  { id: "insights", label: "Insights", icon: Sparkles },
  { id: "reports", label: "Reports", icon: PenLine },
];

interface SyncMeta {
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  lastSyncMsg: string;
  balanceOps?: number;
}

interface ListMeta {
  sources: string[];
  symbols: string[];
  strategies: string[];
  timeframes: string[];
  mtAccounts: { id: string; label: string; status: string; active?: boolean }[];
  sync: SyncMeta | null;
}

interface Floating {
  live: boolean;
  kind: string;
  currency: string;
  balance: number;
  equity: number;
  floating: number;
}

export function JournalView({ notify }: { notify: (title: string, desc?: string, bad?: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState("");
  const [outcome, setOutcome] = useState("");
  const [source, setSource] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [calYear, setCalYear] = useState(new Date().getUTCFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getUTCMonth());

  const [stats, setStats] = useState<(AnalyticsPayload & { prev: CoreStats | null }) | null>(null);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [recent, setRecent] = useState<JournalRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [floating, setFloating] = useState<Floating | null>(null);
  const [user, setUser] = useState<HeaderUser | null>(null);

  const filterQS = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("period", period);
    if (period === "custom") {
      if (from) qs.set("from", new Date(from).toISOString());
      if (to) qs.set("to", new Date(to).toISOString());
    }
    if (symbol) qs.set("symbol", symbol);
    if (direction) qs.set("direction", direction);
    if (outcome) qs.set("outcome", outcome);
    if (source) qs.set("source", source);
    qs.set("year", String(calYear));
    qs.set("month", String(calMonth));
    return qs.toString();
  }, [period, from, to, symbol, direction, outcome, source, calYear, calMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [statsRes, listRes] = await Promise.all([
        fetch(`/api/journal/stats?${filterQS}`, { cache: "no-store" }),
        fetch(`/api/journal?${filterQS}&page=1&pageSize=25`, { cache: "no-store" }),
      ]);
      const sj = (await statsRes.json()) as { ok: boolean; error?: string } & AnalyticsPayload & { prev?: CoreStats | null; sync?: SyncMeta | null };
      const lj = (await listRes.json()) as { ok: boolean; trades?: JournalRec[]; meta?: Omit<ListMeta, "sync">; error?: string };
      if (!sj.ok) throw new Error(sj.error ?? "Could not load journal statistics.");
      if (!lj.ok) throw new Error(lj.error ?? "Could not load the journal.");
      setStats({ ...sj, prev: sj.prev ?? null });
      setRecent(lj.trades ?? []);
      setMeta({
        sources: lj.meta?.sources ?? [],
        symbols: lj.meta?.symbols ?? [],
        strategies: lj.meta?.strategies ?? [],
        timeframes: lj.meta?.timeframes ?? [],
        mtAccounts: lj.meta?.mtAccounts ?? [],
        sync: sj.sync ?? null,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterQS]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // gentle 60 s refresh while the tab is visible (never background polling)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setRefreshKey((k) => k + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // manual-entry event fired from the sync card
  useEffect(() => {
    const h = () => setManualOpen(true);
    document.addEventListener("halo-journal-manual-entry", h);
    return () => document.removeEventListener("halo-journal-manual-entry", h);
  }, []);

  // authenticated user profile for the masthead (cosmetic — best effort)
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const j = (await res.json()) as {
          ok: boolean;
          user?: { fullName?: string; username?: string | null; email?: string; role?: string } | null;
          license?: { planName?: string } | null;
        };
        if (!alive) return;
        const u = j.user;
        if (!u) {
          setUser(null);
          return;
        }
        const name = u.fullName?.trim() || u.username?.trim() || u.email?.split("@")[0] || "Trader";
        const initials =
          name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? "")
            .join("") || "T";
        const detail = j.license?.planName ? `${j.license.planName} license` : u.role ? String(u.role).replace("_", " ") : u.email || "";
        setUser({ initials, name, detail: detail.toLowerCase() });
      } catch {
        /* the masthead profile is cosmetic — never blocks the journal */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // live account floating P&L (existing READ endpoint, reused — no new MT5 path)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/brokers/live-account", { cache: "no-store" });
        const j = (await res.json()) as {
          account?: { balance: number; equity: number; currency: string } | null;
          positions?: { pnl: number }[];
          live?: boolean;
          kind?: string;
        };
        if (!alive || !j.account) return;
        const floatingPnl = j.live ? (j.account.equity ?? 0) - (j.account.balance ?? 0) : (j.positions ?? []).reduce((a, p) => a + (p.pnl ?? 0), 0);
        setFloating({
          live: Boolean(j.live),
          kind: j.kind ?? "paper",
          currency: j.account.currency ?? "USD",
          balance: j.account.balance ?? 0,
          equity: j.account.equity ?? 0,
          floating: Math.round(floatingPnl * 100) / 100,
        });
      } catch {
        // display stays on realized-only — never invented
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const onChanged = useCallback(() => setRefreshKey((k) => k + 1), []);
  const c = stats?.core;
  const ccy = c && c.currencies.length === 1 ? c.currencies[0] : "USD";
  const hasDemo = meta?.sources.includes("DEMO") ?? false;
  const demoOnly = meta?.sources.length === 1 && hasDemo;

  // Live-Data pill — reflects the ACTUAL synchronization state, never faked
  const live: LiveStatus = useMemo(() => {
    const s = meta?.sync ?? null;
    if (s && s.lastSyncOk)
      return {
        tone: "live",
        label: "Live Data",
        title: `MT5 history synchronized — ${s.lastSyncMsg || `last sync ${dt(s.lastSyncAt)}`}`,
      };
    if (s && !s.lastSyncOk) return { tone: "error", label: "Sync Error", title: s.lastSyncMsg || "The last MT5 synchronization failed — retry from Data Sources." };
    if ((c?.totalTrades ?? 0) > 0) return { tone: "journal", label: "Journal Data", title: "Records loaded from CSV import / manual entry — no MT5 synchronization yet." };
    return { tone: "none", label: "No Data", title: "No synchronized MT5 history and no recorded trades yet — use Data Sources below." };
  }, [meta, c]);

  const selectDay = (day: string) => {
    setPeriod("custom");
    setFrom(`${day}T00:00`);
    setTo(`${day}T23:59:59.999`);
    setTab("trades");
  };

  return (
    <div className="space-y-3">
      {/* ═══ masthead ═══ */}
      <JournalHeader period={period} onPeriod={setPeriod} live={live} user={user} loading={loading} onRefresh={onChanged} />

      {/* demo banner — always visible while demo rows exist */}
      {hasDemo && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: A.gold(0.4), background: A.gold(0.07) }} role="status">
          <Pill tone="gold">DEMO DATA LOADED</Pill>
          <span className="text-[9.5px] font-bold" style={{ color: C.goldHover }}>
            {demoOnly
              ? "This journal currently contains ONLY clearly-labeled demo trades for evaluation. Remove them via Data Sources before recording real history."
              : "Some rows in this journal are labeled DEMO. Demo rows are never mixed with real records by the seeder — verify the source filter before drawing conclusions."}
          </span>
        </div>
      )}

      {/* filter bar — advanced facets live on the detail tabs; the custom
          range inputs stay reachable wherever they are needed */}
      {(tab !== "overview" || period === "custom") && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5" style={{ borderColor: C.panelLine, background: `linear-gradient(180deg, ${A.blue(0.06)}, ${C.deep})` }}>
          {period === "custom" && (
            <>
              <input value={from} onChange={(e) => setFrom(e.target.value)} type="datetime-local" aria-label="Custom range start" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} />
              <span className="text-[9px]" style={{ color: C.label }}>
                →
              </span>
              <input value={to} onChange={(e) => setTo(e.target.value)} type="datetime-local" aria-label="Custom range end" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} />
            </>
          )}
          {tab !== "overview" && (
            <>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Instrument filter" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
                <option value="">Instrument: all</option>
                {(meta?.symbols ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction filter" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
                <option value="">BUY / SELL: all</option>
                <option value="BUY">BUY only</option>
                <option value="SELL">SELL only</option>
              </select>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome filter" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
                <option value="">Winners &amp; losers</option>
                <option value="win">Winners only</option>
                <option value="loss">Losers only</option>
                <option value="breakeven">Breakeven only</option>
              </select>
              <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source filter" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
                <option value="">Source: all</option>
                {(meta?.sources ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s === "DEMO" ? "DEMO (labeled)" : s}
                  </option>
                ))}
              </select>
            </>
          )}
          {c && c.mixedCurrency && <Pill tone="warn">MIXED CURRENCIES — TOTALS INDICATIVE</Pill>}
        </div>
      )}

      {/* tab bar */}
      <div className="halo-scroll flex gap-1.5 overflow-x-auto pb-0.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "page" : undefined}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold tracking-wide transition-all"
              style={
                active
                  ? { borderColor: "transparent", background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`, color: "#FFFFFF", boxShadow: `0 0 14px 0 ${A.blue(0.4)}` }
                  : { borderColor: C.line, background: C.navy2, color: C.muted }
              }
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* error state */}
      {err && (
        <PanelCard title="JOURNAL" icon={Database} accent="red">
          <div className="p-3">
            <StateFrame state="error" title="Could not load the journal" hint={err} onRetry={onChanged} />
          </div>
        </PanelCard>
      )}

      {/* ════════ OVERVIEW — the command centre ════════ */}
      {tab === "overview" &&
        (loading || !c || !stats ? (
          !err && (
            <PanelCard title="JOURNAL OVERVIEW" icon={TrendingUp}>
              <div className="p-3">
                <StateFrame state="loading" title="Computing your performance" hint="Reading every recorded trade in the selected range." />
              </div>
            </PanelCard>
          )
        ) : (
          <div className="space-y-2.5">
            <JournalOverview
              stats={stats}
              prev={stats.prev ?? null}
              ccy={ccy}
              recent={recent}
              filterQS={filterQS}
              calMonth={calMonth}
              calYear={calYear}
              onMonthShift={(d) => {
                const next = new Date(Date.UTC(calYear, calMonth + d, 1));
                setCalYear(next.getUTCFullYear());
                setCalMonth(next.getUTCMonth());
              }}
              onSelectDay={selectDay}
              onTab={(t) => setTab(t)}
              onAddNote={() => setManualOpen(true)}
              notify={notify}
              onChanged={onChanged}
            />

            {/* live-account strip — floating P&L is REALIZED-only's honest complement */}
            {floating && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-[9px]" style={{ borderColor: C.lineInner, background: C.deep }}>
                <span className="font-extrabold tracking-[0.14em]" style={{ color: C.label }}>
                  {floating.live ? `LIVE ACCOUNT · ${floating.kind.toUpperCase()}` : "PAPER ENGINE"}
                </span>
                <span style={{ color: C.label }}>
                  Balance{" "}
                  <b className="font-mono" style={{ color: C.txt2 }}>
                    {moneyPlain(floating.balance, floating.currency)}
                  </b>
                </span>
                <span style={{ color: C.label }}>
                  Equity{" "}
                  <b className="font-mono" style={{ color: C.txt2 }}>
                    {moneyPlain(floating.equity, floating.currency)}
                  </b>
                </span>
                <span style={{ color: C.label }}>
                  Floating P&L{" "}
                  <b className="font-mono" style={{ color: pnlColor(floating.floating) }}>
                    {moneyPlain(floating.floating, floating.currency)}
                  </b>{" "}
                  — open positions only, not booked
                </span>
              </div>
            )}

            {/* data sources */}
            <JournalSyncCard
              sync={meta?.sync ?? null}
              accounts={meta?.mtAccounts ?? []}
              onChanged={onChanged}
              notify={notify}
              demoLoaded={hasDemo}
              hasAnyRecords={(c.totalTrades ?? 0) > 0}
            />

            <p className="px-1 text-[8.5px] leading-relaxed" style={{ color: C.label }}>
              All timestamps UTC · sessions derived from the UTC open hour · R-multiples price-based where a stop loss was recorded · metrics that cannot be computed from the records show &ldquo;—&rdquo; rather than a guess · calendar figures {MONTHS[calMonth]} {calYear}.
            </p>
          </div>
        ))}

      {/* ════════ TRADES ════════ */}
      {tab === "trades" && <JournalTrades filterQS={filterQS} refreshKey={refreshKey} meta={meta} notify={notify} onChanged={onChanged} />}

      {/* ════════ ANALYTICS ════════ */}
      {tab === "analytics" && (stats && c && c.totalTrades > 0 ? <JournalAnalytics data={stats} ccy={ccy} /> : <PanelCard title="ANALYTICS" icon={BarChart3}><div className="p-3"><StateFrame state={loading ? "loading" : "empty"} title={loading ? "Computing analytics" : "Nothing to analyse in this selection"} hint="Analytics fill in from your recorded closed trades — widen the date range or load data through Data Sources." /></div></PanelCard>)}

      {/* ════════ CALENDAR ════════ */}
      {tab === "calendar" &&
        (stats ? (
          <JournalCalendar
            weeks={stats.calendar.weeks}
            year={calYear}
            month0={calMonth}
            ccy={ccy}
            onMonth={(y, m) => {
              setCalYear(y);
              setCalMonth(m);
            }}
            onSelectDay={selectDay}
            onMonthShift={(d) => {
              const next = new Date(Date.UTC(calYear, calMonth + d, 1));
              setCalYear(next.getUTCFullYear());
              setCalMonth(next.getUTCMonth());
            }}
          />
        ) : (
          <PanelCard title="CALENDAR" icon={CalendarDays}>
            <div className="p-3">
              <StateFrame state={loading ? "loading" : "empty"} title={loading ? "Loading the calendar" : "No trades to place on the calendar"} />
            </div>
          </PanelCard>
        ))}

      {/* ════════ DISCIPLINE ════════ */}
      {tab === "discipline" && (stats && c ? <JournalDiscipline data={stats} /> : <PanelCard title="DISCIPLINE" icon={ShieldCheck}><div className="p-3"><StateFrame state={loading ? "loading" : "empty"} title={loading ? "Loading" : "No records in this selection"} /></div></PanelCard>)}

      {/* ════════ INSIGHTS ════════ */}
      {tab === "insights" && <JournalInsights filterQS={filterQS} hasData={(c?.totalTrades ?? 0) > 0} />}

      {/* ════════ REPORTS ════════ */}
      {tab === "reports" && <JournalReports filterQS={filterQS} ccy={ccy} />}

      <ManualEntryDialog open={manualOpen} onClose={() => setManualOpen(false)} notify={notify} onChanged={onChanged} />
    </div>
  );
}
