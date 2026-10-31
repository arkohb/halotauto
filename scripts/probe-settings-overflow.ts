/**
 * SETTINGS OVERLOAD SOURCE · find what is 459px wide on mobile settings (post-dismiss)
 * Run: bun scripts/probe-settings-overflow.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
let server: ChildProcess | null = null;
async function ensureServer() {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(2500) }); if (r.status === 401 || r.ok) return; } catch {}
    if (!server) { server = spawn("bun", ["run", "dev"], { cwd: "/home/z/my-project", stdio: "ignore" }); }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

const PROBE_DIR = "/home/z/my-project/scripts/.probe";
const email = readFileSync(`${PROBE_DIR}/email.txt`, "utf8").trim();
const password = readFileSync(`${PROBE_DIR}/pass.txt`, "utf8").trim();
const l = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
const cookie = (l.headers.get("set-cookie") ?? "").slice("halo_session=".length).split(";")[0];

await ensureServer();
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies([{ name: "halo_session", value: cookie, domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /skip intro|enter command/i.test(x.textContent ?? ""));
  (b as HTMLElement)?.click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Settings");
  (nav as HTMLElement)?.click();
});
await page.waitForTimeout(2800);

const res = await page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const out: string[] = [`clientWidth=${W} scrollWidth=${document.documentElement.scrollWidth} dialogMounted=${!!document.querySelector('[role="dialog"]')}`];
  // every element wider than viewport, with the ancestor chain up to body
  const wide = [...document.querySelectorAll("body *")].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.right > W + 2 && b.width > 30;
  }) as HTMLElement[];
  const seen = new Set<string>();
  for (const el of wide.slice(0, 40)) {
    const r = el.getBoundingClientRect();
    const key = `${el.tagName}|${Math.round(r.width)}|${Math.round(r.right)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chain: string[] = [];
    let cur: HTMLElement | null = el;
    for (let i = 0; i < 4 && cur; i++) {
      const b = cur.getBoundingClientRect();
      const st = getComputedStyle(cur);
      chain.push(`<${cur.tagName.toLowerCase()} class="${String(cur.className).slice(0, 70)}" x=${Math.round(b.left)} w=${Math.round(b.width)} right=${Math.round(b.right)} ovx=${st.overflowX} pos=${st.position} mxw=${st.maxWidth}>`);
      cur = cur.parentElement;
    }
    out.push(`EL right=${Math.round(r.right)} w=${Math.round(r.width)} text="${(el as HTMLElement).innerText?.slice(0, 30)?.replace(/\n/g, " ")}"\n   ${chain.join("\n   ↑ ")}`);
  }
  return out.join("\n\n");
});
console.log(res);
await browser.close();
await server?.kill();
process.exit(0);
