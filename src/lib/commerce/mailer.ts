// ══════════════════════════════════════════════════════════════════════════
//  MAILER · transactional e-mail for the commercial platform
//  Reuses the existing SMTP settings singleton (AlertSettings) already used
//  for trade alerts — no new provider dependency. When SMTP is not
//  configured, e-mails are SUPPRESSED with a server-log fallback (and an
//  in-app notification is always created) so flows never break on mail.
//  IMPORTANT: e-mail failure must NEVER fail a payment verification.
// ══════════════════════════════════════════════════════════════════════════

import { tryOpen } from "@/lib/secret-box";
import { db } from "@/lib/db";

interface MailInput {
  to: string;
  subject: string;
  html: string;
}

interface MailResult {
  ok: boolean;
  suppressed?: boolean;
  error?: string;
}

async function smtpConfig() {
  try {
    const s = await db.alertSettings.findUnique({ where: { id: "main" } });
    if (!s || !s.emailEnabled || !s.smtpHost || !s.smtpUser) return null;
    return {
      host: s.smtpHost,
      port: s.smtpPort,
      secure: s.smtpSecure,
      user: s.smtpUser,
      pass: tryOpen(s.smtpPass) ?? "",
      from: s.smtpFrom || s.smtpUser,
    };
  } catch {
    return null;
  }
}

export async function sendMail(input: MailInput): Promise<MailResult> {
  const cfg = await smtpConfig();
  if (!cfg) {
    console.log(`[halo-mail] SMTP not configured — suppressed "${input.subject}" → ${input.to}`);
    return { ok: false, suppressed: true };
  }
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({ from: cfg.from, to: input.to, subject: input.subject, html: input.html });
    return { ok: true };
  } catch (e) {
    console.error("[halo-mail] send failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

export async function notify(userId: string, kind: string, title: string, body: string): Promise<void> {
  try {
    await db.notification.create({ data: { userId, kind, title, body } });
  } catch (e) {
    console.error("[halo-notify] failed:", (e as Error).message);
  }
}

// ── Templates (professional, brand-consistent, no images) ─────────────────

const WRAP = (title: string, body: string) => `
<div style="background:#020B1A;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#021430;border:1px solid #0F2E58;border-radius:14px;padding:28px;">
    <div style="letter-spacing:.22em;font-weight:800;font-size:15px;color:#E9B94E;">HALO 3EL <span style="color:#2ECCFF;">AUTOTRADER</span></div>
    <h2 style="color:#EAF3FF;margin:18px 0 10px;font-size:18px;">${title}</h2>
    <div style="color:#B9CBE4;font-size:13.5px;line-height:1.65;">${body}</div>
    <div style="margin-top:26px;padding-top:14px;border-top:1px solid #0A2447;color:#51678A;font-size:11px;">
      HALO 3EL Autotrader was created by Bismark Arko-Ofori. All rights reserved.
    </div>
  </div>
</div>`;

export function verificationEmail(name: string, url: string): MailInput {
  return {
    to: "",
    subject: "Verify your HALO 3EL Autotrader account",
    html: WRAP(
      `Welcome, ${name || "Trader"}!`,
      `Confirm your e-mail address to activate your account:<br/><br/>
       <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#1E90FF,#2ECCFF);color:#fff;padding:11px 22px;border-radius:9px;text-decoration:none;font-weight:700;">Verify E-mail Address</a>
       <br/><br/>Or paste this link into your browser:<br/><span style="color:#9BE8FF;word-break:break-all;">${url}</span>
       <br/><br/>If you did not create this account you can safely ignore this e-mail.`,
    ),
  };
}

export function resetEmail(name: string, url: string): MailInput {
  return {
    to: "",
    subject: "Reset your HALO 3EL Autotrader password",
    html: WRAP(
      `Password reset, ${name || "Trader"}`,
      `Use the secure link below to choose a new password (valid for 1 hour):<br/><br/>
       <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#1E90FF,#2ECCFF);color:#fff;padding:11px 22px;border-radius:9px;text-decoration:none;font-weight:700;">Reset Password</a>
       <br/><br/>Or paste this link into your browser:<br/><span style="color:#9BE8FF;word-break:break-all;">${url}</span>`,
    ),
  };
}

export function licenseIssuedEmail(name: string, key: string, planName: string, isComplimentary: boolean): MailInput {
  return {
    to: "",
    subject: `Your HALO 3EL Autotrader ${planName} license`,
    html: WRAP(
      `Your license is ready, ${name || "Trader"}!`,
      `${isComplimentary ? "A complimentary license has been issued to you." : "Thank you for your purchase — your one-time payment is verified."}
       Your <b style="color:#E9B94E;">${planName}</b> lifetime license key:<br/><br/>
       <div style="background:#000714;border:1px solid #1C4478;border-radius:9px;padding:14px;text-align:center;font-size:17px;letter-spacing:.14em;color:#9BE8FF;font-family:monospace;">${key}</div>
       <br/>Sign in, open <b>License Activation</b> and paste the key to unlock your features.`,
    ),
  };
}

export function paymentVerifiedEmail(name: string, planName: string, reference: string): MailInput {
  return {
    to: "",
    subject: `Payment verified — ${planName} license issued`,
    html: WRAP(
      `Payment verified, ${name || "Trader"}!`,
      `Your one-time payment for the <b style="color:#E9B94E;">${planName}</b> plan (reference <span style="color:#9BE8FF;">${reference}</span>) has been verified and your lifetime license has been generated.
       Sign in to view your license key and activate your devices.`,
    ),
  };
}

export function approvalEmail(name: string): MailInput {
  return {
    to: "",
    subject: "Your HALO 3EL Autotrader account is approved",
    html: WRAP(
      `Welcome aboard, ${name || "Trader"}!`,
      `Your account has been reviewed and approved. You can now sign in, purchase a plan and activate your license.`,
    ),
  };
}

// sendMail() callers pass `to` explicitly; templates above leave it blank.
export function addressed(tpl: MailInput, to: string): MailInput {
  return { ...tpl, to };
}
