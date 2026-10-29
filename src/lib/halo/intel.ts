// ════════════════════════════════════════════════════════════════════════
//  HALO EXTERNAL INTEL · curated real-world data feeds (read-only)
//
//  Sources (trusted allowlist — HALO never fetches arbitrary URLs, that
//  would expose the server to SSRF; only these fixed public endpoints):
//   • ForexFactory weekly economic calendar JSON (faireconomy media feed)
//   • Bloomberg RSS newsroom feeds (markets + economics)
//   • Yahoo Finance RSS headlines + v8 chart API quotes
//
//  HONESTY CONTRACT: every result carries `ok`, `source`, `fetchedAt` and
//  `stale`. On any failure the result says so — callers must never invent
//  events, headlines or prices, and must pass the failure to the trader.
//
//  All fetches: short timeout, no-store, cached briefly on globalThis
//  (Next dev bundles routes separately — same reason as lib/market.ts).
//  Read-only intelligence: nothing here touches trading, engine, config
//  or broker state.
// ════════════════════════════════════════════════════════════════════════

import { yahooTicker } from "@/lib/market";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const gStore = globalThis as unknown as {
  __haloIntelCal?: CacheEntry<CalendarResult>;
  __haloIntelNews?: Map<string, CacheEntry<NewsResult>>;
  __haloIntelQuote?: Map<string, CacheEntry<QuoteResult>>;
};

interface CacheEntry<T> {
  data: T;
  at: number;
}

async function tget(url: string, ms = 9000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json, text/xml, text/plain" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function cached<T>(entry: CacheEntry<T> | undefined, ttlMs: number): T | null {
  return entry && Date.now() - entry.at < ttlMs ? entry.data : null;
}

// ═══════════════════════ ECONOMIC CALENDAR (ForexFactory) ═══════════════════════

export type EconImpact = "high" | "medium" | "low" | "holiday";
export type CalendarDay = "today" | "tomorrow" | "this_week" | "next_week";

export interface EconEvent {
  title: string;
  currency: string;
  impact: EconImpact;
  date: string; // ISO UTC
  forecast: string;
  previous: string;
  actual: string; // empty until released
}

export interface CalendarResult {
  ok: boolean;
  source: string;
  fetchedAt: string;
  stale: boolean;
  week: "this" | "next";
  events: EconEvent[]; // normalized, chronological
  error?: string;
}

const CAL_TTL_MS = 10 * 60_000;
const CAL_URLS: Record<"this" | "next", string> = {
  this: "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  next: "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
};

