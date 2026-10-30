// ══════════════════════════════════════════════════════════════════════════
//  LICENSE ENGINE · server-side generation, activation and validation
//  - Keys: HALO-XXXX-XXXX-XXXX-XXXX from crypto.randomBytes (CSPRNG),
//    unambiguous alphabet, collision-checked against the DB.
//    Signing keys stay on the backend (LICENSE_SIGNING_SECRET / fallback to
//    HALO_LICENSE_SECRET); nothing privileged is ever exposed to the client.
//  - Entitlement snapshot is captured at issuance → later plan edits never
//    change what an existing customer purchased.
//  - Activation enforces the device allowance server-side.
//  - NEVER touches the MT5/execution engine: this module has no imports
//    from lib/brokers, lib/bot or lib/execution, and no code path here can
//    close a position or alter protective orders.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { db } from "@/lib/db";
import { LICENSE_STATUSES, ROLES } from "./constants";
import { entitlementSnapshot, parseEntitlements } from "./entitlements";
import { logAudit } from "./audit";
import { licenseIssuedEmail, notify, sendMail, addressed } from "./mailer";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 confusion
const GROUPS = 4;
const GROUP_LEN = 4;

function signingSecret(): string {
  return process.env.LICENSE_SIGNING_SECRET || process.env.HALO_LICENSE_SECRET || "";
}

/** CSPRNG key in the professional HALO-XXXX-XXXX-XXXX-XXXX format. */
export function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(GROUPS * GROUP_LEN);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  const g = (n: number) => chars.slice(n * GROUP_LEN, n * GROUP_LEN + GROUP_LEN).join("");
  return `HALO-${g(0)}-${g(1)}-${g(2)}-${g(3)}`;
}

async function uniqueKey(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const key = generateLicenseKey();
    const clash = await db.license.findUnique({ where: { key } });
    if (!clash) return key;
  }
  throw new Error("Unable to allocate a unique license key — try again.");
}

export function maskKey(key: string): string {
  const raw = key.replace(/-/g, "");
  if (raw.length < 8) return "HALO-••••-••••";
  return `HALO-••••-••••-${raw.slice(-4)}`;
}

