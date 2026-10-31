/**
 * welcome-dismiss probe · does the JARVIS welcome overlay re-appear after
 * the user dismisses it? Load → wait for dialog → dismiss (skip) → sample
 * dialog presence every second for 20s.
 */
import { chromium, type BrowserContext } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";

let sessionPair: string | undefined;
for (let i = 0; i < 3 && !sessionPair; i++) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
  });
  const sc = r.headers.getSetCookie?.() ?? [];
  sessionPair = sc.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  if (!sessionPair) await new Promise((res) => setTimeout(res, 15000));
}
if (!sessionPair) {
  console.error("no session");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "halo_session", value: sessionPair.slice("halo_session=".length), domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });

const dialogSel = 'div[role="dialog"][aria-label*="welcome" i]';
let firstSeen = -1;
for (let t = 0; t < 15; t++) {
  const n = await page.locator(dialogSel).count();
  if (n > 0) {
    firstSeen = t;
    break;
  }
  await page.waitForTimeout(1000);
}
console.log(`welcome first appeared at ~${firstSeen}s`);

const skip = page.locator('[data-testid="welcome-skip"]');
if ((await skip.count()) > 0) {
  await skip.click({ timeout: 3000 }).catch(async () => page.keyboard.press("Escape"));
}
await page.waitForTimeout(800);
console.log("dismissed:", (await page.locator(dialogSel).count()) === 0);

for (let t = 1; t <= 20; t++) {
  const n = await page.locator(dialogSel).count();
  if (n > 0) {
    console.log(`RE-APPEARED after ${t}s ✗`);
    await page.screenshot({ path: "/tmp/venue-e2e/welcome-again.png" });
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(1000);
}
console.log("stayed dismissed for 20s ✓");
await browser.close();
