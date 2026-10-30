// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/users · searchable, filterable user table (all admin roles)
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/commerce/auth";
import { USER_STATUSES } from "@/lib/commerce/constants";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const filter = req.nextUrl.searchParams.get("filter") ?? "all";

    const where: Record<string, unknown> = {};
    if (q) {
      where.OR = [
        { email: { contains: q } },
        { fullName: { contains: q } },
        { username: { contains: q } },
      ];
    }
    if (filter === "pending") where.status = { in: [USER_STATUSES.PENDING_EMAIL, USER_STATUSES.PENDING_APPROVAL] };
    else if (filter === "active") where.status = USER_STATUSES.ACTIVE;
    else if (filter === "suspended") where.status = USER_STATUSES.SUSPENDED;
    else if (filter === "blocked") where.status = { in: [USER_STATUSES.BLOCKED, USER_STATUSES.REJECTED] };

    const users = await db.user.findMany({
      where,
      include: {
        licenses: { include: { activations: { where: { active: true } } } },
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      ok: true,
      users: users.map((u) => ({
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
        planCode: u.licenses[0]?.planCode ?? null,
        planName: u.licenses[0]?.planName ?? null,
        licenseStatus: u.licenses[0]?.status ?? null,
        licenseKeyMasked: u.licenses[0] ? u.licenses[0].key.slice(0, 9) + "…" + u.licenses[0].key.slice(-4) : null,
        deviceCount: u.licenses.reduce((n, l) => n + l.activations.length, 0),
        lastPaymentStatus: u.payments[0]?.status ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
