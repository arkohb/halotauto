// ══════════════════════════════════════════════════════════════════════════
//  /api/license · status for the current session (GET) + key activation
//  with e-mail binding (POST — used by the activation screen).
//  License validity is ALWAYS established server-side, never from browser
//  storage. GET is back-compat with the original gate shape.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canonicalKey, evaluateUserLicense } from "@/lib/commerce/license-engine";
import { logAudit } from "@/lib/commerce/audit";
import { licenseStatus } from "@/lib/license";
import { clientIp, rateLimit } from "@/lib/commerce/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const st = await licenseStatus();
    return NextResponse.json(st);
  } catch (e) {
    return NextResponse.json({ commerce: false, licensing: false, activated: true, mode: "owner", error: (e as Error).message }, { status: 200 });
  }
}

/**
 * POST { key, deviceToken, deviceLabel } — activate the key on this device
 * for the signed-in account. Unassigned licenses bind to the activating
 * account; a key assigned to another account is rejected.
 */
export async function POST(req: NextRequest) {
  try {
    const st = await licenseStatus();
    if (!st.commerce) {
      return NextResponse.json({ ok: false, error: "Licensing enforcement is off on this installation (owner mode)." }, { status: 400 });
    }
    if (!st.authenticated || !st.user) {
      return NextResponse.json({ ok: false, error: "Sign in with your HALO account first, then activate your license key." }, { status: 401 });
    }

    const rl = rateLimit(`activate:${clientIp(req)}:${st.user.id}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many activation attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

    const body = (await req.json()) as { key?: string; deviceToken?: string; deviceLabel?: string };
    const key = canonicalKey(String(body.key ?? ""));

    const license = await db.license.findUnique({ where: { key } });
    if (!license) {
      return NextResponse.json({ ok: false, error: "Invalid license key — it was not found in the license registry." }, { status: 404 });
    }
    if (license.userId && license.userId !== st.user.id) {
      return NextResponse.json({ ok: false, error: "This license was issued to a different account." }, { status: 403 });
    }
    if (license.status === "REVOKED") {
      return NextResponse.json({ ok: false, error: "This license has been revoked. Contact support." }, { status: 403 });
    }
    if (license.status === "SUSPENDED") {
      return NextResponse.json({ ok: false, error: "This license is currently suspended. Contact support." }, { status: 403 });
    }

    // Bind unassigned license to this account.
    if (!license.userId) {
      await db.license.update({ where: { id: license.id }, data: { userId: st.user.id } });
      await logAudit({ action: "LICENSE_BOUND_TO_ACCOUNT", actorId: st.user.id, actorEmail: st.user.email, targetType: "license", targetId: license.id, meta: { keyMasked: key.slice(0, 9) + "…" } });
    }

    // If a deviceToken is provided, activate the device too.
    if (body.deviceToken) {
      const { activateLicenseForKey } = await import("@/lib/commerce/license-engine");
      const r = await activateLicenseForKey({
        userId: st.user.id,
        userEmail: st.user.email,
        key,
        deviceToken: String(body.deviceToken),
        deviceLabel: String(body.deviceLabel ?? "Device"),
        userAgent: req.headers.get("user-agent") ?? "",
      });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }

    const ev = await evaluateUserLicense(st.user.id);
    return NextResponse.json({ ok: true, activated: ev.valid, license: ev.license ?? null, reason: ev.reason });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
