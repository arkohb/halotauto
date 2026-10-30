/**
 * console-sweep · commercial UX audit — every page must load with ZERO
 * uncaught exceptions; functional smoke checks on the money pages.
 * Run: bun scripts/console-sweep.ts   (HALO_E2E_EMAIL / HALO_E2E_PASSWORD env)
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

async function sweep(page: import("playwright").Page, label: string, path: string, waitMs = 3500) {
  const errs: string[] = [];
  const cons: string[] = [];
  const onErr = (e: Error) => errs.push(String(e).slice(0, 140));
  const onCon = (m: import("playwright").ConsoleMessage) => { if (m.type() === "error") cons.push(m.text().slice(0, 140)); };
  page.on("pageerror", onErr);
  page.on("console", onCon);
  const resp = await page.goto(`${URL}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(waitMs);
  page.off("pageerror", onErr);
  page.off("console", onCon);
  ok(`${label} ${path} → ${resp?.status()} no uncaught exceptions`, errs.length === 0, errs.length ? errs.join(" | ") : "clean");
  if (cons.length) console.log(`      console(${label} ${path}): ${cons.slice(0, 3).join(" | ")}`);
  return { errs, cons };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });

  // ── anonymous surfaces ──────────────────────────────────────────────────
  const anon = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const p1 = await anon.newPage();
  await sweep(p1, "anon", "/login");
  await sweep(p1, "anon", "/register");
  // register validation: submit empty form → inline error, no crash
  await p1.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /create|register|get started/i.test(x.textContent ?? ""));
    (b as HTMLElement)?.click();
  });
  await p1.waitForTimeout(1200);
  const regErr = await p1.evaluate(() => document.body.innerText.slice(0, 3000));
  ok("anon /register empty-submit shows validation (no crash)", /enter your full name|full name|must|required/i.test(regErr));
  await sweep(p1, "anon", "/forgot-password");
  await sweep(p1, "anon", "/reset-password?token=invalid-token-probe");
  await sweep(p1, "anon", "/pricing");
  const pricingTxt = await p1.evaluate(() => document.body.innerText);
  ok("anon /pricing renders all four plans with correct prices",
     pricingTxt.includes("$199") && pricingTxt.includes("$399") && pricingTxt.includes("$699") && pricingTxt.includes("$1,199"),
     `has199=${pricingTxt.includes("$199")} has1199=${pricingTxt.includes("$1,199")}`);
  const gate = await p1.goto(`${URL}/`, { waitUntil: "domcontentloaded" });
  ok("anon / still redirected to login (gate live during sweep)", (p1.url() ?? "").includes("/login"), `status=${gate?.status()}`);
  await anon.close();

  // ── authenticated (admin) surfaces ──────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const p2 = await ctx.newPage();
  const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
  const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
  const loginRes = await fetch(`${URL}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
  });
  const setCookies = (loginRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const pair = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  if (!pair) { console.error("✗ pre-login failed"); process.exit(1); }
  await ctx.addCookies([{ name: "halo_session", value: pair.slice("halo_session=".length), domain: "localhost", path: "/" }]);

  await sweep(p2, "admin", "/", 9000);            // dashboard boot + feeds
  await sweep(p2, "admin", "/account");
  const acctTxt = await p2.evaluate(() => document.body.innerText);
  ok("admin /account renders account + device surfaces", /device|license|account/i.test(acctTxt));
  await sweep(p2, "admin", "/admin", 6000);
  const admTxt = await p2.evaluate(() => document.body.innerText);
  ok("admin /admin renders control surfaces", /overview|users|licenses|plans|transactions|audit/i.test(admTxt), admTxt.slice(0, 90).replace(/\n/g, " "));
  await sweep(p2, "admin", "/checkout", 5000);
  // no ?plan= → must bounce to /pricing instead of erroring
  ok("admin /checkout without plan redirects to /pricing", (p2.url() ?? "").includes("/pricing"), p2.url());

  // ?plan=PRO → SECURE CHECKOUT renders with plan name + price (creates a
  // PENDING payment owned by the admin — deleted again at the end of sweep)
  await sweep(p2, "admin", "/checkout?plan=PRO", 5000);
  const coTxt = await p2.evaluate(() => document.body.innerText);
  ok("admin /checkout?plan=PRO renders plan + currency display",
     /SECURE CHECKOUT/i.test(coTxt) && /Pro Plan/i.test(coTxt) && /\$399\.00|GH₵/i.test(coTxt),
     `hasPro=${/Pro Plan/i.test(coTxt)} hasPrice=${/\$399\.00/i.test(coTxt)}`);

  // ?ref=unknown → clear error, no crash (resume flow)
  await sweep(p2, "admin", "/checkout?ref=HALOPAY-DOES-NOT-EXIST", 4000);
  const refTxt = await p2.evaluate(() => document.body.innerText);
  ok("admin /checkout?ref=unknown shows payment-not-found (no crash)", /payment not found|not found/i.test(refTxt));

  // ?plan=BOGUS → redirected back to /pricing
  await sweep(p2, "admin", "/checkout?plan=BOGUS-PLAN", 4000);
  ok("admin /checkout?plan=BOGUS redirects to /pricing", (p2.url() ?? "").includes("/pricing"), p2.url());

  await sweep(p2, "admin", "/activate");
  await ctx.close();

  // sweep hygiene: remove the PENDING payment the ?plan=PRO visit created
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const del = await db.payment.deleteMany({ where: { status: "PENDING", reference: { startsWith: "HALOPAY-" } } });
    await db.$disconnect();
    if (del.count) console.log(`      sweep hygiene: removed ${del.count} test PENDING payment(s)`);
  } catch (e) { console.log(`      sweep hygiene skipped: ${(e as Error).message.slice(0, 80)}`); }

  await browser.close();
  console.log("\n════ CONSOLE SWEEP ════");
  for (const r of results) console.log(r);
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`════ ${results.length - failed}/${results.length} passed ════`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("sweep crashed:", e); console.log(results.join("\n")); process.exit(1); });
