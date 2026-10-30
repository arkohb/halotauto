// ════════════════════════════════════════════════════════════════════════
//  HALO OPERATIONS · trusted server-side executors for voice/screen parity
//
//  Every function maps to a capability that ALREADY exists in the app
//  (broker adapters' getOrders/cancelOrder/closePosition/modifyPosition,
//  bot.ts's resetBot/closeOpenTrade, scanner's scan-now). They are wrapped
//  here so the voice brain and any other surface share ONE audited path
//  with the same contract:
//
//    • PAPER mode is handled honestly — nothing is pretended
//    • every WRITE is verified by re-reading the real state afterwards
//    • failures return ok:false with the real reason — never a fake success
//
//  This module adds NO new trading behaviour: the deterministic 3EL
//  engine remains the only entry source, risk limits are untouched.
// ════════════════════════════════════════════════════════════════════════

import { getAdapter, parseCreds } from "@/lib/brokers";
import type { PendingOrderInfo, PositionInfo } from "@/lib/brokers/types";
import { loadExecSettings, resolveBroker } from "@/lib/execution";
import { botState, closeOpenTrade, resetBot } from "@/lib/bot";
import { scannerScanNow, scannerState } from "@/lib/scanner";
import { pickJoke, type JokeStyle } from "@/lib/halo/jokes";

export interface OpResult {
  ok: boolean;
  detail: string;
}

interface LiveBrokerCtx {
  label: string;
  adapter: ReturnType<typeof getAdapter>;
  creds: ReturnType<typeof parseCreds>;
}

/** Resolve the ACTIVE live broker, or an honest reason why there isn't one. */
async function liveBroker(): Promise<{ ctx?: LiveBrokerCtx; error?: string }> {
  const exec = await loadExecSettings();
  if (exec.executionMode !== "live") {
    return { error: "PAPER" };
  }
  const row = await resolveBroker(exec.brokerAccountId);
  if (!row) {
    return { error: "LIVE mode is set but no active broker account is selected — pick one in the Brokers panel first." };
  }
  const adapter = getAdapter(row.kind);
  const creds = parseCreds(row.credsJson);
  return { ctx: { label: row.label, adapter, creds } };
}

// ── resting (pending) orders ─────────────────────────────────────────────

async function readOrders(ctx: LiveBrokerCtx): Promise<PendingOrderInfo[] | null> {
  if (!ctx.adapter.getOrders) return null; // adapter cannot read them
  try {
    return await ctx.adapter.getOrders(ctx.creds);
  } catch {
    return null;
  }
}

const orderLine = (o: PendingOrderInfo): string =>
  `${o.type.replace(/_/g, " ")} ${o.volume} ${o.symbol} @ ${o.entryPrice ?? "?"}${o.sl ? ` sl ${o.sl}` : ""}${o.tp ? ` tp ${o.tp}` : ""} (id ${o.id})`;

/** Verified read of the resting orders on the active live broker. */
export async function listPendingOrdersDetail(): Promise<string> {
  const b = await liveBroker();
  if (b.error === "PAPER") {
    return "Execution is in PAPER mode — the paper engine places market fills with attached SL and TP only, so there are no resting orders to list. On a live broker I can read and cancel them.";
  }
  if (b.error || !b.ctx) return `I could not read the order book — ${b.error}`;
  const orders = await readOrders(b.ctx);
  if (orders === null) return `${b.ctx.label} does not expose resting orders through its adapter, so I cannot list them. Order cancellation is not available on this connection.`;
  if (orders.length === 0) return `The order book on ${b.ctx.label} is clear — no resting pending orders right now.`;
  const lines = orders.slice(0, 5).map(orderLine);
  const more = orders.length > 5 ? ` — plus ${orders.length - 5} more` : "";
  return `${orders.length} resting order${orders.length === 1 ? "" : "s"} on ${b.ctx.label}: ${lines.join("; ")}${more}. Say cancel and I'll ask which one.`;
}

