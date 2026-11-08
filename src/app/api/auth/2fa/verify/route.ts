// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/2fa/verify · second sign-in step
//  { challenge, code } — the challenge comes from /api/auth/login after a
//  correct password; the code is a 6-digit authenticator code or a
//  single-use recovery code. Only a valid pair creates the session.
//  5 tries per challenge, per-account and per-IP rate limits, audit-logged.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { SESSION_COOKIE, createSession, isAdminRole, toSafeUser } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { USER_STATUSES, clientIp, rateLimit } from "@/lib/commerce/constants";
import { checkSecondFactor, finishChallenge, consumeChallenge } from "@/lib/commerce/two-factor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const body = (await req.json().catch(() => ({}))) as { challenge?: string; code?: string };
    const rlIp = rateLimit(`2fa-verify:${ip}`, 20, 15 * 60 * 1000);
    if (!rlIp.ok) return NextResponse.json({ ok: false, error: `Too many attempts. Try again in ${rlIp.retryAfterSec}s.` }, { status: 429 });

    const ch = consumeChallenge(String(body.challenge ?? ""));
    if (!ch) return NextResponse.json({ ok: false, error: "This sign-in has expired. Enter your password again.", restart: true }, { status: 401 });

    const rlUser = rateLimit(`2fa-verify-user:${ch.userId}`, 10, 15 * 60 * 1000);
    if (!rlUser.ok) {
      finishChallenge(String(body.challenge));
      return NextResponse.json({ ok: false, error: `Too many attempts on this account. Try again in ${rlUser.retryAfterSec}s.`, restart: true }, { status: 429 });
    }

    const user = await db.user.findUnique({ where: { id: ch.userId } });
    if (!user || user.status !== USER_STATUSES.ACTIVE) {
      finishChallenge(String(body.challenge));
      return NextResponse.json({ ok: false, error: "This account cannot sign in.", restart: true }, { status: 403 });
    }

    const v = await checkSecondFactor(user.id, String(body.code ?? ""));
    if (!v.ok) {
      await logAudit({ action: "LOGIN_2FA_FAILED", actorId: user.id, actorEmail: user.email, actorRole: user.role, targetType: "user", targetId: user.id, outcome: "denied", meta: { ip } });
      if (ch.last) finishChallenge(String(body.challenge));
      return NextResponse.json({ ok: false, error: ch.last ? "Too many wrong codes. Enter your password again." : "That code is not valid.", restart: ch.last }, { status: 401 });
    }

    finishChallenge(String(body.challenge));
    const token = await createSession(user.id, req.headers.get("user-agent") ?? "");
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({
      action: isAdminRole(user.role) ? "ADMIN_LOGIN" : "USER_LOGIN",
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      targetType: "user",
      targetId: user.id,
      meta: { ip, secondFactor: v.via, recoveryRemaining: v.remaining },
    });
    const res = NextResponse.json({
      ok: true,
      user: toSafeUser(user),
      redirect: isAdminRole(user.role) ? "/admin" : "/account",
      recoveryRemaining: v.remaining,
      usedRecoveryCode: v.via === "recovery",
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https",
      maxAge: ch.remember ? 30 * 24 * 60 * 60 : undefined,
      path: "/",
    });
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
