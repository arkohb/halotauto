/**
 * FOCUSED RE-VERIFICATION · re-audit only the views touched by the fixes
 * (history, performance, lab, settings, alerts, scanner-bot) at both
 * viewports + confirm the scanner feed stays reachable.
 * Run: bun scripts/audit-reverify.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/home/z/my-project/scripts/audit-shots";
mkdirSync(OUT, { recursive: true });

const PROBE_DIR = "/home/z/my-project/scripts/.probe";
const email = readFileSync(`${PROBE_DIR}/email.txt`, "utf8").trim();
const password = readFileSync(`${PROBE_DIR}/pass.txt`, "utf8").trim();
const l = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: email, password }),
});
const cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
if (!l.ok || !cookie) throw new Error("probe login failed");
console.log("probe:", email);

const AUDIT_JS = () => {
  const W = window.innerWidth;
  const doc = document.documentElement;
  const visible = (el: Element): boolean => {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (!r || r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || +st.opacity === 0) return false;
    return true;
  };
  const hOverflow = Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - document.body.clientWidth);
  const offenders: { tag: string; right: number; text: string }[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!visible(el)) continue;
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.right > W + 2 && r.width > 12 && r.left < W) {
      const st = getComputedStyle(el);
      if (st.position === "fixed" && r.left > W) continue;
      const txt = (el as HTMLElement).innerText?.trim() ?? "";
      if (!txt) continue;
      offenders.push({ tag: el.tagName.toLowerCase(), right: Math.round(r.right), text: txt.slice(0, 60) });
      if (offenders.length >= 8) break;
    }
  }
  return { W, hOverflow, offenders, header: document.querySelector("h1,h2")?.textContent?.trim().slice(0, 50) ?? "" };
};

const findings: string[] = [];
const note = (s: string) => { findings.push(s); console.log("  ⚠", s); };

async function pass(label: string, vp: "desktop" | "mobile", targets: { name: string; chip: string }[]) {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const ctx = await browser.newContext(
    vp === "desktop"
      ? { viewport: { width: 1440, height: 900 } }
      : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  );
  const sessionValue = cookie.slice("halo_session=".length);
  await ctx.addCookies([{ name: "halo_session", value: sessionValue, domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 140)}`));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console: ${m.text().slice(0, 140)}`); });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3200); // boot splash fully gone
  // dismiss welcome overlay if present
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /get started|let.s go|begin|continue|skip|enter/i.test(x.textContent ?? ""));
    if (b) (b as HTMLElement).click();
  }).catch(() => {});

  for (const t of targets) {
    const tag = `${label}:${t.name}`;
    try {
      const clicked = await page.evaluate((chip) => {
        const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === chip);
        if (nav) { (nav as HTMLElement).click(); return true; }
        return false;
      }, t.chip);
      if (!clicked) { note(`${tag} NAV-MISSING "${t.chip}"`); continue; }
      await page.waitForTimeout(3200); // welcome bubble gone (auto-hide 4.6s mobile? wait longer)
      await page.waitForTimeout(2200);
      const res = await page.evaluate(AUDIT_JS);
      if (res.hOverflow > 2) note(`${tag} H-OVERFLOW ${res.hOverflow}px`);
      for (const o of res.offenders.slice(0, 4)) note(`${tag} OFF-VIEWPORT <${o.tag}> right=${o.right} "${o.text}"`);
      const errs = consoleErrors.splice(0, consoleErrors.length).filter((e) => !e.includes("Microphone") && !e.includes("mic"));
      for (const e of errs.slice(0, 4)) note(`${tag} JS/NET ${e}`);
      await page.screenshot({ path: `${OUT}/${label}-${t.name}.png`, fullPage: true });
      console.log(`  ✓ ${tag} (header: "${res.header}")`);
    } catch (e) {
      note(`${tag} AUDIT-ERROR ${String(e).slice(0, 150)}`);
    }
  }
  await browser.close();
}

const TARGETS = [
  { name: "history", chip: "Trade History" },
  { name: "performance", chip: "Performance" },
  { name: "lab", chip: "Strategy Lab" },
  { name: "settings", chip: "Settings" },
  { name: "alerts", chip: "Alerts" },
  { name: "scanner-bot", chip: "Scanner Bot" },
];

await pass("rv-desktop", "desktop", TARGETS);
await pass("rv-mobile", "mobile", TARGETS);

// scanner feed reachability straight from the API (licensed context)
const feed = await fetch(`${BASE}/api/tf-scanner`, { headers: { cookie } });
const feedj = (await feed.json()) as { ok: boolean; status?: string };
console.log(`scanner feed: HTTP ${feed.status} ok=${feedj.ok} status=${feedj.status}`);
if (!feed.ok || !feedj.ok) note(`SCANNER-FEED unreachable: HTTP ${feed.status}`);

writeFileSync(`${OUT}/report-reverify.json`, JSON.stringify(findings, null, 2));
console.log(`\n══ RE-VERIFY COMPLETE · ${findings.length} finding(s) ══`);
process.exit(0);
