import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: "/home/z/my-project/scripts/shots/mobile-dash.png", fullPage: false });
// scroll a bit for row 2
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(600);
await page.screenshot({ path: "/home/z/my-project/scripts/shots/mobile-dash-2.png" });
console.log("OK mobile");
await browser.close();
