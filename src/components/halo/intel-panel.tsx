"use client";

// ════════════════════════════════════════════════════════════════════════
//  MARKET INTEL · live external-data view
//
//  REAL external feeds only — ForexFactory economic calendar, Bloomberg +
//  Yahoo Finance headlines, Yahoo Finance quotes — via /api/intel/*.
//  Every block renders an honest source stamp + fetch time; when a feed
//  fails, the failure is shown instead of fake rows. Display-only:
//  nothing here writes trading state, and headline links open the
//  publisher's own page in a new tab.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  Globe,
  Newspaper,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { PanelCard } from "./panel";
import { C } from "@/lib/halo/ui-helpers";

interface EconEvent {
  title: string;
  currency: string;
  impact: "high" | "medium" | "low" | "holiday";
  date: string;
  forecast: string;
  previous: string;
  actual: string;
}

interface CalendarRes {
  ok: boolean;
  source: string;
  fetchedAt: string;
  stale: boolean;
  events: EconEvent[];
  error?: string;
}

interface NewsItem {
  title: string;
  outlet: string;
  link: string;
  publishedAt: string;
}

interface NewsRes {
  ok: boolean;
  source: string;
  fetchedAt: string;
  stale: boolean;
  items: NewsItem[];
  error?: string;
}

interface QuoteRes {
  ok: boolean;
  ticker: string;
  label: string;
  price: number | null;
  changePct: number | null;
  currency: string;
  error?: string;
}

type DayKey = "today" | "tomorrow" | "this_week" | "next_week";
type ImpactKey = "all" | "med_high" | "high";
type NewsKey = "bloomberg" | "yahoo";

const IMPACT_COLOR: Record<EconEvent["impact"], string> = {
  high: C.red,
  medium: C.gold,
  low: "#5D6B85",
  holiday: "#4FD8FF",
};

const QUICK_QUOTES: { q: string; label: string }[] = [
  { q: "SPX", label: "S&P 500" },
  { q: "NDX", label: "Nasdaq 100" },
  { q: "DJI", label: "Dow" },
  { q: "DAX", label: "DAX" },
  { q: "gold", label: "Gold" },
  { q: "oil", label: "WTI Oil" },
  { q: "DXY", label: "DXY" },
  { q: "VIX", label: "VIX" },
];

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function srcStamp(ok: boolean, stale: boolean, fetchedAt: string): string {
  if (!ok) return "unreachable";
  return `${stale ? "stale · " : ""}${relTime(fetchedAt)}`;
}

const chipCls = (active: boolean) =>
  `rounded-full border px-2.5 py-1 text-[9.5px] font-bold tracking-wide transition-colors ${
    active ? "border-[#D4AF37]/60 bg-[#D4AF37]/10 text-[#D4AF37]" : "border-[#1C2A47] bg-[#101C33] text-[#8C98AE] hover:text-[#B8C2D6]"
  }`;

