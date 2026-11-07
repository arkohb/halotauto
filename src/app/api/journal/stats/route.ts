// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/stats — full analytics payload for the filtered journal:
//  KPIs, daily/weekly/monthly P&L, cumulative curve, equity curve (real
//  snapshots or derived-and-labeled), calendar month, breakdowns, risk and
//  discipline. Pure calculations live in lib/journal/stats.ts.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncHaloTrades } from "@/lib/journal/halo-sync";
import { requireUser } from "@/lib/commerce/auth";
import { parseFilters, prevWindow } from "@/lib/journal/filters";
import { toRec } from "@/lib/journal/records";
import { analyticsFor, coreStats, type CoreStats, type EquitySnapshot } from "@/lib/journal/stats";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  await syncHaloTrades(userId).catch(() => 0); // HALO bot book → journal
  const url = new URL(req.url);
  const f = parseFilters(url);

  try {
    const [rows, snaps, state] = await Promise.all([
      db.journalTrade.findMany({
        where: { userId, ...f.where },
        orderBy: { closedAt: "asc" },
        // analytics run on the whole filtered set; 20k rows is the practical
        // SQLite ceiling here — beyond that the UI narrows the range
        take: 20000,
      }),
      db.journalEquity.findMany({ where: { userId }, orderBy: { day: "asc" } }),
      db.journalState.findUnique({ where: { userId } }),
    ]);

    const snapshots: EquitySnapshot[] = snaps.map((s) => ({
      day: s.day,
      balance: s.balance,
      equity: s.equity,
      source: s.source,
    }));
    const payload = analyticsFor(rows.map(toRec), { year: f.year, month0: f.month0, snapshots });

    // previous-period comparison — computed ONLY when a fair preceding
    // window exists (same filters, shifted window). Never invented.
    let prev: CoreStats | null = null;
    const pw = prevWindow(f.period, f.from, f.to);
    if (pw.from || pw.to) {
      const prevRows = await db.journalTrade.findMany({
        where: {
          userId,
          ...f.where,
          closedAt: { ...(pw.from ? { gte: pw.from } : {}), ...(pw.to ? { lte: pw.to } : {}) },
        },
        orderBy: { closedAt: "asc" },
        take: 20000,
      });
      prev = coreStats(prevRows.map(toRec));
    }

    return NextResponse.json({
      ok: true,
      ...payload,
      prev,
      sync: state
        ? {
            lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
            lastSyncOk: state.lastSyncOk,
            lastSyncMsg: state.lastSyncMsg,
            balanceOps: (() => {
              try {
                return JSON.parse(state.balanceOpsJson) as { time: string; amount: number; balance: number; comment: string }[];
              } catch {
                return [];
              }
            })(),
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
