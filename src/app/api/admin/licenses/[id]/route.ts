// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/licenses/[id] · consequential license actions
//  RBAC: suspend/reactivate/adjust-devices → SUPER+LICENSE ·
//        revoke/replace/transfer → SUPER+LICENSE (support never) ·
//        reset-activation (device assist) → all admin roles.
//  Every action requires confirmation client-side and is audit-logged.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LICENSE_STATUSES, ROLES } from "@/lib/commerce/constants";
import { requireAdmin } from "@/lib/commerce/auth";
import { deactivateDevice, generateLicense } from "@/lib/commerce/license-engine";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

const SUPER_OR_LICENSE = [ROLES.SUPER_ADMIN, ROLES.LICENSE_ADMIN];
const ALL_ADMINS = [ROLES.SUPER_ADMIN, ROLES.LICENSE_ADMIN, ROLES.SUPPORT_ADMIN];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const actor = g.user;
    const { id } = await ctx.params;
    const { action, deviceLimit, newOwnerEmail, reason } = (await req.json()) as {
      action?: string;
      deviceLimit?: number;
      newOwnerEmail?: string;
      reason?: string;
    };

    const license = await db.license.findUnique({ where: { id }, include: { activations: true, user: true } });
    if (!license) return NextResponse.json({ ok: false, error: "License not found." }, { status: 404 });

    const denied = (roles: string[]) => !roles.includes(actor.role);
    let auditAction = "";

    switch (action) {
      case "suspend": {
        if (denied(SUPER_OR_LICENSE)) return NextResponse.json({ ok: false, error: "Your role cannot suspend licenses." }, { status: 403 });
        await db.license.update({ where: { id }, data: { status: LICENSE_STATUSES.SUSPENDED } });
        auditAction = "LICENSE_SUSPENDED";
        break;
      }
      case "reactivate": {
        if (denied(SUPER_OR_LICENSE)) return NextResponse.json({ ok: false, error: "Your role cannot reactivate licenses." }, { status: 403 });
        if (license.status === LICENSE_STATUSES.REVOKED) return NextResponse.json({ ok: false, error: "A revoked license cannot be reactivated — replace it instead." }, { status: 400 });
        await db.license.update({ where: { id }, data: { status: license.activatedAt ? LICENSE_STATUSES.ACTIVE : LICENSE_STATUSES.UNACTIVATED } });
        auditAction = "LICENSE_REACTIVATED";
        break;
      }
      case "revoke": {
        if (denied(SUPER_OR_LICENSE)) return NextResponse.json({ ok: false, error: "Your role cannot revoke licenses." }, { status: 403 });
        await db.license.update({ where: { id }, data: { status: LICENSE_STATUSES.REVOKED } });
        await db.licenseActivation.updateMany({ where: { licenseId: id, active: true }, data: { active: false, revokedAt: new Date() } });
        auditAction = "LICENSE_REVOKED";
        break;
      }
      case "adjust-devices": {
        if (denied(SUPER_OR_LICENSE)) return NextResponse.json({ ok: false, error: "Your role cannot adjust device allowances." }, { status: 403 });
        if (!deviceLimit || deviceLimit < 1 || deviceLimit > 50) return NextResponse.json({ ok: false, error: "Device allowance must be between 1 and 50." }, { status: 400 });
        await db.license.update({ where: { id }, data: { deviceLimit } });
        auditAction = "LICENSE_DEVICE_ALLOWANCE_ADJUSTED";
        break;
      }
      case "transfer": {
        if (denied(SUPER_OR_LICENSE)) return NextResponse.json({ ok: false, error: "Your role cannot transfer licenses." }, { status: 403 });
        if (!newOwnerEmail?.trim()) return NextResponse.json({ ok: false, error: "Enter the new owner's e-mail." }, { status: 400 });
        const u = await db.user.findUnique({ where: { email: newOwnerEmail.trim().toLowerCase() } });
        if (!u) return NextResponse.json({ ok: false, error: "No account found for that e-mail — the customer must register first." }, { status: 404 });
        await db.license.update({ where: { id }, data: { userId: u.id } });
        await db.licenseActivation.updateMany({ where: { licenseId: id, active: true }, data: { active: false, revokedAt: new Date() } });
        auditAction = "LICENSE_TRANSFERRED";
        break;
      }
      case "replace": {
        if (denied(SUPER_OR_LICENSE)) return NextResponse.json({ ok: false, error: "Your role cannot replace licenses." }, { status: 403 });
        const replacement = await generateLicense({
          planCode: license.planCode,
          planName: license.planName,
          deviceLimit: license.deviceLimit,
          userId: license.userId,
          kind: license.kind as "SINGLE_USER" | "MULTI_USER",
          seatLimit: license.seatLimit,
          expiresAt: license.expiresAt,
          isComplimentary: license.isComplimentary,
          compReason: license.compReason || `replacement for ${license.key.slice(0, 9)}…`,
          paymentId: license.paymentId,
          issuedBy: actor,
          notes: `Replacement for revoked license ${license.key.slice(0, 9)}…`,
          sendEmail: false,
        });
        await db.license.update({ where: { id }, data: { status: LICENSE_STATUSES.REVOKED } });
        await db.licenseActivation.updateMany({ where: { licenseId: id, active: true }, data: { active: false, revokedAt: new Date() } });
        await logAudit({ action: "LICENSE_REPLACED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "license", targetId: id, meta: { replacementKeyMasked: replacement.key.slice(0, 9) + "…", reason: reason ?? "" } });
        return NextResponse.json({ ok: true, replacementKey: replacement.key });
      }
      case "reset-activation": {
        if (denied(ALL_ADMINS)) return NextResponse.json({ ok: false, error: "Your role cannot reset activations." }, { status: 403 });
        const { activationId } = (await req.json()) as { activationId?: string };
        if (!activationId) return NextResponse.json({ ok: false, error: "Select the device activation to reset." }, { status: 400 });
        const ok = await deactivateDevice(activationId, actor);
        if (!ok) return NextResponse.json({ ok: false, error: "Activation not found or already inactive." }, { status: 400 });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }

    await logAudit({
      action: auditAction,
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetType: "license",
      targetId: id,
      meta: { keyMasked: license.key.slice(0, 9) + "…", deviceLimit: deviceLimit ?? null, newOwnerEmail: newOwnerEmail ?? "", reason: reason ?? "" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
