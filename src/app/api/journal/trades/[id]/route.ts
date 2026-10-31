// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/trades/[id] — inspect, annotate or remove one record.
//  PATCH updates ONLY the trader-authored fields (notes, tags, review,
//  strategy/timeframe classification) — broker-derived numbers are never
//  edited through this route, so the journal can't drift from the source.
//  DELETE removes a single record (an MT5 re-sync would re-import it).
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { toRec } from "@/lib/journal/records";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  const { id } = await ctx.params;

  try {
    const existing = await db.journalTrade.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ ok: false, error: "Trade not found in your journal." }, { status: 404 });

    const b = (await req.json()) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (b.notes !== undefined) data.notes = String(b.notes ?? "").slice(0, 4000);
    if (b.strategy !== undefined) data.strategy = String(b.strategy ?? "").trim().slice(0, 120);
    if (b.timeframe !== undefined) data.timeframe = String(b.timeframe ?? "").trim().slice(0, 20);
    if (b.tags !== undefined && Array.isArray(b.tags)) {
      data.tagsJson = JSON.stringify(b.tags.filter((x): x is string => typeof x === "string").slice(0, 12));
    }
    if (b.review !== undefined && b.review && typeof b.review === "object") {
      const r = b.review as Record<string, unknown>;
      const clean: Record<string, unknown> = {};
      for (const k of ["reasonEntry", "reasonExit", "chartNotes", "mistakes", "lessons"]) {
        if (r[k] !== undefined) clean[k] = String(r[k] ?? "").slice(0, 2000);
      }
      if (r.rating !== undefined) {
        const n = Number(r.rating);
        if (isFinite(n)) clean.rating = Math.min(5, Math.max(1, Math.round(n)));
      }
      data.reviewJson = JSON.stringify(clean);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    }
    const row = await db.journalTrade.update({ where: { id }, data });
    return NextResponse.json({ ok: true, trade: toRec(row) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  const { id } = await ctx.params;
  try {
    const existing = await db.journalTrade.findFirst({ where: { id, userId } });
    if (!existing) return NextResponse.json({ ok: false, error: "Trade not found in your journal." }, { status: 404 });
    await db.journalTrade.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
