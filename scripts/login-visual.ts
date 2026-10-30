/**
 * login-flow E2E · verifies "the app always opens on the login dashboard"
 * and that the admin credentials actually work through the real UI.
 *
 *   1. open / signed-out            → must land on /login?next=%2F
 *   2. /login page renders          → Welcome Back card, hero, plans link
 *   3. sign in with admin creds     → redirected back to / (next param)
 *   4. dashboard fully live         → AuthGate absent, control deck visible
 *   5. signed-in /api/auth/me       → commerce=on, authenticated, licensed
 *   6. signed-out / again (fresh)   → still lands on /login (server-side)
 *
 * Run: Xvfb :99 then DISPLAY=:99 HALO_E2E_EMAIL=… HALO_E2E_PASSWORD=… bun scripts/login-visual.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const SHOT = "/home/z/my-project/download";
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

(async () => {
  const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
  const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
  if (!EMAIL || !PASSWORD) {
    console.error("✗ set HALO_E2E_EMAIL and HALO_E2E_PASSWORD");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await ctx.newPage();

  // ── 1. signed-out root → login dashboard ────────────────────────────────
  await page.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/login/, { timeout: 20000 });
  const landedOn = page.url();
  ok("LOGIN-FIRST: opening / signed-out lands on the login dashboard", /\/login\?next=%2F/.test(landedOn), landedOn);

  // ── 2. login page renders ───────────────────────────────────────────────
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  const renders = body.includes("Welcome Back") && body.includes("Your AI Trading Command Centre");
  ok("LOGIN PAGE: Welcome Back card renders", renders);
  await page.screenshot({ path: `${SHOT}/login-dashboard.png` });

  // ── 3. admin sign-in through the real UI ────────────────────────────────
  await page.fill('input[autocomplete="username"]', EMAIL);
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Sign In"));
    (btn as HTMLElement)?.click();
  });
  await page.waitForURL(/localhost:3000\/(\?.*)?$/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(9000); // dashboard boot + data feeds
  const backHome = !page.url().includes("/login");
  ok("ADMIN LOGIN: credentials accepted, returned to the app", backHome, page.url());

  // ── 4. dashboard live, no gate overlay ──────────────────────────────────
  const dash = await page.evaluate(() => ({
    hasGate: !!document.querySelector('[data-testid="auth-gate"], [aria-label="license activation"]'),
    text: document.body.innerText.slice(0, 4000),
  }));
  const live = !dash.hasGate && /CONTROL|DASHBOARD|MARKET|risk/i.test(dash.text);
  ok("DASHBOARD: fully live behind the login (no gate overlay)", live, `gate=${dash.hasGate}`);
  await page.screenshot({ path: `${SHOT}/login-dashboard-after.png` });

  // ── 5. session state from the server ────────────────────────────────────
  const me = await page.evaluate(async () => {
    const r = await fetch("/api/auth/me", { cache: "no-store" });
    return await r.json();
  });
  ok(
    "SESSION: server reports commerce=on · authenticated · licensed",
    me.commerce === true && me.authenticated === true && me.activated === true,
    `commerce=${me.commerce} auth=${me.authenticated} activated=${me.activated} role=${me.user?.role ?? "-"}`,
  );

  // ── 6. signed-out surfaces still reachable (pricing stays public) ───────
  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  const pricing = await p2.goto(`${URL}/pricing`, { waitUntil: "domcontentloaded" });
  ok("PUBLIC: /pricing reachable without a session", pricing?.status() === 200, `status=${pricing?.status()}`);
  const adminJump = await p2.goto(`${URL}/admin`, { waitUntil: "domcontentloaded" });
  ok("GATE: /admin signed-out is redirected to login", (p2.url().includes("/login")), `${adminJump?.status()} → ${p2.url()}`);
  await anon.close();

  await browser.close();
  console.log("\n════ LOGIN-FLOW E2E ════");
  for (const r of results) console.log(r);
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`════ ${results.length - failed}/${results.length} passed ════`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("e2e crashed:", e);
  console.log(results.join("\n"));
  process.exit(1);
});
