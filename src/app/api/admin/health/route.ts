// System health — the monitor's latest checks (any administrator). The
// monitor runs every 30 s; a check older than that is refreshed here.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/commerce/auth";
import { healthSnapshot, runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  let snap = healthSnapshot();
  if (Date.now() - snap.at > 30_000) {
    await runHealthChecks().catch(() => null);
    snap = healthSnapshot();
  }
  return NextResponse.json({ ok: true, ...snap });
}
