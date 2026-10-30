// ════════════════════════════════════════════════════════════════════════
//  /api/strategies · list + create trader Pine strategies
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStrategyAccess } from "@/lib/license";
import { compileAndSave, toSummary } from "@/lib/strategy-store";
import { selectedStrategyInfo } from "@/lib/pine-bot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.pineStrategy.findMany({ orderBy: { updatedAt: "desc" } });
    return NextResponse.json({
      ok: true,
      strategies: rows.map(toSummary),
      selected: selectedStrategyInfo(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireStrategyAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.pineSource !== "string" || body.pineSource.trim().length === 0) {
      return NextResponse.json({ ok: false, error: "Paste a Pine Script source first." }, { status: 400 });
    }
    const { compile, summary } = await compileAndSave(body);
    return NextResponse.json({ ok: true, strategy: summary, compile });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
