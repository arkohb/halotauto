// Visual verification: long-script counter in Strategy Studio + voice engine
// selector in Settings. Run: DISPLAY=:99 bun scripts/verify-long-ui.ts
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/download";

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(3200);

  // ── Strategy Studio: paste a long script → counter must render ──
  await page.getByRole("button", { name: "Strategy Studio", exact: true }).first().click({ timeout: 8000 }).catch(async () => {
    await page.getByRole("button", { name: "Studio", exact: true }).first().click({ timeout: 8000 });
  });
  await page.waitForTimeout(2500);

  // paste a ~2,500-line generated script into the editor textarea
  const longScript = Array.from({ length: 2500 }, (_, i) => `pad${i} = ta.sma(close, ${(i % 40) + 2})`).join("\n");
  const ta = page.locator("textarea").first();
  await ta.fill(`//@version=5\nstrategy("UI Check")\n${longScript}`);
  await page.waitForTimeout(700);
  const counter = await page.getByText(/line[s]? ·/).first().textContent({ timeout: 5000 }).catch(() => null);
  console.log(`counter: ${counter?.trim() ?? "NOT FOUND"}`);
  await page.screenshot({ path: `${OUT}/verify-studio-long-counter.png` });

  // ── Settings: voice engine selector ──
  await page.getByRole("button", { name: "Settings", exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2200);
  const engineRow = await page.getByText("Voice engine", { exact: false }).first().isVisible({ timeout: 5000 }).catch(() => false);
  const natural = await page.getByText("NATURAL", { exact: false }).first().isVisible({ timeout: 3000 }).catch(() => false);
  const voiceSel = await page.getByText("Natural voice", { exact: false }).first().isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`voice engine row: ${engineRow ? "visible" : "MISSING"} · NATURAL btn: ${natural ? "visible" : "MISSING"} · natural voice picker: ${voiceSel ? "visible" : "MISSING"}`);
  await page.screenshot({ path: `${OUT}/verify-voice-engine-settings.png` });

  console.log(`page errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
  await browser.close();
  process.exit(errors.length === 0 ? 0 : 1);
})();
