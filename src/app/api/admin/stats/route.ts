// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/stats · administrator overview — REAL database-backed numbers
//  Never displays invented statistics. Revenue counts VERIFIED payments only;
//  complimentary licenses are reported separately from paid sales.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/commerce/auth";
import { PAYMENT_STATUSES, USER_STATUSES } from "@/lib/commerce/constants";
import { providerStatus } from "@/lib/commerce/payments";
import { isCommercialEnabled } from "@/lib/license";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    const [usersTotal, byStatus, licensesTotal, activeLicenses, revokedLicenses, pendingApprovals, recentPayments, recentAudit, compCount] = await Promise.all([
      db.user.count(),
      db.user.groupBy({ by: ["status"], _count: true }),
      db.license.count(),
      db.license.count({ where: { status: "ACTIVE" } }),
      db.license.count({ where: { status: "REVOKED" } }),
      db.user.count({ where: { status: { in: [USER_STATUSES.PENDING_EMAIL, USER_STATUSES.PENDING_APPROVAL] } } }),
      db.payment.findMany({ include: { user: { select: { email: true, fullName: true } }, plan: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.license.count({ where: { isComplimentary: true } }),
    ]);

    const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
    const plans = await db.plan.findMany({ select: { id: true, code: true, name: true } });
    const planById = Object.fromEntries(plans.map((p) => [p.id, p]));

    // Revenue by plan (VERIFIED payments only) — grouped per currency for correctness.
    const revenueByPlan: Record<string, { name: string; count: number; amountCents: number; currency: string }> = {};
    let totalRevenueCents = 0;
    let mainCurrency = "USD";
    const paymentsVerified = await db.payment.findMany({ where: { status: PAYMENT_STATUSES.VERIFIED }, select: { amountCents: true, currency: true, planId: true } });
    for (const p of paymentsVerified) {
      const plan = planById[p.planId] ?? { code: "?", name: "Unknown" };
      const k = `${plan.code}:${p.currency}`;
      revenueByPlan[k] = revenueByPlan[k] ?? { name: plan.name, count: 0, amountCents: 0, currency: p.currency };
      revenueByPlan[k].count += 1;
      revenueByPlan[k].amountCents += p.amountCents;
      if (p.currency === mainCurrency) totalRevenueCents += p.amountCents;
    }

    return NextResponse.json({
      ok: true,
      users: {
        total: usersTotal,
        active: statusMap[USER_STATUSES.ACTIVE] ?? 0,
        pendingApprovals,
        suspended: statusMap[USER_STATUSES.SUSPENDED] ?? 0,
        blocked: statusMap[USER_STATUSES.BLOCKED] ?? 0,
        rejected: statusMap[USER_STATUSES.REJECTED] ?? 0,
        pendingEmail: statusMap[USER_STATUSES.PENDING_EMAIL] ?? 0,
      },
      licenses: { total: licensesTotal, active: activeLicenses, revoked: revokedLicenses, complimentary: compCount, unactivated: licensesTotal - activeLicenses - revokedLicenses },
      revenue: {
        totalCents: totalRevenueCents,
        currency: mainCurrency,
        byPlan: Object.entries(revenueByPlan).map(([k, v]) => ({ key: k, ...v })),
      },
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        reference: p.reference,
        customer: p.user.fullName || p.user.email,
        planName: p.plan.name,
        amountCents: p.amountCents,
        currency: p.currency,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      recentActivity: recentAudit.map((a) => ({
        id: a.id,
        action: a.action,
        actor: a.actorEmail || a.actorId || "system",
        targetType: a.targetType,
        targetId: a.targetId,
        outcome: a.outcome,
        createdAt: a.createdAt.toISOString(),
      })),
      system: {
        commerceMode: isCommercialEnabled(),
        database: "online",
        paymentProvider: providerStatus(),
        licenseService: "online",
        application: "online",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
