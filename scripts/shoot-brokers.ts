import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: "Brokers & MT5", exact: true }).first().click({ timeout: 8000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: "/home/z/my-project/scripts/shots/view-brokers.png" });
console.log("OK brokers");
await browser.close();
