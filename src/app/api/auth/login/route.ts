// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/login · credential sign-in (rate-limited, audited)
//  Supports e-mail or username. Enforces account status gates. Sets an
//  HttpOnly session cookie (30 days with "remember me").
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { USER_STATUSES, USER_STATUS_LABEL, clientIp, rateLimit } from "@/lib/commerce/constants";
import { SESSION_COOKIE, createSession, toSafeUser, verifyPassword } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { isAdminRole } from "@/lib/commerce/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const body = (await req.json()) as { identifier?: string; password?: string; remember?: boolean };
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    const rl = rateLimit(`login:${ip}`, 15, 10 * 60 * 1000);
    const rl2 = rateLimit(`login:${ip}:${identifier}`, 8, 10 * 60 * 1000);
    if (!rl.ok || !rl2.ok) {
      const wait = Math.max(rl.retryAfterSec, rl2.retryAfterSec);
      return NextResponse.json({ ok: false, error: `Too many sign-in attempts. Try again in ${wait}s.` }, { status: 429 });
    }

    if (!identifier || !password) return NextResponse.json({ ok: false, error: "Enter your e-mail/username and password." }, { status: 400 });

    const user = await db.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      await logAudit({ action: "LOGIN_FAILED", actorEmail: identifier, outcome: "denied", targetType: "user", meta: { ip } });
      return NextResponse.json({ ok: false, error: "Incorrect credentials. Check your e-mail/username and password." }, { status: 401 });
    }

    if (user.status === USER_STATUSES.PENDING_EMAIL) {
      return NextResponse.json({ ok: false, error: "Please verify your e-mail address first — check your inbox for the verification link." }, { status: 403 });
    }
    if (user.status === USER_STATUSES.PENDING_APPROVAL) {
      return NextResponse.json({ ok: false, error: "Your account is awaiting administrator approval. You will be notified by e-mail once approved." }, { status: 403 });
    }
    if (user.status === USER_STATUSES.SUSPENDED) {
      return NextResponse.json({ ok: false, error: "This account is suspended. Contact support for assistance." }, { status: 403 });
    }
    if (user.status === USER_STATUSES.BLOCKED || user.status === USER_STATUSES.REJECTED) {
      return NextResponse.json({ ok: false, error: "This account no longer has access. Contact support if you believe this is an error." }, { status: 403 });
    }

    const token = await createSession(user.id, req.headers.get("user-agent") ?? "");
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({
      action: isAdminRole(user.role) ? "ADMIN_LOGIN" : "USER_LOGIN",
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      targetType: "user",
      targetId: user.id,
      meta: { ip },
    });

    const res = NextResponse.json({
      ok: true,
      user: toSafeUser(user),
      redirect: isAdminRole(user.role) ? "/admin" : "/account",
    });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https",
      maxAge: body.remember === false ? undefined : 30 * 24 * 60 * 60,
      path: "/",
    });
    return res;
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
