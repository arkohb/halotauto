// ════════════════════════════════════════════════════════════════════════
//  /api/strategies/[id]/activate · select / deselect the bot's strategy
//  active=true  → this Pine strategy becomes THE bot strategy (single-active)
//  active=false → back to the built-in HALO 3EL v1.2 engine
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { requireStrategyAccess } from "@/lib/license";
import { activatePineStrategy, deactivatePineStrategy, getPineBotInfo } from "@/lib/pine-bot";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireStrategyAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  try {
    const body = (await req.json().catch(() => ({}))) as { active?: boolean };
    const active = body.active !== false;
    if (active) {
      const r = await activatePineStrategy(id);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    } else {
      const row = await deactivateIfCurrent(id);
      void row;
    }
    return NextResponse.json({ ok: true, bot: getPineBotInfo() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function deactivateIfCurrent(id: string): Promise<unknown> {
  const { db } = await import("@/lib/db");
  const row = await db.pineStrategy.findUnique({ where: { id } });
  if (row?.active) await deactivatePineStrategy();
  return row;
}
