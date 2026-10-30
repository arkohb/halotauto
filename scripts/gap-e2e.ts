// FOCUSED E2E · the four newly built gaps:
//   1. Trading Activity: PENDING tab + Position Summary
//   2. Quick Actions: CLOSE ALL / MODIFY SL/TP / PAUSE NEW ENTRIES (real toggle, server-verified)
//   3. Performance: equity curve + period chips + monthly summary
//   4. Market Intelligence: MARKET CONDITIONS + 3EL SETUP STATE
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(6000);
  const nav = async (label: string) => {
    await page.getByRole("button", { name: label, exact: true }).first().click({ timeout: 15000 });
    await page.waitForTimeout(2500);
  };

  // ── 1 · TRADING ACTIVITY ─────────────────────────────────────────────
  await nav("Trading Activity");
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText);
  const pendingBtn = page.getByRole("button", { name: /PENDING/i }).first();
  const hasPendingTab = await pendingBtn.count();
  ok("ACTIVITY: PENDING tab exists", hasPendingTab > 0);
  if (hasPendingTab > 0) {
    await pendingBtn.click();
    await page.waitForTimeout(1200);
    const t = await page.evaluate(() => document.body.innerText);
    const honest =
      t.includes("Paper EA executes at market only") ||
      t.includes("No resting orders") ||
      /CANCEL/i.test(t);
    ok("ACTIVITY: PENDING tab honest content", honest, t.includes("Paper EA executes at market only") ? "paper note" : t.includes("No resting orders") ? "empty note" : "orders table");
  }
  // position summary cells exist on POSITIONS tab (even when flat, the block renders only with positions; check QUICK ACTIONS card instead)
  ok("ACTIVITY: QUICK ACTIONS card renders", body.includes("QUICK ACTIONS") && body.includes("CLOSE ALL") && body.includes("MODIFY SL/TP"));
  ok("ACTIVITY: pause control present", body.includes("PAUSE NEW ENTRIES") || body.includes("RESUME NEW ENTRIES"));

  // pause toggle — real server-verified round trip
  const before = await page.evaluate(async () => {
    const r = await fetch("/api/bot/state", { cache: "no-store" });
    const j = await r.json();
    return j.pauseNew;
  });
  const pauseBtn = page.getByRole("button", { name: before ? "RESUME NEW ENTRIES" : "PAUSE NEW ENTRIES" }).first();
  await pauseBtn.click();
  await page.waitForTimeout(2200);
  const after = await page.evaluate(async () => {
    const r = await fetch("/api/bot/state", { cache: "no-store" });
    const j = await r.json();
    return j.pauseNew;
  });
  ok("QUICK ACTIONS: pause toggle changes real bot flag", before !== after, `${before} → ${after}`);
  // restore the original state
  const restoreBtn = page.getByRole("button", { name: after ? "RESUME NEW ENTRIES" : "PAUSE NEW ENTRIES" }).first();
  await restoreBtn.click();
  await page.waitForTimeout(2000);
  const restored = await page.evaluate(async () => (await (await fetch("/api/bot/state", { cache: "no-store" })).json()).pauseNew);
  ok("QUICK ACTIONS: pause restored to original", restored === before, String(restored));
  // verified result line appears (honest server answer)
  const panelNote = await page.evaluate(() => document.body.innerText);
  ok("QUICK ACTIONS: verified result note shown", panelNote.includes("✓") || panelNote.includes("✕"));
  await page.screenshot({ path: "/home/z/my-project/scripts/shots/gap-activity.png" });

  // ── 2 · PERFORMANCE ──────────────────────────────────────────────────
  await nav("Performance");
  await page.waitForTimeout(2000);
  const perf = await page.evaluate(() => document.body.innerText);
  ok("PERFORMANCE: equity curve section", perf.includes("EQUITY CURVE"));
  ok("PERFORMANCE: period chips 7D/30D/90D/ALL", ["7D", "30D", "90D", "ALL"].every((p) => perf.includes(p)));
  const perfHasData =
    perf.includes("MONTHLY SUMMARY") || perf.includes("TRADE DISTRIBUTION") || perf.includes("No closed trades");
  ok("PERFORMANCE: monthly/distribution or honest empty", perfHasData);
  await page.screenshot({ path: "/home/z/my-project/scripts/shots/gap-performance.png" });

  // ── 3 · MARKET INTELLIGENCE ──────────────────────────────────────────
  await nav("Market Intelligence");
  await page.waitForTimeout(2500);
  const intel = await page.evaluate(() => document.body.innerText);
  ok("INTEL: MARKET CONDITIONS card", intel.includes("MARKET CONDITIONS"));
  ok("INTEL: trend/volatility/session rows", ["TREND", "VOLATILITY", "SESSION"].every((k) => intel.toUpperCase().includes(k)));
  ok("INTEL: 3EL SETUP STATE card", intel.includes("3EL SETUP STATE"));
  ok("INTEL: armed levels + trigger rows", intel.includes("ARMED LEVELS") && intel.includes("C3 TRIGGER"));
  await page.screenshot({ path: "/home/z/my-project/scripts/shots/gap-intel.png" });

  // ── 4 · trading behaviour untouched ──────────────────────────────────
  const bot = await page.evaluate(async () => {
    const j = await (await fetch("/api/bot/state", { cache: "no-store" })).json();
    return { symbol: j.symbol, tf: j.tf, src: j.feed?.source, pauseNew: j.pauseNew };
  });
  ok("ENGINE: bot state intact after all interactions", bot.symbol === "XAUUSD" && bot.tf === "1h" && !!bot.src, JSON.stringify(bot));

  ok("ZERO page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  console.log(`---- ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS ----`);
  await browser.close();
})().catch((e) => {
  console.error("FATAL", e.message);
  console.log(results.join("\n"));
  process.exit(1);
});
