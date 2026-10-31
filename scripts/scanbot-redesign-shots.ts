/**
 * SCANNER BOT DASHBOARD · redesign comparison shots
 * Captures the Scanner Bot view at desktop / tablet / mobile with the live
 * scanner state, for pixel comparison against the owner's mockup image.
 * Run: DISPLAY=:99 bun scripts/scanbot-redesign-shots.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const URL = "http://localhost:3000";
const OUT = "/home/z/my-project/scripts/redesign-shots";
const cookie = readFileSync("/tmp/probe_cookie.txt", "utf8").trim();

const viewports = [
  { tag: "desktop", width: 1440, height: 900 },
  { tag: "tablet", width: 768, height: 1024 },
  { tag: "mobile", width: 390, height: 844 },
];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const errors: string[] = [];
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${vp.tag}: ${String(e).slice(0, 160)}`));
    // session cookie straight into the licensed app
    const [name, value] = cookie.split("=");
    await ctx.addCookies([{ name, value, url: URL }]);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5200);
    // dismiss the welcome intro — ESC is the always-available skip channel
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    const overlayGone = await page.evaluate(() => !document.querySelector('[data-testid="welcome-skip"]'));
    if (!overlayGone) {
      const skip = await page.$('[data-testid="welcome-skip"]');
      await skip?.click();
      await page.waitForTimeout(2000);
    }
    // open the Scanner Bot view from the existing nav
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const nav = btns.find((x) => x.textContent?.trim() === "Scanner Bot");
      if (nav) {
        (nav as HTMLElement).click();
        return true;
      }
      return false;
    });
    await page.waitForTimeout(4200);
    await page.screenshot({ path: `${OUT}/${vp.tag}-scanner-bot.png`, fullPage: false });
    // full page too (voice panel below the card)
    await page.screenshot({ path: `${OUT}/${vp.tag}-scanner-bot-full.png`, fullPage: true });
    console.log(`${vp.tag}: nav=${clicked} shot saved`);
    await ctx.close();
  }
  await browser.close();
  console.log("pageerrors:", errors.length ? errors.join(" | ") : "none");
})();