export function canonicalKey(key: string): string {
  let raw = (key ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.startsWith("HALO")) raw = raw.slice(4);
  if (raw.length !== 16) return (key ?? "").toUpperCase().trim();
  return `HALO-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

// ── Generation ─────────────────────────────────────────────────────────────

export interface GenerateLicenseInput {
  planCode: string;
  planName: string;
  deviceLimit: number;
  userId?: string | null;
  customerLabel?: string; // free-text holder note when no account exists
  kind?: "SINGLE_USER" | "MULTI_USER";
  seatLimit?: number;
  expiresAt?: Date | null;
  isComplimentary?: boolean;
  compReason?: string;
  paymentId?: string | null;
  issuedBy?: { id: string; email: string; role: string } | { id: "system"; email: "system"; role: "system" };
  notes?: string;
  sendEmail?: boolean;
}

export async function generateLicense(input: GenerateLicenseInput) {
  const key = await uniqueKey();
  const license = await db.license.create({
    data: {
      key,
      userId: input.userId ?? null,
      planCode: input.planCode,
      planName: input.planName,
      entitlementsJson: JSON.stringify(entitlementSnapshot(input.planCode)),
      status: LICENSE_STATUSES.UNACTIVATED,
      kind: input.kind ?? "SINGLE_USER",
      seatLimit: input.seatLimit ?? 1,
      deviceLimit: Math.max(1, input.deviceLimit || 1),
      isComplimentary: !!input.isComplimentary,
      compReason: input.compReason ?? "",
      paymentId: input.paymentId ?? null,
      issuedById: input.issuedBy?.id ?? null,
      notes: input.notes ?? "",
      expiresAt: input.expiresAt ?? null,
    },
  });

  await logAudit({
    action: "LICENSE_GENERATED",
    actorId: input.issuedBy?.id ?? "system",
    actorEmail: input.issuedBy?.email ?? "system",
    actorRole: input.issuedBy?.role ?? "system",
    targetType: "license",
    targetId: license.id,
    meta: {
      keyMasked: maskKey(key),
      plan: input.planCode,
      complimentary: !!input.isComplimentary,
      compReason: input.compReason ?? "",
      paymentId: input.paymentId ?? "",
      deviceLimit: license.deviceLimit,
    },
  });

  if (input.userId && input.sendEmail !== false) {
    const user = await db.user.findUnique({ where: { id: input.userId } });
    if (user) {
      await notify(user.id, "license", `${input.planName} license issued`, `License ${maskKey(key)} is ready for activation.`);
      void sendMail(addressed(licenseIssuedEmail(user.fullName, key, input.planName, !!input.isComplimentary), user.email));
    }
  }
  if (input.customerLabel) {
    await logAudit({
      action: "LICENSE_HOLDER_NOTED",
      actorId: input.issuedBy?.id ?? "system",
      targetType: "license",
      targetId: license.id,
      meta: { holder: input.customerLabel },
    });
  }
  return license;
}

/**
 * Idempotent license issuance for a VERIFIED payment.
 * If the payment already produced a license it is returned unchanged —
 * duplicate webhooks or recovery retries never double-issue.
 */
export async function issueLicenseForPayment(paymentId: string, issuedBy?: { id: string; email: string; role: string }) {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { plan: true, user: true } });
  if (!payment) throw new Error("Payment not found.");
  if (payment.licenseRef) {
    const existing = await db.license.findUnique({ where: { key: payment.licenseRef } });
    if (existing) return { license: existing, created: false };
  }
  const license = await generateLicense({
    planCode: payment.plan.code,
    planName: payment.plan.name,
    deviceLimit: payment.plan.deviceLimit,
    userId: payment.userId,
    paymentId: payment.id,
    issuedBy: issuedBy ?? { id: "system", email: "system", role: "system" },
    notes: `Auto-issued for verified payment ${payment.reference}`,
  });
  await db.payment.update({ where: { id: payment.id }, data: { licenseRef: license.key } });
  return { license, created: true };
}

// ── Validation & activation ────────────────────────────────────────────────

export interface LicenseEvaluation {
  valid: boolean;
  reason: string;
  license?: {
    id: string;
    key: string;
    planCode: string;
    planName: string;
    status: string;
    entitlements: string[];
    deviceLimit: number;
    deviceCount: number;
    activatedAt: string | null;
    expiresAt: string | null;
    isComplimentary: boolean;
    lifetime: boolean;
  };
}

export async function evaluateUserLicense(userId: string): Promise<LicenseEvaluation> {
  const licenses = await db.license.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { activations: { where: { active: true } } },
  });
  const now = Date.now();
  for (const l of licenses) {
    if (l.status === LICENSE_STATUSES.REVOKED) continue;
    if (l.status === LICENSE_STATUSES.SUSPENDED) continue; // restricted — try next
    if (l.expiresAt && l.expiresAt.getTime() < now) continue; // expired — try next
    if (l.status === LICENSE_STATUSES.UNACTIVATED) continue; // not activated yet
    // ACTIVE
    return {
      valid: true,
      reason: "ok",
      license: {
        id: l.id,
        key: l.key,
        planCode: l.planCode,
        planName: l.planName,
        status: l.status,
        entitlements: parseEntitlements(l.entitlementsJson),
        deviceLimit: l.deviceLimit,
        deviceCount: l.activations.length,
        activatedAt: l.activatedAt?.toISOString() ?? null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        isComplimentary: l.isComplimentary,
        lifetime: !l.expiresAt,
      },
    };
  }
  if (licenses.some((l) => l.status === LICENSE_STATUSES.SUSPENDED)) return { valid: false, reason: "License suspended — contact support." };
  if (licenses.some((l) => l.expiresAt && l.expiresAt.getTime() < now)) return { valid: false, reason: "License expired." };
  if (licenses.some((l) => l.status === LICENSE_STATUSES.REVOKED)) return { valid: false, reason: "License revoked." };
  if (licenses.some((l) => l.status === LICENSE_STATUSES.UNACTIVATED)) return { valid: false, reason: "License issued but not yet activated." };
  return { valid: false, reason: "No license found for this account." };
}

export interface ActivationResult {
  ok: boolean;
  error?: string;
  licenseId?: string;
}

/**
 * Activate a license key for the signed-in customer on this device.
 * deviceToken is a client-generated random secret (privacy-preserving —
 * no hardware fingerprinting).
 */
export async function activateLicenseForKey(opts: {
  userId: string;
  userEmail: string;
  key: string;
  deviceToken: string;
  deviceLabel: string;
  userAgent: string;
}): Promise<ActivationResult> {
  const key = canonicalKey(opts.key);
  if (!key.startsWith("HALO-") || key.replace(/-/g, "").length !== 20) {
    return { ok: false, error: "Invalid license key format. Use the HALO-XXXX-XXXX-XXXX-XXXX key from your purchase." };
  }
  if (!opts.deviceToken || opts.deviceToken.length < 16 || opts.deviceToken.length > 128) {
    return { ok: false, error: "Missing device identity — reload the page and try again." };
  }

  const license = await db.license.findUnique({ where: { key }, include: { activations: true, user: true } });
  if (!license) return { ok: false, error: "Invalid license key — it was not found in the license registry." };
  if (license.status === LICENSE_STATUSES.REVOKED) return { ok: false, error: "This license has been revoked. Contact support." };
  if (license.userId && license.userId !== opts.userId) return { ok: false, error: "This license was issued to a different account." };
  if (license.expiresAt && license.expiresAt.getTime() < Date.now()) return { ok: false, error: "This license has expired." };

  // Re-activation on a known device is always allowed.
  const existing = await db.licenseActivation.findUnique({ where: { deviceToken: opts.deviceToken } });
  if (existing && existing.licenseId !== license.id) {
    return { ok: false, error: "This device already holds a different license. Deactivate it there first." };
  }
  if (existing && existing.licenseId === license.id) {
    if (!existing.active) {
      await db.licenseActivation.update({ where: { id: existing.id }, data: { active: true, revokedAt: null } });
    }
    await ensureLicenseActive(license.id);
    return { ok: true, licenseId: license.id };
  }

  const activeCount = license.activations.filter((a) => a.active).length;
  if (activeCount >= license.deviceLimit) {
    return {
      ok: false,
      error: `Device limit reached (${license.deviceLimit} active ${license.deviceLimit === 1 ? "device" : "devices"}). Deactivate an old device from your account dashboard or contact support for a transfer.`,
    };
  }

  await db.licenseActivation.create({
    data: {
      licenseId: license.id,
      deviceToken: opts.deviceToken,
      deviceLabel: (opts.deviceLabel || "Device").slice(0, 80),
      userAgent: (opts.userAgent || "").slice(0, 250),
    },
  });
  await ensureLicenseActive(license.id);

  // Bind the license to this account on first use when unassigned.
  if (!license.userId) {
    await db.license.update({ where: { id: license.id }, data: { userId: opts.userId } });
  }

  await logAudit({
    action: "LICENSE_DEVICE_ACTIVATED",
    actorId: opts.userId,
    actorEmail: opts.userEmail,
    targetType: "license",
    targetId: license.id,
    meta: { deviceLabel: (opts.deviceLabel || "").slice(0, 80), activeCount: activeCount + 1, deviceLimit: license.deviceLimit },
  });
  await notify(opts.userId, "license", "Device activated", `${(opts.deviceLabel || "Device").slice(0, 80)} is now authorized (${activeCount + 1}/${license.deviceLimit}).`);
  return { ok: true, licenseId: license.id };
}

async function ensureLicenseActive(licenseId: string): Promise<void> {
  const l = await db.license.findUnique({ where: { id: licenseId } });
  if (l && l.status === LICENSE_STATUSES.UNACTIVATED) {
    await db.license.update({ where: { id: licenseId }, data: { status: LICENSE_STATUSES.ACTIVE, activatedAt: new Date() } });
    await logAudit({ action: "LICENSE_ACTIVATED", actorId: l.userId ?? "", targetType: "license", targetId: licenseId, meta: { keyMasked: maskKey(l.key) } });
  }
}

/** Deactivate a device (customer self-service or support admin override). */
export async function deactivateDevice(activationId: string, actor?: { id: string; email: string; role: string }): Promise<boolean> {
  const a = await db.licenseActivation.findUnique({ where: { id: activationId }, include: { license: true } });
  if (!a || !a.active) return false;
  await db.licenseActivation.update({ where: { id: activationId }, data: { active: false, revokedAt: new Date() } });
  await logAudit({
    action: "LICENSE_DEVICE_DEACTIVATED",
    actorId: actor?.id ?? a.license.userId ?? "",
    actorEmail: actor?.email ?? "",
    actorRole: actor?.role ?? ROLES.CUSTOMER,
    targetType: "license",
    targetId: a.licenseId,
    meta: { activationId, deviceLabel: a.deviceLabel },
  });
  return true;
}
