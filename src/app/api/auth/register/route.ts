// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/register · customer account creation
//  Rate-limited · duplicate detection · e-mail verification required ·
//  a fresh account NEVER receives premium access automatically.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ROLES, USER_STATUSES, clientIp, rateLimit } from "@/lib/commerce/constants";
import { emailProblem, hashPassword, passwordProblem } from "@/lib/commerce/auth";
import { getSettings } from "@/lib/commerce/settings";
import { logAudit } from "@/lib/commerce/audit";
import { notify, sendMail, verificationEmail } from "@/lib/commerce/mailer";

export const dynamic = "force-dynamic";

export function baseUrlFrom(req: NextRequest): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`register:${ip}`, 8, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many registrations from this network. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

    const s = await getSettings();
    if (!s.registrationOpen) {
      return NextResponse.json({ ok: false, error: "Registration is currently closed. Please contact support." }, { status: 403 });
    }

    const body = (await req.json()) as {
      fullName?: string;
      email?: string;
      username?: string;
      password?: string;
      confirmPassword?: string;
      country?: string;
      acceptTerms?: boolean;
      acceptLicense?: boolean;
    };

    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const country = String(body.country ?? "").trim().slice(0, 60);

    if (fullName.length < 2) return NextResponse.json({ ok: false, error: "Enter your full name." }, { status: 400 });
    const ep = emailProblem(email);
    if (ep) return NextResponse.json({ ok: false, error: ep }, { status: 400 });
    if (username && !/^[a-z0-9_.-]{3,30}$/.test(username)) {
      return NextResponse.json({ ok: false, error: "Username must be 3–30 characters (letters, numbers, dot, dash, underscore)." }, { status: 400 });
    }
    const pp = passwordProblem(password);
    if (pp) return NextResponse.json({ ok: false, error: pp }, { status: 400 });
    if (body.confirmPassword !== undefined && password !== body.confirmPassword) {
      return NextResponse.json({ ok: false, error: "Passwords do not match." }, { status: 400 });
    }
    if (!body.acceptTerms || !body.acceptLicense) {
      return NextResponse.json({ ok: false, error: "You must accept the Terms & Conditions and the Software License Agreement." }, { status: 400 });
    }

    // Duplicate account detection.
    const dupEmail = await db.user.findUnique({ where: { email } });
    if (dupEmail) return NextResponse.json({ ok: false, error: "An account with this e-mail already exists. Sign in or reset your password." }, { status: 409 });
    if (username) {
      const dupUser = await db.user.findUnique({ where: { username } });
      if (dupUser) return NextResponse.json({ ok: false, error: "That username is taken." }, { status: 409 });
    }

    const verifyToken = crypto.randomBytes(24).toString("hex");
    const user = await db.user.create({
      data: {
        email,
        username: username || null,
        passwordHash: hashPassword(password),
        fullName,
        country,
        role: ROLES.CUSTOMER,
        status: USER_STATUSES.PENDING_EMAIL,
        verifyToken,
      },
    });

    await notify(user.id, "security", "Account created", "Verify your e-mail address to activate your account.");
    await logAudit({ action: "USER_REGISTERED", actorId: user.id, actorEmail: email, targetType: "user", targetId: user.id, meta: { country } });

    const url = `${baseUrlFrom(req)}/api/auth/verify-email?token=${verifyToken}`;
    const mail = { ...verificationEmail(fullName, url), to: email };
    const sent = await sendMail(mail);

    return NextResponse.json({
      ok: true,
      emailSent: sent.ok,
      message: sent.ok
        ? "Account created! Check your inbox to verify your e-mail address."
        : "Account created. E-mail delivery is not configured on this server — an administrator can verify your account from the admin dashboard.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
