// ══════════════════════════════════════════════════════════════════════════
//  HALO PERFORMANCE JOURNAL · MT5 closed-trade synchronization
//
//  Reads REAL closed-trade history from a connected MetaApi (MT4/MT5)
//  account through the READ-ONLY helpers in brokers/metaapi-core.ts and
//  materializes completed round-trip trades into JournalTrade.
//
//  Correctness rules implemented here:
//    1. DEDUP — every record is keyed by "{accountId}:{positionId}:{leg}",
//       unique per user. Re-syncing never duplicates; corrected broker
//       history UPDATES the existing record (user notes/tags untouched).
//    2. PARTIAL CLOSES — a position closed through several OUT deals is
//       aggregated into ONE trade (volume-weighted exit price, summed
//       profit/commission/swap/fees, exit = last OUT deal time).
//    3. MULTIPLE DEALS PER POSITION — all deals of a position are grouped.
//    4. NETTING ACCOUNTS / REVERSALS — a per-position volume ledger splits
//       consecutive round-trips that share one positionId into separate
//       legs (DEAL_ENTRY_INOUT closes the open leg and starts a new one).
//    5. NO FABRICATION — a position whose IN volume was never fully closed
//       by OUT deals is NOT journaled (it is still open).
//    6. DEPOSITS/WITHDRAWALS — DEAL_TYPE_BALANCE operations are stored in
//       JournalState (balanceOpsJson), NEVER as trading profit.
//    7. CLOSED-LOOP COSTS — commission, swap and MT5 fee are summed from
//       the raw deals and included in netPnl (MT5 sign convention).
//    8. ACCOUNT CURRENCY — taken from the broker's account-information.
//    9. R-multiple — price-based only when the SL was recorded on the IN
//       deal. Nothing is invented when it was not.
//
//  This module performs NO order actions — it is read-only against MT5.
// ══════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import type { JournalTrade } from "@prisma/client";
import type { MtHistoryDeal } from "@/lib/brokers/metaapi-core";
import { mtHistoryDeals } from "@/lib/brokers/metaapi-core";
import { mtAccountInformation } from "@/lib/brokers/metaapi-core";

export interface SyncResult {
  ok: true;
  accountId: string;
  label: string;
  currency: string;
  balance: number;
  equity: number;
  dealsSeen: number;
  tradesCreated: number;
  tradesUpdated: number;
  openPositionsSkipped: number;
  balanceOps: number;
  rangeFrom: string | null;
  rangeTo: string | null;
}

interface Leg {
  direction: string; // BUY | SELL
  inVol: number;
  inNotional: number;
  outVol: number;
  outNotional: number;
  sl: number | null;
  tp: number | null;
  firstTime: Date;
  lastTime: Date;
  profit: number;
  commission: number;
  swap: number;
  fees: number;
  dealIds: string[];
}

const EPS = 1e-9;

function entryOf(d: MtHistoryDeal): "IN" | "OUT" | "INOUT" | "OUT_BY" | null {
  const e = String(d.entry ?? "").toUpperCase();
  if (e === "DEAL_ENTRY_IN" || e === "IN") return "IN";
  if (e === "DEAL_ENTRY_OUT" || e === "OUT") return "OUT";
  if (e === "DEAL_ENTRY_INOUT" || e === "INOUT") return "INOUT";
  if (e === "DEAL_ENTRY_OUT_BY" || e === "OUT_BY") return "OUT_BY";
  return null;
}

function sideOfDeal(d: MtHistoryDeal): string | null {
  const t = String(d.type ?? "").toUpperCase();
  if (t.includes("BUY")) return "BUY";
  if (t.includes("SELL")) return "SELL";
  return null;
}

function timeOf(d: MtHistoryDeal): Date | null {
  if (!d.time) return null;
  const t = new Date(d.time);
  return isFinite(+t) ? t : null;
}

