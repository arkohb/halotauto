/**
 * EMPIRICAL PROBE · mobile welcome overlay overflow + post-dismiss recheck
 * Run: bun scripts/probe-welcome-overflow.ts
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
  throw new Error("server not up");
}

const PROBE_DIR = "/home/z/my-project/scripts/.probe";
const email = readFileSync(`${PROBE_DIR}/email.txt`, "utf8").trim();
const password = readFileSync(`${PROBE_DIR}/pass.txt`, "utf8").trim();
const l = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
const cookie = (l.headers.get("set-cookie") ?? "").slice("halo_session=".length).split(";")[0];
if (!cookie) throw new Error(`login failed ${l.status}`);

await ensureServer();
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies([{ name: "halo_session", value: cookie, domain: "127.0.0.1", path: "/" }]);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3600);

const probe = () => page.evaluate(() => {
  const W = document.documentElement.clientWidth, SW = document.documentElement.scrollWidth;
  const out: string[] = [`clientWidth=${W} scrollWidth=${SW} overflow=${SW - W}`];
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) { out.push("welcome overlay: NOT MOUNTED"); return out.join("\n"); }
  const r = dialog.getBoundingClientRect();
  out.push(`dialog rect: w=${Math.round(r.width)} h=${Math.round(r.height)} right=${Math.round(r.right)}`);
  // find every element wider than the clientWidth and walk its ancestor chain
  const wide = [...document.querySelectorAll("body *")].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > W + 1 && b.width < 3000;
  }).slice(0, 6) as HTMLElement[];
  for (const el of wide) {
    const chain: string[] = [];
    let cur: HTMLElement | null = el;
    for (let i = 0; i < 5 && cur; i++) {
      const b = cur.getBoundingClientRect();
      const st = getComputedStyle(cur);
      chain.push(`<${cur.tagName.toLowerCase()} class="${String(cur.className).slice(0, 60)}" w=${Math.round(b.width)} ovx=${st.overflowX} pos=${st.position}${st.transform !== "none" ? ` tf=${st.transform.slice(0, 40)}` : ""}>`);
      cur = cur.parentElement;
    }
    out.push(`WIDE ${chain.join("\n   ↑ ")}`);
  }
  return out.join("\n\n");
});

console.log("══ BEFORE DISMISS ══");
console.log(await probe());
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("SKIP INTRO"));
  (b as HTMLElement)?.click();
});
await page.waitForTimeout(1600);
console.log("══ AFTER DISMISS ══");
console.log(await probe());

// also probe a fresh session WITHOUT the welcome (sessionStorage seen) at smaller height
await page.evaluate(() => { try { sessionStorage.setItem("halo3el.boot.seen.v1", "1"); } catch {} });
await browser.close();
await server?.kill();
process.exit(0);
