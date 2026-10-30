// checkout-404-probe · identify exactly which resource 404s on /checkout
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const URL = "http://localhost:3000";
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const ctx = await browser.newContext();
  const loginRes = await fetch(`${URL}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: process.env.HALO_E2E_EMAIL, password: process.env.HALO_E2E_PASSWORD, remember: true }),
  });
  const sc = (loginRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const pair = sc.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  await ctx.addCookies([{ name: "halo_session", value: pair!.slice("halo_session=".length), domain: "localhost", path: "/" }]);
  const page = await ctx.newPage();
  page.on("response", (r) => { if (r.status() >= 400) console.log(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  await page.goto(`${URL}/checkout`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log("── page text ──\n" + txt.replace(/\n+/g, " | "));
  await browser.close();
})();
