// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/transactions · payment ledger (all admins read)
//  /api/admin/transactions/[id] POST actions:
//   · verify (manual payment verification) → SUPER_ADMIN, LICENSE_ADMIN
//     (records reference, amount, currency, admin identity, audit)
//   · mark-failed / mark-refunded / mark-disputed → SUPER_ADMIN
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LICENSE_STATUSES, PAYMENT_STATUSES, ROLES } from "@/lib/commerce/constants";
import { requireAdmin } from "@/lib/commerce/auth";
import { canManuallyVerify, processVerifiedPayment } from "@/lib/commerce/payments";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const where: Record<string, unknown> = {};
    if (status !== "all") where.status = status;
    if (q) {
      where.OR = [{ reference: { contains: q.toUpperCase() } }, { user: { is: { email: { contains: q.toLowerCase() } } } }];
    }

    const payments = await db.payment.findMany({
      where,
      include: { user: { select: { email: true, fullName: true } }, plan: { select: { name: true, code: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      ok: true,
      transactions: payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        customer: p.user.fullName || p.user.email,
        customerEmail: p.user.email,
        planName: p.plan.name,
        planCode: p.plan.code,
        amountCents: p.amountCents,
        currency: p.currency,
        provider: p.provider,
        status: p.status,
        licenseKeyMasked: p.licenseRef ? p.licenseRef.slice(0, 9) + "…" + p.licenseRef.slice(-4) : null,
        manualVerifiedAt: p.manualVerifiedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const actor = g.user;
    const { paymentId, action, adminNote } = (await req.json()) as { paymentId?: string; action?: string; adminNote?: string };
    if (!paymentId || !action) return NextResponse.json({ ok: false, error: "paymentId and action are required." }, { status: 400 });

    const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { plan: true, user: true } });
    if (!payment) return NextResponse.json({ ok: false, error: "Payment not found." }, { status: 404 });

    switch (action) {
      case "verify": {
        if (!canManuallyVerify(actor.role)) {
          await logAudit({ action: "PAYMENT_VERIFY_DENIED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "payment", targetId: payment.id, outcome: "denied" });
          return NextResponse.json({ ok: false, error: "Your role is not authorized to verify payments." }, { status: 403 });
        }
        const r = await processVerifiedPayment({
          reference: payment.reference,
          provider: payment.provider === "MANUAL" ? "MANUAL" : payment.provider as "PAYSTACK" | "FLUTTERWAVE",
          actor: { id: actor.id, email: actor.email, role: actor.role },
          manual: true,
        });
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
        if (adminNote) await db.payment.update({ where: { id: payment.id }, data: { adminNote } });
        return NextResponse.json({ ok: true, duplicate: !!r.duplicate, licenseKey: r.licenseKey });
      }
      case "mark-failed": {
        if (actor.role !== ROLES.SUPER_ADMIN) return NextResponse.json({ ok: false, error: "Only a Super Administrator can mark payments failed." }, { status: 403 });
        if (payment.status === PAYMENT_STATUSES.VERIFIED) return NextResponse.json({ ok: false, error: "A VERIFIED payment cannot be marked failed — issue a refund instead." }, { status: 400 });
        await db.payment.update({ where: { id: payment.id }, data: { status: PAYMENT_STATUSES.FAILED, adminNote: adminNote ?? "" } });
        await logAudit({ action: "PAYMENT_MARKED_FAILED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "payment", targetId: payment.id, meta: { reference: payment.reference } });
        return NextResponse.json({ ok: true });
      }
      case "mark-refunded": {
        if (actor.role !== ROLES.SUPER_ADMIN) return NextResponse.json({ ok: false, error: "Only a Super Administrator can record refunds." }, { status: 403 });
        await db.payment.update({ where: { id: payment.id }, data: { status: PAYMENT_STATUSES.REFUNDED, adminNote: adminNote ?? "" } });
        await logAudit({ action: "PAYMENT_MARKED_REFUNDED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "payment", targetId: payment.id, meta: { reference: payment.reference } });
        // a refunded payment must not leave an active licence behind
        const revoked = await db.license.updateMany({ where: { paymentId: payment.id, status: { not: LICENSE_STATUSES.REVOKED } }, data: { status: LICENSE_STATUSES.REVOKED } });
        if (revoked.count) await logAudit({ action: "LICENSE_REVOKED_ON_REFUND", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "payment", targetId: payment.id, meta: { licenses: revoked.count } });
        return NextResponse.json({ ok: true, licensesRevoked: revoked.count });
      }
      case "mark-disputed": {
        if (actor.role !== ROLES.SUPER_ADMIN) return NextResponse.json({ ok: false, error: "Only a Super Administrator can flag disputes." }, { status: 403 });
        await db.payment.update({ where: { id: payment.id }, data: { status: PAYMENT_STATUSES.DISPUTED, adminNote: adminNote ?? "" } });
        await logAudit({ action: "PAYMENT_MARKED_DISPUTED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "payment", targetId: payment.id, meta: { reference: payment.reference } });
        // disputed → the licence (activated or not) is suspended until the dispute is settled
        const suspended = await db.license.updateMany({ where: { paymentId: payment.id, status: { in: [LICENSE_STATUSES.ACTIVE, LICENSE_STATUSES.UNACTIVATED] } }, data: { status: LICENSE_STATUSES.SUSPENDED } });
        if (suspended.count) await logAudit({ action: "LICENSE_SUSPENDED_ON_DISPUTE", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "payment", targetId: payment.id, meta: { licenses: suspended.count } });
        return NextResponse.json({ ok: true, licensesSuspended: suspended.count });
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
