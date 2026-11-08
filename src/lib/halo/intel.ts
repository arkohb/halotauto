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

import { getKlines, getSymbolMeta, yahooTicker } from "@/lib/market";
import { isSimOnlyGroup } from "@/lib/market-symbols";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const gStore = globalThis as unknown as {
  __haloIntelCal?: Map<"this" | "next", CacheEntry<CalendarResult>>;
  __haloIntelCalInflight?: Map<string, Promise<CalendarResult>>;
  __haloIntelNews?: Map<string, CacheEntry<NewsResult>>;
  __haloIntelQuote?: Map<string, CacheEntry<QuoteResult>>;
};

interface CacheEntry<T> {
  data: T;
  at: number;
}

// ── feed cooldown (429 / Retry-After awareness) ────────────────────────────
// A 429 is the feed telling us to BACK OFF — hammering it only extends the
// ban. Every external fetch can therefore carry a cooldown key: a failing URL
// parks itself for the period the feed asks for (Retry-After, clamped
// 30s–30min; default 5min on 429, 1min on other failures) and further
// attempts fail fast WITHOUT an outbound request. This is what makes the
// refresh button safe: during a cooldown it re-serves the last good copy or
// an honest failure instead of deepening the rate limit.
class FeedCooldownError extends Error {
  constructor(
    public readonly until: number,
    public readonly rateLimited: boolean
  ) {
    super(rateLimited ? "HTTP 429 — rate-limited by the feed" : "feed failing — backing off briefly");
  }
}

const FEED_COOLDOWN = new Map<string, { until: number; rateLimited: boolean }>();

/** parse a Retry-After header (delay-seconds or HTTP-date) → ms, or null */
export function retryAfterToMs(v: string | null): number | null {
  if (!v) return null;
  const s = Number(v.trim());
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const d = Date.parse(v);
  return isNaN(d) ? null : Math.max(0, d - Date.now());
}

const clampCooldown = (ms: number) => Math.min(Math.max(ms, 30_000), 30 * 60_000);

function cooldownLeft(key: string): { until: number; rateLimited: boolean } | null {
  const c = FEED_COOLDOWN.get(key);
  return c && Date.now() < c.until ? c : null;
}

class HttpStatusError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function tget(url: string, ms = 9000, cdKey?: string, encoding = "utf-8"): Promise<string> {
  if (cdKey) {
    const c = cooldownLeft(cdKey);
    if (c) throw new FeedCooldownError(c.until, c.rateLimited);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: { "User-Agent": UA, Accept: "application/json, text/xml, text/plain" },
    });
    if (!r.ok) {
      if (cdKey) {
        const limited = r.status === 429;
        const backoff = limited ? (retryAfterToMs(r.headers.get("retry-after")) ?? 5 * 60_000) : 60_000;
        FEED_COOLDOWN.set(cdKey, { until: Date.now() + clampCooldown(backoff), rateLimited: limited });
      }
      throw new HttpStatusError(r.status);
    }
    if (cdKey) FEED_COOLDOWN.delete(cdKey);
    const buf = await r.arrayBuffer();
    return new TextDecoder(encoding).decode(buf);
  } catch (e) {
    // network-level failures (timeout, DNS, refused) also earn a short
    // backoff so a cold or dead endpoint is not re-hit on every consumer poll
    if (cdKey && !(e instanceof HttpStatusError) && !(e instanceof FeedCooldownError) && !cooldownLeft(cdKey)) {
      FEED_COOLDOWN.set(cdKey, { until: Date.now() + clampCooldown(60_000), rateLimited: false });
    }
    throw e;
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
  note?: string; // transparency remark on a successful result (e.g. served via XML fallback)
  rateLimited?: boolean; // failure (or stale serve) caused by the feed's own 429
  retryIn?: number; // seconds until a real re-fetch is possible (cooldown window)
}

const CAL_TTL_MS = 10 * 60_000;
// one publisher, two representations of the same official feed: the JSON file
// is the primary; the XML file on the same nfs.faireconomy.media host is the
// fallback when the JSON path is rate-limited or failing (same events, same
// absolute UTC times — the XML simply carries no <actual> element).
const CAL_URLS: Record<"this" | "next", { json: string; xml: string }> = {
  this: {
    json: "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    xml: "https://nfs.faireconomy.media/ff_calendar_thisweek.xml",
  },
  next: {
    json: "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
    xml: "https://nfs.faireconomy.media/ff_calendar_nextweek.xml",
  },
};

