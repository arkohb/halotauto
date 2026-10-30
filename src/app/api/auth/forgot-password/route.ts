// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/forgot-password · issues a 1-hour password reset token
//  Generic response (no account enumeration). Rate-limited.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/commerce/constants";
import { baseUrlFrom } from "../register/route";
import { logAudit } from "@/lib/commerce/audit";
import { resetEmail, sendMail } from "@/lib/commerce/mailer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`forgot:${clientIp(req)}`, 6, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many requests. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

    const { email } = (await req.json()) as { email?: string };
    const normalized = String(email ?? "").trim().toLowerCase();

    const user = await db.user.findUnique({ where: { email: normalized } });
    if (user) {
      const token = crypto.randomBytes(24).toString("hex");
      await db.user.update({
        where: { id: user.id },
        data: { resetToken: token, resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await logAudit({ action: "PASSWORD_RESET_REQUESTED", actorId: user.id, actorEmail: user.email, targetType: "user", targetId: user.id });
      const url = `${baseUrlFrom(req)}/reset-password?token=${token}`;
      await sendMail({ ...resetEmail(user.fullName, url), to: user.email });
    }
    // Identical response whether or not the account exists.
    return NextResponse.json({ ok: true, message: "If an account exists for that address, a password-reset link has been sent." });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
