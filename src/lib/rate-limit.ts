// ════════════════════════════════════════════════════════════════════════
//  API RATE LIMITS · one rule table, enforced in the request gate (proxy.ts)
//  so no route can be forgotten. Limits sit far above measured normal use
//  (dashboard: ~21 candle, ~15 quote, ~5 scanner, ~3 voice calls/min) and
//  separate expensive AI / backtest work from ordinary market data.
//    key: signed-in session (cookie) · else client IP · EA: its pairing key
//  In-memory fixed windows (single instance). Stats feed Admin → Execution.
//  Nothing here can authorise anything: a request that passes still meets
//  every route's own auth, licence, price and risk checks.
// ════════════════════════════════════════════════════════════════════════

export interface RateRule {
  id: string;
  label: string;
  /** path prefixes (or a regex) this rule covers */
  match: Array<string | RegExp>;
  methods?: string[]; // default: all
  keyBy: "session" | "ip" | "ea";
  windows: Array<{ limit: number; ms: number }>;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** first match wins — specific rules before broad ones */
export const RATE_RULES: RateRule[] = [
  { id: "ai", label: "AI assistant (Claude)", match: ["/api/halo/brain", "/api/halo/assistant"], keyBy: "session", windows: [{ limit: 20, ms: MIN }, { limit: 400, ms: DAY }] },
  { id: "tts", label: "Voice (text-to-speech)", match: ["/api/halo/tts"], keyBy: "session", windows: [{ limit: 40, ms: MIN }] },
  { id: "backtest", label: "Backtests", match: ["/api/backtest"], keyBy: "session", windows: [{ limit: 10, ms: MIN }, { limit: 200, ms: DAY }] },
  { id: "edge-heavy", label: "EDGE compare / autopilot runs", match: ["/api/edge/compare", "/api/edge/autopilot"], methods: ["POST"], keyBy: "session", windows: [{ limit: 6, ms: MIN }, { limit: 60, ms: DAY }] },
  { id: "pine-preview", label: "Strategy previews", match: [/^\/api\/strategies\/[^/]+\/preview/], keyBy: "session", windows: [{ limit: 60, ms: MIN }] },
  { id: "scanners", label: "Scanners", match: ["/api/scanner", "/api/tf-scanner"], keyBy: "session", windows: [{ limit: 120, ms: MIN }] },
  { id: "stream", label: "Live price streams", match: ["/api/market/stream"], keyBy: "session", windows: [{ limit: 30, ms: MIN }] },
  { id: "market", label: "Market data", match: ["/api/market/", "/api/intel/"], keyBy: "session", windows: [{ limit: 300, ms: MIN }] },
  { id: "journal-heavy", label: "Journal import / sync / export / report", match: ["/api/journal/import", "/api/journal/sync", "/api/journal/export", "/api/journal/report"], keyBy: "session", windows: [{ limit: 20, ms: 10 * MIN }] },
  { id: "tv-webhook", label: "TradingView webhook", match: ["/api/webhook/"], keyBy: "ip", windows: [{ limit: 60, ms: MIN }] },
  { id: "ea", label: "HALO Bridge EA polling", match: ["/api/bridge/mt5"], keyBy: "ea", windows: [{ limit: 600, ms: MIN }] },
  { id: "pay-webhook", label: "Payment webhooks", match: ["/api/commerce/webhook/"], keyBy: "ip", windows: [{ limit: 120, ms: MIN }] },
  { id: "auth", label: "Sign-in & account endpoints", match: ["/api/auth/"], keyBy: "ip", windows: [{ limit: 60, ms: MIN }] },
  { id: "api", label: "All other API calls (backstop)", match: ["/api/"], keyBy: "session", windows: [{ limit: 1200, ms: MIN }] },
];

interface Bucket {
  count: number;
  resetAt: number;
}
export interface RuleStats {
  allowed: number;
  rejected: number;
  lastRejectedAt: number | null;
  lastRejectedKey: string | null; // short, non-reversible
}

const g = globalThis as unknown as { __haloRate?: { buckets: Map<string, Bucket>; stats: Map<string, RuleStats>; since: number } };
const store = (g.__haloRate ??= { buckets: new Map(), stats: new Map(), since: Date.now() });

/** short non-cryptographic fingerprint (FNV-1a) — keys never hold raw tokens */
function fp(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function ruleFor(pathname: string, method: string): RateRule | null {
  for (const r of RATE_RULES) {
    if (r.methods && !r.methods.includes(method)) continue;
    if (r.match.some((m) => (typeof m === "string" ? pathname === m || pathname.startsWith(m.endsWith("/") ? m : `${m}/`) : m.test(pathname)))) return r;
  }
  return null;
}

export interface RateInput {
  pathname: string;
  method: string;
  session?: string | null;
  ip: string;
  eaKey?: string | null;
  now?: number;
}

export type RateVerdict = { ok: true } | { ok: false; rule: RateRule; retryAfterSec: number };

/** count one request; refuse when any window of its rule is full */
export function checkRate(i: RateInput): RateVerdict {
  const rule = ruleFor(i.pathname, i.method);
  if (!rule) return { ok: true };
  const now = i.now ?? Date.now();
  const who = rule.keyBy === "ea" ? `ea:${fp(i.eaKey ?? i.ip)}` : rule.keyBy === "ip" || !i.session ? `ip:${fp(i.ip)}` : `s:${fp(i.session)}`;
  const st = store.stats.get(rule.id) ?? { allowed: 0, rejected: 0, lastRejectedAt: null, lastRejectedKey: null };
  store.stats.set(rule.id, st);
  let retry = 0;
  const hits: Bucket[] = [];
  rule.windows.forEach((w, n) => {
    const k = `${rule.id}|${n}|${who}`;
    let b = store.buckets.get(k);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + w.ms };
      store.buckets.set(k, b);
    }
    if (b.count >= w.limit) retry = Math.max(retry, Math.ceil((b.resetAt - now) / 1000));
    hits.push(b);
  });
  if (retry > 0) {
    st.rejected++;
    st.lastRejectedAt = now;
    st.lastRejectedKey = who.slice(0, 12);
    return { ok: false, rule, retryAfterSec: Math.max(1, retry) };
  }
  for (const b of hits) b.count++;
  st.allowed++;
  if (store.buckets.size > 50_000) for (const [k, b] of store.buckets) if (b.resetAt <= now) store.buckets.delete(k);
  return { ok: true };
}

/** Admin → Execution: rules, limits and counters since the process started */
export function rateStats(): { since: number; rules: Array<{ id: string; label: string; keyBy: string; windows: Array<{ limit: number; ms: number }> } & RuleStats> } {
  return {
    since: store.since,
    rules: RATE_RULES.map((r) => ({
      id: r.id,
      label: r.label,
      keyBy: r.keyBy,
      windows: r.windows,
      ...(store.stats.get(r.id) ?? { allowed: 0, rejected: 0, lastRejectedAt: null, lastRejectedKey: null }),
    })),
  };
}

/** tests only */
export function resetRateLimits(): void {
  store.buckets.clear();
  store.stats.clear();
}
