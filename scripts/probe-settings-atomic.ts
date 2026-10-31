/**
 * SETTINGS OVERFLOW PROBE 2 · find the ATOMIC wide element (no equally-wide children).
 * Run: bun scripts/probe-settings-atomic.ts
 */
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
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /get started|let.s go|begin|continue|skip|enter/i.test(x.textContent ?? ""));
  if (b) (b as HTMLElement).click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Settings");
  if (nav) (nav as HTMLElement).click();
});
await page.waitForTimeout(2800);

const res = await page.evaluate(() => {
  const W = 390;
  const atomic: string[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (!r || r.width <= W + 2) continue;
    const st = getComputedStyle(el);
    if (st.display === "none") continue;
    // atomic = no child is equally wide
    let childWide = false;
    for (const c of Array.from(el.children)) {
      const cr = (c as HTMLElement).getBoundingClientRect?.();
      if (cr && cr.width > W + 2) { childWide = true; break; }
    }
    if (childWide) continue;
    // compute min-content estimate: what happens if we could shrink — report scrollWidth + classes + parent class
    const par = el.parentElement;
    atomic.push(
      `ATOMIC <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 110)}"> w=${Math.round(r.width)} sw=${(el as HTMLElement).scrollWidth} ` +
      `disp=${st.display} ws=${st.whiteSpace} flex=${st.flex} shrink=${st.flexShrink} ` +
      `parent=<${par?.tagName.toLowerCase()} class="${String(par?.className ?? "").slice(0, 90)}" disp=${par ? getComputedStyle(par).display : "?"}> ` +
      `txt="${((el as HTMLElement).innerText ?? "").slice(0, 40).replace(/\n/g, " ")}"`
    );
  }
  return atomic.slice(0, 25);
});
for (const a of res) console.log(a);
await browser.close();
