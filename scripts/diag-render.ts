// Quick diagnostic: dashboard render + console errors + theme check
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const run = async () => {
  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(6000);
  const diag = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const tokens = getComputedStyle(document.documentElement).getPropertyValue("--hx-cyan").trim();
    const header = document.body.innerText.slice(0, 400);
    return { bg, tokens, headerStart: header.replace(/\n+/g, " | ").slice(0, 300) };
  });
  console.log("DIAG:", JSON.stringify(diag, null, 1));
  console.log("ERRORS:", errors.length ? errors.slice(0, 8).join("\n") : "none");
  await page.screenshot({ path: "/home/z/my-project/scripts/shots/diag-dash.png" });
  await browser.close();
};
run().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
