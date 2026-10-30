// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/verify-email · e-mail verification link target (GET from mail)
//  Verifies the token, applies the configured approval policy and redirects
//  the customer to the login screen with a status hint.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { USER_STATUSES } from "@/lib/commerce/constants";
import { getSettings } from "@/lib/commerce/settings";
import { logAudit } from "@/lib/commerce/audit";
import { notify, approvalEmail, sendMail, addressed } from "@/lib/commerce/mailer";

export const dynamic = "force-dynamic";

function redirectPage(title: string, message: string, tone: "ok" | "err") {
  const color = tone === "ok" ? "#00D68F" : "#FF4D5E";
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>HALO 3EL Autotrader</title><style>body{background:#020B1A;color:#EAF3FF;font-family:Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}div{max-width:420px;background:#021430;border:1px solid #0F2E58;border-radius:14px;padding:32px;text-align:center}h1{color:${color};font-size:18px;letter-spacing:.08em}p{color:#B9CBE4;font-size:13.5px;line-height:1.6}a{display:inline-block;margin-top:18px;background:linear-gradient(135deg,#1E90FF,#2ECCFF);color:#fff;padding:11px 24px;border-radius:9px;text-decoration:none;font-weight:700;font-size:13px}</style></head><body><div><div style="letter-spacing:.22em;font-weight:800;font-size:14px;color:#E9B94E;margin-bottom:14px;">HALO 3EL <span style="color:#2ECCFF">AUTOTRADER</span></div><h1>${title}</h1><p>${message}</p><a href="/login">Continue to Sign In</a></div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token) return redirectPage("Missing token", "This verification link is incomplete. Request a new e-mail from the sign-in page.", "err");

  const user = await db.user.findFirst({ where: { verifyToken: token } });
  if (!user) return redirectPage("Link expired", "This verification link is invalid or was already used. Sign in to request a new one.", "err");

  await db.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date(), verifyToken: "", status: USER_STATUSES.ACTIVE },
  });
  await logAudit({ action: "EMAIL_VERIFIED", actorId: user.id, actorEmail: user.email, targetType: "user", targetId: user.id });
  await notify(user.id, "security", "E-mail verified", "Your e-mail address is confirmed. You can now sign in.");

  const s = await getSettings();
  if (s.approvalMode === "MANUAL") {
    // Manual mode: registration must still be reviewed by an administrator.
    await db.user.update({ where: { id: user.id }, data: { status: USER_STATUSES.PENDING_APPROVAL } });
    await logAudit({ action: "USER_AWAITING_APPROVAL", actorId: "system", targetType: "user", targetId: user.id, meta: { reason: "manual approval mode" } });
    return redirectPage("E-mail verified", "Thank you! Your e-mail is confirmed. Your account now awaits administrator approval — you will be notified by e-mail once approved.", "ok");
  }

  void sendMail(addressed(approvalEmail(user.fullName), user.email));
  return redirectPage("E-mail verified", "Your e-mail address is confirmed and your account is active. Sign in to choose your plan.", "ok");
}
