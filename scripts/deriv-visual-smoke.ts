// Visual smoke: terminal renders with the Deriv catalog + symbol dropdown works.
import { chromium } from "playwright";

const URL = process.env.HALO_URL ?? "http://localhost:3000";
const EMAIL = process.env.HALO_E2E_EMAIL ?? "beamark54@gmail.com";
const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "HALO-cJE4-SnYV-26";

const loginRes = await fetch(`${URL}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
});
if (!loginRes.ok) {
  console.error("login failed", loginRes.status);
  process.exit(1);
}
const setCookies = (loginRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
const sessionPair = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
if (!sessionPair) {
  console.error("no session cookie");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1680, height: 950 } });
await ctx.addCookies([{ name: "halo_session", value: sessionPair.split("=")[1], domain: "localhost", path: "/" }]);

const page = await ctx.newPage();
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message.slice(0, 160)}`));

await page.goto(`${URL}/`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4000);

// dismiss the JARVIS personalized-welcome overlay if it is up
const welcome = page.locator('div[aria-label="HALO personalized welcome"]');
try {
  await welcome.waitFor({ state: "visible", timeout: 8000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  if (await welcome.isVisible().catch(() => false)) {
    const btn = welcome.locator("button").last();
    if (await btn.count()) await btn.click({ timeout: 4000 }).catch(() => {});
  }
  await welcome.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  console.log("welcome overlay dismissed");
} catch {
  console.log("welcome overlay not shown");
}
await page.waitForTimeout(800);

// open the header symbol dropdown
const trigger = page.locator('[aria-label="Trading symbol"]').first();
await trigger.click();
await page.waitForTimeout(1200);
const body = await page.locator("body").innerText();
const hasSynthGroup = body.includes("Deriv · Synthetic Indices");
const hasV75 = body.includes("VOL 75");
const hasBoom = body.includes("BOOM 1000");
const hasIdx = body.includes("Deriv · Stock Indices & Energy");
console.log(`dropdown: synthGroup=${hasSynthGroup} v75=${hasV75} boom1000=${hasBoom} indicesGroup=${hasIdx}`);

// select V75 from the dropdown
await page.getByRole("option", { name: "VOL 75", exact: true }).first().click();
await page.waitForTimeout(5000);
const state = await page.evaluate(async () => {
  const r = await fetch("/api/bot/state", { cache: "no-store" });
  return (await r.json()) as { symbol?: string; feed?: { source?: string } };
});
console.log("after select: symbol =", state?.symbol, "feed =", state?.feed?.source);

await page.screenshot({ path: "download/deriv-v75-terminal.png", fullPage: false });

// restore symbol
await page.evaluate(async () => {
  await fetch("/api/bot/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "PAXGUSDT" }),
  });
});

const realErrors = errors.filter((e) => !e.includes("favicon") && !e.includes("net::") && !e.includes("404"));
console.log("console errors (filtered):", realErrors.length);
realErrors.slice(0, 6).forEach((e) => console.log("  •", e));

await browser.close();
const ok = hasSynthGroup && hasV75 && hasBoom && hasIdx && state?.symbol === "V75" && realErrors.length === 0;
console.log(ok ? "VISUAL SMOKE OK" : "VISUAL SMOKE FAILED");
process.exit(ok ? 0 : 1);