export function IntelPanel() {
  const [day, setDay] = useState<DayKey>("today");
  const [impact, setImpact] = useState<ImpactKey>("all");
  const [currency, setCurrency] = useState<string>("ALL");
  const [newsSrc, setNewsSrc] = useState<NewsKey>("bloomberg");

  const [cal, setCal] = useState<CalendarRes | null>(null);
  const [news, setNews] = useState<NewsRes | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteRes>>({});
  const [loading, setLoading] = useState(false);

  const loadCalendar = useCallback(async () => {
    const cur = currency === "ALL" ? "" : `&currency=${currency}`;
    try {
      const r = await fetch(`/api/intel/calendar?day=${day}&impact=${impact}${cur}`, { cache: "no-store" });
      setCal((await r.json()) as CalendarRes);
    } catch {
      setCal({ ok: false, source: "ForexFactory", fetchedAt: new Date().toISOString(), stale: true, events: [], error: "network error" });
    }
  }, [day, impact, currency]);

  const loadNews = useCallback(async () => {
    try {
      const r = await fetch(`/api/intel/news?source=${newsSrc}&limit=12`, { cache: "no-store" });
      setNews((await r.json()) as NewsRes);
    } catch {
      setNews({ ok: false, source: newsSrc, fetchedAt: new Date().toISOString(), stale: true, items: [], error: "network error" });
    }
  }, [newsSrc]);

  const loadQuotes = useCallback(async () => {
    const results = await Promise.allSettled(
      QUICK_QUOTES.map(async (qq) => {
        const r = await fetch(`/api/intel/quote?symbol=${encodeURIComponent(qq.q)}`, { cache: "no-store" });
        return [qq.q, (await r.json()) as QuoteRes] as const;
      })
    );
    const map: Record<string, QuoteRes> = {};
    for (const r of results) {
      if (r.status === "fulfilled") map[r.value[0]] = r.value[1];
    }
    setQuotes(map);
  }, []);

  const refreshAll = useCallback(() => {
    setLoading(true);
    void Promise.allSettled([loadCalendar(), loadNews(), loadQuotes()]).finally(() => setLoading(false));
  }, [loadCalendar, loadNews, loadQuotes]);

  // deferred initial load + periodic auto-refresh (setState stays in callbacks)
  useEffect(() => {
    const t = setTimeout(() => void loadCalendar(), 0);
    const id = setInterval(() => void loadCalendar(), 600_000); // calendar: 10 min
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [loadCalendar]);
  useEffect(() => {
    const t = setTimeout(() => void loadNews(), 0);
    const id = setInterval(() => void loadNews(), 300_000); // headlines: 5 min
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [loadNews]);
  useEffect(() => {
    const t = setTimeout(() => void loadQuotes(), 0);
    const id = setInterval(() => void loadQuotes(), 60_000); // quotes: 1 min
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [loadQuotes]);

  return (
    <div className="space-y-4">
      {/* header strip */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-[#1C2A47] bg-[#0D1730]/90 px-3 py-2">
          <Globe size={14} className="text-[#4FD8FF]" />
          <span className="text-[10.5px] font-extrabold tracking-[0.2em] text-[#DDE6F5]">MARKET INTEL</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#6B7A94]">· live external feeds</span>
        </div>
        <span className="rounded-full border border-[#1C2A47] bg-[#101C33] px-2.5 py-1 text-[9px] font-bold text-[#8C98AE]">
          ForexFactory {cal ? srcStamp(cal.ok, cal.stale, cal.fetchedAt) : "…"}
        </span>
        <span className="rounded-full border border-[#1C2A47] bg-[#101C33] px-2.5 py-1 text-[9px] font-bold text-[#8C98AE]">
          Bloomberg {news && newsSrc === "bloomberg" ? srcStamp(news.ok, news.stale, news.fetchedAt) : newsSrc === "bloomberg" ? "…" : "idle"}
        </span>
        <span className="rounded-full border border-[#1C2A47] bg-[#101C33] px-2.5 py-1 text-[9px] font-bold text-[#8C98AE]">
          Yahoo {news && newsSrc === "yahoo" ? srcStamp(news.ok, news.stale, news.fetchedAt) : newsSrc === "yahoo" ? "…" : "idle"}
        </span>
        <button
          type="button"
          onClick={refreshAll}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#1C2A47] bg-[#101C33] px-3 py-1.5 text-[10px] font-bold text-[#B8C2D6] transition-colors hover:border-[#D4AF37]/50 hover:text-[#D4AF37]"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh feeds
        </button>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* ════════ economic calendar ════════ */}
        <PanelCard title="ECONOMIC CALENDAR · FOREXFACTORY" icon={CalendarClock} accent="gold" bodyClassName="flex flex-col gap-2 p-3">
          {/* filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(["today", "tomorrow", "this_week", "next_week"] as DayKey[]).map((d) => (
              <button key={d} type="button" onClick={() => setDay(d)} className={chipCls(day === d)}>
                {d.replace("_", " ")}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[#1C2A47]" />
            {(["all", "med_high", "high"] as ImpactKey[]).map((i) => (
              <button key={i} type="button" onClick={() => setImpact(i)} className={chipCls(impact === i)}>
                {i === "all" ? "all impact" : i === "high" ? "high only" : "med + high"}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[#1C2A47]" />
            {["ALL", "USD", "EUR", "GBP", "JPY"].map((cc) => (
              <button key={cc} type="button" onClick={() => setCurrency(cc)} className={chipCls(currency === cc)}>
                {cc}
              </button>
            ))}
          </div>

          {/* column legend */}
          <div className="grid grid-cols-[44px_38px_1fr_58px_58px_58px] gap-1 border-b border-[#16263F] pb-1 text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#6B7A94]">
            <span>Time</span>
            <span>Cur</span>
            <span>Event</span>
            <span className="text-right">Forecast</span>
            <span className="text-right">Prev</span>
            <span className="text-right">Actual</span>
          </div>

          {/* rows */}
          <div className="halo-scroll max-h-[430px] min-h-[120px] overflow-y-auto pr-1">
            {!cal ? (
              <p className="py-6 text-center text-[10.5px] text-[#6B7A94]">Fetching ForexFactory calendar…</p>
            ) : !cal.ok ? (
              <p className="rounded-lg border border-[rgba(242,54,69,0.4)] bg-[rgba(242,54,69,0.07)] px-3 py-3 text-[10.5px] leading-snug text-[#F23645]">
                Calendar feed unreachable — {cal.error}. Retry with the refresh button; nothing is invented to fill the gap.
              </p>
            ) : cal.events.length === 0 ? (
              <p className="py-6 text-center text-[10.5px] text-[#6B7A94]">
                No {impact === "all" ? "" : impact === "high" ? "high-impact " : "medium-or-higher "}
                {currency !== "ALL" ? `${currency} ` : ""}releases for {day.replace("_", " ")}.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {cal.events.map((e, i) => {
                  const released = e.actual !== "";
                  return (
                    <li
                      key={`${e.date}-${e.title}-${i}`}
                      className="grid grid-cols-[44px_38px_1fr_58px_58px_58px] items-center gap-1 rounded-md px-1 py-1 hover:bg-[#101C33]"
                      title={e.title}
                    >
                      <span className="font-mono text-[10px] font-bold text-[#8C98AE]">{fmtClock(e.date)}</span>
                      <span className="font-mono text-[9.5px] font-extrabold text-[#B8C2D6]">{e.currency}</span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: IMPACT_COLOR[e.impact], boxShadow: e.impact === "high" ? `0 0 6px ${IMPACT_COLOR[e.impact]}` : undefined }}
                          title={e.impact}
                        />
                        <span className="truncate text-[10.5px] font-medium text-[#DDE6F5]">{e.title}</span>
                      </span>
                      <span className="truncate text-right font-mono text-[9.5px] text-[#8C98AE]">{e.forecast || "—"}</span>
                      <span className="truncate text-right font-mono text-[9.5px] text-[#6B7A94]">{e.previous || "—"}</span>
                      <span
                        className="truncate text-right font-mono text-[9.5px] font-bold"
                        style={{ color: released ? C.gold : "#4A5568" }}
                      >
                        {released ? e.actual : "…"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="text-[8.5px] leading-snug text-[#5D6B85]">
            Times in UTC · impact dot: red = high, gold = medium · source {cal?.source ?? "ForexFactory"} · informational, not trade advice.
          </p>
        </PanelCard>

        {/* ════════ right column: quotes + news ════════ */}
        <div className="space-y-4">
          {/* quotes */}
          <PanelCard title="LIVE QUOTES · YAHOO FINANCE" icon={TrendingUp} accent="green" bodyClassName="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 xl:grid-cols-2">
            {QUICK_QUOTES.map((qq) => {
              const q = quotes[qq.q];
              const up = (q?.changePct ?? 0) >= 0;
              return (
                <div key={qq.q} className="min-w-0 rounded-lg border border-[#16263F] bg-[#0B1426]/70 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[8.5px] font-bold uppercase tracking-[0.14em] text-[#6B7A94]">{q?.label ?? qq.label}</span>
                    {q?.ok && q.changePct != null && (
                      <span className="shrink-0 font-mono text-[8.5px] font-bold" style={{ color: up ? C.green : C.red }}>
                        {up ? "▲" : "▼"} {Math.abs(q.changePct).toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[12.5px] font-bold leading-tight" style={{ color: q?.ok ? C.txt : "#6B7A94" }}>
                    {q?.ok && q.price != null
                      ? q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(q.price) < 5 ? 4 : 2 })
                      : q && !q.ok
                        ? "—"
                        : "…"}
                  </div>
                  {q && !q.ok && <div className="truncate text-[8px] text-[#F23645]/80" title={q.error}>{q.error?.slice(0, 30) ?? "unreachable"}</div>}
                </div>
              );
            })}
          </PanelCard>

          {/* news */}
          <PanelCard
            title="MARKET HEADLINES"
            icon={Newspaper}
            accent="cyan"
            right={
              <div className="flex gap-1">
                {(["bloomberg", "yahoo"] as NewsKey[]).map((s) => (
                  <button key={s} type="button" onClick={() => setNewsSrc(s)} className={chipCls(newsSrc === s)}>
                    {s}
                  </button>
                ))}
              </div>
            }
            bodyClassName="flex flex-col gap-1 p-3"
          >
            {!news ? (
              <p className="py-4 text-center text-[10.5px] text-[#6B7A94]">Fetching headlines…</p>
            ) : !news.ok ? (
              <p className="rounded-lg border border-[rgba(242,54,69,0.4)] bg-[rgba(242,54,69,0.07)] px-3 py-2.5 text-[10.5px] leading-snug text-[#F23645]">
                {newsSrc} feed unreachable — {news.error}. Try the other source or refresh; no headlines are fabricated.
              </p>
            ) : (
              <ul className="halo-scroll max-h-[320px] space-y-0.5 overflow-y-auto pr-1">
                {news.items.map((n, i) => (
                  <li key={`${n.publishedAt}-${i}`}>
                    <a
                      href={n.link || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-[#101C33]"
                    >
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[#4FD8FF]/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10.5px] font-medium leading-snug text-[#DDE6F5] group-hover:text-[#9BE8FF]">{n.title}</span>
                        <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#5D6B85]">
                          {n.outlet} · {relTime(n.publishedAt)}
                        </span>
                      </span>
                      <ExternalLink size={10} className="mt-1 shrink-0 text-[#3D4C66] group-hover:text-[#4FD8FF]" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>
        </div>
      </div>
    </div>
  );
}
