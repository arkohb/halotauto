/**
 * VERIFY AUDIT FIXES · targeted re-checks of every finding that was fixed
 * Run: bun scripts/verify-audit-fixes.ts
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/home/z/my-project/scripts/audit-shots/verify";
mkdirSync(OUT, { recursive: true });
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") => {
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

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

// ───────────────────────── DESKTOP ─────────────────────────
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await dctx.addCookies([{ name: "halo_session", value: cookie, domain: "127.0.0.1", path: "/" }]);
const dp = await dctx.newPage();
await dp.goto(BASE, { waitUntil: "domcontentloaded" });
await dp.waitForTimeout(3400);
// dismiss welcome/boot if present
await dp.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /skip intro|enter command/i.test(x.textContent ?? ""));
  (b as HTMLElement)?.click();
}).catch(() => {});
await dp.waitForTimeout(900);

// 1. intel chart header — left chips vs right controls collision
await dp.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Market Intelligence");
  (nav as HTMLElement)?.click();
});
await dp.waitForTimeout(2600);
const pillCheck = await dp.evaluate(() => {
  const texts = [...document.querySelectorAll("body *")].filter((e) => {
    const t = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
    return /^(BINANCE|DERIV|MT5 · CFD|OKX|EA ON|EA OFF)$/.test(t);
  }) as HTMLElement[];
  const rects = texts.map((e) => ({ t: e.textContent?.trim() ?? "", r: e.getBoundingClientRect() }));
  const bad: string[] = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const A = rects[i], B = rects[j];
      if (A.t === B.t) continue;
      const ix = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
      const iy = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
      if (ix * iy > 0) bad.push(`${A.t} ∩ ${B.t}`);
    }
  return bad;
});
ok("DESK intel: venue chips do not collide with EA/TV controls", pillCheck.length === 0, pillCheck.join(", "));

// 2. ALL BROKERS chip not clipped
const chipCheck = await dp.evaluate(() => {
  const el = [...document.querySelectorAll("span,div")].find((e) => e.textContent?.trim() === "ALL BROKERS" && e.children.length === 0) as HTMLElement | undefined;
  if (!el) return { found: false };
  return { found: true, clipped: el.scrollWidth - el.clientWidth };
});
ok("DESK header: ALL BROKERS chip fully visible", chipCheck.found && (chipCheck.clipped ?? 0) <= 1, `clip=${chipCheck.clipped}px`);

// 3. footer clears the PERMANENT fixed widgets at max scroll (robot art +
//    launcher — the speech bubble is dismissible and may legally cover text)
await dp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await dp.waitForTimeout(900);
const footCheck = await dp.evaluate(() => {
  const foot = [...document.querySelectorAll("footer span")].find((s) => s.textContent?.includes("ALL RIGHTS RESERVED")) as HTMLElement | undefined;
  if (!foot) return { found: false };
  const fr = foot.getBoundingClientRect();
  const robot = document.querySelector('[aria-label^="HALO-B robotic assistant"]') as HTMLElement | null;
  const launcher = [...document.querySelectorAll("div,button")].find((d) => (d as HTMLElement).offsetParent !== null && /fixed bottom-3 right-\[84px\]/.test(String(d.className))) as HTMLElement | null;
  const zones = [robot?.getBoundingClientRect(), launcher?.getBoundingClientRect()].filter(Boolean) as DOMRect[];
  const overlaps = zones.filter((rr) => Math.max(0, Math.min(fr.bottom, rr.bottom) - Math.max(fr.top, rr.top)) > 0 && Math.max(0, Math.min(fr.right, rr.right) - Math.max(fr.left, rr.left)) > 0);
  return { found: true, overlap: overlaps.length > 0, zones: zones.length };
});
ok("DESK footer: clears fixed widget zone at max scroll", footCheck.found && !footCheck.overlap, JSON.stringify(footCheck));

// 4. settings "Instant (intrabar)" not clipped
await dp.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Settings");
  (nav as HTMLElement)?.click();
});
await dp.waitForTimeout(2400);
const sigCheck = await dp.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((e) => e.textContent?.trim() === "Instant (intrabar)" && e.children.length === 0) as HTMLElement | undefined;
  if (!el) return { found: false };
  return { found: true, clipped: el.scrollWidth - el.clientWidth };
});
ok("DESK settings: Instant (intrabar) value fully visible", sigCheck.found && (sigCheck.clipped ?? 0) <= 1, `clip=${sigCheck.clipped}px`);
await dp.screenshot({ path: `${OUT}/d-settings-fixed.png` });

// 5. voice view — no stacked mic warnings
await dp.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Voice Command");
  (nav as HTMLElement)?.click();
});
await dp.waitForTimeout(2400);
const micCheck = await dp.evaluate(() => {
  const t = document.body.innerText;
  const hits = (t.match(/Microphone permission is denied/g) ?? []).length;
  return hits;
});
ok("DESK voice: mic-denied warning appears at most once", micCheck <= 1, `count=${micCheck}`);

await dctx.close();

// ───────────────────────── MOBILE ─────────────────────────
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mctx.addCookies([{ name: "halo_session", value: cookie, domain: "127.0.0.1", path: "/" }]);
const mp = await mctx.newPage();
await mp.goto(BASE, { waitUntil: "domcontentloaded" });
// wait for the welcome dialog to actually mount (provider timing varies)
try {
  await mp.waitForSelector('[role="dialog"]', { timeout: 15000 });
} catch {
  // overlay may legitimately not raise on this session
}
await mp.waitForTimeout(800);

// 6. welcome overlay: no horizontal overflow + bottom reachable
const welcomeCheck = await mp.evaluate(() => {
  const W = document.documentElement.clientWidth, SW = document.documentElement.scrollWidth;
  const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
  if (!dialog) return { mounted: false, hOver: SW - W };
  const root = dialog;
  const canScroll = root.scrollHeight - root.clientHeight;
  // last attribution line reachable by scrolling the overlay?
  const attr = [...dialog.querySelectorAll("div")].find((d) => d.textContent?.trim().startsWith("CREATED BY")) as HTMLElement | null;
  let reachable = false;
  if (attr && canScroll > 0) {
    root.scrollTop = root.scrollHeight;
    const r = attr.getBoundingClientRect();
    reachable = r.top < window.innerHeight && r.bottom > 0;
    root.scrollTop = 0;
  } else if (attr) {
    const r = attr.getBoundingClientRect();
    reachable = r.bottom <= window.innerHeight + 1;
  }
  return { mounted: true, hOver: SW - W, canScroll, attrReachable: reachable };
});
ok("MOBILE welcome: no horizontal overflow", welcomeCheck.hOver <= 2, `overflow=${welcomeCheck.hOver}px`);
ok("MOBILE welcome: creator line reachable (scrolls if tall)", !welcomeCheck.mounted || welcomeCheck.attrReachable === true, JSON.stringify(welcomeCheck));
await mp.screenshot({ path: `${OUT}/m-welcome-fixed.png`, fullPage: false });

// dismiss + settings overflow recheck
await mp.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /skip intro|enter command/i.test(x.textContent ?? ""));
  (b as HTMLElement)?.click();
});
await mp.waitForTimeout(900);
await mp.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Settings");
  (nav as HTMLElement)?.click();
});
await mp.waitForTimeout(2600);
const mOver = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok("MOBILE settings: no horizontal page overflow", mOver <= 2, `overflow=${mOver}px`);

// footer clearance on mobile
await mp.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await mp.waitForTimeout(900);
const mFoot = await mp.evaluate(() => {
  const foot = [...document.querySelectorAll("footer span")].find((s) => s.textContent?.includes("ALL RIGHTS RESERVED")) as HTMLElement | undefined;
  if (!foot) return { found: false };
  const fr = foot.getBoundingClientRect();
  const robot = document.querySelector('[aria-label^="HALO-B robotic assistant"]') as HTMLElement | null;
  const launcher = [...document.querySelectorAll("div,button")].find((d) => (d as HTMLElement).offsetParent !== null && /fixed bottom-3 right-\[84px\]/.test(String(d.className))) as HTMLElement | null;
  const zones = [robot?.getBoundingClientRect(), launcher?.getBoundingClientRect()].filter(Boolean) as DOMRect[];
  const overlaps = zones.filter((rr) => Math.max(0, Math.min(fr.bottom, rr.bottom) - Math.max(fr.top, rr.top)) > 0 && Math.max(0, Math.min(fr.right, rr.right) - Math.max(fr.left, rr.left)) > 0);
  return { found: true, overlap: overlaps.length > 0, zones: zones.length };
});
ok("MOBILE footer: clears fixed widget zone at max scroll", mFoot.found && !mFoot.overlap, JSON.stringify(mFoot));
await mp.screenshot({ path: `${OUT}/m-footer-fixed.png`, fullPage: false });

// mobile voice mic-warning count
await mp.evaluate(() => {
  const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === "Voice Command");
  (nav as HTMLElement)?.click();
});
await mp.waitForTimeout(2400);
const mMic = await mp.evaluate(() => (document.body.innerText.match(/Microphone permission is denied/g) ?? []).length);
ok("MOBILE voice: mic-denied warning appears at most once", mMic <= 1, `count=${mMic}`);
await mp.screenshot({ path: `${OUT}/m-voice-fixed.png`, fullPage: false });

await mctx.close();
await browser.close();
await server?.kill();
console.log(`\n══ ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} checks passed ══`);
process.exit(results.every((r) => r.startsWith("PASS")) ? 0 : 1);
