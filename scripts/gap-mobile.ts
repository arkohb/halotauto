// Mobile 390px check of the rebuilt views
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const run = async () => {
  const browser = await chromium.launch({ headless: false, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(6000);

  // activity view
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Trading Activity");
    (nav as HTMLElement)?.click();
  });
  await page.waitForTimeout(2500);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("activity overflowX px:", overflowX);
  await page.screenshot({ path: "/home/z/my-project/scripts/shots/gap-mobile-activity.png" });

  // performance view
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Performance");
    (nav as HTMLElement)?.click();
  });
  await page.waitForTimeout(2000);
  const overflowX2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log("performance overflowX px:", overflowX2);
  await page.screenshot({ path: "/home/z/my-project/scripts/shots/gap-mobile-performance.png" });

  console.log("errors:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
};
run().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
