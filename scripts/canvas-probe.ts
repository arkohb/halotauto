import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
let sessionPair: string | undefined;
for (let i = 0; i < 5 && !sessionPair; i++) {
  const loginRes = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }) });
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  sessionPair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  if (!sessionPair) {
    console.log(`login attempt ${i + 1} failed: ${loginRes.status} ${(await loginRes.text()).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
}
if (!sessionPair) process.exit(1);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "halo_session", value: sessionPair.slice("halo_session=".length), domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("canvas")).map((c) => {
    const r = (c as HTMLCanvasElement).getBoundingClientRect();
    return { w: (c as HTMLCanvasElement).width, h: (c as HTMLCanvasElement).height, cssW: Math.round(r.width), cssH: Math.round(r.height) };
  });
});
console.log(JSON.stringify(info));
await browser.close();
