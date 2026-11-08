// API rate-limit rule table — self-test (pure, in-memory).
//   npx tsx scripts/rate-limit-selftest.ts
import { checkRate, rateStats, resetRateLimits, ruleFor } from "../src/lib/rate-limit";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const fire = (n: number, pathname: string, opt: { method?: string; session?: string; ip?: string; eaKey?: string; now?: number } = {}) => {
  let last = checkRate({ pathname, method: opt.method ?? "GET", session: opt.session ?? "sess-A", ip: opt.ip ?? "1.1.1.1", eaKey: opt.eaKey, now: opt.now });
  for (let i = 1; i < n; i++) last = checkRate({ pathname, method: opt.method ?? "GET", session: opt.session ?? "sess-A", ip: opt.ip ?? "1.1.1.1", eaKey: opt.eaKey, now: opt.now });
  return last;
};

// routing
ok(ruleFor("/api/halo/brain", "POST")?.id === "ai" && ruleFor("/api/halo/assistant", "GET")?.id === "ai", "AI routes → AI rule");
ok(ruleFor("/api/backtest/live", "POST")?.id === "backtest", "backtest sub-routes → backtest rule");
ok(ruleFor("/api/edge/autopilot", "POST")?.id === "edge-heavy" && ruleFor("/api/edge/autopilot", "GET")?.id === "api", "autopilot RUN is heavy; status polling is not");
ok(ruleFor("/api/strategies/abc123/preview", "GET")?.id === "pine-preview" && ruleFor("/api/strategies", "GET")?.id === "api", "strategy previews matched by pattern");
ok(ruleFor("/api/scannerx", "GET")?.id === "api", "a different route that merely starts the same is not caught");
ok(ruleFor("/api/market/stream", "GET")?.id === "stream" && ruleFor("/api/market/candles", "GET")?.id === "market", "price streams and candles have separate limits");
ok(ruleFor("/api/bridge/mt5", "POST")?.keyBy === "ea" && ruleFor("/api/webhook/tv", "POST")?.keyBy === "ip", "EA counted per pairing key, webhooks per IP");

// limits
resetRateLimits();
const t = Date.UTC(2026, 10, 8, 10, 0, 0);
ok(fire(20, "/api/halo/brain", { method: "POST", now: t }).ok, "20 AI requests in a minute allowed");
const r21 = fire(1, "/api/halo/brain", { method: "POST", now: t });
ok(!r21.ok && r21.retryAfterSec > 0 && r21.retryAfterSec <= 60, "21st AI request in the minute refused with a retry time");
ok(fire(1, "/api/halo/brain", { method: "POST", session: "sess-B", now: t }).ok, "another user is not affected");
ok(fire(1, "/api/market/candles", { now: t }).ok, "market data is unaffected by the AI limit");
ok(fire(1, "/api/halo/brain", { method: "POST", now: t + 61_000 }).ok, "the next minute is allowed again");

// daily cap: 400 AI requests across minutes
resetRateLimits();
let allowed = 0;
for (let m = 0; m < 25; m++) for (let i = 0; i < 20; i++) if (fire(1, "/api/halo/assistant", { now: t + m * 61_000 }).ok) allowed++;
ok(allowed === 400, `AI daily cap: 400 allowed over 25 minutes (got ${allowed})`);

// normal dashboard use stays far below every limit (measured: candles ~21/min, quote ~15/min)
resetRateLimits();
ok(fire(21 * 4, "/api/market/candles", { now: t }).ok && fire(15 * 4, "/api/intel/quote", { now: t }).ok, "4 open dashboards' worth of market calls in a minute → allowed");
ok(fire(120, "/api/bridge/mt5", { method: "POST", eaKey: "k1", now: t }).ok, "EA polling every 0.5 s (120/min) → allowed");

// stats
const st = rateStats().rules;
ok((st.find((r) => r.id === "market")?.allowed ?? 0) >= 144, "counters record allowed requests");
resetRateLimits();
fire(41, "/api/halo/tts", { method: "POST", now: t });
const tts = rateStats().rules.find((r) => r.id === "tts")!;
ok(tts.allowed === 40 && tts.rejected === 1 && tts.lastRejectedAt === t, "counters record rejections and when");
ok(!JSON.stringify(rateStats()).includes("sess-A"), "no session token appears in the stats");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
