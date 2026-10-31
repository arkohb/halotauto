// ══════════════════════════════════════════════════════════════════════════
//  /api/journal/import — CSV import (the guaranteed alternative when MT5
//  history sync is not available for an account). Accepts multipart file
//  upload or raw text. Rows are deduped by content hash — importing the
//  same file twice never duplicates. Unparsable rows are reported, never
//  guessed. CSV records are NOT overwritten by MT5 sync (different keys).
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { parseTradesCsv } from "@/lib/journal/csv";
import { toRec } from "@/lib/journal/records";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await requireUser();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const userId = g.user!.id;

  try {
    let text = "";
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (file instanceof File) text = await file.text();
      else if (typeof form.get("csv") === "string") text = String(form.get("csv"));
    } else {
      const b = (await req.json().catch(() => ({}))) as { csv?: string };
      text = String(b.csv ?? "");
    }
    if (!text.trim()) return NextResponse.json({ ok: false, error: "No CSV content received — choose a file or paste rows." }, { status: 400 });

    const parsed = parseTradesCsv(text);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: parsed.errors[0] ?? "No importable rows found.", errors: parsed.errors },
        { status: 400 }
      );
    }

    // dedup inside the file itself, then upsert by content key
    const byKey = new Map(parsed.rows.map((r) => [r.extKey, r]));
    let created = 0;
    let skippedExisting = 0;
    for (const r of byKey.values()) {
      const existing = await db.journalTrade.findUnique({
        where: { userId_extKey: { userId, extKey: r.extKey } },
        select: { id: true },
      });
      if (existing) {
        skippedExisting += 1;
        continue;
      }
      await db.journalTrade.create({
        data: {
          userId,
          extKey: r.extKey,
          source: "CSV",
          brokerLabel: "CSV import",
          symbol: r.symbol,
          direction: r.direction,
          volume: r.volume,
          volumeExit: r.volume,
          entryPrice: r.entryPrice,
          exitPrice: r.exitPrice,
          sl: r.sl,
          tp: r.tp,
          openedAt: r.openedAt,
          closedAt: r.closedAt,
          durationMin: Math.max(0, Math.round((+r.closedAt - +r.openedAt) / 60000)),
          grossProfit: r.grossProfit,
          commission: r.commission,
          swap: r.swap,
          fees: r.fees,
          netPnl: r.netPnl,
          currency: r.currency,
          riskPrice: r.sl !== null && r.entryPrice > 0 ? Math.abs(r.entryPrice - r.sl) : null,
          rMultiple:
            r.sl !== null && r.entryPrice > 0 && Math.abs(r.entryPrice - r.sl) > 0
              ? ((r.exitPrice - r.entryPrice) * (r.direction === "SELL" ? -1 : 1)) / Math.abs(r.entryPrice - r.sl)
              : null,
          strategy: r.strategy,
          timeframe: r.timeframe,
          session: "",
          status: "CLOSED",
          notes: r.notes,
          tagsJson: "[]",
          reviewJson: "{}",
        },
      });
      created += 1;
    }

    const total = await db.journalTrade.count({ where: { userId } });
    return NextResponse.json({
      ok: true,
      created,
      skippedExisting,
      skippedInvalid: parsed.skipped,
      errors: parsed.errors.slice(0, 12),
      total,
      trades: (await db.journalTrade.findMany({ where: { userId }, orderBy: { closedAt: "desc" }, take: 1 })).map(toRec),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