/** split one position's chronological deal list into completed round-trip legs */
export function legsOfPosition(deals: MtHistoryDeal[]): { legs: Leg[]; openRemains: boolean } {
  const legs: Leg[] = [];
  let cur: Leg | null = null;
  const startLeg = (direction: string, t: Date): Leg => ({
    direction,
    inVol: 0,
    inNotional: 0,
    outVol: 0,
    outNotional: 0,
    sl: null,
    tp: null,
    firstTime: t,
    lastTime: t,
    profit: 0,
    commission: 0,
    swap: 0,
    fees: 0,
    dealIds: [],
  });

  for (const d of deals) {
    const t = timeOf(d);
    if (!t) continue;
    const entry = entryOf(d);
    const vol = Number(d.volume ?? 0);
    const px = Number(d.price ?? 0);
    const side = sideOfDeal(d);

    if (entry === "IN") {
      if (!cur) cur = startLeg(side ?? "BUY", t);
      cur.inVol += vol;
      if (px > 0) cur.inNotional += vol * px;
      if (Number(d.sl ?? 0) > 0) cur.sl = Number(d.sl);
      if (Number(d.tp ?? 0) > 0) cur.tp = Number(d.tp);
      cur.profit += Number(d.profit ?? 0);
      cur.commission += Number(d.commission ?? 0);
      cur.swap += Number(d.swap ?? 0);
      cur.fees += Number(d.fee ?? 0);
      if (d.id) cur.dealIds.push(String(d.id));
      cur.lastTime = t;
    } else if (entry === "OUT" || entry === "OUT_BY") {
      if (!cur) continue; // OUT without a tracked IN — ignore (legacy history)
      cur.outVol += vol;
      if (px > 0) cur.outNotional += vol * px;
      cur.profit += Number(d.profit ?? 0);
      cur.commission += Number(d.commission ?? 0);
      cur.swap += Number(d.swap ?? 0);
      cur.fees += Number(d.fee ?? 0);
      if (d.id) cur.dealIds.push(String(d.id));
      cur.lastTime = t;
      if (cur.inVol > 0 && cur.outVol >= cur.inVol - EPS) {
        legs.push(cur);
        cur = null;
      }
    } else if (entry === "INOUT") {
      // reversal: everything currently open is closed at this deal's price,
      // the profit belongs to the closing leg; a new leg opens opposite
      if (cur) {
        const remain = Math.max(0, cur.inVol - cur.outVol);
        cur.outVol += remain;
        if (px > 0) cur.outNotional += remain * px;
        cur.profit += Number(d.profit ?? 0);
        cur.commission += Number(d.commission ?? 0);
        cur.swap += Number(d.swap ?? 0);
        cur.fees += Number(d.fee ?? 0);
        if (d.id) cur.dealIds.push(String(d.id));
        cur.lastTime = t;
        if (cur.inVol > 0 && cur.outVol >= cur.inVol - EPS) {
          legs.push(cur);
          cur = null;
        }
      }
      if (vol > 0 && side) {
        cur = startLeg(side, t);
        cur.inVol = vol;
        if (px > 0) cur.inNotional = vol * px;
        if (Number(d.sl ?? 0) > 0) cur.sl = Number(d.sl);
        if (Number(d.tp ?? 0) > 0) cur.tp = Number(d.tp);
        if (d.id) cur.dealIds.push(String(d.id));
      }
    }
  }
  return { legs, openRemains: cur !== null };
}

export interface SyncOptions {
  userId: string;
  accountId?: string; // BrokerAccount id — default: the active metaapi account
  lookbackDays?: number; // first-sync history pull (7..365, default 30)
}

async function resolveAccount(accountId?: string) {
  if (accountId) {
    const row = await db.brokerAccount.findUnique({ where: { id: accountId } });
    if (!row || row.kind !== "metaapi") return null;
    return row;
  }
  const accounts = await db.brokerAccount.findMany({ where: { kind: "metaapi" } });
  return accounts.find((a) => a.active) ?? accounts[0] ?? null;
}

