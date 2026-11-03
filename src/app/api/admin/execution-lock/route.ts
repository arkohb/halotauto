// Persistent execution lock — status for administrators; resolution of an
// UNCERTAIN order by the Super Admin only (after checking the broker).
// Audit-logged. Never touches broker positions.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, requireSuper } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { lockHolder, resolveUncertain } from "@/lib/exec-lock";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const holder = await lockHolder();
  const recent = await db.executionIntent.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const events = holder ? await db.executionEvent.findMany({ where: { intentId: holder.intentId }, orderBy: { at: "asc" } }) : [];
  return NextResponse.json({ ok: true, holder, events, recent });
}

export async function POST(req: Request) {
  const g = await requireSuper();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  let body: { intentId?: unknown; outcome?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const outcome = body.outcome === "executed" ? "executed" : body.outcome === "not_executed" ? "not_executed" : null;
  if (!outcome || typeof body.intentId !== "string") {
    return NextResponse.json({ ok: false, error: 'Send { intentId, outcome: "executed" | "not_executed" } after checking the broker.' }, { status: 400 });
  }
  const r = await resolveUncertain(body.intentId, outcome, g.user.email);
  await logAudit({ action: "EXECUTION_LOCK_RESOLVED", actorId: g.user.id, actorEmail: g.user.email, actorRole: g.user.role, targetType: "execution_intent", targetId: body.intentId, outcome: r.ok ? "success" : "failed", meta: { outcome } });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
