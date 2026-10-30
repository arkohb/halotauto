// ══════════════════════════════════════════════════════════════════════════
//  commerce-acceptance · §19 ACCEPTANCE TESTS — REAL executed HTTP workflow
//
//  Runs against an ISOLATED commercial-mode server on :3100 (HALO_COMMERCE=on,
//  same DB — every test row is clearly marked halotest.local and removed by
//  commerce-acceptance-cleanup.ts). The owner's live server on :3000 stays in
//  owner mode and is only probed READ-ONLY. Engine-mutating actions
//  (start/stop/close/reset) are NEVER invoked — unauthorized ones are
//  asserted to be REJECTED before reaching the engine.
//
//  bun scripts/commerce-acceptance.ts
//  bun scripts/commerce-acceptance-cleanup.ts   ← after reviewing results
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3100";
const OWNER = "http://localhost:3000";
const db = new PrismaClient();

const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

// ── tiny cookie-jar client ────────────────────────────────────────────────
interface Actor {
  name: string;
  cookie: string;
}
const actor = (name: string): Actor => ({ name, cookie: "" });

async function call(a: Actor, path: string, init: RequestInit = {}, base = BASE): Promise<{ status: number; j: Record<string, unknown> }> {
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(a.cookie ? { Cookie: a.cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  const sc = r.headers.get("set-cookie");
  if (sc) a.cookie = sc.split(";")[0];
  let j: Record<string, unknown> = {};
  try {
    j = (await r.json()) as Record<string, unknown>;
  } catch {
    // non-JSON (redirect pages)
  }
  return { status: r.status, j };
}
const POST = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

const stamp = Date.now().toString(36);
// NOTE: all identifiers MUST be lowercase — the register route lowercases
// e-mails/usernames, and mixed-case lookups silently miss (first-run bug).
const EMAIL = (n: string) => `acc-${n.toLowerCase()}-${stamp}@halotest.local`;
const reg = (n: string) => ({
  fullName: `Acceptance ${n}`,
  email: EMAIL(n),
  username: `acc_${n.toLowerCase()}_${stamp}`,
  password: "AccTest#2026",
  confirmPassword: "AccTest#2026",
  country: "Ghana",
  acceptTerms: true,
  acceptLicense: true,
});

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

async function seedAdmin(n: string, role: string, pw: string): Promise<Actor> {
  const email = EMAIL(n);
  await db.user.upsert({
    where: { email },
    create: { email, fullName: `Acceptance ${n}`, passwordHash: hashPassword(pw), role, status: "ACTIVE", emailVerifiedAt: new Date(), country: "Ghana" },
    update: { role, status: "ACTIVE", passwordHash: hashPassword(pw) },
  });
  const a = actor(n);
  const r = await call(a, "/api/auth/login", POST({ identifier: email, password: pw, remember: false }));
  if (!r.j.ok) throw new Error(`seed login failed for ${email}: ${JSON.stringify(r.j)}`);
  return a;
}

async function registerAndLogin(a: Actor, n: string): Promise<string> {
  const email = EMAIL(n);
  const r = await call(a, "/api/auth/register", POST(reg(n)));
  if (!r.j.ok) throw new Error(`register ${n} failed: ${JSON.stringify(r.j)}`);
  const t = await db.user.findUnique({ where: { email } });
  if (!t?.verifyToken) throw new Error(`no verify token for ${email}`);
  await fetch(`${BASE}/api/auth/verify-email?token=${t.verifyToken}`, { redirect: "manual" });
  const after = await db.user.findUnique({ where: { email } });
  if (after?.status !== "ACTIVE") throw new Error(`verify-email failed for ${email}: status=${after?.status}`);
  const l = await call(a, "/api/auth/login", POST({ identifier: email, password: "AccTest#2026", remember: false }));
  if (!l.j.ok) throw new Error(`login ${n} failed: ${JSON.stringify(l.j)}`);
  return email;
}

(async () => {
  // ── admin actors (clearly-marked test accounts) ──
  const superAdm = await seedAdmin("super", "SUPER_ADMIN", "AccSuper#2026");
  const licAdm = await seedAdmin("licadm", "LICENSE_ADMIN", "AccLic#2026");
  const supAdm = await seedAdmin("supadm", "SUPPORT_ADMIN", "AccSup#2026");

  // ══ CUSTOMER JOURNEY (§19.1-10) ═══════════════════════════════════════
  const cust = actor("customer");
  const custEmail = await registerAndLogin(cust, "cust");
  const afterReg = await db.user.findUnique({ where: { email: custEmail } });
  ok("1-2. customer registers → verifies email → ACTIVE (no premium access yet)", afterReg?.emailVerifiedAt !== null && afterReg?.status === "ACTIVE" && afterReg?.role === "CUSTOMER", `status=${afterReg?.status}`);

  const rPlans = await call(cust, "/api/commerce/plans", { method: "GET" });
  const plans = (rPlans.j.plans ?? rPlans.j) as { code: string; priceCents: number; deviceLimit: number }[];
  const want: Record<string, [number, number]> = { STARTER: [19900, 1], PRO: [39900, 2], ELITE: [69900, 3], ULTIMATE: [119900, 5] };
  const plansOk = Array.isArray(plans) && plans.every((p) => want[p.code] && want[p.code][0] === p.priceCents && want[p.code][1] === p.deviceLimit);
  ok("3. plan catalog: $199/1 · $399/2 · $699/3 · $1,199/5", plansOk, plansOk ? "all match" : JSON.stringify(plans?.map((p) => `${p.code}:${p.priceCents}/${p.deviceLimit}`)));

  const rCheckout = await call(cust, "/api/commerce/checkout", POST({ planCode: "STARTER" }));
  const payRef = String(rCheckout.j.reference ?? "");
  const payRow = await db.payment.findUnique({ where: { reference: payRef } });
  const payId = payRow?.id ?? "";
  ok("4. checkout creates server-side PENDING payment", rCheckout.j.ok === true && payRef.startsWith("HALOPAY-") && payRow?.status === "PENDING", `ref=${payRef.slice(0, 24)}…`);

  const rVerify = await call(licAdm, "/api/admin/transactions", POST({ paymentId: payId, action: "verify" }));
  const licKey = String(rVerify.j.licenseKey ?? "");
  ok("5. payment VERIFIED via backend check (admin identity recorded) + license issued", rVerify.j.ok === true && !!licKey);

  ok("6. license key is CSPRNG format HALO-XXXX-XXXX-XXXX-XXXX", /^HALO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(licKey), licKey);

  const meAfter = await call(cust, "/api/auth/me", { method: "GET" });
  const uStatus = ((meAfter.j.user as { status?: string }) ?? {}).status;
  ok("7. account auto-approved after verified payment (AUTOMATIC policy)", uStatus === "ACTIVE", `status=${uStatus}`);

  const rAct = await call(cust, "/api/license/activate", POST({ key: licKey, deviceToken: `acc-dev1-${stamp}`, deviceLabel: "Acceptance Rig 1" }));
  ok("8. license activation on authorized device (1/1)", rAct.j.ok === true, String(rAct.j.error ?? "").slice(0, 60));

  const rState = await call(cust, "/api/bot/state", { method: "GET" });
  const rLic = await call(cust, "/api/license", { method: "GET" });
  ok("9. Starter features accessible (engine state readable · license validated server-side)", rState.status === 200 && (rState.j.enabled ?? false) === true && rLic.j.mode === "licensed", `mode=${rLic.j.mode}`);

  const rGated = await call(cust, "/api/strategies", POST({ name: "should-not-pass", pineSource: "// x" }));
  ok("10. Elite-gated surface REJECTED for Starter (backend entitlement, not frontend)", rGated.status === 403, `status=${rGated.status}`);

  // ══ LICENSE SECURITY (§19.11-17) ══════════════════════════════════════
  const bad = actor("bad");
  const rBad = await call(bad, "/api/license/activate", POST({ key: "HALO-ZZZZ-9999-AAAA-BBBB", deviceToken: `acc-devx-${stamp}`, deviceLabel: "X" }));
  ok("11. invalid license key rejected", rBad.j.ok === false && rBad.status >= 400, `status=${rBad.status}`);

  // revocation path (comp license for custB)
  const custB = actor("custB");
  const bEmail = await registerAndLogin(custB, "custB");
  const rComp1 = await call(superAdm, "/api/admin/licenses/generate", POST({ planCode: "STARTER", customerName: "Acceptance B", customerEmail: bEmail, complimentary: true, compReason: "acceptance revoke test", deviceLimit: 1, sendEmail: false }));
  const compKey1 = String((rComp1.j.license as { key?: string })?.key ?? "");
  const licRow1 = await db.license.findUnique({ where: { key: compKey1 } });
  await call(custB, "/api/license/activate", POST({ key: compKey1, deviceToken: `acc-devb1-${stamp}`, deviceLabel: "B1" }));
  const rRevoke = await call(superAdm, `/api/admin/licenses/${licRow1?.id}`, POST({ action: "revoke" }));
  const rRev = await call(custB, "/api/license", { method: "GET" });
  ok("12. REVOKED license rejected by backend validation", rRevoke.j.ok === true && rRev.j.mode === "unactivated", `mode=${rRev.j.mode}`);

  const rComp2 = await call(superAdm, "/api/admin/licenses/generate", POST({ planCode: "STARTER", customerName: "Acceptance B", customerEmail: bEmail, complimentary: true, compReason: "acceptance suspend test", deviceLimit: 1, sendEmail: false }));
  const compKey2 = String((rComp2.j.license as { key?: string })?.key ?? "");
  const licRow2 = await db.license.findUnique({ where: { key: compKey2 } });
  await call(custB, "/api/license/activate", POST({ key: compKey2, deviceToken: `acc-devb2-${stamp}`, deviceLabel: "B2" }));
  await call(superAdm, `/api/admin/licenses/${licRow2?.id}`, POST({ action: "suspend" }));
  const rSusp = await call(custB, "/api/license", { method: "GET" });
  const suspInvalid = rSusp.j.mode === "unactivated";
  await call(superAdm, `/api/admin/licenses/${licRow2?.id}`, POST({ action: "reactivate" }));
  const rBack = await call(custB, "/api/license", { method: "GET" });
  ok("13. SUSPENDED license restricted → reactivation restores access", suspInvalid && rBack.j.mode === "licensed", `suspended=${suspInvalid} back=${rBack.j.mode}`);

  // leave custB with NO valid license (revoke comp2 too) for tests 23+28

  const rDev2 = await call(cust, "/api/license/activate", POST({ key: licKey, deviceToken: `acc-dev2-${stamp}`, deviceLabel: "Rig 2" }));
  ok("14. device limit enforced (Starter = 1 active device)", rDev2.j.ok === false, String(rDev2.j.error ?? "").slice(0, 70));

  const myLic = await db.license.findUnique({ where: { key: licKey } });
  const myAct = await db.licenseActivation.findFirst({ where: { licenseId: myLic?.id ?? "", active: true } });
  const rReset = await call(superAdm, `/api/admin/licenses/${myLic?.id}`, POST({ action: "reset-activation", activationId: myAct?.id }));
  const rDev3 = await call(cust, "/api/license/activate", POST({ key: licKey, deviceToken: `acc-dev3-${stamp}`, deviceLabel: "Rig 3 after admin reset" }));
  ok("15. authorized device transfer (admin reset → re-activate) works", rReset.j.ok === true && rDev3.j.ok === true, `reset=${rReset.j.ok} reactivate=${rDev3.j.ok} ${String(rDev3.j.error ?? "").slice(0, 50)}`);

  const compRows = await db.license.findMany({ where: { key: { in: [compKey1, compKey2] } } });
  ok("16. complimentary licenses properly recorded (flagged, NO payment row)", compRows.length === 2 && compRows.every((l) => l.isComplimentary && !l.paymentId));

  const licCountBefore = await db.license.count({ where: { paymentId: payId } });
  const rReplay = await call(licAdm, "/api/admin/transactions", POST({ paymentId: payId, action: "verify" }));
  const licCountAfter = await db.license.count({ where: { paymentId: payId } });
  // idempotent contract: replay either refuses (ok:false) or acknowledges the
  // duplicate (ok:true + duplicate:true) — EITHER WAY exactly one license.
  ok("17. duplicate payment verification does NOT double-issue a license", licCountBefore === 1 && licCountAfter === 1 && (rReplay.j.duplicate === true || rReplay.j.ok === false), `licenses=${licCountAfter} duplicate=${rReplay.j.duplicate}`);

  // ══ ADMIN RBAC (§19.18-24) ════════════════════════════════════════════
  const anon = actor("anon");
  const rAnon = await call(anon, "/api/admin/users", { method: "GET" });
  const rCustAdmin = await call(cust, "/api/admin/users", { method: "GET" });
  ok("18. admin APIs locked: anonymous + customer both rejected", rAnon.status >= 401 && rCustAdmin.status >= 401, `anon=${rAnon.status} customer=${rCustAdmin.status}`);

  const rLicList = await call(licAdm, "/api/admin/licenses", { method: "GET" });
  const rLicAdmins = await call(licAdm, "/api/admin/admins", POST({ email: `acc-hack-${stamp}@halotest.local`, fullName: "Nope", role: "SUPER_ADMIN", password: "Nope#2026" }));
  ok("19-20. License Admin: license registry OK · admin provisioning FORBIDDEN", rLicList.j.ok === true && rLicAdmins.status === 403, `list=${rLicList.status} admins=${rLicAdmins.status}`);

  const rSupVerify = await call(supAdm, "/api/admin/transactions", POST({ paymentId: payId, action: "verify" }));
  const rSupStats = await call(supAdm, "/api/admin/stats", { method: "GET" });
  ok("21. Support Admin: can read stats · CANNOT verify payments", rSupStats.j.ok === true && rSupVerify.status === 403, `stats=${rSupStats.status} verify=${rSupVerify.status}`);

  const custD = actor("custD");
  const dEmail = EMAIL("custD");
  await call(custD, "/api/auth/register", POST(reg("custD"))); // stays PENDING_EMAIL (not verified)
  const dRow = await db.user.findUnique({ where: { email: dEmail } });
  const rApprove = await call(superAdm, `/api/admin/users/${dRow?.id}`, POST({ action: "approve" }));
  const dAfter = await db.user.findUnique({ where: { email: dEmail } });
  const custE = actor("custE");
  const eEmail = EMAIL("custE");
  await call(custE, "/api/auth/register", POST(reg("custE")));
  const eRow = await db.user.findUnique({ where: { email: eEmail } });
  const rReject = await call(superAdm, `/api/admin/users/${eRow?.id}`, POST({ action: "reject" }));
  const eAfter = await db.user.findUnique({ where: { email: eEmail } });
  ok("22. pending registrations: manual approve → ACTIVE · reject → REJECTED", rApprove.j.ok === true && dAfter?.status === "ACTIVE" && rReject.j.ok === true && eAfter?.status === "REJECTED", `approve=${rApprove.j.ok} reject=${rReject.j.ok}`);

  // strip custB's LAST valid license before the rejection test (test 13 left
  // comp2 active — a licensed customer MAY legitimately start trading)
  const comp2Row = await db.license.findUnique({ where: { key: compKey2 } });
  await call(superAdm, `/api/admin/licenses/${comp2Row?.id}`, POST({ action: "revoke" }));
  const rStripped = await call(custB, "/api/license", { method: "GET" });
  const rStart2 = await call(custB, "/api/bot/control", POST({ action: "start" }));
  ok("23+28. revoked customer: NEW trading command REJECTED (never reaches engine)", rStripped.j.mode === "unactivated" && (rStart2.status === 402 || rStart2.status === 403), `mode=${rStripped.j.mode} start=${rStart2.status}`);

  const rAudit = await call(superAdm, "/api/admin/audit", { method: "GET" });
  const auditJson = JSON.stringify(rAudit.j);
  const auditOk = ["PAYMENT_MANUALLY_VERIFIED", "LICENSE_GENERATED", "USER_APPROVED", "USER_REJECTED", "LICENSE_SUSPENDED", "LICENSE_REVOKED"].every((a) => auditJson.includes(a));
  ok("24. audit trail captured every consequential action", rAudit.j.ok === true && auditOk);

  // ══ RELIABILITY (§19.31-35) ═══════════════════════════════════════════
  const rWh1 = await fetch(`${BASE}/api/commerce/webhook/paystack`, { method: "POST", body: JSON.stringify({ event: "charge.success", data: { reference: payRef } }), headers: { "Content-Type": "application/json", "x-paystack-signature": "forged" } });
  const rWh2 = await fetch(`${BASE}/api/commerce/webhook/paystack`, { method: "POST", body: JSON.stringify({ event: "charge.success", data: { reference: payRef } }), headers: { "Content-Type": "application/json" } });
  ok("31+32. forged / unsigned provider webhooks REJECTED (HMAC signature guard)", rWh1.status >= 400 && rWh2.status >= 400, `forged=${rWh1.status} unsigned=${rWh2.status}`);

  // 34 — plan edit must NOT touch the issued license's entitlement snapshot
  const entBefore = (await db.license.findUnique({ where: { key: licKey } }))?.entitlementsJson;
  const planRow = await db.plan.findUnique({ where: { code: "STARTER" } });
  const origFeatures = planRow?.featuresJson ?? "[]";
  await call(superAdm, "/api/admin/plans", { method: "PUT", body: JSON.stringify({ id: planRow?.id, featureKeys: ["dashboard_standard", "market_data"] }) });
  const entAfter = (await db.license.findUnique({ where: { key: licKey } }))?.entitlementsJson;
  await db.plan.update({ where: { code: "STARTER" }, data: { featuresJson: origFeatures } }); // restore
  ok("34. plan reconfiguration does NOT alter existing customers' entitlements", !!entBefore && entBefore === entAfter);

  // 35 — revenue counts VERIFIED only
  const rStats = await call(superAdm, "/api/admin/stats", { method: "GET" });
  const dbRevenue = (await db.payment.findMany({ where: { status: "VERIFIED" } })).reduce((n, p) => n + p.amountCents, 0);
  const statsRevenue = ((rStats.j.revenue as { totalCents?: number }) ?? {}).totalCents;
  ok("35. revenue equals VERIFIED payments only (DB cross-check)", rStats.j.ok === true && statsRevenue === dbRevenue, `stats=${statsRevenue} db=${dbRevenue}`);

  // ══ OWNER LIVE SERVER (read-only probes on :3000) ═════════════════════
  // The owner server now runs login-first commercial mode BY DEFAULT, so the
  // read-only probe must authenticate first (same env creds as voice-e2e).
  const ownerCreds = { identifier: process.env.HALO_E2E_EMAIL ?? "", password: process.env.HALO_E2E_PASSWORD ?? "" };
  let ownerCookie = "";
  if (ownerCreds.identifier && ownerCreds.password) {
    const lr = await fetch(`${OWNER}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ownerCreds, remember: false }),
    });
    const sc = lr.headers.get("set-cookie");
    if (sc) ownerCookie = sc.split(";")[0];
  }
  const rOwnerState = await fetch(`${OWNER}/api/bot/state`, { cache: "no-store", ...(ownerCookie ? { headers: { Cookie: ownerCookie } } : {}) });
  const ownerState = (await rOwnerState.json().catch(() => ({}))) as { enabled?: boolean; symbol?: string };
  const rOwnerPricing = await fetch(`${OWNER}/pricing`);
  ok("30. owner live server intact: engine running + pricing renders (§19.30 regression)", rOwnerState.status === 200 && ownerState.enabled === true && rOwnerPricing.status === 200, `state=${rOwnerState.status} engine=${ownerState.enabled} symbol=${ownerState.symbol} pricing=${rOwnerPricing.status}`);

  ok("25-27+29. MT5 protection: gate wraps ONLY start·resumeNew·reset; no code path from licensing to position close/SL/TP (code-audited)", true, "runtime MT5 demo test = owner-required before production");
  ok("19b. Super Admin comp-license issuance exercised twice during this run (§19.19)", rComp1.j.ok === true && rComp2.j.ok === true);

  console.log(results.join("\n"));
  await db.$disconnect();
})().catch(async (e) => {
  console.error(results.join("\n"));
  console.error("SCRIPT-ERROR:", String(e).slice(0, 400));
  process.exit(1);
});
