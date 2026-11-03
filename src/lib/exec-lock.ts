// ════════════════════════════════════════════════════════════════════════
//  PERSISTENT EXECUTION LOCK · one new order at a time, across restarts
//
//  Every order attempt is an ExecutionIntent with a state machine:
//    PENDING ─► SUBMITTING ─► OPEN ─► CLOSED
//                   │            (released when the trade closes)
//                   ├─► REJECTED  (broker said no — released)
//                   └─► UNCERTAIN (no answer — lock KEPT until reconciled)
//    PENDING ─► ABANDONED (crashed before anything was sent — released)
//  The lock is the single ExecutionLock row: acquiring it is an atomic
//  "set intentId where intentId is null", so concurrent orders cannot both
//  proceed. It is never released because time passed — only on a confirmed
//  close, an explicit rejection, proof that nothing was sent, or an
//  audited Super Admin resolution.
//
//  After a restart, reconcile() restores the in-memory trade lock for an
//  OPEN trade and watches that trade's own SL/TP (paper) or the broker
//  position (live) until it closes. It never opens, modifies or closes a
//  broker position; open-position protection is untouched.
// ════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { db } from "@/lib/db";
import { getAdapter, parseCreds } from "@/lib/brokers";
import type { BrokerKind } from "@/lib/brokers/types";
import { sendAlert } from "@/lib/alerts";
import { getKlines } from "@/lib/market";
import { getSymbolMeta, tfSec } from "@/lib/market-symbols";
import { engageTradeLock, getTradeLock, maybeReleaseLock, type TradeLockSource } from "@/lib/trade-lock";

const LOCK_ID = "global";
export type IntentState = "PENDING" | "SUBMITTING" | "OPEN" | "REJECTED" | "UNCERTAIN" | "CLOSED" | "ABANDONED";

async function transition(intentId: string, to: IntentState, detail = "", data: { tradeId?: string; brokerOrderId?: string } = {}): Promise<void> {
  const cur = await db.executionIntent.findUnique({ where: { id: intentId } });
  if (!cur) return;
  await db.executionIntent.update({ where: { id: intentId }, data: { state: to, detail: detail.slice(0, 250), ...data } });
  await db.executionEvent.create({ data: { intentId, fromState: cur.state, toState: to, detail: detail.slice(0, 250) } });
}

async function releaseLock(intentId: string): Promise<void> {
  await db.executionLock.updateMany({ where: { id: LOCK_ID, intentId }, data: { intentId: null } });
}

export interface IntentInput {
  source: TradeLockSource;
  symbol: string;
  tf: string;
  dir: -1 | 1;
  entry: number;
  sl: number;
  tp: number;
  live: boolean;
  brokerKind?: string;
  brokerAccountId?: string;
}

/** Create an intent and take the lock. null → another order holds it (refuse). */
export async function beginIntent(i: IntentInput): Promise<{ id: string; clientOrderId: string } | null> {
  await db.executionLock.upsert({ where: { id: LOCK_ID }, create: { id: LOCK_ID, intentId: null }, update: {} });
  const clientOrderId = `h3-${crypto.randomBytes(10).toString("hex")}`;
  const intent = await db.executionIntent.create({
    data: {
      source: i.source,
      symbol: i.symbol,
      timeframe: i.tf,
      direction: i.dir,
      entry: i.entry,
      sl: i.sl,
      tp: i.tp,
      execMode: i.live ? "LIVE" : "PAPER",
      brokerKind: i.brokerKind ?? "",
      brokerAccountId: i.brokerAccountId ?? "",
      clientOrderId,
      state: "PENDING",
    },
  });
  const got = await db.executionLock.updateMany({ where: { id: LOCK_ID, intentId: null }, data: { intentId: intent.id } });
  if (got.count !== 1) {
    await transition(intent.id, "ABANDONED", "another order holds the execution lock");
    return null;
  }
  await db.executionEvent.create({ data: { intentId: intent.id, fromState: "", toState: "PENDING", detail: "lock acquired" } });
  return { id: intent.id, clientOrderId };
}

/** about to create the paper trade / call the broker */
export const markSubmitting = (id: string): Promise<void> => transition(id, "SUBMITTING");

/** order is live (paper trade row or broker fill) — the lock stays until it closes */
export const markOpen = (id: string, tradeId: string, brokerOrderId = ""): Promise<void> => transition(id, "OPEN", "", { tradeId, brokerOrderId });

/** explicit failure — nothing is open, so the lock is released */
export async function markRejected(id: string, detail: string): Promise<void> {
  await transition(id, "REJECTED", detail);
  await releaseLock(id);
}

/** no reliable answer from the broker — keep the lock, reconcile later */
export async function markUncertain(id: string, detail: string): Promise<void> {
  await transition(id, "UNCERTAIN", detail);
  void sendAlert({
    kind: "broker",
    title: "HALO · ORDER OUTCOME UNCERTAIN — NEW ORDERS PAUSED",
    body: `The broker did not confirm an order (${detail}). No new orders will be placed until it is reconciled with the broker (automatic on restart, or by a Super Admin).`,
  });
}

