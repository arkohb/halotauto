// ══════════════════════════════════════════════════════════════════════════
//  AUTH · credential authentication with DB-backed sessions
//  - scrypt password hashing (node:crypto — no extra dependencies)
//  - opaque random session tokens; only sha256 hashes are stored
//  - instant revocation: suspended/blocked accounts lose access immediately
//  Server-only. Never trust a frontend role value.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ROLES, type Role } from "./constants";

export const SESSION_COOKIE = "halo_session";
/** httpOnly cookie holding this browser's activated-device token (set by the server on activation) */
export const DEVICE_COOKIE = "halo_device";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days ("remember me")
const SCRYPT_KEYLEN = 64;

// ── Passwords ──────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, "hex");
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(pw: string): string | null {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 128) return "Password must be at most 128 characters.";
  if (!/[a-zA-Z]/.test(pw)) return "Password must contain a letter.";
  if (!/[0-9]/.test(pw)) return "Password must contain a number.";
  return null;
}

export function emailProblem(email: string): string | null {
  if (!email || email.length > 200) return "Enter a valid e-mail address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "Enter a valid e-mail address.";
  return null;
}

// ── Sessions ───────────────────────────────────────────────────────────────

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}

export interface SafeUser {
  id: string;
  email: string;
  username: string | null;
  fullName: string;
  country: string;
  role: Role;
  status: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export function toSafeUser(u: {
  id: string;
  email: string;
  username: string | null;
  fullName: string;
  country: string;
  role: string;
  status: string;
  emailVerifiedAt: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}): SafeUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    fullName: u.fullName,
    country: u.country,
    role: u.role as Role,
    status: u.status,
    emailVerified: !!u.emailVerifiedAt,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

/** Create a DB session; returns the raw token to place in the cookie. */
export async function createSession(userId: string, userAgent: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      userAgent: (userAgent || "").slice(0, 250),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    await db.session.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

/** Session id + bound device for this request (null when signed out / revoked). */
export async function getSessionContext(): Promise<{ sessionId: string; userId: string; activationId: string | null; deviceToken: string | null } | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(SESSION_COOKIE)?.value;
    if (!raw) return null;
    const session = await db.session.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    return { sessionId: session.id, userId: session.userId, activationId: session.activationId, deviceToken: jar.get(DEVICE_COOKIE)?.value ?? null };
  } catch {
    return null;
  }
}

/** was this request made over HTTPS (directly or behind a proxy)? */
export function requestIsHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

/** Set the device cookie on this response (httpOnly — page scripts cannot read or forge it). */
export async function setDeviceCookie(deviceToken: string, secure: boolean): Promise<void> {
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, deviceToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/** The authenticated user for this request (null when signed out / revoked). */
export async function getSessionUser(): Promise<SafeUser | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(SESSION_COOKIE)?.value;
    if (!raw) return null;
    const session = await db.session.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    const u = session.user;
    if (u.status === "SUSPENDED" || u.status === "BLOCKED" || u.status === "REJECTED") return null;
    return toSafeUser(u);
  } catch {
    return null;
  }
}

export function isAdminRole(role: string): boolean {
  return role === ROLES.SUPER_ADMIN || role === ROLES.LICENSE_ADMIN || role === ROLES.SUPPORT_ADMIN;
}

export type Guard<T> = { ok: true; user: T } | { ok: false; error: string; status: number };

/** Route guard: any authenticated, non-revoked account. */
export async function requireUser(): Promise<Guard<SafeUser>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Sign in to continue.", status: 401 };
  return { ok: true, user };
}

/** Route guard: administrators only, checked server-side. */
export async function requireAdmin(min?: Role | Role[]): Promise<Guard<SafeUser>> {
  const g = await requireUser();
  if (!g.ok) return g;
  const u = g.user;
  if (!isAdminRole(u.role)) return { ok: false, error: "Administrator access required.", status: 403 };
  if (min) {
    const need = Array.isArray(min) ? min : [min];
    if (!need.includes(u.role)) return { ok: false, error: "Your administrator role is not permitted to perform this action.", status: 403 };
  }
  return { ok: true, user: u };
}

export async function requireSuper(): Promise<Guard<SafeUser>> {
  return requireAdmin(ROLES.SUPER_ADMIN);
}
