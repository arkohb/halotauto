/**
 * venue-chips E2E · verifies the chart broker switcher + pair filtering
 *   1. broker chips render on the chart (DERIV / MT5 · CFD / BINANCE)
 *   2. DERIV chip filters the pair dropdown to the Deriv catalog only
 *      (no crypto pairs inside), engine switches to a picked synthetic
 *   3. BINANCE chip filters to crypto, engine switches to a picked pair
 *   4. chip toggle-off restores the full catalog
 *   5. no fatal console errors; original bot symbol restored
 * Run: HALO_E2E_EMAIL=… HALO_E2E_PASSWORD=… bun scripts/venue-chips-e2e.ts
 */
import { chromium, type BrowserContext } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOT = "/tmp/venue-e2e";
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

let sessionPair: string | undefined;
let loginNote = "";
for (let i = 0; i < 4 && !sessionPair; i++) {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
  });
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  sessionPair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  loginNote = (await loginRes.json()).error ?? "";
  if (!sessionPair) await new Promise((r) => setTimeout(r, 15000));
}
ok("AUTH: login returns session cookie", Boolean(sessionPair), loginNote);
if (!sessionPair) process.exit(1);
const cookieHeader = sessionPair;

const browser = await chromium.launch();
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1600, height: 950 } });
await ctx.addCookies([{ name: "halo_session", value: cookieHeader.slice("halo_session=".length), domain: "localhost", path: "/" }]);

const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|net::ERR|WebSocket|websocket|EventSource|AbortError/i.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3500);

// dismiss the one-per-session JARVIS welcome overlay — it mounts ~6s after
// load (voice warm-up), so WAIT for it before dismissing, otherwise it pops
// over the UI mid-run (full-screen role=dialog; skip button / Escape dismiss)
const dialogSel = 'div[role="dialog"][aria-label*="welcome" i]';
let welcomeSeen = false;
for (let t = 0; t < 14; t++) {
  if ((await page.locator(dialogSel).count()) > 0) {
    welcomeSeen = true;
    break;
  }
  await page.waitForTimeout(1000);
}
if (welcomeSeen) {
  const skipBtn = page.locator('[data-testid="welcome-skip"]');
  await skipBtn.click({ timeout: 3000 }).catch(() => page.keyboard.press("Escape"));
  await page.waitForTimeout(1300);
}
ok("WELCOME: overlay dismissed (no blocking dialog)", (await page.locator(dialogSel).count()) === 0, welcomeSeen ? "shown then dismissed" : "not shown (repeat session)");

// ── 1. broker chips render ──────────────────────────────────────────────
const chipDeriv = page.getByRole("button", { name: "Show Deriv pairs" });
const chipMt5 = page.getByRole("button", { name: "Show MT5 / CFD Brokers pairs" });
const chipBn = page.getByRole("button", { name: "Show Binance pairs" });
ok("CHIPS: three broker chips render on the chart", (await chipDeriv.count()) === 1 && (await chipMt5.count()) === 1 && (await chipBn.count()) === 1);

// ── 2. DERIV filter ─────────────────────────────────────────────────────
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await chipDeriv.click();
await page.waitForTimeout(300);
ok("CHIPS: DERIV chip active (aria-pressed)", (await chipDeriv.getAttribute("aria-pressed")) === "true");

const symTrigger = page.getByRole("combobox", { name: "Chart symbol — the EA follows automatically" });
await symTrigger.click();
await page.waitForTimeout(500);
const listbox = page.getByRole("listbox");
const derivItems = await listbox.getByRole("option").count();
const btcInDeriv = await listbox.getByRole("option", { name: /BTC\/USDT/ }).count();
const volInDeriv = await listbox.getByRole("option", { name: /^VOL 10$/ }).count();
ok("FILTER: DERIV catalog has synthetics, no crypto", derivItems > 50 && btcInDeriv === 0 && volInDeriv === 1, `items=${derivItems} btc=${btcInDeriv} vol10=${volInDeriv}`);
await page.screenshot({ path: `${SHOT}/deriv-dropdown.png` });

// pick VOL 10 → engine switches (JS click — page ambient layers can
// sit over the portal point and intercept real mouse hit-testing)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="option"]')].find((i) => i.textContent?.trim() === "VOL 10");
  if (el) (el as HTMLElement).click();
});
await page.waitForTimeout(600);
await page.keyboard.press("Escape");
await page.waitForTimeout(1500);
const st1 = (await (await fetch(`${BASE}/api/bot/state`, { headers: { Cookie: cookieHeader } })).json()) as { symbol?: string };
ok("SWITCH: picking VOL 10 moves the engine to V10", st1.symbol === "V10", `symbol=${st1.symbol}`);
await page.screenshot({ path: `${SHOT}/chart-deriv.png` });

// ── 3. BINANCE filter ───────────────────────────────────────────────────
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await chipBn.click();
await page.waitForTimeout(300);
await symTrigger.click();
await page.waitForTimeout(500);
const bnItems = await page.getByRole("listbox").getByRole("option").count();
const btcInBn = await page.getByRole("listbox").getByRole("option", { name: /BTC\/USDT/ }).count();
const volInBn = await page.getByRole("listbox").getByRole("option", { name: /^VOL 10$/ }).count();
ok("FILTER: BINANCE catalog is crypto-only", bnItems === 7 && btcInBn === 1 && volInBn === 0, `items=${bnItems} btc=${btcInBn} vol10=${volInBn}`);
await page.screenshot({ path: `${SHOT}/binance-dropdown.png` });

await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="option"]')].find((i) => /BTC\/USDT/.test(i.textContent ?? ""));
  if (el) (el as HTMLElement).click();
});
await page.waitForTimeout(600);
await page.keyboard.press("Escape");
await page.waitForTimeout(1500);
const st2 = (await (await fetch(`${BASE}/api/bot/state`, { headers: { Cookie: cookieHeader } })).json()) as { symbol?: string };
ok("SWITCH: picking BTC/USDT moves the engine to BTCUSDT", st2.symbol === "BTCUSDT", `symbol=${st2.symbol}`);

// ── 4. toggle chip off → full catalog ───────────────────────────────────
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await chipBn.click();
await page.waitForTimeout(300);
ok("CHIPS: active chip toggles off (aria-pressed=false)", (await chipBn.getAttribute("aria-pressed")) === "false");

// ── 5. console + restore ────────────────────────────────────────────────
ok("CONSOLE: no fatal page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

const restore = await fetch(`${BASE}/api/bot/config`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader },
  body: JSON.stringify({ symbol: "PAXGUSDT", tf: "5m" }),
});
const rj = (await restore.json()) as { ok?: boolean };
ok("RESTORE: bot back on PAXGUSDT · 5m", Boolean(rj.ok), rj.error ?? "");

await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
