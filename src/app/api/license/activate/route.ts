// ══════════════════════════════════════════════════════════════════════════
//  /api/license/activate · activate a license key on this device
//  Requires an ACTIVE account. Enforces device allowance server-side.
//  Clear messages for: invalid / revoked / suspended / expired keys,
//  device limit reached, unverified payment, pending approval.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { USER_STATUSES, USER_STATUS_LABEL, clientIp, rateLimit } from "@/lib/commerce/constants";
import { getSessionUser } from "@/lib/commerce/auth";
import { activateLicenseForKey, evaluateUserLicense } from "@/lib/commerce/license-engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "Sign in with your HALO account to activate a license.", code: "AUTH" }, { status: 401 });
    if (user.status === USER_STATUSES.PENDING_EMAIL || user.status === USER_STATUSES.PENDING_APPROVAL) {
      return NextResponse.json({ ok: false, error: `Your account is ${USER_STATUS_LABEL[user.status].toLowerCase()} — activation is available once the account is active.`, code: user.status }, { status: 403 });
    }
    if (user.status !== USER_STATUSES.ACTIVE) {
      return NextResponse.json({ ok: false, error: `Your account is ${USER_STATUS_LABEL[user.status].toLowerCase()} — contact support.`, code: user.status }, { status: 403 });
    }

    const rl = rateLimit(`activate:${clientIp(req)}:${user.id}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many activation attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

    const body = (await req.json()) as { key?: string; deviceToken?: string; deviceLabel?: string };
    if (!body.key) return NextResponse.json({ ok: false, error: "Enter your license key." }, { status: 400 });
    if (!body.deviceToken) return NextResponse.json({ ok: false, error: "Missing device identity — reload the page and try again." }, { status: 400 });

    const r = await activateLicenseForKey({
      userId: user.id,
      userEmail: user.email,
      key: String(body.key),
      deviceToken: String(body.deviceToken),
      deviceLabel: String(body.deviceLabel ?? "Device"),
      userAgent: req.headers.get("user-agent") ?? "",
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });

    const ev = await evaluateUserLicense(user.id);
    return NextResponse.json({ ok: true, activated: ev.valid, license: ev.license ?? null, reason: ev.reason });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
