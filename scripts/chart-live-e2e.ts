/**
 * chart-live E2E · verifies the real-time chart layer
 *   1. signed-out /                    → still lands on /login (gate intact)
 *   2. login via API                   → halo_session cookie
 *   3. terminal view                   → chart canvas renders, no fatal console errors
 *   4. live stream                     → "BINANCE LIVE"/"DERIV LIVE" badge appears for a
 *                                        crypto chart symbol (Binance WS reachable in-sandbox)
 *   5. candle movement                 → lightweight-charts visible range keeps advancing
 *                                        (new bars arriving) over the observation window
 * Run: Xvfb :99 then DISPLAY=:99 HALO_E2E_EMAIL=… HALO_E2E_PASSWORD=… bun scripts/chart-live-e2e.ts
 */
import { chromium, type BrowserContext } from "playwright";

const BASE = "http://localhost:3000";
const SHOT = "/tmp/chart-e2e";
import { mkdirSync } from "node:fs";
mkdirSync(SHOT, { recursive: true });

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✓ ${name}${detail ? ` · ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
if (!EMAIL || !PASSWORD) {
  console.error("✗ set HALO_E2E_EMAIL and HALO_E2E_PASSWORD");
  process.exit(1);
}

// ── 0. gate still up (signed-out) ───────────────────────────────────────
const gateRes = await fetch(`${BASE}/`, { redirect: "manual" });
ok("GATE: signed-out / redirects to login", gateRes.status === 307 || gateRes.status === 302, `status=${gateRes.status} loc=${gateRes.headers.get("location")}`);

// ── login (retry — login rate-limit is 8/10min) ─────────────────────────
let sessionPair: string | undefined;
let loginNote = "";
for (let i = 0; i < 4 && !sessionPair; i++) {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
  });
  const loginJson = (await loginRes.json()) as { ok?: boolean; error?: string };
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  sessionPair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  loginNote = loginJson.error ?? "";
  if (!sessionPair) await new Promise((r) => setTimeout(r, 20000));
}
ok("AUTH: login returns session cookie", Boolean(sessionPair), loginNote);
if (!sessionPair) process.exit(1);

const browser = await chromium.launch();
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "halo_session", value: sessionPair.slice("halo_session=".length), domain: "localhost", path: "/" }]);

const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|net::ERR|WebSocket|websocket|EventSource/i.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
// auth gate hydration may briefly overlay — wait for it to clear
await page.waitForTimeout(2500);

const gateOverlay = await page.evaluate(() => {
  const el = document.querySelector("[data-auth-gate]");
  return el ? el.getAttribute("data-state") ?? "present" : "none";
});
ok("APP: no auth gate overlay after login", gateOverlay !== "present", `gate=${gateOverlay}`);

// chart canvas present (lightweight-charts renders <canvas>)
const canvases = await page.locator("canvas").count();
ok("CHART: lightweight-charts canvas rendered", canvases >= 1, `canvases=${canvases}`);

// symbol switch to a crypto symbol → Binance live stream expected
// (via the bot config API — the chart follows the bot's symbol; UI selects
// are covered by the voice/orb overlay and flaky to click in headless)
const cfgRes = await fetch(`${BASE}/api/bot/config`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: sessionPair },
  body: JSON.stringify({ symbol: "BTCUSDT", tf: "1m" }),
});
const cfgJson = (await cfgRes.json()) as { ok?: boolean; state?: { symbol?: string; tf?: string }; error?: string };
ok("CONFIG: switched chart symbol to BTCUSDT · 1m", Boolean(cfgJson.ok && cfgJson.state?.symbol === "BTCUSDT"), cfgJson.error ?? `${cfgJson.state?.symbol}:${cfgJson.state?.tf}`);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// ── observe the live layer ─────────────────────────────────────────────
await page.waitForTimeout(4000);
const liveBadge = await page
  .getByText(/^(DERIV LIVE|BINANCE LIVE)$/, { exact: true })
  .first()
  .textContent({ timeout: 8000 })
  .catch(() => null);
ok("LIVE: source badge shows a live stream", Boolean(liveBadge), `badge=${liveBadge ?? "none"}`);

// deterministic per-tick assertion: count live bar updates flowing into the
// chart over a 12s window via the feed's debug hook
const ticks0 = await page.evaluate(() => (window as unknown as { __haloLiveFeed?: { stats: (s: string, t: string) => { updates: number } } }).__haloLiveFeed?.stats("BTCUSDT", "1m")?.updates ?? -1);
await page.waitForTimeout(12_000);
const ticks1 = await page.evaluate(() => (window as unknown as { __haloLiveFeed?: { stats: (s: string, t: string) => { updates: number } } }).__haloLiveFeed?.stats("BTCUSDT", "1m")?.updates ?? -1);
const tickDelta = ticks1 - ticks0;
ok("LIVE: per-tick bar updates flowing into the chart", tickDelta >= 4, `+${tickDelta} bar updates in 12s (≥4 expected; total=${ticks1})`);

ok("CONSOLE: no fatal page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.screenshot({ path: `${SHOT}/chart-live.png`, fullPage: false });

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
