/**
 * COMPREHENSIVE UI AUDIT · errors, text jumble/overlap, clipping, overflow, responsiveness
 * Self-contained: spawns the dev server, bootstraps a licensed probe account, audits
 * every view + public page at desktop (1440×900) and mobile (390×844), screenshots all.
 * Run: bun scripts/audit-ui-comprehensive.ts [desktop|mobile|all|public]
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/home/z/my-project/scripts/audit-shots";
const MODE = process.argv[2] ?? "all";
mkdirSync(OUT, { recursive: true });

// ── 1. dev server lifecycle (processes die between sandbox calls → self-spawn) ──
let server: ChildProcess | null = null;
async function ensureServer(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/api/version`, { signal: AbortSignal.timeout(2500) });
      if (r.status === 401 || r.ok) { console.log("server: already up"); return; }
    } catch { /* not up */ }
    if (!server) {
      server = spawn("bun", ["run", "dev"], { cwd: "/home/z/my-project", stdio: "ignore", detached: false });
      console.log("server: spawning…");
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("dev server did not come up");
}

// ── 2. probe bootstrap (register + verify + comp license + login) ──
const PROBE_DIR = "/home/z/my-project/scripts/.probe";
mkdirSync(PROBE_DIR, { recursive: true });
const EMAIL_F = `${PROBE_DIR}/email.txt`;
const PASS_F = `${PROBE_DIR}/pass.txt`;
async function bootstrapProbe(): Promise<string> {
  if (existsSync(EMAIL_F) && existsSync(PASS_F)) {
    const email = readFileSync(EMAIL_F, "utf8").trim();
    const password = readFileSync(PASS_F, "utf8").trim();
    const l = await fetch(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: email, password }),
    });
    const cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
    if (l.ok && cookie) { console.log("probe: reused", email); return cookie; }
  }
  const email = `probe-audit-${Date.now()}@halotest.local`;
  const password = "ProbeTest#2026!";
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "UI Audit Probe", email, password, confirmPassword: password, country: "GH", acceptTerms: true, acceptLicense: true }),
  });
  const regj = (await reg.json()) as { ok: boolean; error?: string };
  if (!regj.ok) throw new Error(`register failed: ${regj.error}`);
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("probe user missing");
  if (user.verifyToken) await fetch(`${BASE}/api/auth/verify-email?token=${encodeURIComponent(user.verifyToken)}`);
  const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const g = () => Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => ABC[b % ABC.length]).join("");
  await db.license.create({
    data: { key: `HALO-${g()}-${g()}-${g()}-${g()}`, userId: user.id, planCode: "PRO_LIFETIME", planName: "E2E Audit Comp", entitlementsJson: JSON.stringify(["*"]), status: "ACTIVE", isComplimentary: true, compReason: "Comprehensive UI audit probe", issuedById: "system", notes: "Throwaway probe — delete after audit" },
  });
  await db.$disconnect();
  const l = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  const cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
  if (!l.ok || !cookie) throw new Error("probe login failed");
  writeFileSync(EMAIL_F, email); writeFileSync(PASS_F, password);
  console.log("probe: created", email);
  return cookie;
}

