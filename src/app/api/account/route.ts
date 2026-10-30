// ══════════════════════════════════════════════════════════════════════════
//  /api/account · customer account dashboard data
//  Profile, license + entitlements, devices, purchases, notifications,
//  and the upgrade map (locked features → plan that unlocks them).
//  Only ever returns the signed-in customer's own data.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { evaluateUserLicense } from "@/lib/commerce/license-engine";
import { lockedFeaturesByPlan } from "@/lib/commerce/entitlements";
import { maskKey } from "@/lib/commerce/license-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const g = await requireUser();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const user = g.user;

    const [ev, payments, notifications, licenses] = await Promise.all([
      evaluateUserLicense(user.id),
      db.payment.findMany({ where: { userId: user.id }, include: { plan: true }, orderBy: { createdAt: "desc" }, take: 25 }),
      db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      db.license.findMany({ where: { userId: user.id }, include: { activations: { where: { active: true } } }, orderBy: { createdAt: "desc" } }),
    ]);

    return NextResponse.json({
      ok: true,
      user,
      license: ev.license
        ? {
            ...ev.license,
            keyMasked: maskKey(ev.license.key),
          }
        : null,
      licenseReason: ev.reason,
      entitlements: ev.license?.entitlements ?? [],
      upgrades: lockedFeaturesByPlan(ev.license?.entitlements ?? []),
      devices: licenses.flatMap((l) =>
        l.activations
          .filter((a) => a.active)
          .map((a) => ({
            id: a.id,
            deviceLabel: a.deviceLabel,
            planName: l.planName,
            licenseKeyMasked: maskKey(l.key),
            activatedAt: a.activatedAt.toISOString(),
          })),
      ),
      licenses: licenses.map((l) => ({
        id: l.id,
        keyMasked: maskKey(l.key),
        planCode: l.planCode,
        planName: l.planName,
        status: l.status,
        deviceLimit: l.deviceLimit,
        deviceCount: l.activations.length,
        isComplimentary: l.isComplimentary,
        activatedAt: l.activatedAt?.toISOString() ?? null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        lifetime: !l.expiresAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        reference: p.reference,
        planName: p.plan.name,
        amountCents: p.amountCents,
        currency: p.currency,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
        licenseKeyMasked: p.licenseRef ? maskKey(p.licenseRef) : null,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