interface FfRow {
  title?: string;
  country?: string;
  date?: string; // JSON: ISO with offset · XML path: already converted to ISO UTC
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

function rowsToEvents(rows: FfRow[]): EconEvent[] {
  return rows
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
}

// ── official XML variant of the ForexFactory feed (fallback) ─────────────
// windows-1252 encoded, times already UTC: NFP lists 1:30pm for the 8:30am ET
// release in November (EST = UTC−5) and AU Building Approvals 12:30am for the
// 11:30am Sydney release (AEDT = UTC+11). No <actual> element exists here.
export function parseFfXml(xml: string): FfRow[] {
  if (!/<weeklyevents[\s>]/i.test(xml)) throw new Error("calendar XML feed returned unexpected shape");
  const xmlVal = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}\\s*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}\\s*>`, "i"));
    if (!m) return "";
    return m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  };
  const toIso = (dateRaw: string, timeRaw: string): string => {
    const dm = dateRaw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); // MM-DD-YYYY
    if (!dm) return "";
    const tm = timeRaw.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    let hh = 0;
    let mm = 0;
    if (tm) {
      hh = (parseInt(tm[1], 10) % 12) + (tm[3] === "pm" ? 12 : 0);
      mm = tm[2] ? parseInt(tm[2], 10) : 0;
    }
    const ms = Date.UTC(Number(dm[3]), Number(dm[1]) - 1, Number(dm[2]), hh, mm);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
  };
  const rows: FfRow[] = [];
  for (const raw of xml.split(/<event\s*>/i).slice(1)) {
    const end = raw.search(/<\/event\s*>/i);
    const b = end >= 0 ? raw.slice(0, end) : raw;
    const date = toIso(xmlVal(b, "date"), xmlVal(b, "time"));
    if (!date) continue;
    rows.push({
      title: xmlVal(b, "title"),
      country: xmlVal(b, "country"),
      date,
      impact: xmlVal(b, "impact"),
      forecast: xmlVal(b, "forecast"),
      previous: xmlVal(b, "previous"),
      actual: "", // the XML variant carries no actuals — never invented
    });
  }
  return rows;
}

// per-week cache slots (a single slot was thrashed by alternating this/next
// requests, doubling the outbound rate) + in-flight dedup (page load fires
// several consumers at the same feed — they share one request)
async function fetchWeek(week: "this" | "next", force = false): Promise<CalendarResult> {
  const cacheMap = (gStore.__haloIntelCal ??= new Map<"this" | "next", CacheEntry<CalendarResult>>());
  const cachedRes = cached(cacheMap.get(week), CAL_TTL_MS);
  if (cachedRes && !force) return cachedRes;

  const inflight = (gStore.__haloIntelCalInflight ??= new Map<string, Promise<CalendarResult>>());
  const running = inflight.get(week);
  if (running) return running;

  const task = (async (): Promise<CalendarResult> => {
    // primary: official JSON — fallback: same publisher's XML variant
    let jsonErr: unknown = null;
    try {
      const raw = await tget(CAL_URLS[week].json, 9000, `ffcal-json-${week}`);
      const rows = JSON.parse(raw) as FfRow[];
      if (!Array.isArray(rows)) throw new Error("calendar feed returned unexpected shape");
      return {
        ok: true,
        source: "ForexFactory",
        fetchedAt: new Date().toISOString(),
        stale: false,
        week,
        events: rowsToEvents(rows),
      };
    } catch (e) {
      jsonErr = e;
    }
    try {
      const raw = await tget(CAL_URLS[week].xml, 9000, `ffcal-xml-${week}`, "windows-1252");
      const events = rowsToEvents(parseFfXml(raw));
      return {
        ok: true,
        source: "ForexFactory",
        fetchedAt: new Date().toISOString(),
        stale: false,
        week,
        events,
        note: "served from the official XML variant of the same feed (JSON path unavailable right now) — released actuals may be missing here",
      };
    } catch (xmlErr) {
      // both paths failed — serve the last good copy honestly flagged, else
      // an honest failure carrying the cooldown window
      const cooling = cooldownLeft(`ffcal-json-${week}`) ?? cooldownLeft(`ffcal-xml-${week}`);
      const rateLimited = Boolean(cooling?.rateLimited ?? /\b429\b/.test(String(jsonErr)));
      const retryMs = cooling ? cooling.until - Date.now() : undefined;
      const retryTxt = retryMs ? ` — a real retry opens in ~${Math.max(1, Math.round(retryMs / 60_000))}m` : "";
      const why = rateLimited
        ? "rate-limited by the feed (HTTP 429)"
        : ((xmlErr as Error)?.message || (jsonErr as Error)?.message || "feed error").slice(0, 80);
      const lastGood = cacheMap.get(week);
      if (lastGood) {
        return {
          ...lastGood.data,
          stale: true,
          ...(rateLimited ? { rateLimited: true } : {}),
          ...(retryMs ? { retryIn: Math.ceil(retryMs / 1000) } : {}),
          error: `feed unreachable (${why})${retryTxt} — showing last good copy`,
        };
      }
      return {
        ok: false,
        source: "ForexFactory",
        fetchedAt: new Date().toISOString(),
        stale: true,
        week,
        events: [],
        ...(rateLimited ? { rateLimited: true } : {}),
        ...(retryMs ? { retryIn: Math.ceil(retryMs / 1000) } : {}),
        error: `ForexFactory calendar unreachable: ${why}${retryTxt}`,
      };
    }
  })();

  inflight.set(week, task);
  try {
    const res = await task;
    if (res.ok && !res.stale) cacheMap.set(week, { data: res, at: Date.now() });
    return res;
  } finally {
    inflight.delete(week);
  }
}

export async function getCalendar(
  day: CalendarDay,
  impact: "all" | "high" | "med_high",
  currency?: string,
  opts?: { force?: boolean }
): Promise<CalendarResult> {
  const wantNext = day === "next_week";
  const base = await fetchWeek(wantNext ? "next" : "this", opts?.force);
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
  // fetch the source's feeds in parallel, merge chronologically (cooldown key
  // per feed URL: a 429ing RSS endpoint is backed off, not hammered)
  const results = await Promise.allSettled(
    feeds.map(async (f) => ({ outlet: f.outlet, xml: await tget(f.url, 9000, f.url) }))
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
  // Deriv synthetic indices have no Yahoo/external quote anywhere — go straight
  // to HALO's own feed (seeded simulator, honestly labelled). Real instruments
  // keep Yahoo as the primary source with the internal feed as fallback.
  const meta = getSymbolMeta(canonical);
  if (meta && isSimOnlyGroup(meta.group)) {
    return feedQuote(canonical, meta.label.split("·")[0].trim() || label);
  }
  const ticker = canonicalToYahoo(canonical);
  if (!ticker) {
    return emptyQuote(canonical, label, `no ticker mapping for "${canonical}"`);
  }
  const cacheKey = ticker;
  const cachedRes = cached(gStore.__haloIntelQuote?.get(cacheKey), QUOTE_TTL_MS);
  if (cachedRes) return { ...cachedRes, label };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d&includePrePost=false`;
  try {
    const raw = await tget(url, 8000, url);
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
    // real instrument, external feed down → fall back to HALO's own feed so
    // the trader always gets an answer (labelled with its true source)
    try {
      return await feedQuote(canonical, label);
    } catch {
      return emptyQuote(ticker, label, `Yahoo Finance quote unreachable: ${(e as Error).message.slice(0, 120)}`);
    }
  }
}

/**
 * Quote built from HALO's own candle feed (simulator for synthetics, last
 * cached real candles for anything else). Always answers; source is honest.
 */
async function feedQuote(canonical: string, label: string): Promise<QuoteResult> {
  const res = await getKlines(canonical, "5m", 3, { fresh: false });
  const cs = res.candles;
  if (!cs.length) throw new Error("no feed data");
  const last = cs[cs.length - 1];
  const prev = cs.length >= 2 ? cs[cs.length - 2] : null;
  const changePct = prev && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
  const out: QuoteResult = {
    ok: true,
    ticker: canonical,
    label,
    price: last.close,
    previousClose: prev ? prev.close : null,
    changePct: changePct != null ? Math.round(changePct * 100) / 100 : null,
    dayHigh: last.high,
    dayLow: last.low,
    currency: "USD",
    exchange: res.source === "simulator" ? "HALO SIM" : "HALO FEED",
    marketTime: new Date(last.time).toISOString(),
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
  (gStore.__haloIntelQuote ??= new Map()).set(`feed:${canonical}`, { data: out, at: Date.now() });
  return { ...out, label };
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
