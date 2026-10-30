/** probe: what exactly happens around SKIP on the welcome overlay */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const DIALOG = '[role="dialog"][aria-label*="welcome"]';

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(`
    (() => { Date.prototype.getHours = function () { return 9; }; })();
  `);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("halo-voice") || t.includes("halo-welcome")) console.log("[console]", t.slice(0, 160));
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const tAppear = Date.now();
  await page.waitForSelector(DIALOG, { timeout: 20000 });
  console.log("dialog appeared at", Date.now() - tAppear, "ms after goto");

  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      const dl = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute("aria-label"));
      const btns = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((t) => t && /SKIP|ENTER|PLAY|ENABLE/.test(t));
      return { dl, btns };
    });
    console.log(`t+${i * 300}:`, JSON.stringify(info));
  }

  const t0 = Date.now();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("SKIP INTRO"));
    (b as HTMLElement)?.click();
  });
  console.log("clicked SKIP");
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label*="welcome"]');
      const btns = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((t) => t && /SKIP|ENTER|PLAY/.test(t));
      return { present: !!d, btns };
    });
    if (!st.present) {
      console.log("dialog DETACHED at", Date.now() - t0, "ms after click");
      break;
    }
    if (i % 3 === 0) console.log(`t+${i * 200}: still present, btns=`, JSON.stringify(st.btns));
  }
  await browser.close();
})();
