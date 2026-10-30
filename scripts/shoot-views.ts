// Visual verification: screenshot every HALO view via the real nav rail.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/scripts/shots";
const VIEWS = [
  ["terminal", "Dashboard"],
  ["intel", "Market Intelligence"],
  ["activity", "Trading Activity"],
  ["risk", "Risk Guardian"],
  ["backtest", "Strategy Lab"],
  ["trade-history", "Trade History"],
  ["performance", "Performance"],
  ["briefing", "Daily Briefing"],
  ["learning", "Learning Missions"],
  ["settings", "Settings"],
  ["scanner", "Market Scanner"],
  ["voice", "Voice Command"],
  ["brokers", "Brokers"],
  ["alerts", "Alerts"],
];

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3500);

  for (const [id, label] of VIEWS) {
    try {
      // click the nav rail button by its visible label
      await page.getByRole("button", { name: label, exact: true }).first().click({ timeout: 8000 });
      await page.waitForTimeout(2600);
      await page.screenshot({ path: `${OUT}/view-${id}.png` });
      console.log(`OK  ${id}`);
    } catch (e) {
      console.log(`FAIL ${id}: ${e.message.split("\n")[0]}`);
      try {
        await page.screenshot({ path: `${OUT}/view-${id}-fail.png` });
      } catch {}
    }
  }

  console.log("---- console/page errors ----");
  console.log(errors.length ? errors.slice(0, 20).join("\n") : "(none)");
  await browser.close();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
