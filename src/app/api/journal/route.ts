// ══════════════════════════════════════════════════════════════════════════
//  /api/journal — the trade book (list + manual entry). Every row is scoped
//  to the signed-in user (userId) — journal data is private per account.
//  GET  : filtered + paginated trade list + journal meta
//  POST : manual entry (validated; never fabricated)
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { syncHaloTrades } from "@/lib/journal/halo-sync";
import { requireUser } from "@/lib/commerce/auth";
import { parseFilters } from "@/lib/journal/filters";
import { toRec } from "@/lib/journal/records";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;
  await syncHaloTrades(userId).catch(() => 0); // HALO bot book → journal
  const url = new URL(req.url);

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
  const sort = url.searchParams.get("sort") === "oldest" ? "asc" : "desc";
  const f = parseFilters(url);

  try {
    const [rows, total, state, sources, symbols, strategies, timeframes] = await Promise.all([
      db.journalTrade.findMany({
        where: { userId, ...f.where },
        orderBy: { closedAt: sort },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.journalTrade.count({ where: { userId, ...f.where } }),
      db.journalState.findUnique({ where: { userId } }),
      db.journalTrade.findMany({ where: { userId }, select: { source: true }, distinct: ["source"] }),
      db.journalTrade.findMany({ where: { userId }, select: { symbol: true }, distinct: ["symbol"], orderBy: { symbol: "asc" } }),
      db.journalTrade.findMany({ where: { userId, strategy: { not: "" } }, select: { strategy: true }, distinct: ["strategy"], orderBy: { strategy: "asc" } }),
      db.journalTrade.findMany({ where: { userId, timeframe: { not: "" } }, select: { timeframe: true }, distinct: ["timeframe"], orderBy: { timeframe: "asc" } }),
    ]);

    const accounts = await db.brokerAccount.findMany({
      where: { kind: "metaapi" },
      select: { id: true, label: true, status: true, active: true },
    });

    return NextResponse.json({
      ok: true,
      trades: rows.map(toRec),
      total,
      page,
      pageSize,
      meta: {
        sources: sources.map((s) => s.source).sort(),
        symbols: symbols.map((s) => s.symbol),
        strategies: strategies.map((s) => s.strategy),
        timeframes: timeframes.map((t) => t.timeframe),
        sync: state
          ? {
              lastSyncAt: state.lastSyncAt?.toISOString() ?? null,
              lastSyncOk: state.lastSyncOk,
              lastSyncMsg: state.lastSyncMsg,
              syncBrokerId: state.syncBrokerId,
              balanceOps: (() => {
                try {
                  return (JSON.parse(state.balanceOpsJson) as unknown[]).length;
                } catch {
                  return 0;
                }
              })(),
            }
          : null,
        mtAccounts: accounts,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function numField(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  try {
    const symbol = String(b.symbol ?? "").trim().toUpperCase();
    const direction = String(b.direction ?? "").trim().toUpperCase();
    const entryPrice = numField(b.entryPrice);
    const exitPrice = numField(b.exitPrice);
    const openedAt = b.openedAt ? new Date(String(b.openedAt)) : null;
    const closedAt = b.closedAt ? new Date(String(b.closedAt)) : null;

    const problems: string[] = [];
    if (!symbol) problems.push("Instrument is required.");
    if (direction !== "BUY" && direction !== "SELL") problems.push("Direction must be BUY or SELL.");
    if (entryPrice === null || entryPrice <= 0) problems.push("Entry price must be a positive number.");
    if (exitPrice === null || exitPrice <= 0) problems.push("Exit price must be a positive number.");
    if (!openedAt || !isFinite(+openedAt)) problems.push("Open time is required (date/time).");
    if (!closedAt || !isFinite(+closedAt)) problems.push("Close time is required (date/time).");
    if (openedAt && closedAt && +closedAt < +openedAt) problems.push("Close time cannot be before open time.");
    if (problems.length > 0) return NextResponse.json({ ok: false, error: problems.join(" ") }, { status: 400 });

    const volume = numField(b.volume) ?? 0;
    const grossProfit = numField(b.grossProfit) ?? 0;
    const commission = numField(b.commission) ?? 0;
    const swap = numField(b.swap) ?? 0;
    const fees = numField(b.fees) ?? 0;
    const netPnl = numField(b.netPnl) ?? grossProfit + commission + swap + fees;
    const sl = numField(b.sl);
    const tp = numField(b.tp);
    const dir = direction === "SELL" ? -1 : 1;
    const riskPrice = sl !== null && sl > 0 && entryPrice ? Math.abs(entryPrice - sl) : null;
    const rMultiple = riskPrice && riskPrice > 0 && exitPrice !== null && entryPrice !== null ? ((exitPrice - entryPrice) * dir) / riskPrice : null;
    const durationMin = Math.max(0, Math.round((+closedAt! - +openedAt!) / 60000));
    const hour = openedAt!.getUTCHours();
    const session = hour < 7 ? "Asia" : hour < 13 ? "London" : hour < 21 ? "New York" : "Sydney";

    const row = await db.journalTrade.create({
      data: {
        userId,
        extKey: `manual:${crypto.randomBytes(10).toString("hex")}`,
        source: "MANUAL",
        brokerLabel: "Manual entry",
        symbol,
        direction,
        volume,
        volumeExit: volume,
        entryPrice: entryPrice!,
        exitPrice: exitPrice!,
        sl,
        tp,
        openedAt: openedAt!,
        closedAt: closedAt!,
        durationMin,
        grossProfit,
        commission,
        swap,
        fees,
        netPnl,
        currency: String(b.currency ?? "USD").trim().toUpperCase() || "USD",
        riskPrice,
        rMultiple,
        strategy: String(b.strategy ?? "").trim(),
        timeframe: String(b.timeframe ?? "").trim(),
        session,
        status: "CLOSED",
        notes: String(b.notes ?? "").slice(0, 4000),
        tagsJson: JSON.stringify(Array.isArray(b.tags) ? b.tags.filter((x) => typeof x === "string").slice(0, 12) : []),
        reviewJson: JSON.stringify({}),
      },
    });
    return NextResponse.json({ ok: true, trade: toRec(row) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
