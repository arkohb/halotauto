// Re-link this signed-in browser to a device it already activated (e.g.
// after sign-in, or for browsers activated before device binding existed).
// Only an ACTIVE activation of the caller's own valid licence can be bound;
// it uses no new device slot. Binding signs out other browsers on that device.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext, getSessionUser, requestIsHttps, setDeviceCookie } from "@/lib/commerce/auth";
import { bindSessionToActivation, evaluateUserLicense } from "@/lib/commerce/license-engine";
import { clientIp, rateLimit } from "@/lib/commerce/constants";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const ctx = await getSessionContext();
  if (!user || !ctx) return NextResponse.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  const rl = rateLimit(`bind:${clientIp(req)}:${user.id}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });
  let body: { deviceToken?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const token = String(body.deviceToken ?? "");
  if (token.length < 16 || token.length > 128) return NextResponse.json({ ok: false, error: "Missing device identity." }, { status: 400 });

  const ev = await evaluateUserLicense(user.id);
  if (!ev.valid || !ev.license) return NextResponse.json({ ok: false, error: ev.reason }, { status: 402 });
  const a = await db.licenseActivation.findUnique({ where: { deviceToken: token } });
  if (!a || !a.active || a.licenseId !== ev.license.id) {
    return NextResponse.json({ ok: false, error: "This browser is not an activated device for your licence." }, { status: 404 });
  }
  await bindSessionToActivation(ctx.sessionId, a.id);
  await setDeviceCookie(token, requestIsHttps(req));
  return NextResponse.json({ ok: true });
}
