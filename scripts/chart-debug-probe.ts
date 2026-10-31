// debug probe: what does the terminal page actually render?
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
});
const setCookie = loginRes.headers.getSetCookie?.() ?? [];
const sessionPair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
if (!sessionPair) {
  console.error("login failed", await loginRes.text());
  process.exit(1);
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "halo_session", value: sessionPair.slice("halo_session=".length), domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 300), "\nSTACK:", (e.stack ?? "").slice(0, 1200)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 300));
});
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4000);
// switch to BTCUSDT 1m like the real E2E — reproduces the stream-vs-poll race
const cfgRes = await fetch(`${BASE}/api/bot/config`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: sessionPair },
  body: JSON.stringify({ symbol: "BTCUSDT", tf: "1m" }),
});
console.log("cfg:", (await cfgRes.text()).slice(0, 120));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(15000);
const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
console.log("---BODY TEXT---");
console.log(text);
console.log("--- canvases:", await page.locator("canvas").count());
console.log("--- selects:", await page.locator("[role='combobox']").count());
await page.screenshot({ path: "/tmp/chart-e2e/debug.png" });
await browser.close();