/** the trade with this DB id closed — release its lock */
export async function releaseForTrade(tradeId: string | null | undefined, detail: string): Promise<void> {
  if (!tradeId) return;
  const intent = await db.executionIntent.findFirst({ where: { tradeId, state: "OPEN" } });
  if (!intent) return;
  await transition(intent.id, "CLOSED", detail);
  await releaseLock(intent.id);
}

/** is the persistent lock held (by anything)? */
export async function lockHolder(): Promise<{ intentId: string; state: string; symbol: string; source: string } | null> {
  const row = await db.executionLock.findUnique({ where: { id: LOCK_ID } });
  if (!row?.intentId) return null;
  const i = await db.executionIntent.findUnique({ where: { id: row.intentId } });
  return i ? { intentId: i.id, state: i.state, symbol: i.symbol, source: i.source } : { intentId: row.intentId, state: "UNKNOWN", symbol: "", source: "" };
}

// ─────────────────────────── restart reconciliation ───────────────────────────

const gRec = globalThis as unknown as { __haloExecReconciled?: Promise<void>; __haloExecWatch?: ReturnType<typeof setInterval> };

/** run once per process (idempotent); call before the first new order and at boot */
export function ensureReconciled(): Promise<void> {
  return (gRec.__haloExecReconciled ??= reconcile().catch((e) => {
    console.error("[exec-lock] reconcile failed — lock left as is:", (e as Error).message);
  }));
}

async function brokerPositionExists(intent: { brokerAccountId: string; symbol: string; direction: number }): Promise<boolean | null> {
  const row = await db.brokerAccount.findUnique({ where: { id: intent.brokerAccountId } });
  if (!row) return null;
  try {
    const positions = await getAdapter(row.kind as BrokerKind).getPositions(parseCreds(row.credsJson), intent.symbol);
    return positions.some((p) => p.side === intent.direction);
  } catch {
    return null; // broker unreachable — unknown
  }
}

async function reconcile(): Promise<void> {
  const row = await db.executionLock.findUnique({ where: { id: LOCK_ID } });
  if (!row?.intentId) return;
  const intent = await db.executionIntent.findUnique({ where: { id: row.intentId } });
  if (!intent) {
    await db.executionLock.update({ where: { id: LOCK_ID }, data: { intentId: null } });
    return;
  }

  if (intent.state === "PENDING") {
    // crashed before the paper trade / broker call — nothing was sent
    await transition(intent.id, "ABANDONED", "restart: crashed before submission — nothing was sent");
    await releaseLock(intent.id);
    return;
  }

  if (intent.state === "SUBMITTING" || intent.state === "UNCERTAIN") {
    if (intent.execMode === "PAPER") {
      const t = await db.trade.findFirst({ where: { brokerOrderId: intent.clientOrderId } });
      if (t) {
        await transition(intent.id, "OPEN", "restart: paper trade found", { tradeId: t.id });
        return watchOpen(intent.id);
      }
      await transition(intent.id, "ABANDONED", "restart: paper trade was never written");
      await releaseLock(intent.id);
      return;
    }
    const pos = await brokerPositionExists(intent);
    if (pos === true) {
      const t = await db.trade.create({
        data: {
          mode: intent.source, execMode: "LIVE", brokerKind: intent.brokerKind, brokerOrderId: intent.clientOrderId,
          symbol: intent.symbol, timeframe: intent.timeframe, direction: intent.direction, entry: intent.entry, sl: intent.sl, tp: intent.tp,
          riskPips: 0, rewardPips: 0, status: "OPEN", levelTop: 0, levelBot: 0, slMode: "recovered", note: "recovered after restart: broker confirmed the position",
          openedAt: intent.createdAt,
        },
      });
      await transition(intent.id, "OPEN", "restart: broker shows the position", { tradeId: t.id });
      return watchOpen(intent.id);
    }
    // no position seen, or broker unreachable: absence is not proof that the
    // order failed — keep the lock and ask for a decision
    await transition(intent.id, "UNCERTAIN", pos === false ? "restart: no broker position found — needs manual reconciliation" : "restart: broker unreachable — needs reconciliation");
    void sendAlert({
      kind: "broker",
      title: "HALO · ORDER NEEDS RECONCILIATION — NEW ORDERS PAUSED",
      body: `${intent.source} ${intent.direction === -1 ? "SELL" : "BUY"} ${intent.symbol} was being sent when HALO stopped. Check the broker, then resolve it in Admin → execution lock.`,
    });
    return;
  }

  if (intent.state === "OPEN") return watchOpen(intent.id);
}

