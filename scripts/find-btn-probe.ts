import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3000";
const PROBE = "/home/z/my-project/scripts/.probe";
const email = readFileSync(`${PROBE}/email.txt`, "utf8").trim();
const password = readFileSync(`${PROBE}/pass.txt`, "utf8").trim();
const l = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
const cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies([{ name: "halo_session", value: cookie.slice("halo_session=".length), domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /get started|let.s go|begin|continue|skip|enter/i.test(x.textContent ?? "")); if (b) (b as HTMLElement).click(); });
await page.waitForTimeout(800);
await page.evaluate(() => { const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Settings"); if (nav) (nav as HTMLElement).click(); });
await page.waitForTimeout(2800);
const out = await page.evaluate(() => {
  const res: string[] = [];
  for (const el of Array.from(document.querySelectorAll("button"))) {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (st.whiteSpace === "nowrap" && r.width > 350) {
      const chain: string[] = [];
      let p: HTMLElement | null = el.parentElement;
      while (p && chain.length < 6) { chain.push(`<${p.tagName.toLowerCase()} class="${String(p.className).slice(0, 60)}">`); p = p.parentElement; }
      res.push(`BTN w=${Math.round(r.width)} txt="${(el.textContent ?? "").trim().slice(0, 60)}" chain=${chain.join(" > ")}`);
    }
  }
  return res;
});
console.log(out.join("\n"));
await browser.close();
