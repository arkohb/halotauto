// Persistent execution lock — status for administrators; for the Super Admin:
//   { action: "recheck", intentId }               ask the broker again by order id
//   { intentId, outcome: "executed"|"not_executed" } manual resolution after checking
// Audit-logged. Never touches broker positions.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, requireSuper } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { lockHolder, reconcileByReference, resolveUncertain } from "@/lib/exec-lock";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const holder = await lockHolder();
  const recent = await db.executionIntent.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const events = holder ? await db.executionEvent.findMany({ where: { intentId: holder.intentId }, orderBy: { at: "asc" } }) : [];
  // every unresolved order with its full reconciliation trail
  const uncertainRows = await db.executionIntent.findMany({ where: { state: "UNCERTAIN" }, orderBy: { createdAt: "asc" } });
  const uncertain = await Promise.all(
    uncertainRows.map(async (i) => ({ ...i, events: await db.executionEvent.findMany({ where: { intentId: i.id }, orderBy: { at: "asc" } }) }))
  );
  return NextResponse.json({ ok: true, holder, events, uncertain, recent });
}

export async function POST(req: Request) {
  const g = await requireSuper();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  let body: { intentId?: unknown; outcome?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (body.action === "recheck" && typeof body.intentId === "string") {
    const result = await reconcileByReference(body.intentId, `re-check by ${g.user.email}`);
    await logAudit({ action: "EXECUTION_LOCK_RECHECK", actorId: g.user.id, actorEmail: g.user.email, actorRole: g.user.role, targetType: "execution_intent", targetId: body.intentId, outcome: "success", meta: { result } });
    return NextResponse.json({ ok: result !== "skipped", result, error: result === "skipped" ? "Not an uncertain live order." : undefined }, { status: result === "skipped" ? 400 : 200 });
  }
  const outcome = body.outcome === "executed" ? "executed" : body.outcome === "not_executed" ? "not_executed" : null;
  if (!outcome || typeof body.intentId !== "string") {
    return NextResponse.json({ ok: false, error: 'Send { intentId, outcome: "executed" | "not_executed" } after checking the broker.' }, { status: 400 });
  }
  const r = await resolveUncertain(body.intentId, outcome, g.user.email);
  await logAudit({ action: "EXECUTION_LOCK_RESOLVED", actorId: g.user.id, actorEmail: g.user.email, actorRole: g.user.role, targetType: "execution_intent", targetId: body.intentId, outcome: r.ok ? "success" : "failed", meta: { outcome } });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
