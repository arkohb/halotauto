// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/sync — MT5 closed-trade synchronization (READ-ONLY import).
//    GET  : sync bookkeeping + the MetaApi connections available
//    POST : run the sync (accountId?, lookbackDays?)
//  Errors are recorded on the user's JournalState and shown in the UI —
//  the journal never pretends a sync succeeded.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { syncMt5History } from "@/lib/journal/mt5-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  try {
    const [state, accounts] = await Promise.all([
      db.journalState.findUnique({ where: { userId } }),
      db.brokerAccount.findMany({
        where: { kind: "metaapi" },
        select: { id: true, label: true, status: true, statusMsg: true, active: true },
      }),
    ]);
    return NextResponse.json({
      ok: true,
      sync: state
        ? {
            lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
            lastSyncOk: state.lastSyncOk,
            lastSyncMsg: state.lastSyncMsg,
            syncBrokerId: state.syncBrokerId,
            lookbackDays: state.syncLookback,
            balanceOps: (() => {
              try {
                return JSON.parse(state.balanceOpsJson) as { time: string; amount: number; balance: number; comment: string }[];
              } catch {
                return [];
              }
            })(),
          }
        : null,
      accounts,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  try {
    const b = (await req.json().catch(() => ({}))) as { accountId?: string; lookbackDays?: number };
    const result = await syncMt5History({
      userId,
      accountId: b.accountId ? String(b.accountId) : undefined,
      lookbackDays: b.lookbackDays ? Number(b.lookbackDays) : undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
