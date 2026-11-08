// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/2fa · two-factor enrolment for the signed-in administrator
//  GET  : { enabled, enabledAt, recoveryRemaining }
//  POST : { action: "setup", password }            → { secret, uri }
//         { action: "enable", code }               → { recovery[] } (shown once)
//         { action: "regenerate", password, code } → { recovery[] }
//         { action: "disable", password, code }
//  Password re-entry for setup / regenerate / disable; a code (TOTP or a
//  recovery code) for regenerate / disable. Enabling signs out every other
//  session. Rate-limited and audit-logged.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionContext, isAdminRole, requireUser, verifyPassword } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { rateLimit } from "@/lib/commerce/constants";
import { beginEnrolment, checkSecondFactor, confirmEnrolment, disableTwoFactor, loadTwoFactor, regenerateRecovery } from "@/lib/commerce/two-factor";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  try {
    const r = await loadTwoFactor(g.user!.id);
    return NextResponse.json({ ok: true, available: isAdminRole(g.user!.role), enabled: !!r.secret, enabledAt: r.enabledAt, recoveryRemaining: r.recovery.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const user = g.user!;
  if (!isAdminRole(user.role)) return NextResponse.json({ ok: false, error: "Two-factor sign-in is available for administrator accounts." }, { status: 403 });

  const rl = rateLimit(`2fa-manage:${user.id}`, 10, 15 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; password?: string; code?: string };
  const audit = (action: string, outcome: "success" | "denied" | "failed", meta: Record<string, unknown> = {}) =>
    logAudit({ action, actorId: user.id, actorEmail: user.email, actorRole: user.role, targetType: "user", targetId: user.id, outcome, meta });
  const passwordOk = async () => {
    const row = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    return !!row && verifyPassword(String(body.password ?? ""), row.passwordHash);
  };

  try {
    if (body.action === "setup") {
      if (!(await passwordOk())) {
        await audit("2FA_SETUP_DENIED", "denied", { reason: "password" });
        return NextResponse.json({ ok: false, error: "Password is incorrect." }, { status: 401 });
      }
      const r = await beginEnrolment(user.id, user.email);
      await audit("2FA_SETUP_STARTED", "success");
      return NextResponse.json({ ok: true, secret: r.secret, uri: r.uri });
    }

    if (body.action === "enable") {
      const r = await confirmEnrolment(user.id, String(body.code ?? ""));
      if (!r.ok) {
        await audit("2FA_ENABLE_FAILED", "denied");
        return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      }
      // a stolen session must not survive turning 2FA on
      const ctx = await getSessionContext();
      const revoked = await db.session.updateMany({ where: { userId: user.id, revokedAt: null, ...(ctx ? { id: { not: ctx.sessionId } } : {}) }, data: { revokedAt: new Date() } });
      await audit("2FA_ENABLED", "success", { otherSessionsRevoked: revoked.count });
      return NextResponse.json({ ok: true, recovery: r.recovery, otherSessionsRevoked: revoked.count });
    }

    if (body.action === "regenerate" || body.action === "disable") {
      if (!(await passwordOk())) {
        await audit(body.action === "disable" ? "2FA_DISABLE_DENIED" : "2FA_RECOVERY_REGEN_DENIED", "denied", { reason: "password" });
        return NextResponse.json({ ok: false, error: "Password is incorrect." }, { status: 401 });
      }
      const c = await checkSecondFactor(user.id, String(body.code ?? ""));
      if (!c.ok) {
        await audit(body.action === "disable" ? "2FA_DISABLE_DENIED" : "2FA_RECOVERY_REGEN_DENIED", "denied", { reason: "code" });
        return NextResponse.json({ ok: false, error: "That code is not valid." }, { status: 401 });
      }
      if (body.action === "disable") {
        await disableTwoFactor(user.id);
        await audit("2FA_DISABLED", "success", { via: c.via });
        return NextResponse.json({ ok: true });
      }
      const recovery = await regenerateRecovery(user.id);
      await audit("2FA_RECOVERY_REGENERATED", "success", { via: c.via });
      return NextResponse.json({ ok: true, recovery });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (e) {
    await audit("2FA_ERROR", "failed", { message: (e as Error).message.slice(0, 160) });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
