// ══════════════════════════════════════════════════════════════════════════
//  TWO-FACTOR AUTHENTICATION · TOTP (RFC 6238) + single-use recovery codes
//
//  • Secret: 160 random bits, base32, stored ENCRYPTED (secret-box, the same
//    HALO_DATA_KEY as broker credentials) in SystemSetting "2fa:<userId>" —
//    no schema migration. A missing/wrong key fails closed (cannot enrol).
//  • Codes: 6 digits / 30 s, ±1 step clock tolerance; a code (time step)
//    can never be used twice.
//  • Recovery: 10 codes, shown once, stored as SHA-256 hashes, single use.
//  • Login challenge: password OK → short-lived challenge (5 min, 5 tries);
//    only a valid code turns it into a session (login route, the only place
//    sessions are created).
//  Opt-in per account (admins); a server-side reset exists for break-glass
//  recovery (scripts/admin-credentials.ts --reset-2fa).
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { db } from "@/lib/db";
import { seal, tryOpen } from "@/lib/secret-box";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_S = 30;
const DIGITS = 6;
const WINDOW = 1;
const RECOVERY_COUNT = 10;
const ISSUER = "HALO 3EL";

// ───────────────────────── pure helpers ─────────────────────────

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** the TOTP code for a time step */
export function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function stepOf(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_S);
}

/** verify a 6-digit code; returns the matched step (must be > lastStep: no replay) */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep: number): { ok: boolean; step: number } {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return { ok: false, step: lastStep };
  const now = stepOf(nowMs);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const s = now + d;
    if (s <= lastStep) continue;
    const want = totpAt(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return { ok: true, step: s };
  }
  return { ok: false, step: lastStep };
}

export function otpauthUri(account: string, secret: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`;
}

const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z2-7]/g, "");
const hashCode = (c: string) => crypto.createHash("sha256").update(`halo-2fa-recovery:${normCode(c)}`).digest("hex");

export function newRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: RECOVERY_COUNT }, () => {
    const s = base32Encode(crypto.randomBytes(6)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { plain, hashes: plain.map(hashCode) };
}

// ───────────────────────── storage ─────────────────────────

export interface TwoFactorRecord {
  secret: string | null; // active secret (null = not enabled)
  pendingSecret: string | null; // during enrolment, until the first code is confirmed
  enabledAt: string | null;
  lastStep: number;
  recovery: string[]; // remaining recovery-code hashes
}

const keyOf = (userId: string) => `2fa:${userId}`;
const EMPTY: TwoFactorRecord = { secret: null, pendingSecret: null, enabledAt: null, lastStep: 0, recovery: [] };

export async function loadTwoFactor(userId: string): Promise<TwoFactorRecord> {
  const row = await db.systemSetting.findUnique({ where: { key: keyOf(userId) } });
  if (!row) return { ...EMPTY };
  const plain = tryOpen(row.valueJson);
  if (plain === null) throw new Error("two-factor data cannot be decrypted (HALO_DATA_KEY missing or changed)");
  return { ...EMPTY, ...(JSON.parse(plain) as Partial<TwoFactorRecord>) };
}

async function saveTwoFactor(userId: string, rec: TwoFactorRecord): Promise<void> {
  const valueJson = seal(JSON.stringify(rec)); // throws without a valid key → never stored in plaintext
  await db.systemSetting.upsert({ where: { key: keyOf(userId) }, create: { key: keyOf(userId), valueJson, updatedById: userId }, update: { valueJson, updatedById: userId } });
}

export async function twoFactorEnabled(userId: string): Promise<boolean> {
  try {
    return !!(await loadTwoFactor(userId)).secret;
  } catch {
    // data exists but cannot be read: treat as ENABLED so sign-in is refused
    // rather than silently skipping the second factor
    return true;
  }
}

/** step 1 of enrolment: a fresh pending secret (the active one, if any, stays until confirmed) */
export async function beginEnrolment(userId: string, account: string): Promise<{ secret: string; uri: string }> {
  const rec = await loadTwoFactor(userId);
  const secret = generateSecret();
  await saveTwoFactor(userId, { ...rec, pendingSecret: secret });
  return { secret, uri: otpauthUri(account, secret) };
}

/** step 2: confirm the first code → enabled; returns the recovery codes (shown once) */
export async function confirmEnrolment(userId: string, code: string, nowMs = Date.now()): Promise<{ ok: true; recovery: string[] } | { ok: false; error: string }> {
  const rec = await loadTwoFactor(userId);
  if (!rec.pendingSecret) return { ok: false, error: "Start setup first." };
  const v = verifyTotp(rec.pendingSecret, code, nowMs, 0);
  if (!v.ok) return { ok: false, error: "That code is not valid — check the time on your phone and try the current code." };
  const rc = newRecoveryCodes();
  await saveTwoFactor(userId, { secret: rec.pendingSecret, pendingSecret: null, enabledAt: new Date(nowMs).toISOString(), lastStep: v.step, recovery: rc.hashes });
  return { ok: true, recovery: rc.plain };
}

/** check a sign-in / sensitive-action code: TOTP or a single-use recovery code */
export async function checkSecondFactor(userId: string, code: string, nowMs = Date.now()): Promise<{ ok: boolean; via?: "totp" | "recovery"; remaining?: number }> {
  const rec = await loadTwoFactor(userId);
  if (!rec.secret) return { ok: false };
  const v = verifyTotp(rec.secret, code, nowMs, rec.lastStep);
  if (v.ok) {
    await saveTwoFactor(userId, { ...rec, lastStep: v.step });
    return { ok: true, via: "totp", remaining: rec.recovery.length };
  }
  const h = hashCode(code);
  if (normCode(code).length === 10 && rec.recovery.includes(h)) {
    const recovery = rec.recovery.filter((x) => x !== h);
    await saveTwoFactor(userId, { ...rec, recovery });
    return { ok: true, via: "recovery", remaining: recovery.length };
  }
  return { ok: false };
}

export async function regenerateRecovery(userId: string): Promise<string[]> {
  const rec = await loadTwoFactor(userId);
  const rc = newRecoveryCodes();
  await saveTwoFactor(userId, { ...rec, recovery: rc.hashes });
  return rc.plain;
}

export async function disableTwoFactor(userId: string): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: keyOf(userId) } });
}

// ───────────────────────── login challenges ─────────────────────────

interface Challenge {
  userId: string;
  remember: boolean;
  expiresAt: number;
  attempts: number;
}
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const gc = globalThis as unknown as { __halo2faChallenges?: Map<string, Challenge> };
const challenges = (gc.__halo2faChallenges ??= new Map<string, Challenge>());
const chKey = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function createChallenge(userId: string, remember: boolean): string {
  const now = Date.now();
  for (const [k, c] of challenges) if (c.expiresAt < now) challenges.delete(k);
  const token = crypto.randomBytes(24).toString("hex");
  challenges.set(chKey(token), { userId, remember, expiresAt: now + CHALLENGE_TTL_MS, attempts: 0 });
  return token;
}

/** consume one attempt on a challenge; null = expired / unknown / out of attempts */
export function consumeChallenge(token: string): (Challenge & { last: boolean }) | null {
  const k = chKey(token);
  const c = challenges.get(k);
  if (!c || c.expiresAt < Date.now()) {
    challenges.delete(k);
    return null;
  }
  c.attempts += 1;
  if (c.attempts > MAX_ATTEMPTS) {
    challenges.delete(k);
    return null;
  }
  return { ...c, last: c.attempts === MAX_ATTEMPTS };
}

export function finishChallenge(token: string): void {
  challenges.delete(chKey(token));
}