interface FfRow {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

function normImpact(v: string | undefined): EconImpact {
  const s = (v ?? "").toLowerCase();
  if (s.includes("high")) return "high";
  if (s.includes("medium")) return "medium";
  if (s.includes("low")) return "low";
  if (s.includes("holiday")) return "holiday";
  return "low";
}

function cleanStr(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

async function fetchWeek(week: "this" | "next"): Promise<CalendarResult> {
  const cachedRes = cached(gStore.__haloIntelCal, CAL_TTL_MS);
  // cache is per-week-file: only reuse when it matches the requested week
  if (cachedRes && cachedRes.week === week) return cachedRes;

  try {
    const raw = await tget(CAL_URLS[week]);
    const rows = JSON.parse(raw) as FfRow[];
    if (!Array.isArray(rows)) throw new Error("calendar feed returned unexpected shape");
    const events: EconEvent[] = rows
      .filter((r) => r && typeof r.title === "string" && typeof r.date === "string")
      .map((r) => {
        const d = new Date(r.date as string);
        return {
          title: cleanStr(r.title).slice(0, 120),
          currency: cleanStr(r.country).toUpperCase().slice(0, 4),
          impact: normImpact(r.impact),
          date: isNaN(d.getTime()) ? "" : d.toISOString(),
          forecast: cleanStr(r.forecast),
          previous: cleanStr(r.previous),
          actual: cleanStr(r.actual),
        };
      })
      .filter((e) => e.date !== "")
      .sort((a, b) => a.date.localeCompare(b.date));
    const res: CalendarResult = {
      ok: true,
      source: "ForexFactory",
      fetchedAt: new Date().toISOString(),
      stale: false,
      week,
      events,
    };
    gStore.__haloIntelCal = { data: res, at: Date.now() };
    return res;
  } catch (e) {
    // serve stale cache honestly flagged, else honest failure
    const staleEntry = gStore.__haloIntelCal;
    if (staleEntry?.data.week === week) {
      return { ...staleEntry.data, stale: true, error: `feed unreachable (${(e as Error).message}) — showing last good copy` };
    }
    return {
      ok: false,
      source: "ForexFactory",
      fetchedAt: new Date().toISOString(),
      stale: true,
      week,
      events: [],
      error: `ForexFactory calendar unreachable: ${(e as Error).message.slice(0, 120)}`,
    };
  }
}

export async function getCalendar(
  day: CalendarDay,
  impact: "all" | "high" | "med_high",
  currency?: string
): Promise<CalendarResult> {
  const wantNext = day === "next_week";
  const base = await fetchWeek(wantNext ? "next" : "this");
  if (!base.ok) return base;

  const now = new Date();
  const startToday = new Date(now);
  startToday.setUTCHours(0, 0, 0, 0);
  const startTomorrow = new Date(startToday);
  startTomorrow.setUTCDate(startTomorrow.getUTCDate() + 1);
  const endTomorrow = new Date(startTomorrow);
  endTomorrow.setUTCDate(endTomorrow.getUTCDate() + 1);
  const weekEnd = new Date(startToday);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  let events = base.events.filter((e) => {
    const d = new Date(e.date);
    switch (day) {
      case "today":
        return d >= startToday && d < startTomorrow;
      case "tomorrow":
        return d >= startTomorrow && d < endTomorrow;
      case "this_week":
        return d >= startToday && d < weekEnd;
      case "next_week":
        return d >= startTomorrow; // next-week file is already bounded by FF
    }
  });

  if (impact === "high") events = events.filter((e) => e.impact === "high");
  else if (impact === "med_high") events = events.filter((e) => e.impact === "high" || e.impact === "medium");

  const cur = (currency ?? "").trim().toUpperCase();
  if (cur && cur !== "ALL" && cur !== "ANY") events = events.filter((e) => e.currency === cur || e.currency === "ALL");

  return { ...base, events };
}

// ═══════════════════════ NEWS (Bloomberg + Yahoo Finance RSS) ═══════════════════════

export interface NewsItem {
  title: string;
  outlet: string;
  link: string;
  publishedAt: string;
}

export interface NewsResult {
  ok: boolean;
  source: string;
  fetchedAt: string;
  stale: boolean;
  items: NewsItem[];
  error?: string;
}

const NEWS_TTL_MS = 8 * 60_000;

const NEWS_FEEDS: Record<"bloomberg" | "yahoo", { url: string; outlet: string }[]> = {
  bloomberg: [
    { url: "https://feeds.bloomberg.com/markets/news.rss", outlet: "Bloomberg Markets" },
    { url: "https://feeds.bloomberg.com/economics/news.rss", outlet: "Bloomberg Economics" },
  ],
  yahoo: [{ url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US", outlet: "Yahoo Finance" }],
};

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function grab(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function parseRss(xml: string, outlet: string, limit: number): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const b of blocks) {
    const title = grab(b, "title");
    if (!title) continue;
    const link = grab(b, "link");
    const pub = grab(b, "pubDate");
    const d = pub ? new Date(pub) : new Date();
    out.push({
      title: title.slice(0, 200),
      outlet,
      link,
      publishedAt: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getNews(
  source: "bloomberg" | "yahoo",
  topic?: string
): Promise<NewsResult> {
  const key = source;
  const cachedRes = cached(gStore.__haloIntelNews?.get(key), NEWS_TTL_MS);
  if (cachedRes) return filterNews(cachedRes, topic);

  const feeds = NEWS_FEEDS[source];
  const items: NewsItem[] = [];
  const errs: string[] = [];
  // fetch the source's feeds in parallel, merge chronologically
  const results = await Promise.allSettled(
    feeds.map(async (f) => ({ outlet: f.outlet, xml: await tget(f.url) }))
  );
  for (const r of results) {
    if (r.status === "fulfilled") items.push(...parseRss(r.value.xml, r.value.outlet, 25));
    else errs.push((r.reason as Error)?.message?.slice(0, 80) ?? "feed error");
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const res: NewsResult = {
    ok: items.length > 0,
    source,
    fetchedAt: new Date().toISOString(),
    stale: false,
    items,
    ...(items.length === 0 ? { error: `${source} feeds unreachable: ${errs.join("; ") || "empty feed"}` } : {}),
  };
  if (res.ok) (gStore.__haloIntelNews ??= new Map()).set(key, { data: res, at: Date.now() });
  return filterNews(res, topic);
}

function filterNews(res: NewsResult, topic?: string): NewsResult {
  const t = (topic ?? "").trim().toLowerCase();
  if (!t || !res.ok) return res;
  const items = res.items.filter(
    (i) => i.title.toLowerCase().includes(t) || i.outlet.toLowerCase().includes(t)
  );
  return { ...res, items };
}

// ═══════════════════════ QUOTES (Yahoo Finance chart API) ═══════════════════════

export interface QuoteResult {
  ok: boolean;
  ticker: string;
  label: string;
  price: number | null;
  previousClose: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  currency: string;
  exchange: string;
  marketTime: string | null;
  fetchedAt: string;
  stale: boolean;
  error?: string;
}

const QUOTE_TTL_MS = 45_000;

/** canonical intel target → Yahoo ticker (indices + commodities; catalog symbols resolve via market.ts) */
const CANONICAL_TICKER: Record<string, string> = {
  SPX: "^GSPC",
  NDX: "^NDX",
  IXIC: "^IXIC",
  DJI: "^DJI",
  DAX: "^GDAXI",
  FTSE: "^FTSE",
  NIKKEI: "^N225",
  HSI: "^HSI",
  VIX: "^VIX",
  US10Y: "^TNX",
  OIL: "CL=F",
  BRENT: "BZ=F",
  NATGAS: "NG=F",
  DXY: "DX-Y.NYB",
};

export function canonicalToYahoo(canonical: string): string | null {
  const direct = CANONICAL_TICKER[canonical];
  if (direct) return direct;
  // crypto pairs: Yahoo lists them as BASE-USD (e.g. BTC-USD), not the
  // exchange-native USDT form the catalog uses
  if (/USDT$/.test(canonical)) return canonical.replace(/USDT$/, "-USD");
  return yahooTicker(canonical);
}

export async function getQuote(canonical: string, label: string): Promise<QuoteResult> {
  const ticker = canonicalToYahoo(canonical);
  if (!ticker) {
    return emptyQuote(canonical, label, `no ticker mapping for "${canonical}"`);
  }
  const cacheKey = ticker;
  const cachedRes = cached(gStore.__haloIntelQuote?.get(cacheKey), QUOTE_TTL_MS);
  if (cachedRes) return { ...cachedRes, label };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;
  try {
    const raw = await tget(url, 8000);
    const j = JSON.parse(raw) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            previousClose?: number;
            chartPreviousClose?: number;
            currency?: string;
            exchangeName?: string;
            regularMarketTime?: number;
          };
          timestamp?: number[];
          indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }> };
        }>;
        error?: { description?: string } | null;
      };
    };
    const res0 = j.chart?.result?.[0];
    const meta = res0?.meta;
    const price = meta?.regularMarketPrice;
    if (!res0 || price == null || !isFinite(price)) {
      throw new Error(j.chart?.error?.description ?? "no price in response");
    }

    // previous close: meta fields, else the 1d candle before the last
    const q = res0.indicators?.quote?.[0];
    const closes = (q?.close ?? []).filter((c): c is number => c != null && isFinite(c));
    const prevClose =
      meta?.previousClose ??
      (meta?.chartPreviousClose != null && meta.chartPreviousClose !== price ? meta.chartPreviousClose : null) ??
      (closes.length >= 2 ? closes[closes.length - 2] : null);

    // today's range from the last candle with real data
    let dayHigh: number | null = null;
    let dayLow: number | null = null;
    if (q?.high && q?.low) {
      for (let i = q.high.length - 1; i >= 0; i--) {
        const h = q.high[i];
        const l = q.low[i];
        if (h != null && l != null && isFinite(h) && isFinite(l)) {
          dayHigh = h;
          dayLow = l;
          break;
        }
      }
    }

    const changePct = prevClose && prevClose !== 0 ? ((price - prevClose) / prevClose) * 100 : null;
    const out: QuoteResult = {
      ok: true,
      ticker,
      label,
      price,
      previousClose: prevClose,
      changePct: changePct != null ? Math.round(changePct * 100) / 100 : null,
      dayHigh,
      dayLow,
      currency: meta?.currency ?? "",
      exchange: meta?.exchangeName ?? "",
      marketTime: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    (gStore.__haloIntelQuote ??= new Map()).set(cacheKey, { data: out, at: Date.now() });
    return { ...out, label };
  } catch (e) {
    const staleEntry = gStore.__haloIntelQuote?.get(cacheKey);
    if (staleEntry) return { ...staleEntry.data, stale: true, error: `quote feed degraded (${(e as Error).message}) — last good read shown` };
    return emptyQuote(ticker, label, `Yahoo Finance quote unreachable: ${(e as Error).message.slice(0, 120)}`);
  }
}

function emptyQuote(ticker: string, label: string, error: string): QuoteResult {
  return {
    ok: false,
    ticker,
    label,
    price: null,
    previousClose: null,
    changePct: null,
    dayHigh: null,
    dayLow: null,
    currency: "",
    exchange: "",
    marketTime: null,
    fetchedAt: new Date().toISOString(),
    stale: true,
    error,
  };
}