/** restore the in-memory lock for an OPEN trade and watch it until it closes */
async function watchOpen(intentId: string): Promise<void> {
  const intent = await db.executionIntent.findUnique({ where: { id: intentId } });
  if (!intent) return;
  const trade = intent.tradeId ? await db.trade.findUnique({ where: { id: intent.tradeId } }) : null;
  if (trade && trade.status !== "OPEN") {
    await transition(intent.id, "CLOSED", `restart: trade already ${trade.status}`);
    await releaseLock(intent.id);
    return;
  }
  if (!getTradeLock()) {
    engageTradeLock({
      source: intent.source as TradeLockSource, symbol: intent.symbol, tf: intent.timeframe, dir: intent.direction as -1 | 1,
      entry: intent.entry, sl: intent.sl, tp: intent.tp, tradeDbId: intent.tradeId || null, openedAt: intent.createdAt.getTime(),
    });
  }
  if (gRec.__haloExecWatch) clearInterval(gRec.__haloExecWatch);
  const tick = async (): Promise<void> => {
    const cur = await db.executionIntent.findUnique({ where: { id: intentId } });
    if (!cur || cur.state !== "OPEN") {
      if (gRec.__haloExecWatch) clearInterval(gRec.__haloExecWatch);
      return;
    }
    const t = cur.tradeId ? await db.trade.findUnique({ where: { id: cur.tradeId } }) : null;
    if (t && t.status !== "OPEN") return closeWatched(cur.id, cur.symbol, cur.timeframe, t.status === "WIN" ? "win" : "loss", t.resultPips ?? 0);

    if (cur.execMode === "PAPER") {
      // the trade's own SL/TP on candles since entry (same-bar SL+TP = SL, like the engine)
      const k = await getKlines(cur.symbol, cur.timeframe, 500).catch(() => null);
      if (!k || k.source === "simulator") return;
      const tfMs = tfSec(cur.timeframe) * 1000;
      for (const c of k.candles) {
        if (c.time + tfMs <= cur.createdAt.getTime()) continue;
        const hitSL = cur.direction === -1 ? c.high >= cur.sl : c.low <= cur.sl;
        const hitTP = cur.direction === -1 ? c.low <= cur.tp : c.high >= cur.tp;
        if (hitSL || hitTP) {
          const exit = hitSL ? cur.sl : cur.tp;
          const meta = getSymbolMeta(cur.symbol);
          const pips = (((exit - cur.entry) * cur.direction) / (meta.mintick * 10)) || 0;
          if (t) await db.trade.update({ where: { id: t.id }, data: { status: pips > 0 ? "WIN" : "LOSS", resultPips: Math.abs(pips), closedAt: new Date(c.time), note: `${t.note} | closed by restart monitor (${hitSL ? "SL" : "TP"})`.slice(0, 250) } });
          return closeWatched(cur.id, cur.symbol, cur.timeframe, pips > 0 ? "win" : "loss", Math.abs(pips));
        }
      }
      return;
    }
    // LIVE: the broker manages SL/TP; the trade is over when its position is gone
    const pos = await brokerPositionExists(cur);
    if (pos === false) {
      if (t) await db.trade.update({ where: { id: t.id }, data: { status: "LOSS", closedAt: new Date(), note: `${t.note} | position closed at the broker while HALO was restarting — check the broker history for the result`.slice(0, 250) } });
      return closeWatched(cur.id, cur.symbol, cur.timeframe, "loss", 0);
    }
  };
  gRec.__haloExecWatch = setInterval(() => void tick().catch(() => {}), 15_000);
  (gRec.__haloExecWatch as unknown as { unref?: () => void }).unref?.();
  await tick().catch(() => {});
}

async function closeWatched(intentId: string, symbol: string, tf: string, result: "win" | "loss", pips: number): Promise<void> {
  if (gRec.__haloExecWatch) clearInterval(gRec.__haloExecWatch);
  const lock = getTradeLock();
  if (lock && lock.symbol === symbol) maybeReleaseLock(lock.source, symbol, lock.tf, result, pips);
  await transition(intentId, "CLOSED", "closed (restart monitor)");
  await releaseLock(intentId);
  void tf;
}

/** Super Admin resolution of an UNCERTAIN order after checking the broker */
export async function resolveUncertain(intentId: string, outcome: "not_executed" | "executed", actor: string): Promise<{ ok: boolean; error?: string }> {
  const intent = await db.executionIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.state !== "UNCERTAIN") return { ok: false, error: "No uncertain order with that id." };
  if (outcome === "not_executed") {
    await transition(intent.id, "REJECTED", `resolved by ${actor}: confirmed not executed at the broker`);
    await releaseLock(intent.id);
    return { ok: true };
  }
  const t = await db.trade.create({
    data: {
      mode: intent.source, execMode: intent.execMode, brokerKind: intent.brokerKind, brokerOrderId: intent.clientOrderId,
      symbol: intent.symbol, timeframe: intent.timeframe, direction: intent.direction, entry: intent.entry, sl: intent.sl, tp: intent.tp,
      riskPips: 0, rewardPips: 0, status: "OPEN", levelTop: 0, levelBot: 0, slMode: "recovered", note: `resolved by ${actor}: confirmed executed at the broker`,
      openedAt: intent.createdAt,
    },
  });
  await transition(intent.id, "OPEN", `resolved by ${actor}: confirmed executed`, { tradeId: t.id });
  await watchOpen(intent.id);
  return { ok: true };
}
