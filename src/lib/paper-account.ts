// ════════════════════════════════════════════════════════════════════════
//  PAPER ACCOUNT · persistent simulator (demo) balance
//
//  Ported from the original platform build, adapted to HALO's close paths.
//  The demo balance used to be a constant 100 000 that snapped back after
//  every trade. Now:
//    • the balance lives in PaperAccount (id "main") and survives restarts
//    • every closed PAPER trade books its realized P&L exactly once — the
//      Trade.pnlBooked flag is claimed atomically before the balance moves,
//      so retries, restarts and parallel callers can never double-book
//    • booking is a SWEEP over closed-but-unbooked paper trades, so every
//      close path (engine, scanners, Pine bot, TV webhook, Smart Trade
//      Manager, exec-lock reconciliation, orphan settlement) is covered
//      without hooking each one
//    • the trader can reset the balance to the starting amount
//  LIVE trades are never booked here — the broker owns that balance.
//  Every read degrades gracefully to the starting balance.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { loadExecSettings, type ExecSettings } from "./execution";

export const PAPER_STARTING_BALANCE = 100_000;
/** display convention for the simulator account: 1 lot = 10 USD per pip */
export const PIP_VALUE_PER_LOT = 10;

export interface PaperAccountState {
  balance: number;
  startingBalance: number;
  currency: string;
}

const FALLBACK: PaperAccountState = { balance: PAPER_STARTING_BALANCE, startingBalance: PAPER_STARTING_BALANCE, currency: "USD" };

export async function getPaperAccount(): Promise<PaperAccountState> {
  try {
    const row = await db.paperAccount.upsert({ where: { id: "main" }, create: { id: "main" }, update: {} });
    return { balance: row.balance, startingBalance: row.startingBalance, currency: row.currency };
  } catch {
    return FALLBACK;
  }
}

/**
 * Volume for a paper trade — the same formula the account panel uses to show
 * the running position, so the booked P&L matches what the trader saw.
 */
export function paperVolumeOf(exec: ExecSettings, riskPips: number, balance: number): number {
  if (exec.sizingMode === "fixed") return Math.max(0.01, Math.round(exec.sizeFixed * 100) / 100);
  const rp = Math.max(1, riskPips || 50);
  return Math.max(0.01, Math.round(((balance * exec.sizePercent) / 100 / Math.max(1, rp * PIP_VALUE_PER_LOT)) * 100) / 100);
}

/** status-signed pips (LOSS rows may store a positive magnitude) */
function signed(status: string, pips: number): number {
  const v = Math.abs(pips) || 0;
  return status === "WIN" ? v : status === "LOSS" ? -v : 0;
}

/** Book one closed PAPER trade. Returns the P&L booked, or null if it was not this caller's to book. */
export async function bookPaperCloseFromDb(tradeId: string): Promise<number | null> {
  try {
    const claimed = await db.trade.updateMany({
      where: { id: tradeId, pnlBooked: false, execMode: "PAPER", status: { in: ["WIN", "LOSS"] }, resultPips: { not: null } },
      data: { pnlBooked: true },
    });
    if (claimed.count === 0) return null; // not paper / not closed / already booked
    const t = await db.trade.findUnique({ where: { id: tradeId } });
    if (!t || t.resultPips == null) return null;
    const [exec, acct] = await Promise.all([loadExecSettings(), getPaperAccount()]);
    const volume = paperVolumeOf(exec, t.riskPips, acct.balance) * (t.sizeMult > 0 ? t.sizeMult : 1);
    const pnl = Math.round(signed(t.status, t.resultPips) * PIP_VALUE_PER_LOT * volume * 100) / 100;
    // increment (not read-modify-write) so two bookings can never overwrite each other
    await db.paperAccount.update({ where: { id: "main" }, data: { balance: { increment: pnl } } });
    return pnl;
  } catch {
    return null; // booking must never break a close path — the next sweep retries rows still unclaimed
  }
}

const gSweep = globalThis as unknown as { __haloPaperSweep?: Promise<number> | null };

/** Book every closed, not-yet-booked PAPER trade (oldest first). Single-flight. */
export function syncPaperBookings(): Promise<number> {
  if (gSweep.__haloPaperSweep) return gSweep.__haloPaperSweep;
  const run = (async () => {
    let n = 0;
    try {
      const rows = await db.trade.findMany({
        where: { execMode: "PAPER", pnlBooked: false, status: { in: ["WIN", "LOSS"] }, resultPips: { not: null } },
        orderBy: { closedAt: "asc" },
        select: { id: true },
        take: 200,
      });
      for (const r of rows) if ((await bookPaperCloseFromDb(r.id)) !== null) n += 1;
    } catch {
      // DB hiccup — next sweep
    }
    return n;
  })();
  gSweep.__haloPaperSweep = run;
  return run.finally(() => {
    gSweep.__haloPaperSweep = null;
  });
}

/** Reset the demo balance to its starting amount (trader action). Already-closed trades stay booked. */
export async function resetPaperAccount(): Promise<PaperAccountState> {
  await syncPaperBookings(); // settle pending bookings first so none land after the reset
  const row = await db.paperAccount.upsert({ where: { id: "main" }, create: { id: "main" }, update: {} });
  const updated = await db.paperAccount.update({ where: { id: "main" }, data: { balance: row.startingBalance } });
  return { balance: updated.balance, startingBalance: updated.startingBalance, currency: updated.currency };
}
