"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · EXECUTION SAFETY — the persistent one-trade lock, every order
//  whose broker outcome is uncertain (with its full reconciliation trail),
//  the price-guard live-deviation threshold, and recent order attempts.
//  Every administrator can see it; actions are Super Administrator only
//  and re-checked + audit-logged server-side. Nothing here touches broker
//  positions: "re-check" asks the broker by HALO's order id, "resolve"
//  records what the Super Admin confirmed at the broker.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { A, C } from "@/lib/halo/ui-helpers";
import { ActBtn, api, ConfirmDialog, KV, Note, SectionHead, StatCard, StatusPill, TableWrap, Td, Th, when, type ConfirmState } from "./kit";

interface Ev {
  id: string;
  fromState: string;
  toState: string;
  detail: string;
  at: string;
}
interface Intent {
  id: string;
  source: string;
  symbol: string;
  timeframe: string;
  direction: number;
  entry: number;
  sl: number;
  tp: number;
  execMode: string;
  brokerKind: string;
  brokerAccountId: string;
  clientOrderId: string;
  brokerOrderId: string;
  state: string;
  detail: string;
  createdAt: string;
  updatedAt: string;
  events?: Ev[];
}
interface LockRes {
  holder: { intentId: string; state: string; symbol: string; source: string } | null;
  uncertain: Intent[];
  recent: Intent[];
}
interface GuardRes {
  maxDeviationAtr: number | null;
  liveTradingAllowed: boolean;
  maxQuoteAgeSec: number;
}

const fieldCss: React.CSSProperties = { background: "#000714", border: "1px solid #1C4478", color: "#EAF3FF" };
const side = (d: number) => (d === -1 ? "SELL" : "BUY");

