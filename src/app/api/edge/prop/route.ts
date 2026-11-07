// Prop-firm risk rules — live status + Super Admin reset.
// GET : floors, balance/equity, breaches (any licensed user)
// POST: { action: "reset" } — Super Admin only, audit-logged. Clears a total
//       or daily breach and re-anchors the day after the account was checked.
import { NextResponse } from "next/server";
import { guardLicensed } from "@/lib/api-guard";
import { requireSuper } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { loadPropState, propStatus, propTick, resetPropState } from "@/lib/edge/prop";
import { PROP_PRESETS } from "@/lib/edge/settings";
import { SESSION_HOURS } from "@/lib/edge/filters";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  await propTick().catch(() => null);
  return NextResponse.json({ ok: true, status: await propStatus(), presets: PROP_PRESETS, sessions: SESSION_HOURS });
}

export async function POST(req: Request) {
  const g = await requireSuper();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "reset") return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  const before = await loadPropState();
  await resetPropState();
  await logAudit({ action: "PROP_RULES_RESET", actorId: g.user.id, actorEmail: g.user.email, actorRole: g.user.role, targetType: "setting", targetId: "edge.prop.state", meta: { before } });
  await propTick().catch(() => null);
  return NextResponse.json({ ok: true, status: await propStatus() });
}
