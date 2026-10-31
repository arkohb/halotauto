/**
 * Confirm the trade-history table fix on a 390px viewport:
 *  1. the container actually pans horizontally (scrollLeft moves)
 *  2. the STATE column becomes visible after panning
 *  3. Strategy Lab header pills fit inside the viewport now
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const PROBE_DIR = "/home/z/my-project/scripts/.probe";
const email = readFileSync(`${PROBE_DIR}/email.txt`, "utf8").trim();
const password = readFileSync(`${PROBE_DIR}/pass.txt`, "utf8").trim();
const l = await fetch(`${BASE}/api/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: email, password }),
});
const cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
if (!l.ok || !cookie) throw new Error("probe login failed");

const browser = await chromium.launch({ headless: true, channel: "chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "halo_session", value: cookie.slice("halo_session=".length), domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(3000);
// dismiss the welcome overlay with a real (trusted) click on SKIP INTRO
await page.waitForSelector('[data-testid="welcome-skip"]', { timeout: 15000 });
await page.click('[data-testid="welcome-skip"]', { force: true });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Trade History");
  if (nav) (nav as HTMLElement).click();
});
await page.waitForTimeout(2500);

const tableTest = await page.evaluate(() => {
  // the fixed container: overflow-auto wrapper around the history table
  const table = [...document.querySelectorAll("table")].find((t) => t.textContent?.includes("STATE"));
  if (!table) return { found: false };
  const wrap = table.parentElement!;
  const st = getComputedStyle(wrap);
  const before = wrap.scrollLeft;
  wrap.scrollLeft = 99999;
  const after = wrap.scrollLeft;
  const stateTh = [...table.querySelectorAll("th")].find((t) => t.textContent === "STATE");
  const r = stateTh?.getBoundingClientRect();
  return {
    found: true,
    overflowX: st.overflowX,
    panWorks: after > before,
    scrollable: wrap.scrollWidth - wrap.clientWidth,
    stateVisibleAfterPan: r ? r.right <= window.innerWidth + 1 && r.left >= -1 : false,
    stateRight: Math.round(r?.right ?? -1),
  };
});
console.log("TABLE:", JSON.stringify(tableTest));
await page.screenshot({ path: "/home/z/my-project/scripts/audit-shots/rv2-mobile-history-panned.png" });

// lab pills
await page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Strategy Lab");
  if (nav) (nav as HTMLElement).click();
});
await page.waitForTimeout(2500);
const labTest = await page.evaluate(() => {
  const pill = [...document.querySelectorAll("span")].find((s) => s.textContent?.trim() === "∞ BARS · ANY PAIR · M1→W1");
  if (!pill) return { found: false };
  const r = pill.getBoundingClientRect();
  return { found: true, right: Math.round(r.right), fitsViewport: r.right <= window.innerWidth + 1 };
});
console.log("LAB PILL:", JSON.stringify(labTest));
await browser.close();
process.exit(tableTest.found && tableTest.panWorks && tableTest.stateVisibleAfterPan && (!labTest.found || labTest.fitsViewport) ? 0 : 1);