// ── 3. in-page audit probes ──
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
  const directText = (el: Element): string => {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent ?? "";
    return t.replace(/\s+/g, " ").trim();
  };
  // A. horizontal page overflow
  const hOverflow = Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - document.body.clientWidth);
  // B. elements poking beyond the right edge (visible, non-fixed-intent)
  const offenders: { tag: string; cls: string; right: number; w: number; text: string }[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!visible(el)) continue;
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.right > W + 2 && r.width > 12 && r.left < W) {
      const st = getComputedStyle(el);
      if (st.position === "fixed" && r.left > W) continue;
      // only flag elements with real content — decorative glow blobs without text are noise
      const txt = (el as HTMLElement).innerText?.trim() ?? "";
      const isContent = txt.length > 0 || /^(input|select|textarea|button|table|img|canvas|video|iframe)$/i.test(el.tagName);
      if (!isContent) continue;
      offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 80), right: Math.round(r.right), w: Math.round(r.width), text: txt.slice(0, 60) });
      if (offenders.length >= 12) break;
    }
  }
  // C. clipped text without ellipsis (jumble/truncation candidates)
  const clipped: { tag: string; cls: string; clip: number; text: string }[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (!visible(el) || el.children.length > 6) continue;
    const t = (el as HTMLElement).innerText?.trim();
    if (!t || t.length < 3) continue;
    const st = getComputedStyle(el);
    const clipsX = el.scrollWidth - el.clientWidth;
    const clipsY = el.scrollHeight - el.clientHeight;
    const noEll = st.textOverflow !== "ellipsis";
    if ((clipsX > 4 || (clipsY > 6 && st.overflowY !== "auto" && st.overflowY !== "scroll")) && noEll && st.overflow !== "visible") {
      clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 80), clip: Math.max(clipsX, clipsY), text: t.slice(0, 70) });
      if (clipped.length >= 14) break;
    }
  }
  // D. overlapping text leaves (jumble detector) — same-parent-ish, non-ancestor pairs
  const leaves: { el: HTMLElement; r: DOMRect; t: string }[] = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (el.closest("svg,canvas")) continue;
    const t = directText(el);
    if (!t || t.length < 2) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 80) continue;
    leaves.push({ el: el as HTMLElement, r, t });
    if (leaves.length > 400) break;
  }
  const overlaps: { a: string; b: string; cover: number }[] = [];
  outer: for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const A = leaves[i], B = leaves[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const ix = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
      const iy = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
      const inter = ix * iy;
      if (inter <= 0) continue;
      const minArea = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
      const cover = inter / minArea;
      if (cover > 0.45) {
        overlaps.push({ a: A.t.slice(0, 40), b: B.t.slice(0, 40), cover: +cover.toFixed(2) });
        if (overlaps.length >= 10) break outer;
      }
    }
  }
  // E. broken images · F. duplicate ids · G. header presence
  const brokenImgs = Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src.slice(-60));
  const ids: Record<string, number> = {};
  for (const el of document.querySelectorAll("[id]")) ids[el.id] = (ids[el.id] ?? 0) + 1;
  const dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
  const header = document.querySelector("h1,h2")?.textContent?.trim().slice(0, 60) ?? "";
  return { W, hOverflow, offenders, clipped, overlaps, brokenImgs, dupIds, header };
};

// ── 4. driver ──
type Finding = { where: string; kind: string; detail: string };
const findings: Finding[] = [];
const note = (where: string, kind: string, detail: string) => {
  findings.push({ where, kind, detail });
  console.log(`  ⚠ ${where} · ${kind} · ${detail.slice(0, 160)}`);
};

