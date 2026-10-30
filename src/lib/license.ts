// ══════════════════════════════════════════════════════════════════════════
//  LICENSE GATE · commercial enforcement seam for the trading app
//
//  MODES
//  - OWNER MODE (default; HALO_COMMERCE unset): no gate at all. Dev, E2E
//    and the owner's own installation behave exactly as before.
//  - COMMERCIAL MODE (HALO_COMMERCE=on): consequential endpoints require an
//    authenticated account whose license is ACTIVE and unexpired, with the
//    feature entitlement for the specific surface (Starter→Ultimate).
//
//  MT5 PROTECTION GUARANTEE
//  This gate is INDEPENDENT of position management. It only guards NEW
//  trading commands (bot start/stop, config changes, strategy edits).
//  Nothing in the license layer can close, modify or liquidate an existing
//  broker position, disable protective SL/TP, or interrupt the EA — those
//  live in the broker/EA layer and never consult this module.
// ══════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { getSessionUser, isAdminRole, type SafeUser } from "@/lib/commerce/auth";
import { evaluateUserLicense } from "@/lib/commerce/license-engine";
import { hasFeature, parseEntitlements } from "@/lib/commerce/entitlements";
import { GATE_FEATURES } from "@/lib/commerce/constants";

export function isCommercialEnabled(): boolean {
  return process.env.HALO_COMMERCE === "on";
}

/** Back-compat alias used by older callers. */
export const isLicensingEnabled = isCommercialEnabled;

export interface LicenseStatus {
  commerce: boolean; // commercial enforcement on
  licensing: boolean; // back-compat field (same as commerce)
  authenticated: boolean;
  activated: boolean;
  mode: "owner" | "licensed" | "unactivated";
  user: SafeUser | null;
  license: {
    key: string;
    planCode: string;
    planName: string;
    status: string;
    entitlements: string[];
    deviceLimit: number;
    deviceCount: number;
    activatedAt: string | null;
    expiresAt: string | null;
    lifetime: boolean;
  } | null;
  reason: string;
}

/** Full license/session status for the current request. */
export async function licenseStatus(): Promise<LicenseStatus> {
  if (!isCommercialEnabled()) {
    // Owner mode: no license gate — but still resolve the session so that
    // /api/auth/me, /login redirects and the admin dashboard work while the
    // owner is signed in.
    const user = await getSessionUser();
    return {
      commerce: false,
      licensing: false,
      authenticated: !!user,
      activated: true,
      mode: "owner",
      user,
      license: null,
      reason: "owner",
    };
  }
  const user = await getSessionUser();
  if (!user) {
    return { commerce: true, licensing: true, authenticated: false, activated: false, mode: "unactivated", user: null, license: null, reason: "not-authenticated" };
  }
  const ev = await evaluateUserLicense(user.id);
  if (ev.valid && ev.license) {
    return {
      commerce: true,
      licensing: true,
      authenticated: true,
      activated: true,
      mode: "licensed",
      user,
      license: {
        key: ev.license.key,
        planCode: ev.license.planCode,
        planName: ev.license.planName,
        status: ev.license.status,
        entitlements: ev.license.entitlements,
        deviceLimit: ev.license.deviceLimit,
        deviceCount: ev.license.deviceCount,
        activatedAt: ev.license.activatedAt,
        expiresAt: ev.license.expiresAt,
        lifetime: ev.license.lifetime,
      },
      reason: "ok",
    };
  }
  return { commerce: true, licensing: true, authenticated: true, activated: false, mode: "unactivated", user, license: null, reason: ev.reason };
}

type Guard = { ok: true; user: SafeUser | null } | { ok: false; error: string; status: number };

/**
 * Guard for consequential endpoints (NEW trading commands only):
 * owner mode → allow. Commercial mode → valid license required.
 */
export async function requireLicensed(): Promise<Guard> {
  if (!isCommercialEnabled()) return { ok: true, user: null };

  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Sign in with your HALO account to continue. Create an account at /register or sign in at /login.",
    };
  }
  if (isAdminRole(user.role)) return { ok: true, user }; // administrators manage, not trade

  const ev = await evaluateUserLicense(user.id);
  if (!ev.valid) {
    return {
      ok: false,
      status: 402,
      error: ev.reason === "License issued but not yet activated."
        ? "Your license is issued but not activated on this device. Open License Activation to unlock trading."
        : `${ev.reason} Purchase or activate a plan at /pricing to unlock trading and strategy features.`,
    };
  }
  return { ok: true, user };
}

/**
 * Guard for a SPECIFIC premium feature (centralized entitlement system):
 * the user's license entitlement snapshot must include the feature key.
 */
export async function requireFeature(featureKey: string): Promise<Guard> {
  if (!isCommercialEnabled()) return { ok: true, user: null };

  const g = await requireLicensed();
  if (!g.ok) return g;
  const user = g.user;
  if (!user || isAdminRole(user.role)) return { ok: true, user };

  const ev = await evaluateUserLicense(user.id);
  const entitlements = ev.license ? parseEntitlements(JSON.stringify(ev.license.entitlements)) : [];
  if (!ev.license || !hasFeature(entitlements, featureKey)) {
    return {
      ok: false,
      status: 403,
      error: `Your current plan does not include this feature. Upgrade to unlock it (feature: ${featureKey}).`,
    };
  }
  return { ok: true, user };
}

/** Convenience wrappers matching the existing API surfaces. */
export const requireTradingAccess = () => requireFeature(GATE_FEATURES.bot);
export const requireStrategyAccess = () => requireFeature(GATE_FEATURES.strategies);

/**
 * MT5 PROTECTION (commercial mandate §6) — when a license or account loses
 * authorization (suspended / revoked / replaced), the engine must not keep
 * INITIATING new protected trades. This pauses NEW engine entries only:
 *   • the open position keeps being managed by the engine,
 *   • protective broker-side SL/TP stay attached,
 *   • nothing is ever closed, modified or liquidated by the licensing layer,
 *   • the trader keeps emergency-stop / close / pause access (bot/control
 *     gates only start·resumeNew·reset).
 * Owner mode: no-op. Engine bookkeeping must never break the admin action.
 */
export async function pauseNewEntriesForRevocation(): Promise<void> {
  if (!isCommercialEnabled()) return;
  try {
    const { setPauseNew } = await import("@/lib/bot");
    await setPauseNew(true);
  } catch {
    // non-fatal by design
  }
}
