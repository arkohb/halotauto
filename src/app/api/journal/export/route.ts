// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/export — CSV download of the FILTERED journal (same filter
//  contract as the list route, so an export always matches what's on
//  screen). Demo rows are labeled DEMO in the Source column.
// ══════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { syncHaloTrades } from "@/lib/journal/halo-sync";
import { requireUser } from "@/lib/commerce/auth";
import { parseFilters } from "@/lib/journal/filters";
import { toRec } from "@/lib/journal/records";
import { tradesToCsv } from "@/lib/journal/csv";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requireUser();
  if (!g.ok) return new Response(JSON.stringify({ ok: false, error: g.error }), { status: g.status });
  const userId = g.user!.id;
  await syncHaloTrades(userId).catch(() => 0); // HALO bot book → journal
  const url = new URL(req.url);
  const f = parseFilters(url);
  try {
    const rows = await db.journalTrade.findMany({
      where: { userId, ...f.where },
      orderBy: { closedAt: "desc" },
      take: 20000,
    });
    const csv = tradesToCsv(rows.map(toRec));
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="halo-journal-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
