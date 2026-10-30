// ════════════════════════════════════════════════════════════════════════
//  /api/strategies/[id] · read / update / delete one Pine strategy
//  Editing an ACTIVE strategy recompiles; a broken source deactivates it
//  honestly (the bot never trades a script that no longer compiles).
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStrategyAccess } from "@/lib/license";
import { compileAndSave, toSummary } from "@/lib/strategy-store";
import { deactivatePineStrategy } from "@/lib/pine-bot";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const row = await db.pineStrategy.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "Strategy not found." }, { status: 404 });
    return NextResponse.json({ ok: true, strategy: { ...toSummary(row), pineSource: row.pineSource } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireStrategyAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const existing = await db.pineStrategy.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ ok: false, error: "Strategy not found." }, { status: 404 });
    const wasActive = existing.active;
    const { row, compile, summary } = await compileAndSave(body, id);
    // an active strategy whose source no longer compiles is deactivated honestly
    if (wasActive && !compile.ok) {
      await deactivatePineStrategy();
      await db.pineStrategy.update({ where: { id }, data: { active: false } });
    }
    return NextResponse.json({ ok: true, strategy: summary, compile, deactivated: wasActive && !compile.ok });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireStrategyAccess();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  try {
    const existing = await db.pineStrategy.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ ok: false, error: "Strategy not found." }, { status: 404 });
    if (existing.active) await deactivatePineStrategy();
    await db.pineStrategy.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
