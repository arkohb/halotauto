// Two-factor sign-in — end-to-end over HTTP against a running HALO server.
//   TFA_BASE=http://127.0.0.1:3100 TFA_EMAIL=… TFA_PASSWORD=… DATABASE_URL=file:<copy> \
//     npx tsx scripts/two-factor-e2e.ts
// Use ONLY with a throwaway database copy and a throwaway admin account:
// it turns 2FA on and off for TFA_EMAIL.
import { PrismaClient } from "@prisma/client";
import { stepOf, totpAt } from "../src/lib/commerce/two-factor";

const BASE = process.env.TFA_BASE ?? "http://127.0.0.1:3100";
const EMAIL = process.env.TFA_EMAIL ?? "";
const PASSWORD = process.env.TFA_PASSWORD ?? "";
if (!EMAIL || !PASSWORD || !String(process.env.DATABASE_URL).includes("halo-2fa-e2e")) {
  console.error("refusing to run: needs TFA_EMAIL, TFA_PASSWORD and a DATABASE_URL pointing at the halo-2fa-e2e copy");
  process.exit(2);
}

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};

async function call(path: string, body?: unknown, cookie?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.get("set-cookie") ?? "";
  const m = /halo_session=([^;]+)/.exec(set);
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown>, cookie: m ? `halo_session=${m[1]}` : undefined };
}

const nextStepCode = async (secret: string, after: number) => {
  // wait until a fresh 30-s step so the code has not been used yet
  while (stepOf(Date.now()) <= after) await new Promise((r) => setTimeout(r, 1000));
  return { code: totpAt(secret, stepOf(Date.now())), step: stepOf(Date.now()) };
};

async function main() {
  const db = new PrismaClient();
  const login = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  ok(login.status === 200 && !!login.cookie && !login.json.twoFactorRequired, "before enrolment: password alone signs in");
  const s1 = login.cookie!;
  const other = (await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD })).cookie!;

  ok((await call("/api/auth/2fa", undefined, s1)).json.enabled === false, "status: two-factor OFF");
  ok((await call("/api/auth/2fa", { action: "setup", password: "wrong-password-1" }, s1)).status === 401, "setup with a wrong password is refused");
  const setup = await call("/api/auth/2fa", { action: "setup", password: PASSWORD }, s1);
  const secret = String(setup.json.secret ?? "");
  ok(setup.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && String(setup.json.uri).startsWith("otpauth://totp/"), "setup returns a 160-bit key and an otpauth link");
  ok((await call("/api/auth/2fa", { action: "enable", code: "000000" }, s1)).status === 400, "enable with a wrong code is refused");

  let c = await nextStepCode(secret, 0);
  const en = await call("/api/auth/2fa", { action: "enable", code: c.code }, s1);
  const recovery = (en.json.recovery as string[]) ?? [];
  ok(en.status === 200 && recovery.length === 10, "enable with the right code → ON + 10 recovery codes");
  ok(Number(en.json.otherSessionsRevoked) >= 1 && (await call("/api/auth/me", undefined, other)).json.authenticated !== true, "turning it on signs out the other session");
  ok((await call("/api/auth/me", undefined, s1)).json.authenticated === true, "…but keeps the current one");

  const row = await db.systemSetting.findFirst({ where: { key: { startsWith: "2fa:" } } });
  ok(!!row && row.valueJson.startsWith("enc:v1:") && !row.valueJson.includes(secret), "the secret is stored encrypted, never in plaintext");

  // second step at sign-in
  const l2 = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  ok(l2.status === 200 && l2.json.twoFactorRequired === true && !l2.cookie, "after enrolment: password gives NO session, only a challenge");
  const ch = String(l2.json.challenge);
  ok((await call("/api/auth/2fa/verify", { challenge: ch, code: "123456" })).status === 401, "wrong code refused");
  ok((await call("/api/auth/2fa/verify", { challenge: "forged", code: c.code })).status === 401, "a forged challenge is refused");
  c = await nextStepCode(secret, c.step);
  const v = await call("/api/auth/2fa/verify", { challenge: ch, code: c.code });
  ok(v.status === 200 && !!v.cookie, "right code → session created");
  ok((await call("/api/auth/me", undefined, v.cookie)).json.authenticated === true, "…and the session works");
  ok((await call("/api/auth/2fa/verify", { challenge: ch, code: c.code })).status === 401, "the challenge cannot be reused");
  const l3 = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  ok((await call("/api/auth/2fa/verify", { challenge: String(l3.json.challenge), code: c.code })).status === 401, "the same code cannot be replayed on a new sign-in");

  // recovery code
  const l4 = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  const rv = await call("/api/auth/2fa/verify", { challenge: String(l4.json.challenge), code: recovery[0].toLowerCase() });
  ok(rv.status === 200 && rv.json.usedRecoveryCode === true && rv.json.recoveryRemaining === 9, "a recovery code signs in once (9 left)");
  const l5 = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  ok((await call("/api/auth/2fa/verify", { challenge: String(l5.json.challenge), code: recovery[0] })).status === 401, "the used recovery code is dead");

  // 5 tries per challenge
  const l6 = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  let r6 = { status: 0, json: {} as Record<string, unknown> };
  for (let i = 0; i < 5; i++) r6 = await call("/api/auth/2fa/verify", { challenge: String(l6.json.challenge), code: "999999" });
  ok(r6.json.restart === true, "after 5 wrong codes the password must be entered again");

  // turn off
  const s2 = rv.cookie!;
  ok((await call("/api/auth/2fa", { action: "disable", password: PASSWORD, code: "000000" }, s2)).status === 401, "turning off needs a valid code");
  ok((await call("/api/auth/2fa", { action: "disable", password: PASSWORD, code: recovery[1] }, s2)).status === 200, "password + recovery code turns it off");
  const l7 = await call("/api/auth/login", { identifier: EMAIL, password: PASSWORD });
  ok(l7.status === 200 && !!l7.cookie && !l7.json.twoFactorRequired, "after turning off: password alone signs in again");

  const audits = await db.auditLog.findMany({ where: { action: { startsWith: "2FA_" } }, select: { action: true } });
  const names = new Set(audits.map((a) => a.action));
  ok(["2FA_SETUP_STARTED", "2FA_ENABLED", "2FA_DISABLED"].every((n) => names.has(n)) && (await db.auditLog.count({ where: { action: "LOGIN_2FA_FAILED" } })) >= 5, "setup, enable, disable and failed codes are in the audit log");

  await db.$disconnect();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
