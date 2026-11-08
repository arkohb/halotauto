// API rate limits — rules, limits and allowed/rejected counters since the
// server started (any administrator). Limits are defined in src/lib/rate-limit.ts.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/commerce/auth";
import { rateStats } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  return NextResponse.json({ ok: true, ...rateStats() });
}
