/**
 * TARGETED DIAGNOSIS · probes the exact flagged elements: rects, styles, close-ups.
 * Run: bun scripts/audit-diagnose.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/home/z/my-project/scripts/audit-shots/diag";
mkdirSync(OUT, { recursive: true });

let server: ChildProcess | null = null;
async function ensureServer() {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(2500) }); if (r.status === 401 || r.ok) return; } catch {}
    if (!server) { server = spawn("bun", ["run", "dev"], { cwd: "/home/z/my-project", stdio: "ignore" }); console.log("spawning server…"); }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("server not up");
}

const PROBE_DIR = "/home/z/my-project/scripts/.probe";
const email = readFileSync(`${PROBE_DIR}/email.txt`, "utf8").trim();
const password = readFileSync(`${PROBE_DIR}/pass.txt`, "utf8").trim();
const l = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: email, password }) });
const cookie = (l.headers.get("set-cookie") ?? "").slice("halo_session=".length).split(";")[0];
if (!cookie) throw new Error(`probe login failed: ${l.status}`);

function dumpEl(el: Element): string {
  const r = el.getBoundingClientRect();
  const st = getComputedStyle(el);
  const parent = el.parentElement;
  const pst = parent ? getComputedStyle(parent) : null;
  return [
    `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 100)}">`,
    `rect: x=${Math.round(r.left)} y=${Math.round(r.top)} w=${Math.round(r.width)} h=${Math.round(r.height)}`,
    `pos=${st.position} disp=${st.display} ovx=${st.overflowX} ovy=${st.overflowY} ws=${st.whiteSpace} fs=${st.fontSize}`,
    pst ? `parent=<${parent!.tagName.toLowerCase()} class="${String(parent!.className).slice(0, 80)}" ovx=${pst.overflowX} ovy=${pst.overflowY} pos=${pst.position} disp=${pst.display}>` : "parent=null",
  ].join(" | ");
}

async function diagnose(page: import("playwright").Page, chip: string, texts: string[], shot: string) {
  await page.evaluate((chip) => {
    const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === chip);
    (nav as HTMLElement)?.click();
  }, chip);
  await page.waitForTimeout(2400);
  console.log(`\n══ ${chip} (${texts.join(" · ")}) ══`);
  for (const t of texts) {
    const info = await page.evaluate(({ t, dump }) => {
      const D = new Function("el", `return (${dump})(el);`) as (el: Element) => string;
      const els = [...document.querySelectorAll("body *")].filter((e) => {
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
        return own.toLowerCase().includes(t.toLowerCase());
      });
      return els.slice(0, 3).map((e) => D(e));
    }, { t, dump: dumpEl.toString() });
    console.log(` · "${t}": ${info.length ? "\n     " + info.join("\n     ") : "NOT FOUND"}`);
  }
  await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false });
}

const browser = await chromium.launch({ headless: true, channel: "chromium" });
// mobile context
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await mctx.addCookies([{ name: "halo_session", value: cookie, domain: "127.0.0.1", path: "/" }]);
const mp = await mctx.newPage();
await mp.goto(BASE, { waitUntil: "domcontentloaded" });
await mp.waitForTimeout(3200);

// 1. brokers — login / master password / server overlap
await diagnose(mp, "Brokers & MT5", ["login", "master password", "server", "account id"], "m-brokers-form");

// 2. scanner — sweep table clip + "every pair in the catalog"
await diagnose(mp, "Market Scanner", ["every pair in the catalog", "1h and 4h timeframes only", "FRESH S / B"], "m-scanner-tables");

// 3. settings overflow source
await diagnose(mp, "Settings", ["COPY WEBHOOK URL", "Instant (intrabar)"], "m-settings-overflow");
const mOverflow = await mp.evaluate(() => {
  const W = document.documentElement.clientWidth, SW = document.documentElement.scrollWidth;
  const bad: string[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 2 && r.width > 8) {
      const st = getComputedStyle(el);
      if (st.position === "fixed") continue;
      bad.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}" right=${Math.round(r.right)} w=${Math.round(r.width)} text="${(el as HTMLElement).innerText?.slice(0, 40)?.replace(/\n/g, " ")}">`);
    }
  }
  return { W, SW, bad: bad.slice(0, 15) };
});
console.log("\n══ settings overflow ══", JSON.stringify(mOverflow, null, 1));

// 4. dashboard "HALO CORE ⇄ 3EL INDICATOR / SCANNING" + "3m ⇄ TRADINGVIEW · 3EL"
await diagnose(mp, "Dashboard", ["HALO CORE", "3EL INDICATOR", "TRADINGVIEW", "NEURAL MARKET LINK"], "m-dashboard-overlaps");

// desktop context
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await dctx.addCookies([{ name: "halo_session", value: cookie, domain: "127.0.0.1", path: "/" }]);
const dp = await dctx.newPage();
await dp.goto(BASE, { waitUntil: "domcontentloaded" });
await dp.waitForTimeout(3200);

// 5. intel — BINANCE LIVE ⇄ EA ON
await diagnose(dp, "Market Intelligence", ["BINANCE LIVE", "EA ON", "Refresh feeds"], "d-intel-pills");

// 6. strip ALL BROKERS chip (on dashboard)
await diagnose(dp, "Dashboard", ["ALL BROKERS"], "d-strip-chip");
const chipInfo = await dp.evaluate(() => {
  const el = [...document.querySelectorAll("span,button,div")].find((e) => e.textContent?.trim() === "ALL BROKERS" && e.children.length === 0);
  if (!el) return "not found";
  const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
  const par = el.parentElement!;
  const pr = par.getBoundingClientRect(); const pst = getComputedStyle(par);
  return `chip rect w=${Math.round(r.width)} h=${Math.round(r.height)} | ovx=${st.overflowX} ws=${st.whiteSpace} fs=${st.fontSize} | parent w=${Math.round(pr.width)} sw=${par.scrollWidth} ovx=${pst.overflowX} cls="${String(par.className).slice(0, 90)}"`;
});
console.log("\n══ ALL BROKERS chip ══", chipInfo);

// 7. history table clip 614px + performance
await diagnose(dp, "Trade History", ["TRADE HISTORY", "R:R"], "d-history-table");
const hist = await dp.evaluate(() => {
  const D = (el: Element) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 80)}" w=${Math.round(r.width)} h=${Math.round(r.height)} sw=${el.scrollWidth} sh=${el.scrollHeight} ovx=${st.overflowX} ovy=${st.overflowY}>`; };
  const el = [...document.querySelectorAll("div")].find((e) => e.textContent?.includes("TRADE HISTORY") && e.querySelector("table"));
  if (!el) return "table wrap not found";
  const chain: string[] = [];
  let cur: Element | null = el;
  for (let i = 0; i < 6 && cur; i++) { chain.push(D(cur)); cur = cur.parentElement; }
  return chain.join("\n  → ");
});
console.log("\n══ history table chain ══", hist);

await browser.close();
await server?.kill();
process.exit(0);
