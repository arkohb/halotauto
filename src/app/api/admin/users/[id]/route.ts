// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/users/[id] · account detail + administrative actions
//  RBAC (server-side, never trusted from the frontend):
//   · approve / reject / verify-email → SUPER_ADMIN, LICENSE_ADMIN
//   · suspend / reactivate / block / reset-sessions → SUPER_ADMIN
//   · every action is audit-logged; customers can never self-approve.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/commerce/auth";
import { ROLES, USER_STATUSES } from "@/lib/commerce/constants";
import { logAudit } from "@/lib/commerce/audit";
import { notify, approvalEmail, sendMail, addressed } from "@/lib/commerce/mailer";

export const dynamic = "force-dynamic";

const APPROVERS = [ROLES.SUPER_ADMIN, ROLES.LICENSE_ADMIN];
const SUPER_ONLY = [ROLES.SUPER_ADMIN];
const VERIFIERS = [ROLES.SUPER_ADMIN, ROLES.LICENSE_ADMIN, ROLES.SUPPORT_ADMIN];

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const { id } = await ctx.params;

    const u = await db.user.findUnique({
      where: { id },
      include: {
        licenses: { include: { activations: true }, orderBy: { createdAt: "desc" } },
        payments: { include: { plan: true }, orderBy: { createdAt: "desc" } },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } },
      },
    });
    if (!u) return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });

    return NextResponse.json({
      ok: true,
      user: {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        username: u.username,
        country: u.country,
        role: u.role,
        status: u.status,
        emailVerified: !!u.emailVerifiedAt,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        activeSessions: u.sessions.length,
      },
      licenses: u.licenses.map((l) => ({
        id: l.id,
        keyMasked: l.key.slice(0, 9) + "…" + l.key.slice(-4),
        planCode: l.planCode,
        planName: l.planName,
        status: l.status,
        deviceLimit: l.deviceLimit,
        deviceCount: l.activations.filter((a) => a.active).length,
        isComplimentary: l.isComplimentary,
        activatedAt: l.activatedAt?.toISOString() ?? null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        lifetime: !l.expiresAt,
        activations: l.activations.map((a) => ({ id: a.id, deviceLabel: a.deviceLabel, active: a.active, activatedAt: a.activatedAt.toISOString() })),
      })),
      payments: u.payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        planName: p.plan.name,
        amountCents: p.amountCents,
        currency: p.currency,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const actor = g.user;
    const { id } = await ctx.params;
    const { action, reason } = (await req.json()) as { action?: string; reason?: string };

    const target = await db.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
    if (target.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json({ ok: false, error: "Only a Super Administrator can act on another Super Administrator." }, { status: 403 });
    }

    let auditAction = "";
    const allowed = (roles: string[]) => roles.includes(actor.role);

    switch (action) {
      case "approve": {
        if (!allowed(APPROVERS)) return NextResponse.json({ ok: false, error: "Your role cannot approve accounts." }, { status: 403 });
        await db.user.update({ where: { id }, data: { status: USER_STATUSES.ACTIVE, emailVerifiedAt: target.emailVerifiedAt ?? new Date() } });
        await notify(id, "approval", "Account approved", "Your account has been approved. Sign in to choose your plan.");
        void sendMail(addressed(approvalEmail(target.fullName), target.email));
        auditAction = "USER_APPROVED";
        break;
      }
      case "reject": {
        if (!allowed(APPROVERS)) return NextResponse.json({ ok: false, error: "Your role cannot reject accounts." }, { status: 403 });
        await db.user.update({ where: { id }, data: { status: USER_STATUSES.REJECTED } });
        await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        auditAction = "USER_REJECTED";
        break;
      }
      case "suspend": {
        if (!allowed(SUPER_ONLY)) return NextResponse.json({ ok: false, error: "Only a Super Administrator can suspend accounts." }, { status: 403 });
        await db.user.update({ where: { id }, data: { status: USER_STATUSES.SUSPENDED } });
        await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        auditAction = "USER_SUSPENDED";
        break;
      }
      case "reactivate": {
        if (!allowed(SUPER_ONLY)) return NextResponse.json({ ok: false, error: "Only a Super Administrator can reactivate accounts." }, { status: 403 });
        await db.user.update({ where: { id }, data: { status: USER_STATUSES.ACTIVE } });
        auditAction = "USER_REACTIVATED";
        break;
      }
      case "block": {
        if (!allowed(SUPER_ONLY)) return NextResponse.json({ ok: false, error: "Only a Super Administrator can block accounts." }, { status: 403 });
        await db.user.update({ where: { id }, data: { status: USER_STATUSES.BLOCKED } });
        await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        auditAction = "USER_BLOCKED";
        break;
      }
      case "verify-email": {
        if (!allowed(VERIFIERS)) return NextResponse.json({ ok: false, error: "Your role cannot verify e-mail addresses." }, { status: 403 });
        await db.user.update({ where: { id }, data: { emailVerifiedAt: target.emailVerifiedAt ?? new Date(), verifyToken: "" } });
        auditAction = "USER_EMAIL_MANUALLY_VERIFIED";
        break;
      }
      case "reset-sessions": {
        if (!allowed(SUPER_ONLY)) return NextResponse.json({ ok: false, error: "Only a Super Administrator can reset sessions." }, { status: 403 });
        await db.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        auditAction = "USER_SESSIONS_RESET";
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }

    await logAudit({
      action: auditAction,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetType: "user",
      targetId: id,
      meta: { targetEmail: target.email, reason: reason ?? "" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