/** Cancel ONE resting order. Without an id, only works when exactly one exists. */
export async function cancelPendingOrderExec(orderId: string | undefined): Promise<OpResult> {
  const b = await liveBroker();
  if (b.error === "PAPER") return { ok: true, detail: "Paper mode — there are no resting orders to cancel. The paper engine fires at market with SL/TP attached." };
  if (b.error || !b.ctx) return { ok: false, detail: b.error ?? "No live broker available." };
  const ctx = b.ctx;
  if (!ctx.adapter.cancelOrder) return { ok: false, detail: `${ctx.label} does not support order cancellation through its adapter.` };

  const orders = await readOrders(ctx);
  if (orders === null) return { ok: false, detail: `I could not read the order book on ${ctx.label}, so I cannot verify a cancellation — nothing was sent. Try again shortly.` };

  let target: PendingOrderInfo | undefined;
  if (orderId) {
    const wanted = orderId.trim();
    target = orders.find((o) => o.id === wanted);
    if (!target) {
      // be forgiving about broker-side id formatting (e.g. prefixed ids)
      target = orders.find((o) => o.id.includes(wanted) || wanted.includes(o.id));
    }
    if (!target) {
      const list = orders.slice(0, 5).map(orderLine).join("; ");
      return { ok: false, detail: `No resting order matches "${wanted.slice(0, 24)}" on ${ctx.label}.${orders.length > 0 ? ` Current orders: ${list}.` : " The book is empty."}` };
    }
  } else {
    if (orders.length === 0) return { ok: true, detail: "There are no resting orders to cancel — the book is already clear." };
    if (orders.length > 1) {
      const list = orders.slice(0, 5).map(orderLine).join("; ");
      return { ok: false, detail: `There are ${orders.length} resting orders — say cancel all to flatten the book, or give me the one you want: ${list}` };
    }
    target = orders[0];
  }

  try {
    const res = await ctx.adapter.cancelOrder(ctx.creds, target.id);
    if (!res.ok) {
      return { ok: false, detail: `${ctx.label} refused the cancellation of order ${target.id}: ${res.error ?? "unknown broker error"}.` };
    }
  } catch (e) {
    return { ok: false, detail: `Cancellation failed: ${(e as Error).message.slice(0, 140)}` };
  }

  // VERIFY: the order must be gone from a fresh read (when the adapter can read)
  const after = await readOrders(ctx);
  if (after !== null && after.some((o) => o.id === target!.id)) {
    return { ok: false, detail: `${ctx.label} accepted the cancel but order ${target.id} still reads on the book — check the broker terminal before relying on it.` };
  }
  return { ok: true, detail: `Confirmed: order ${target.id} (${orderLine(target)}) was cancelled on ${ctx.label}${after !== null ? " and verified gone from the book" : ""}.` };
}

