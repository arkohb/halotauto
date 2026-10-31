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
  const lines: string[] = [];
  // right column = the div.space-y-4 child of the settings grid
  const h1 = [...document.querySelectorAll("h1")].find((x) => x.textContent?.trim() === "SETTINGS");
  let grid: HTMLElement | null = null;
  let el: HTMLElement | null = h1;
  while (el && el !== document.body) { if (getComputedStyle(el).display === "grid") { grid = el; break; } el = el.parentElement; }
  if (!grid) return ["no grid"];
  const col = Array.from(grid.children).find((c) => (c as HTMLElement).classList.contains("space-y-4")) as HTMLElement | undefined;
  if (!col) return ["no right col"];
  // bisect: force min-content at each level
  const bisect = (node: HTMLElement, depth: number, path: string) => {
    if (depth > 9) return;
    node.style.width = "min-content";
    const w = node.getBoundingClientRect().width;
    node.style.width = "";
    if (w < 400) return; // this subtree shrinks fine
    lines.push(`${"  ".repeat(depth)}${path} w=${Math.round(w)}`);
    for (const ch of Array.from(node.children)) bisect(ch as HTMLElement, depth + 1, `<${ch.tagName.toLowerCase()} class="${String(ch.className).slice(0, 55)}">`);
  };
  bisect(col, 0, "RIGHTCOL");
  return lines;
});
console.log(out.join("\n"));
await browser.close();