async function auditContext(
  label: string,
  vp: "desktop" | "mobile",
  cookie: string | null,
  targets: { name: string; path: string; navChip?: string }[],
) {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  const ctx = await browser.newContext(
    vp === "desktop"
      ? { viewport: { width: 1440, height: 900 } }
      : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  );
  if (cookie) {
    const sessionValue = cookie.slice("halo_session=".length);
    await ctx.addCookies([
      { name: "halo_session", value: sessionValue, domain: "127.0.0.1", path: "/" },
      { name: "halo_session", value: sessionValue, domain: "localhost", path: "/" },
    ]);
  }
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`console: ${m.text().slice(0, 160)}`); });
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400 && !r.url().includes("/api/auth/me")) {
      // 401/404 on protected probes are expected pre-login; still logged with context
      consoleErrors.push(`http ${r.status()}: ${r.url().replace(BASE, "").slice(0, 100)}`);
    }
  });

  for (const t of targets) {
    const tag = `${label}:${t.name}`;
    try {
      await page.goto(`${BASE}${t.path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2600);
      if (t.navChip) {
        // welcome/boot overlay may cover the nav — dismiss if present, then navigate
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll("button")];
          const w = btns.find((b) => /get started|let.s go|begin|continue|skip|enter/i.test(b.textContent ?? ""));
          if (w) (w as HTMLElement).click();
        }).catch(() => {});
        await page.waitForTimeout(700);
        const clicked = await page.evaluate((chip) => {
          const nav = [...document.querySelectorAll("nav button")].find((x) => x.textContent?.trim() === chip);
          if (nav) { (nav as HTMLElement).click(); return true; }
          return false;
        }, t.navChip);
        if (!clicked) note(tag, "NAV-MISSING", `nav chip "${t.navChip}" not found`);
        await page.waitForTimeout(2600);
      }
      const res = await page.evaluate(AUDIT_JS);
      if (res.hOverflow > 2) note(tag, "H-OVERFLOW", `${res.hOverflow}px horizontal page overflow @${res.W}px`);
      for (const o of res.offenders.slice(0, 4)) note(tag, "OFF-VIEWPORT", `<${o.tag}> "${o.text || o.cls}" right=${o.right}`);
      for (const c of res.clipped.slice(0, 4)) note(tag, "CLIPPED-TEXT", `<${c.tag}> clip=${c.clip}px "${c.text}"`);
      for (const o of res.overlaps.slice(0, 4)) note(tag, "TEXT-OVERLAP", `"${o.a}" ⇄ "${o.b}" cover=${o.cover}`);
      if (res.brokenImgs.length) note(tag, "BROKEN-IMG", res.brokenImgs.join(" | "));
      if (res.dupIds.length) note(tag, "DUP-ID", res.dupIds.join(","));
      const errs = consoleErrors.splice(0, consoleErrors.length);
      for (const e of errs.slice(0, 6)) note(tag, "JS/NET", e);
      await page.screenshot({ path: `${OUT}/${label}-${t.name}.png`, fullPage: true });
      console.log(`  ✓ ${tag} audited (header: "${res.header}")`);
    } catch (e) {
      note(tag, "AUDIT-ERROR", String(e).slice(0, 200));
      try { await page.screenshot({ path: `${OUT}/${label}-${t.name}-CRASH.png`, fullPage: true }); } catch { /* ignore */ }
    }
  }
  await browser.close();
}

// ── main ──
(async () => {
  await ensureServer();
  const cookie = await bootstrapProbe();

  const VIEWS: { name: string; navChip: string }[] = [
    { name: "dashboard", navChip: "Dashboard" },
    { name: "intel", navChip: "Market Intelligence" },
    { name: "activity", navChip: "Trading Activity" },
    { name: "risk", navChip: "Risk Guardian" },
    { name: "lab", navChip: "Strategy Lab" },
    { name: "studio", navChip: "Strategy Studio" },
    { name: "history", navChip: "Trade History" },
    { name: "performance", navChip: "Performance" },
    { name: "briefing", navChip: "Daily Briefing" },
    { name: "learning", navChip: "Learning Missions" },
    { name: "settings", navChip: "Settings" },
    { name: "scanner", navChip: "Market Scanner" },
    { name: "scanner-bot", navChip: "Scanner Bot" },
    { name: "voice", navChip: "Voice Command" },
    { name: "brokers", navChip: "Brokers & MT5" },
    { name: "alerts", navChip: "Alerts" },
  ];
  const PUBLIC: { name: string; path: string }[] = [
    { name: "login", path: "/login" },
    { name: "register", path: "/register" },
    { name: "forgot", path: "/forgot-password" },
    { name: "pricing", path: "/pricing" },
  ];

  // view navigation is client-side; path "/" once + chip clicks
  const appTargets = [{ name: "app-root", path: "/" }, ...VIEWS.map((v) => ({ name: v.name, path: "/", navChip: v.navChip }))];

  if (MODE === "desktop" || MODE === "all") {
    await auditContext("pub-desktop", "desktop", null, PUBLIC);
    await auditContext("desktop", "desktop", cookie, appTargets);
  }
  if (MODE === "mobile" || MODE === "all") {
    await auditContext("pub-mobile", "mobile", null, PUBLIC);
    await auditContext("mobile", "mobile", cookie, appTargets);
  }

  writeFileSync(`${OUT}/report-${MODE}.json`, JSON.stringify(findings, null, 2));
  console.log(`\n══ AUDIT COMPLETE · ${findings.length} finding(s) · report: ${OUT}/report-${MODE}.json ══`);
  await server?.kill();
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); server?.kill(); process.exit(1); });
