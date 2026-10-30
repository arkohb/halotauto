// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/audit · read-only audit trail (all admin roles)
//  No endpoint in the platform can alter or delete audit records.
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
    const action = req.nextUrl.searchParams.get("action")?.trim() ?? "";

    const where: Record<string, unknown> = {};
    if (action) where.action = { contains: action.toUpperCase() };
    if (q) {
      where.OR = [{ actorEmail: { contains: q } }, { targetType: { contains: q } }, { targetId: { contains: q } }];
    }

    const logs = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
    return NextResponse.json({
      ok: true,
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        actor: l.actorEmail || l.actorId || "system",
        actorRole: l.actorRole,
        targetType: l.targetType,
        targetId: l.targetId,
        outcome: l.outcome,
        meta: (() => {
          try {
            return JSON.parse(l.metaJson) as Record<string, unknown>;
          } catch {
            return {};
          }
        })(),
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
