/**
 * HALO UI REDESIGN E2E · every route, key controls, states, zero-error check
 * Run: DISPLAY=:99 bun scripts/ui-e2e.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const SHOT = "/home/z/my-project/download";
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["microphone"], { origin: URL });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  // ── 1. every navigation route renders with its page header ──
  const routes: { chip: string; header: string; shot: string }[] = [
    { chip: "Dashboard", header: null as unknown as string, shot: "ui-01-dashboard" }, // dashboard has welcome banner, no PageHeader
    { chip: "Market Intelligence", header: "Market Intelligence", shot: "ui-03-intel" },
    { chip: "Trading Activity", header: "Trading Activity", shot: "ui-04-activity" },
    { chip: "Risk Guardian", header: "RISK GUARDIAN", shot: "ui-05-risk" },
    { chip: "Strategy Lab", header: "STRATEGY LAB", shot: "ui-06-lab" },
    { chip: "Trade History", header: "Trade History", shot: "ui-11-history" },
    { chip: "Performance", header: "PERFORMANCE", shot: "ui-07-performance" },
    { chip: "Daily Briefing", header: "Daily Briefing", shot: "ui-12-briefing" },
    { chip: "Learning Missions", header: "Learning Missions", shot: "ui-13-learning" },
    { chip: "Settings", header: "SETTINGS", shot: "ui-10-settings" },
    { chip: "Market Scanner", header: "MARKET SCANNER", shot: "ui-02-market" },
    { chip: "Voice Command", header: "Voice Command Center", shot: "ui-14-voice" },
    { chip: "Brokers & MT5", header: "BROKERS & MT5", shot: "ui-08-brokers" },
    { chip: "Alerts", header: "ALERTS & DELIVERY", shot: "ui-09-alerts" },
  ];
  // mockup nav: active pill = azure gradient fill + white label
  const activeIsGold = async () =>
    page.evaluate(() => {
      const cur = document.querySelector('button[aria-current="page"]');
      if (!cur) return false;
      const st = (cur as HTMLElement).style;
      const label = cur.querySelector("span:last-child") as HTMLElement | null;
      const filled = /gradient|46, 204, 255|38, 146, 255/.test(st.background + st.backgroundImage + st.boxShadow);
      const bright = !!label && ["rgb(255, 255, 255)", "white", "rgb(236, 246, 255)"].includes(label.style.color);
      return filled || bright;
    });

  for (const r of routes) {
    await page.evaluate((chip) => {
      const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === chip);
      (nav as HTMLElement)?.click();
    }, r.chip);
    await page.waitForTimeout(2600);
    const body = await page.evaluate(() => document.body.innerText);
    const headerOk = r.header === null ? true : body.includes(r.header);
    ok(`ROUTE ${r.chip}: renders${r.header ? ` + PageHeader "${r.header}"` : " (welcome banner)"}`, headerOk, headerOk ? "" : "header text missing");
    ok(`ROUTE ${r.chip}: active-tab treatment (aria-current + azure pill)`, await activeIsGold());
    await page.screenshot({ path: `${SHOT}/${r.shot}.png` });
  }

  // ── 2. key interactive controls survived the redesign ──
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Market Scanner");
    (nav as HTMLElement)?.click();
  });
  await page.waitForTimeout(2200);
  const scannerBits = await page.evaluate(() => ({
    scanNow: !![...document.querySelectorAll("button")].find((x) => /SCAN NOW/i.test(x.textContent ?? "")),
    addSymbol: document.body.innerText.includes("ADD SYMBOL"),
    watchlist: document.body.innerText.includes("WATCHLIST"),
  }));
  ok("CONTROLS Market: SCAN NOW + ADD SYMBOL + WATCHLIST present", scannerBits.scanNow && scannerBits.addSymbol && scannerBits.watchlist, JSON.stringify(scannerBits));

  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Dashboard");
    (nav as HTMLElement)?.click();
  });
  await page.waitForTimeout(2600);
  // mockup-01 dashboard composition: deck · AI core · risk · market overview ·
  // account summary · recent trades · orb canvas · EA pill
  // (Daily Briefing is its own dedicated view since the mockup redesign)
  const dashBits = await page.evaluate(() => ({
    deck: document.body.innerText.includes("CONTROL DECK"),
    aiCore: document.body.innerText.includes("HALO AI"),
    riskCard: document.body.innerText.includes("RISK GUARDIAN"),
    overview: document.body.innerText.includes("MARKET OVERVIEW") || document.body.innerText.includes("GOLD · LIVE"),
    account: document.body.innerText.includes("ACCOUNT SUMMARY") || document.body.innerText.includes("EQUITY"),
    orbCanvas: !!document.querySelector("canvas"),
    eaPill: /EA (ON|OFF)/.test(document.body.innerText),
  }));
  ok("CONTROLS Dashboard: deck + AI core + risk + overview + account + orb canvas + EA pill", Object.values(dashBits).every(Boolean), JSON.stringify(dashBits));

  // voice console opens + mic button (drag/re-verify voice flow intact)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Open HALO console"));
    (b as HTMLElement)?.click();
  });
  await page.waitForTimeout(1600);
  const consoleOpen = await page.evaluate(() => !!document.querySelector('[aria-label="HALO JARVIS console"]'));
  ok("CONTROLS Voice: JARVIS console opens", consoleOpen);
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('#halo-jarvis-root button, [aria-label="HALO JARVIS console"] button')].find((x) => /close/i.test(x.getAttribute("aria-label") ?? ""));
    (x as HTMLElement)?.click();
  });
  await page.waitForTimeout(800);

  // ── 3. theme tokens actually compiled ──
  const cssOk = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      bg: cs.backgroundColor === "rgb(2, 11, 26)",
      tokens: rootStyle.getPropertyValue("--hx-cyan").trim() === "#2eccff" && rootStyle.getPropertyValue("--hx-teal").trim() === "#35e0c8",
      shadcnCyan: rootStyle.getPropertyValue("--primary").trim() === "#2eccff", // --primary resolves to the azure rebrand in :root AND .dark
    };
  });
  ok("THEME: navy body + --hx tokens + shadcn primary rebranded", cssOk.bg && cssOk.tokens && cssOk.shadcnCyan, JSON.stringify(cssOk));

  // ── 4. honest states exist (intel panel loading/verify + scanner states) ──
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Market Intelligence");
    (nav as HTMLElement)?.click();
  });
  await page.waitForTimeout(3500);
  const intelBits = await page.evaluate(() => ({
    calendar: document.body.innerText.includes("ECONOMIC CALENDAR"),
    headlines: document.body.innerText.includes("MARKET HEADLINES"),
    quotes: document.body.innerText.includes("LIVE QUOTES"),
  }));
  ok("INTEL: calendar + headlines + quotes sections render", Object.values(intelBits).every(Boolean), JSON.stringify(intelBits));

  // ── 5. trading state integrity ──
  const bot = await page.evaluate(async () => {
    const r = await fetch("/api/bot/state", { cache: "no-store" });
    const j = await r.json();
    return { enabled: j.enabled, symbol: j.symbol, tf: j.tf, src: j.feed?.source, cfgKeys: Object.keys(j.config ?? {}).length };
  });
  ok("TRADING: bot state intact (symbol/tf/config)", bot.symbol === "XAUUSD" && bot.tf === "1h" && bot.cfgKeys > 10, JSON.stringify(bot));
  const alertsTest = await page.evaluate(async () => {
    const r = await fetch("/api/alerts/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json();
    return { status: r.status, channels: Object.keys(j.result ?? {}) };
  });
  ok("ALERTS TEST: /api/alerts/test responds honestly", alertsTest.status === 200 && alertsTest.channels.length === 3, JSON.stringify(alertsTest));

  ok("NO PAGE ERRORS: zero uncaught exceptions across all routes", errors.length === 0, errors.join(" | ").slice(0, 160));

  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => {
  console.error(results.join("\n"));
  console.error("SCRIPT-ERROR:", String(e).slice(0, 300));
  process.exit(1);
});
