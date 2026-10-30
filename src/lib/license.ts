// ════════════════════════════════════════════════════════════════════════
//  HALO COMMERCIAL LICENSE · one-time payment activation
//
//  MODEL: the app is sold as a one-time-payment product. The seller mints a
//  personal lifetime key per buyer (scripts/license-mint.ts --holder email);
//  the buyer pastes key + e-mail once and the app unlocks forever.
//
//  ENFORCEMENT IS OPT-IN: with HALO_LICENSE_SECRET unset the app runs in
//  owner mode (no gate — dev, E2E and the owner's own instance unaffected).
//  With the secret set, consequential endpoints (bot control, config,
//  strategy mutations) require activation; read-only views stay browsable
//  so a buyer can look before activating.
// ════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { db } from "@/lib/db";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 confusion

export function isLicensingEnabled(): boolean {
  return !!process.env.HALO_LICENSE_SECRET;
}

export function normalizeHolder(h: string): string {
  return (h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic per-holder lifetime key: HALO-XXXX-XXXX-XXXX-XXXX */
export function mintKey(holder: string, secret?: string): string {
  const s = secret ?? process.env.HALO_LICENSE_SECRET ?? "";
  if (!s) throw new Error("HALO_LICENSE_SECRET is not set — cannot mint keys.");
  const mac = crypto.createHmac("sha256", s).update(`halo-lifetime|${normalizeHolder(holder)}`).digest();
  const chars: string[] = [];
  for (let i = 0; i < 20; i++) chars.push(ALPHABET[mac[i] % ALPHABET.length]);
  const g = (n: number) => chars.slice(n * 4, n * 4 + 4).join("");
  return `HALO-${g(0)}-${g(1)}-${g(2)}-${g(3)}`;
}

export function canonicalKey(key: string): string {
  let raw = (key ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.startsWith("HALO")) raw = raw.slice(4);
  if (raw.length !== 16) return (key ?? "").toUpperCase().trim(); // malformed — verify() will fail honestly
  return `HALO-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function verifyKey(key: string, holder: string): boolean {
  if (!isLicensingEnabled()) return true;
  const expected = mintKey(holder);
  const a = Buffer.from(canonicalKey(key).replace(/-/g, ""));
  const b = Buffer.from(expected.replace(/-/g, ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface LicenseStatus {
  licensing: boolean; // enforcement on (secret set)
  activated: boolean;
  mode: "owner" | "licensed" | "unactivated";
  holder: string;
  plan: string;
  activatedAt: string | null;
}

export async function licenseStatus(): Promise<LicenseStatus> {
  if (!isLicensingEnabled()) {
    return { licensing: false, activated: true, mode: "owner", holder: "", plan: "owner", activatedAt: null };
  }
  try {
    const row = await db.license.findUnique({ where: { id: "main" } });
    // a stored activation only counts when the key still verifies against the
    // holder — rows recorded in owner mode (no enforcement) never unlock a
    // licensed deployment
    if (row?.status === "active" && verifyKey(row.key, row.holder)) {
      return {
        licensing: true,
        activated: true,
        mode: "licensed",
        holder: row.holder,
        plan: row.plan,
        activatedAt: row.activatedAt?.toISOString() ?? null,
      };
    }
  } catch {
    // DB not ready yet
  }
  return { licensing: true, activated: false, mode: "unactivated", holder: "", plan: "", activatedAt: null };
}

/** guard for consequential endpoints under enforcement */
export async function requireLicensed(): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const st = await licenseStatus();
  if (st.activated) return { ok: true };
  return {
    ok: false,
    status: 402,
    error: "HALO is not activated. Enter your one-time license key (Settings → License, or the activation screen) to unlock trading and strategy features.",
  };
}

export async function activateLicense(key: string, holder: string): Promise<{ ok: boolean; error?: string }> {
  if (!isLicensingEnabled()) {
    // owner mode — activation is a no-op that still records the holder
    await db.license.upsert({
      where: { id: "main" },
      create: { id: "main", key: canonicalKey(key), holder: normalizeHolder(holder), status: "active", activatedAt: new Date() },
      update: { key: canonicalKey(key), holder: normalizeHolder(holder), status: "active", activatedAt: new Date() },
    });
    return { ok: true };
  }
  if (!key || !holder) return { ok: false, error: "Enter both your license key and the e-mail it was issued to." };
  if (!verifyKey(key, holder)) {
    return { ok: false, error: "That key does not match this e-mail. Check for typos (the key was issued for the exact e-mail you purchased with), or contact the seller." };
  }
  await db.license.upsert({
    where: { id: "main" },
    create: { id: "main", key: canonicalKey(key), holder: normalizeHolder(holder), status: "active", activatedAt: new Date() },
    update: { key: canonicalKey(key), holder: normalizeHolder(holder), status: "active", activatedAt: new Date() },
  });
  return { ok: true };
}
