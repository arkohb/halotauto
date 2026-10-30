// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/reset-password · completes a password reset
//  Token must be unexpired; all existing sessions are revoked afterwards.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/commerce/constants";
import { hashPassword, passwordProblem } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`reset:${clientIp(req)}`, 10, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many requests. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

    const { token, password, confirmPassword } = (await req.json()) as { token?: string; password?: string; confirmPassword?: string };
    if (!token) return NextResponse.json({ ok: false, error: "Missing reset token." }, { status: 400 });
    if (password !== confirmPassword) return NextResponse.json({ ok: false, error: "Passwords do not match." }, { status: 400 });
    const pp = passwordProblem(String(password ?? ""));
    if (pp) return NextResponse.json({ ok: false, error: pp }, { status: 400 });

    const user = await db.user.findFirst({
      where: { resetToken: String(token), resetTokenExpiresAt: { gt: new Date() } },
    });
    if (!user) return NextResponse.json({ ok: false, error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(String(password)), resetToken: "", resetTokenExpiresAt: null, mustChangePassword: false },
    });
    await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await logAudit({ action: "PASSWORD_RESET_COMPLETED", actorId: user.id, actorEmail: user.email, targetType: "user", targetId: user.id });
    return NextResponse.json({ ok: true, message: "Password updated. Sign in with your new password." });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