/** run the synchronization; throws with a readable message on failure */
export async function syncMt5History(opts: SyncOptions): Promise<SyncResult> {
  const userId = opts.userId;
  const lookback = Math.min(365, Math.max(7, Math.round(opts.lookbackDays ?? 30)));
  const now = new Date();

  const row = await resolveAccount(opts.accountId);
  if (!row) throw new Error("No MetaApi (MT4/MT5) account is connected. Connect one in Brokers & MT5 first.");

  let creds: Record<string, unknown> = {};
  try {
    creds = JSON.parse(row.credsJson) as Record<string, unknown>;
  } catch {
    /* handled below */
  }
  const brokerAccountId = String(creds.accountId ?? "");
  const region = String(creds.region ?? "new-york");
  const token = creds.token ? String(creds.token) : undefined;
  if (!brokerAccountId) throw new Error(`The "${row.label}" connection has no MetaApi accountId — reconnect it in Brokers & MT5.`);

  const state = await db.journalState.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  try {
    // account info — currency/balance/equity for the snapshot + floating P&L
    let currency = "USD";
    let balance = 0;
    let equity = 0;
    try {
      const info = await mtAccountInformation(brokerAccountId, region, token);
      currency = String(info.currency ?? "USD").toUpperCase() || "USD";
      balance = Number(info.balance ?? 0);
      equity = Number(info.equity ?? 0) || balance;
    } catch {
      // history sync can proceed even if account-info hiccups — currency
      // falls back to USD and the equity snapshot is skipped
    }

    // windowed history pull: ≤30d per wire call, dedup by deal id
    const from =
      state.lastSyncAt && state.lastSyncOk
        ? new Date(+state.lastSyncAt - 3600_000) // 1h correction overlap
        : new Date(+now - lookback * 24 * 3600_000);
    const dealMap = new Map<string, MtHistoryDeal>();
    let cursor = +from;
    while (cursor < +now) {
      const chunkEnd = Math.min(cursor + 30 * 24 * 3600_000, +now);
      const { deals } = await mtHistoryDeals(brokerAccountId, region, new Date(cursor).toISOString(), 30, token);
      for (const d of deals) {
        if (d.id) dealMap.set(String(d.id), d);
      }
      cursor = chunkEnd;
    }
    const deals = [...dealMap.values()]
      .map((d) => ({ d, t: timeOf(d) }))
      .filter((x): x is { d: MtHistoryDeal; t: Date } => x.t !== null)
      .sort((a, b) => +a.t - +b.t);

    // separate balance operations (deposits/withdrawals — NOT trading profit)
    const balanceOps: { time: string; amount: number; balance: number; comment: string }[] = [];
    try {
      const prev = JSON.parse(state.balanceOpsJson) as typeof balanceOps;
      if (Array.isArray(prev)) balanceOps.push(...prev);
    } catch {
      /* fresh */
    }
    for (const { d, t } of deals) {
      const type = String(d.type ?? "").toUpperCase();
      if (type.includes("BALANCE")) {
        balanceOps.push({
          time: t.toISOString(),
          amount: Number(d.profit ?? 0),
          balance: Number(d.balance ?? 0),
          comment: String(d.comment ?? "").slice(0, 80),
        });
      }
    }
    if (balanceOps.length > 400) balanceOps.splice(0, balanceOps.length - 400);

    // group trading deals by positionId → volume-ledger legs
    const byPosition = new Map<string, { d: MtHistoryDeal; t: Date }[]>();
    for (const x of deals) {
      const type = String(x.d.type ?? "").toUpperCase();
      if (type.includes("BALANCE")) continue;
      const pid = String(x.d.positionId ?? "");
      if (!pid || !x.d.symbol) continue;
      const list = byPosition.get(pid) ?? [];
      list.push(x);
      byPosition.set(pid, list);
    }

    let rangeFrom: string | null = null;
    let rangeTo: string | null = null;
    const upserts: ReturnType<typeof db.journalTrade.upsert>[] = [];
    let openPositionsSkipped = 0;

    for (const [pid, list] of byPosition) {
      const { legs, openRemains } = legsOfPosition(list.map((x) => x.d));
      const journalable = legs.filter((l) => l.inVol > 0 && l.outVol > 0);
      if (openRemains && journalable.length === 0) openPositionsSkipped += 1;
      journalable.forEach((leg, legIdx) => {
        const extKey = `${brokerAccountId}:${pid}:${legIdx}`;
        const entryPrice = leg.inNotional / leg.inVol;
        const exitPrice = leg.outNotional / leg.outVol;
        const gross = leg.profit;
        const commission = leg.commission;
        const swap = leg.swap;
        const fees = leg.fees;
        const net = gross + commission + swap + fees;
        const dir = leg.direction === "SELL" ? -1 : 1;
        const riskPrice = leg.sl !== null && entryPrice > 0 ? Math.abs(entryPrice - leg.sl) : null;
        const rMultiple = riskPrice && riskPrice > 0 ? ((exitPrice - entryPrice) * dir) / riskPrice : null;
        const durationMin = Math.max(0, Math.round((+leg.lastTime - +leg.firstTime) / 60000));
        const data = {
          source: "MT5",
          brokerKind: "metaapi",
          brokerAccount: row.id,
          brokerLabel: row.label,
          dealIdsJson: JSON.stringify(leg.dealIds.filter(Boolean)),
          positionId: pid,
          symbol: String(list[0].d.symbol ?? "").toUpperCase(),
          direction: leg.direction,
          volume: leg.inVol,
          volumeExit: leg.outVol,
          entryPrice,
          exitPrice,
          sl: leg.sl,
          tp: leg.tp,
          openedAt: leg.firstTime,
          closedAt: leg.lastTime,
          durationMin,
          grossProfit: gross,
          commission,
          swap,
          fees,
          netPnl: net,
          currency,
          riskPrice,
          rMultiple,
          session: "",
          status: "CLOSED",
        };
        if (!rangeFrom || +leg.firstTime < +new Date(rangeFrom)) rangeFrom = leg.firstTime.toISOString();
        if (!rangeTo || +leg.lastTime > +new Date(rangeTo)) rangeTo = leg.lastTime.toISOString();

        // dedup + correction: broker-derived fields update; the trader's own
        // notes / tags / review / strategy / timeframe classification stay
        upserts.push(
          db.journalTrade.upsert({
            where: { userId_extKey: { userId, extKey } },
            update: {
              brokerLabel: data.brokerLabel,
              dealIdsJson: data.dealIdsJson,
              symbol: data.symbol,
              direction: data.direction,
              volume: data.volume,
              volumeExit: data.volumeExit,
              entryPrice: data.entryPrice,
              exitPrice: data.exitPrice,
              sl: data.sl,
              tp: data.tp,
              openedAt: data.openedAt,
              closedAt: data.closedAt,
              durationMin: data.durationMin,
              grossProfit: data.grossProfit,
              commission: data.commission,
              swap: data.swap,
              fees: data.fees,
              netPnl: data.netPnl,
              currency: data.currency,
              riskPrice: data.riskPrice,
              rMultiple: data.rMultiple,
            },
            create: { userId, extKey, ...data },
          })
        );
      });
    }

    const results: JournalTrade[] = await db.$transaction(upserts);
    const created = results.filter((r) => Math.abs(+r.createdAt - +r.updatedAt) < 1500).length;
    const updated = results.length - created;

    // daily equity/balance snapshot (REAL observed values only)
    if (balance > 0 || equity > 0) {
      const day = now.toISOString().slice(0, 10);
      await db.journalEquity.upsert({
        where: { userId_day: { userId, day } },
        update: { balance, equity, source: "MT5" },
        create: { userId, day, balance, equity, source: "MT5" },
      });
    }

    const msg = `Synced ${deals.length} deals → ${created} new + ${updated} updated trade${created + updated === 1 ? "" : "s"}.`;
    await db.journalState.update({
      where: { userId },
      data: {
        lastSyncAt: now,
        lastSyncOk: true,
        lastSyncMsg: msg,
        syncBrokerId: row.id,
        syncLookback: lookback,
        balanceOpsJson: JSON.stringify(balanceOps),
      },
    });

    return {
      ok: true,
      accountId: brokerAccountId,
      label: row.label,
      currency,
      balance,
      equity,
      dealsSeen: deals.length,
      tradesCreated: created,
      tradesUpdated: updated,
      openPositionsSkipped,
      balanceOps: balanceOps.length,
      rangeFrom,
      rangeTo,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown synchronization error.";
    await db.journalState.update({
      where: { userId },
      data: { lastSyncAt: now, lastSyncOk: false, lastSyncMsg: msg.slice(0, 400), syncBrokerId: row.id },
    });
    throw new Error(msg);
  }
}
