/**
 * GRID MIN-CONTENT PROBE · measure each settings-grid child's min-content width.
 * Run: bun scripts/probe-grid-mincontent.ts
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
  // find the grid: parent of the SETTINGS PageHeader
  const h1 = [...document.querySelectorAll("h1")].find((x) => x.textContent?.trim() === "SETTINGS");
  if (!h1) return ["no SETTINGS h1"];
  let grid: HTMLElement | null = null;
  let el: HTMLElement | null = h1;
  while (el && el !== document.body) {
    if (getComputedStyle(el).display === "grid") { grid = el; break; }
    el = el.parentElement;
  }
  if (!grid) return ["no grid ancestor"];
  const gs = getComputedStyle(grid);
  const out: string[] = [];
  out.push(`GRID class="${grid.className}" display=${gs.display} cols=${gs.gridTemplateColumns} w=${Math.round(grid.getBoundingClientRect().width)}`);
  for (const child of Array.from(grid.children)) {
    const c = child as HTMLElement;
    const origW = c.style.width;
    const origFlex = c.style.flex;
    // measure min-content: width:min-content
    c.style.width = "min-content";
    const mc = c.getBoundingClientRect().width;
    c.style.width = origW || "";
    // walk inside to find widest descendant at min-content
    c.style.width = "min-content";
    let widest: { w: number; tag: string; cls: string } | null = null;
    const walk = (n: Element) => {
      const r = (n as HTMLElement).getBoundingClientRect?.();
      if (r && (!widest || r.width > widest.w)) widest = { w: r.width, tag: n.tagName.toLowerCase(), cls: String(n.className).slice(0, 70) };
      for (const k of Array.from(n.children)) walk(k);
    };
    walk(c);
    c.style.width = origW || "";
    const cc = widest as { w: number; tag: string; cls: string } | null;
    out.push(`  child <${c.tagName.toLowerCase()} class="${String(c.className).slice(0, 60)}"> minContent=${Math.round(mc)} widestInside=${cc ? Math.round(cc.w) + "px <" + cc.tag + " " + cc.cls + ">" : "?"}`);
  }
  // also walk the widest chain inside the FIRST wide panel to find nowrap min-content elements
  const nowrap: string[] = [];
  for (const e of Array.from(grid.querySelectorAll("*"))) {
    const st = getComputedStyle(e);
    if ((st.whiteSpace === "nowrap" || st.width.startsWith("fit")) === false) continue;
    const r = (e as HTMLElement).getBoundingClientRect();
    if (r.width > 390) nowrap.push(`NOWRAP/FIT <${e.tagName.toLowerCase()} class="${String(e.className).slice(0, 70)}"> w=${Math.round(r.width)}`);
  }
  out.push(...nowrap.slice(0, 10));
  return out;
});
for (const r of res) console.log(r);
await browser.close();
