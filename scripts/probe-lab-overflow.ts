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
await page.evaluate(() => { const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Strategy Lab"); if (nav) (nav as HTMLElement).click(); });
await page.waitForTimeout(3200);
const out = await page.evaluate(() => {
  const lines: string[] = [];
  lines.push(`docScrollW=${document.documentElement.scrollWidth} bodyScrollW=${document.body.scrollWidth}`);
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (!r) continue;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") continue;
    if (r.right > 392 && r.width > 30) {
      const kids = Array.from(el.children).filter((c) => { const cr = (c as HTMLElement).getBoundingClientRect?.(); return cr && cr.right > 392; }).length;
      if (kids === 0) {
        lines.push(`LEAF-POKE <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 85)}"> w=${Math.round(r.width)} right=${Math.round(r.right)} txt="${((el as HTMLElement).innerText ?? "").slice(0, 30).replace(/\n/g, " ")}"`);
      }
    }
  }
  return lines.slice(0, 24);
});
console.log(out.join("\n"));
await browser.close();
