/**
 * SETTINGS OVERFLOW PROBE · find which elements force >390px width on mobile settings.
 * Run: bun scripts/probe-settings-overflow2.ts
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
const sessionValue = cookie.slice("halo_session=".length);
await ctx.addCookies([{ name: "halo_session", value: sessionValue, domain: "127.0.0.1", path: "/" }]);
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
  const out: string[] = [];
  const wide: { tag: string; cls: string; w: number; right: number; text: string }[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (!r) continue;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") continue;
    if (r.width > W + 2) {
      wide.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 90), w: Math.round(r.width), right: Math.round(r.right), text: ((el as HTMLElement).innerText ?? "").slice(0, 40).replace(/\n/g, " ") });
    }
    if (r.right > W + 2 && r.width < W && r.width > 20) {
      out.push(`POKE <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 80)}"> w=${Math.round(r.width)} right=${Math.round(r.right)} txt="${((el as HTMLElement).innerText ?? "").slice(0, 36).replace(/\n/g, " ")}"`);
    }
  }
  wide.sort((a, b) => b.w - a.w);
  return { wide: wide.slice(0, 14).map((x) => `WIDE <${x.tag} class="${x.cls}"> w=${x.w} right=${x.right} txt="${x.text}"`), poke: out.slice(0, 20), docW: document.documentElement.scrollWidth };
});
console.log(`doc scrollWidth=${res.docW}`);
for (const w of res.wide) console.log(w);
console.log("--- pokes ---");
for (const p of res.poke) console.log(p);
await browser.close();
