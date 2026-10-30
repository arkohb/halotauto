// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/licenses · license registry (masked keys — full keys are
//  only shown once at generation / to the owning customer)
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/commerce/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const plan = req.nextUrl.searchParams.get("plan") ?? "all";

    const where: Record<string, unknown> = {};
    if (status !== "all") where.status = status;
    if (plan !== "all") where.planCode = plan;
    if (q) {
      where.OR = [{ key: { contains: q.toUpperCase() } }];
    }

    const licenses = await db.license.findMany({
      where,
      include: { user: { select: { email: true, fullName: true } }, activations: { where: { active: true } }, payment: false },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Attach payment references separately (no relation defined License→Payment beyond paymentId).
    const paymentIds = licenses.map((l) => l.paymentId).filter((x): x is string => !!x);
    const payments = paymentIds.length ? await db.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, reference: true, status: true } }) : [];
    const paymentById = Object.fromEntries(payments.map((p) => [p.id, p]));

    return NextResponse.json({
      ok: true,
      licenses: licenses.map((l) => ({
        id: l.id,
        keyMasked: l.key.slice(0, 9) + "…" + l.key.slice(-4),
        customer: l.user ? l.user.fullName || l.user.email : "—",
        customerEmail: l.user?.email ?? "",
        planCode: l.planCode,
        planName: l.planName,
        status: l.status,
        kind: l.kind,
        deviceLimit: l.deviceLimit,
        deviceCount: l.activations.length,
        isComplimentary: l.isComplimentary,
        paymentStatus: l.paymentId ? paymentById[l.paymentId]?.status ?? null : null,
        paymentReference: l.paymentId ? paymentById[l.paymentId]?.reference ?? null : null,
        activatedAt: l.activatedAt?.toISOString() ?? null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        lifetime: !l.expiresAt,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