export function AdminExecution({ isSuper }: { isSuper: boolean }) {
  const [lock, setLock] = useState<LockRes | null>(null);
  const [guard, setGuard] = useState<GuardRes | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [thr, setThr] = useState("");

  const load = useCallback(async () => {
    const [l, g] = await Promise.all([api<LockRes>("/api/admin/execution-lock"), api<GuardRes>("/api/admin/price-guard")]);
    if (l.ok) setLock(l);
    else setNote({ text: l.error ?? "Could not load the execution lock.", bad: true });
    if (g.ok) {
      setGuard(g);
      setThr((t) => (t === "" && g.maxDeviationAtr !== null ? String(g.maxDeviationAtr) : t));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load]);

  const recheck = async (i: Intent) => {
    setBusy(i.id);
    const j = await api<{ result?: string }>("/api/admin/execution-lock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "recheck", intentId: i.id }),
    });
    setBusy(null);
    const msg: Record<string, string> = {
      open: "The broker shows the position open — the trade was recovered.",
      closed: "The order was filled and has already closed — lock released; check the broker history for its result.",
      absent: "The broker confirms the order was not executed — lock released.",
      unknown: "Still unknown — the broker could not confirm either way. The order stays locked.",
    };
    setNote(j.ok ? { text: msg[j.result ?? ""] ?? `Result: ${j.result}`, bad: j.result === "unknown" } : { text: j.error ?? "Re-check failed.", bad: true });
    await load();
  };

  const resolve = (i: Intent, outcome: "executed" | "not_executed") =>
    setConfirm({
      title: outcome === "executed" ? "Confirm: the broker DID execute this order" : "Confirm: the broker did NOT execute this order",
      body:
        outcome === "executed"
          ? `Only confirm after you have SEEN this position (${side(i.direction)} ${i.symbol}, order ${i.clientOrderId}) in the broker platform. HALO will book it as an open trade and keep the lock until it closes.`
          : `Only confirm after checking the broker platform shows NO position or fill for ${side(i.direction)} ${i.symbol} (order ${i.clientOrderId}). HALO will release the lock and new orders can be placed. No trade is recorded.`,
      tone: outcome === "executed" ? "gold" : "danger",
      confirmLabel: outcome === "executed" ? "I SAW IT AT THE BROKER" : "CONFIRMED — NOT EXECUTED",
      onConfirm: async () => {
        const j = await api("/api/admin/execution-lock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intentId: i.id, outcome }),
        });
        setNote(j.ok ? { text: outcome === "executed" ? "Recorded as executed — the trade is booked and stays locked until it closes." : "Recorded as not executed — the lock is released." } : { text: j.error ?? "Resolution failed.", bad: true });
        await load();
      },
    });

  const saveGuard = (value: number | null) =>
    setConfirm({
      title: value === null ? "Block live trading?" : `Allow live orders within ${value} × ATR?`,
      body:
        value === null
          ? "Clearing the threshold refuses EVERY live order until it is set again. Paper trading is not affected."
          : `Setting a threshold PERMITS live orders on the connected broker account whenever the broker's price is within ${value} × ATR of the order price. 0.30 × ATR was proposed for DEMO testing only — set it only for a demo account you have approved for testing.`,
      tone: value === null ? "cyan" : "danger",
      confirmLabel: value === null ? "BLOCK LIVE ORDERS" : "SET THRESHOLD",
      onConfirm: async () => {
        const j = await api<GuardRes>("/api/admin/price-guard", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ maxDeviationAtr: value }),
        });
        setNote(j.ok ? { text: value === null ? "Threshold cleared — live orders are blocked." : `Threshold set to ${value} × ATR.` } : { text: j.error ?? "Could not save.", bad: true });
        await load();
      },
    });

  if (!lock || !guard) return <div className="text-[11px]" style={{ color: C.muted }}>Loading execution safety…</div>;
  const unc = lock.uncertain;

  return (
    <div className="space-y-5">
      <SectionHead
        title="EXECUTION SAFETY"
        sub="One-trade lock, uncertain broker outcomes and live price protection. Refreshes every 15 s. Actions are Super Administrator only."
        right={<ActBtn tone="ghost" onClick={() => void load()}>REFRESH</ActBtn>}
      />
      <Note note={note} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="EXECUTION LOCK"
          value={lock.holder ? "HELD" : "FREE"}
          tone={!lock.holder ? "ok" : lock.holder.state === "UNCERTAIN" ? "err" : "warn"}
          pulse={lock.holder?.state === "UNCERTAIN"}
          sub={lock.holder ? `${lock.holder.source} · ${lock.holder.symbol} · ${lock.holder.state}` : "new orders can be placed"}
        />
        <StatCard label="UNCERTAIN ORDERS" value={unc.length} tone={unc.length ? "err" : "ok"} pulse={unc.length > 0} sub={unc.length ? "new orders are paused" : "none"} />
        <StatCard
          label="LIVE PRICE GUARD"
          value={guard.maxDeviationAtr === null ? "NOT SET" : `${guard.maxDeviationAtr} × ATR`}
          tone={guard.maxDeviationAtr === null ? "warn" : "info"}
          sub={guard.maxDeviationAtr === null ? "every live order is refused" : `broker quote ≤ ${guard.maxQuoteAgeSec} s old`}
        />
      </div>

      {/* ── uncertain orders ── */}
      <div className="space-y-3">
        <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>UNCERTAIN ORDERS</div>
        {unc.length === 0 ? (
          <div className="rounded-xl px-4 py-3 text-[11px]" style={{ background: A.green(0.06), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.25)}` }}>
            No uncertain orders. HALO re-asks the broker about any new one every minute.
          </div>
        ) : (
          unc.map((i) => (
            <div key={i.id} className="space-y-3 rounded-xl p-4" style={{ background: "#031329", boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status="FAILED" label="UNCERTAIN" />
                <span className="text-[12.5px] font-extrabold" style={{ color: C.txt }}>
                  {side(i.direction)} {i.symbol} · {i.timeframe} · {i.source}
                </span>
                <span className="text-[10px]" style={{ color: C.muted }}>sent {when(i.createdAt)}</span>
              </div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <KV k="Order id (HALO)" v={i.clientOrderId} mono />
                <KV k="Broker" v={`${i.brokerKind || "—"} · ${i.brokerAccountId || "—"}`} mono />
                <KV k="Entry / SL / TP" v={`${i.entry} / ${i.sl} / ${i.tp}`} mono />
                <KV k="Last detail" v={i.detail || "—"} />
              </div>
              <div>
                <div className="mb-1 text-[9.5px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>TRAIL</div>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {(i.events ?? []).map((e) => (
                    <div key={e.id} className="flex gap-2 text-[10.5px]" style={{ color: C.txt2 }}>
                      <span className="shrink-0 tabular-nums" style={{ color: C.dim }}>{when(e.at)}</span>
                      <span className="shrink-0 font-bold" style={{ color: C.cyan }}>{e.fromState ? `${e.fromState} → ` : ""}{e.toState}</span>
                      <span className="min-w-0">{e.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
              {isSuper ? (
                <div className="flex flex-wrap gap-2">
                  <ActBtn busy={busy === i.id} onClick={() => void recheck(i)}>RE-CHECK WITH BROKER</ActBtn>
                  <ActBtn tone="gold" onClick={() => resolve(i, "executed")}>I SAW IT EXECUTED</ActBtn>
                  <ActBtn tone="danger" onClick={() => resolve(i, "not_executed")}>CONFIRMED NOT EXECUTED</ActBtn>
                </div>
              ) : (
                <div className="text-[10.5px]" style={{ color: C.muted }}>A Super Administrator must check the broker and resolve this order.</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── price guard ── */}
      <div className="space-y-2 rounded-xl p-4" style={{ background: "#031329", boxShadow: `inset 0 0 0 1px ${C.line}` }}>
        <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>LIVE PRICE GUARD · DEVIATION THRESHOLD</div>
        <p className="text-[11px] leading-relaxed" style={{ color: C.muted }}>
          Before a live order, the broker&apos;s fresh quote must be within this many ATR of the order price. While it is not set, every live order is refused.
          0.30 × ATR is the proposed value for <b>demo testing only</b> — it is not a proven live standard.
        </p>
        {isSuper ? (
          <div className="flex flex-wrap items-center gap-2">
            <input value={thr} onChange={(e) => setThr(e.target.value)} placeholder="e.g. 0.30" inputMode="decimal" className="w-28 rounded-lg px-3 py-1.5 text-[12px] outline-none" style={fieldCss} />
            <span className="text-[11px]" style={{ color: C.muted }}>× ATR (0.05 – 5)</span>
            <ActBtn
              tone="danger"
              disabled={!(Number(thr) >= 0.05 && Number(thr) <= 5)}
              onClick={() => saveGuard(Math.round(Number(thr) * 100) / 100)}
            >
              SET THRESHOLD
            </ActBtn>
            {guard.maxDeviationAtr !== null && <ActBtn tone="ghost" onClick={() => saveGuard(null)}>CLEAR · BLOCK LIVE</ActBtn>}
          </div>
        ) : (
          <div className="text-[10.5px]" style={{ color: C.muted }}>Only a Super Administrator can change this.</div>
        )}
      </div>

      {/* ── recent attempts ── */}
      <div className="space-y-2">
        <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>RECENT ORDER ATTEMPTS</div>
        <TableWrap maxH={420}>
          <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Source</Th>
              <Th>Order</Th>
              <Th>Mode</Th>
              <Th>State</Th>
              <Th>Order id</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {lock.recent.map((i) => (
              <tr key={i.id}>
                <Td>{when(i.createdAt)}</Td>
                <Td>{i.source}</Td>
                <Td>{side(i.direction)} {i.symbol} {i.timeframe}</Td>
                <Td>{i.execMode}</Td>
                <Td><StatusPill status={i.state === "OPEN" || i.state === "CLOSED" ? "VERIFIED" : i.state === "UNCERTAIN" || i.state === "REJECTED" ? "FAILED" : "PENDING"} label={i.state} /></Td>
                <Td mono>{i.clientOrderId}</Td>
                <Td>{i.detail || "—"}</Td>
              </tr>
            ))}
          </tbody>
          </table>
        </TableWrap>
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
