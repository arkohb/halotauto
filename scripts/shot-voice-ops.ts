/** Visual check · JARVIS console chips + new command surface. Run: DISPLAY=:99 bun scripts/shot-voice-ops.ts */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await ctx.grantPermissions(["microphone"], { origin: URL });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  // open the console via its launcher button
  const launcher = page.locator('button[aria-label*="JARVIS" i], button[aria-label*="console" i]').first();
  if (await launcher.count()) await launcher.click().catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/home/z/my-project/download/voice-ops-console.png", fullPage: false });
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((b) => b.textContent ?? "").filter((t) => /CANCEL ORDERS|TELL A JOKE|CLOSE ALL|SCAN NOW|START EA/i.test(t)));
  console.log("new chips visible:", JSON.stringify(chips));
  await browser.close();
})().catch((e) => { console.error("crash:", e); process.exit(1); });