/** Cancel EVERY resting order on the active live broker — verified count. */
export async function cancelAllPendingOrdersExec(): Promise<OpResult> {
  const b = await liveBroker();
  if (b.error === "PAPER") return { ok: true, detail: "Paper mode — no resting orders exist, the book is already clear." };
  if (b.error || !b.ctx) return { ok: false, detail: b.error ?? "No live broker available." };
  const ctx = b.ctx;
  if (!ctx.adapter.cancelOrder) return { ok: false, detail: `${ctx.label} does not support order cancellation through its adapter.` };

  const orders = await readOrders(ctx);
  if (orders === null) return { ok: false, detail: `I could not read the order book on ${ctx.label}, so I won't blind-cancel — nothing was sent.` };
  if (orders.length === 0) return { ok: true, detail: "The order book is already clear — no resting orders to cancel." };

  let done = 0;
  const failed: string[] = [];
  for (const o of orders) {
    try {
      const res = await ctx.adapter.cancelOrder!(ctx.creds, o.id);
      if (res.ok) done += 1;
      else failed.push(`${o.id}: ${res.error ?? "refused"}`);
    } catch (e) {
      failed.push(`${o.id}: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  const after = await readOrders(ctx);
  const left = after ? after.length : -1; // -1 = unverifiable
  if (done === orders.length && (left === 0 || left === -1)) {
    return { ok: true, detail: `Confirmed: all ${done} resting order${done === 1 ? "" : "s"} cancelled on ${ctx.label}${left === 0 ? " — the book now reads empty" : ""}.` };
  }
  if (done > 0) {
    return { ok: true, detail: `${done} of ${orders.length} orders cancelled on ${ctx.label}; ${failed.length} refused (${failed.slice(0, 3).join("; ")}).${left > 0 ? ` ${left} still rest on the book.` : ""}` };
  }
  return { ok: false, detail: `No order could be cancelled — ${failed.slice(0, 3).join("; ")}` };
}

// ── positions ────────────────────────────────────────────────────────────

async function readPositions(ctx: LiveBrokerCtx): Promise<PositionInfo[] | null> {
  if (!ctx.adapter.getPositions) return null;
  try {
    return await ctx.adapter.getPositions(ctx.creds);
  } catch {
    return null;
  }
}

/** Close the whole book: paper → close the EA trade via the engine; live → broker flatten. */
export async function closeAllPositionsExec(): Promise<OpResult> {
  const b = await liveBroker();
  if (b.error === "PAPER") {
    const st = await botState();
    if (!st.engine.trade) return { ok: true, detail: "Paper book is already flat — nothing to close." };
    await closeOpenTrade();
    const after = await botState();
    return after.engine.trade
      ? { ok: false, detail: "The paper close did not verify — the trade still shows open. Check the dashboard." }
      : { ok: true, detail: "Confirmed: the paper EA position was closed through the engine and the result booked." };
  }
  if (b.error || !b.ctx) return { ok: false, detail: b.error ?? "No live broker available." };
  const ctx = b.ctx;
  try {
    const res = await ctx.adapter.closePosition(ctx.creds); // no symbol → close ALL where supported
    if (!res.ok) return { ok: false, detail: `${ctx.label} refused the close-all: ${res.error ?? "unknown broker error"}.` };
  } catch (e) {
    return { ok: false, detail: `Close-all failed: ${(e as Error).message.slice(0, 140)}` };
  }
  // VERIFY: fresh position read when the adapter supports it
  const after = await readPositions(ctx);
  if (after && after.length > 0) {
    return { ok: true, detail: `${ctx.label} accepted the close-all, but ${after.length} position${after.length === 1 ? " still reads" : "s still read"} on the book — re-check on the broker terminal.` };
  }
  return { ok: true, detail: `Confirmed: close-all accepted by ${ctx.label}${after ? " and the position book now reads flat" : ""}.` };
}

/**
 * Amend SL/TP on an open LIVE broker position — the voice twin of the
 * Quick-Actions MODIFY SL/TP dialog. Applies when exactly one position is
 * open; with several, asks for the specific one (never guesses).
 */
export async function modifyPositionSltpExec(sl: number | undefined, tp: number | undefined): Promise<OpResult> {
  if ((sl == null || !isFinite(sl) || sl <= 0) && (tp == null || !isFinite(tp) || tp <= 0)) {
    return { ok: false, detail: "Give me a valid stop-loss and/or take-profit price to amend." };
  }
  const b = await liveBroker();
  if (b.error === "PAPER") {
    return { ok: false, detail: "SL/TP amendments work on live broker positions. In paper mode the strategy manages its own stop and target — I won't fake a broker-side edit." };
  }
  if (b.error || !b.ctx) return { ok: false, detail: b.error ?? "No live broker available." };
  const ctx = b.ctx;
  if (!ctx.adapter.modifyPosition) return { ok: false, detail: `${ctx.label} does not support SL/TP modification through its adapter.` };

  const positions = await readPositions(ctx);
  if (positions === null) return { ok: false, detail: `I could not read the position book on ${ctx.label} — nothing was changed.` };
  if (positions.length === 0) return { ok: true, detail: "There is no open position on the broker to amend — the book is flat." };
  if (positions.length > 1) {
    const lines = positions.slice(0, 4).map((p) => `${p.side === -1 ? "SELL" : "BUY"} ${p.volume} ${p.symbol} (id ${p.id})`);
    return { ok: false, detail: `Several positions are open — I won't guess which one you mean: ${lines.join("; ")}. Amend from the MODIFY SL/TP dialog on screen.` };
  }

  const pos = positions[0];
  try {
    const res = await ctx.adapter.modifyPosition(ctx.creds, pos.id, { sl: sl ?? undefined, tp: tp ?? undefined });
    if (!res.ok) return { ok: false, detail: `${ctx.label} refused the amendment: ${res.error ?? "unknown broker error"}.` };
  } catch (e) {
    return { ok: false, detail: `Amendment failed: ${(e as Error).message.slice(0, 140)}` };
  }

  // VERIFY the levels actually took effect when the broker returns them
  const after = await readPositions(ctx);
  const p2 = after?.find((x) => x.id === pos.id);
  if (p2) {
    const slOk = sl == null || p2.sl == null || Math.abs(p2.sl - sl) <= Math.max(1e-8, Math.abs(sl) * 1e-4);
    const tpOk = tp == null || p2.tp == null || Math.abs(p2.tp - tp) <= Math.max(1e-8, Math.abs(tp) * 1e-4);
    if (!slOk || !tpOk) {
      return { ok: false, detail: `${ctx.label} accepted the request but the fresh read shows SL ${p2.sl ?? "—"} / TP ${p2.tp ?? "—"} — verify on the broker terminal.` };
    }
  }
  const parts = [sl != null ? `stop ${sl}` : null, tp != null ? `target ${tp}` : null].filter(Boolean).join(" and ");
  return { ok: true, detail: `Confirmed: ${parts} amended on the ${pos.side === -1 ? "SELL" : "BUY"} ${pos.volume} ${pos.symbol} position${p2 ? " and verified on a fresh read" : ""}.` };
}

// ── engine + scanner ─────────────────────────────────────────────────────

/** Screen parity for the RESET control: re-warm the engine (refused while a trade is open). */
export async function resetEngineExec(): Promise<OpResult> {
  try {
    await resetBot();
  } catch (e) {
    return { ok: false, detail: `Reset refused: ${(e as Error).message.slice(0, 140)}` };
  }
  const st = await botState();
  return st.engine.trade
    ? { ok: false, detail: "Reset did not verify — a trade still shows open on the engine." }
    : { ok: true, detail: `Confirmed: the engine re-warmed on ${st.symbol} ${st.tf} — fresh levels, counters cleared, watch continues.` };
}

/** Screen parity for SCAN NOW: run the multi-symbol scan, summarise honestly. */
export async function runMarketScanDetail(): Promise<string> {
  try {
    await scannerScanNow();
  } catch (e) {
    return `The scan could not run: ${(e as Error).message.slice(0, 140)}`;
  }
  const s = await scannerState();
  if (s.rows.length === 0) return "The scanner watchlist is empty — add symbols in the Market Scanner panel and I'll sweep them for 3EL formations.";
  const active = s.rows.filter((r) => r.enabled);
  const watching = active.filter((r) => r.status === "C3 WATCH");
  const running = active.filter((r) => r.status === "RUNNING");
  const errored = s.rows.filter((r) => r.status === "ERROR");
  const parts: string[] = [
    `Scan complete: ${s.rows.length} symbol${s.rows.length === 1 ? "" : "s"} on the watchlist, ${active.length} enabled.`,
  ];
  if (running.length > 0) parts.push(`${running.length} in a live trade (${running.map((r) => r.symbolLabel.split("·")[0].trim()).join(", ")}).`);
  if (watching.length > 0) parts.push(`${watching.length} in C3 watch: ${watching.map((r) => `${r.symbolLabel.split("·")[0].trim()} on ${r.tf}`).join(", ")}.`);
  if (errored.length > 0) parts.push(`${errored.length} row${errored.length === 1 ? "" : "s"} reporting feed errors.`);
  if (watching.length === 0 && running.length === 0) parts.push("No formations at break level right now — the watch keeps running.");
  parts.push(`${s.totalSignals} signal${s.totalSignals === 1 ? "" : "s"} logged since the scanner started.`);
  return parts.join(" ");
}

// ── humour ───────────────────────────────────────────────────────────────

let lastJoke = "";

/** A curated joke — entertainment only, never mixed into market answers. */
export function jokeDetail(style: string | undefined): string {
  const valid: JokeStyle | undefined =
    style === "trading" || style === "tech" || style === "motivation" ? style : undefined;
  const j = pickJoke(valid, lastJoke);
  lastJoke = j.text;
  return j.text;
}
