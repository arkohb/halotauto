// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/demo — seed or clear the clearly-labeled DEMO dataset.
//  Seeding is refused unless the journal is empty → demo rows can never
//  mix with real MT5/CSV/manual history. Clearing touches ONLY demo rows.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { seedDemoJournal, clearDemoJournal } from "@/lib/journal/demo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  try {
    const b = (await req.json().catch(() => ({}))) as { action?: string; count?: number };
    if (b.action === "seed") {
      const result = await seedDemoJournal(userId, Number(b.count ?? 78));
      return NextResponse.json({ ok: true, result });
    }
    if (b.action === "clear") {
      const result = await clearDemoJournal(userId);
      const remaining = await db.journalTrade.count({ where: { userId } });
      return NextResponse.json({ ok: true, result, remaining });
    }
    return NextResponse.json({ ok: false, error: "Unknown action — use \"seed\" or \"clear\"." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
