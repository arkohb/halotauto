/**
 * ICB BISECT · toggle suspects to find the true 459px source
 * Run: bun scripts/probe-icb-bisect.ts
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
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Settings");
  (nav as HTMLElement)?.click();
});
await page.waitForTimeout(2800);

console.log(await page.evaluate(() => `baseline: scrollWidth=${document.documentElement.scrollWidth} clientWidth=${document.documentElement.clientWidth} viewportMeta=${document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "MISSING"}`));

const bisect = await page.evaluate(() => {
  const sw = () => document.documentElement.scrollWidth;
  const out: string[] = [];
  const toggle = (label: string, fn: () => boolean) => {
    const restore = fn();
    out.push(`${label}: scrollWidth=${sw()}${restore ? " (restored)" : ""}`);
  };
  // 1. hide welcome overlay
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
  if (dialog) toggle("hide welcome dialog", () => { dialog.style.display = "none"; dialog.style.display = ""; return true; });
  // 2. hide ambience
  const amb = document.querySelector(".halo-ambience") as HTMLElement | null;
  if (amb) toggle("hide ambience", () => { amb.style.display = "none"; amb.style.display = ""; return true; });
  // 3. hide robot assistant
  const robot = document.querySelector(".fixed.bottom-3.right-3") as HTMLElement | null;
  if (robot) toggle("hide robot assistant", () => { robot.style.display = "none"; robot.style.display = ""; return true; });
  // 4. hide jarvis launcher
  const jl = [...document.querySelectorAll("div")].find((d) => d.className.includes("fixed bottom-3 right-[84px]")) as HTMLElement | null;
  if (jl) toggle("hide jarvis launcher", () => { jl.style.display = "none"; jl.style.display = ""; return true; });
  // 5. hide header
  const header = document.querySelector("header") as HTMLElement | null;
  if (header) toggle("hide header", () => { header.style.display = "none"; header.style.display = ""; return true; });
  // 6. hide nav chips
  const chips = document.querySelector('nav[aria-label="HALO navigation"]') as HTMLElement | null;
  if (chips) toggle("hide chip nav", () => { chips.style.display = "none"; chips.style.display = ""; return true; });
  // 7. hide footer
  const foot = document.querySelector("footer") as HTMLElement | null;
  if (foot) toggle("hide footer", () => { foot.style.display = "none"; foot.style.display = ""; return true; });
  // 8. hide main
  const main = document.querySelector("main") as HTMLElement | null;
  if (main) toggle("hide main", () => { main.style.display = "none"; main.style.display = ""; return true; });
  // 9. element-level: who has the widest scrollWidth without clipped ancestors? walk all and find max right with no overflow-hidden ancestor
  let worst = "";
  let worstR = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > worstR) {
      let clipped = false;
      let cur: HTMLElement | null = el.parentElement;
      while (cur) {
        const st = getComputedStyle(cur);
        if (st.overflowX === "hidden" || st.overflowX === "clip" || st.overflowX === "auto" || st.overflowX === "scroll") { clipped = true; break; }
        cur = cur.parentElement;
      }
      if (!clipped && r.right > worstR) {
        worstR = r.right;
        worst = `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}" right=${Math.round(r.right)} w=${Math.round(r.width)} text="${(el as HTMLElement).innerText?.slice(0, 40)?.replace(/\n/g, " ")}">`;
      }
    }
  }
  out.push(`WIDEST UNCLIPPED: right=${Math.round(worstR)} ${worst}`);
  return out.join("\n");
});
console.log(bisect);
await browser.close();
await server?.kill();
process.exit(0);
