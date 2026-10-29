"use client";

// ════════════════════════════════════════════════════════════════════════
//  TRADING ACTIVITY · positions / history / engine log card
//  POSITIONS  → real /api/brokers/live-account positions (EA + manual)
//  HISTORY    → the existing bot trade book (HistoryPanel, DB-backed)
//  ENGINE LOG → the genuine strategy engine decision log
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { A, C, fmtPx, type BotStateRes } from "@/lib/halo/ui-helpers";
import { HistoryPanel } from "./history-panel";
import { PanelCard, StateFrame } from "./panel";

interface LivePos {
  id: string;
  symbol: string;
  side: -1 | 1;
  volume: number;
  entryPrice: number | null;
  currentPrice: number | null;
  sl: number | null;
  tp: number | null;
  pnl: number;
  pips: number | null;
  paper: boolean;
  ea: boolean;
}

interface LiveAcctPayload {
  ok?: boolean;
  live: boolean;
  degraded: string | null;
  positions: LivePos[];
  updatedAt: number;
}

type Tab = "positions" | "history" | "log";

export function TradingActivity({ state, histKey }: { state: BotStateRes; histKey: number }) {
  const [tab, setTab] = useState<Tab>("positions");
  const [acct, setAcct] = useState<LiveAcctPayload | null>(null);
  // honest-state: set only by the existing fetch catch, cleared when data arrives
  const [acctErr, setAcctErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/brokers/live-account", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: LiveAcctPayload) => {
          if (alive) {
            setAcct(j);
            setAcctErr(false);
          }
        })
        .catch(() => {
          if (alive) setAcctErr(true);
        });
    };
    const t = window.setTimeout(load, 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => {
      alive = false;
      window.clearTimeout(t);
      clearInterval(id);
    };
  }, [histKey]);

  const positions = acct?.positions ?? [];
  const openPnl = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);

  // one-shot flash when the confirmed total open P&L actually changes
  // (adjusted during render — the React-recommended pattern for prop drift)
  const [pnlFlash, setPnlFlash] = useState(0);
  const [pnlPrev, setPnlPrev] = useState(openPnl);
  if (pnlPrev !== openPnl) {
    setPnlPrev(openPnl);
    setPnlFlash((f) => f + 1);
  }

  const tabBtn = (id: Tab, label: string, badge?: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-extrabold tracking-[0.12em] transition-colors"
      style={{
        background: tab === id ? A.cyan(0.12) : "transparent",
        color: tab === id ? C.cyan : C.label,
        boxShadow: tab === id ? `inset 0 0 0 1px ${A.cyan(0.35)}` : `inset 0 0 0 1px ${C.lineInner}`,
      }}
    >
      {label}
      {badge && (
        <span className="rounded-full px-1 text-[7.5px] font-extrabold" style={{ background: C.gold, color: C.navy }}>
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <PanelCard
      title="TRADING ACTIVITY"
      icon={Activity}
      accent="cyan"
      className="h-full"
      right={
        <div className="flex gap-1">
          {tabBtn("positions", "POSITIONS", positions.length > 0 ? String(positions.length) : undefined)}
          {tabBtn("history", "HISTORY")}
          {tabBtn("log", "LOG")}
        </div>
      }
      bodyClassName="flex flex-col"
    >
      {tab === "positions" && (
        <div className="flex min-h-0 flex-1 flex-col">
          {positions.length === 0 ? (
            acctErr ? (
              <div className="flex flex-1 items-center justify-center px-4 py-6">
                <StateFrame
                  state="offline"
                  title="Broker link unavailable"
                  hint="Positions come from the live broker feed only — retrying keeps them honest."
                  compact
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 py-6 text-center text-[11px]" style={{ color: C.label }}>
                Flat book — no open positions. The EA opens one only on a valid C3 fire.
              </div>
            )
          ) : (
            <>
              <div className="halo-scroll min-h-0 flex-1 overflow-auto">
                <table className="w-full text-[9px]">
                  <thead className="sticky top-0" style={{ background: C.panel }}>
                    <tr className="text-[8px] uppercase tracking-[0.08em]" style={{ color: C.label }}>
                      <th className="px-1.5 py-1.5 text-left font-bold">Symbol</th>
                      <th className="px-1 py-1.5 text-left font-bold">Type</th>
                      <th className="px-1 py-1.5 text-right font-bold">Lots</th>
                      <th className="px-1 py-1.5 text-right font-bold">Entry</th>
                      <th className="px-1 py-1.5 text-right font-bold">SL</th>
                      <th className="px-1 py-1.5 text-right font-bold">TP</th>
                      <th className="px-1.5 py-1.5 text-right font-bold">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.id} className="halo-row-in border-t" style={{ borderColor: C.divider }}>
                        <td className="px-1.5 py-1.5 font-semibold" style={{ color: C.txt }}>
                          {p.symbol}
                          {p.paper && <span className="ml-0.5 rounded px-0.5 text-[7px] font-bold" style={{ background: A.gold(0.12), color: C.gold }}>SIM</span>}
                        </td>
                        <td className="px-1 py-1.5 font-bold" style={{ color: p.side === -1 ? C.red : C.green }}>
                          {p.side === -1 ? "SELL" : "BUY"}
                        </td>
                        <td className="px-1 py-1.5 text-right font-mono" style={{ color: C.txt }}>{p.volume.toFixed(2)}</td>
                        <td className="px-1 py-1.5 text-right font-mono" style={{ color: C.txt2 }}>{p.entryPrice !== null ? fmtPx(p.entryPrice, state.mintick) : "—"}</td>
                        <td className="px-1 py-1.5 text-right font-mono" style={{ color: A.red(0.9) }}>{p.sl !== null ? fmtPx(p.sl, state.mintick) : "—"}</td>
                        <td className="px-1 py-1.5 text-right font-mono" style={{ color: A.green(0.9) }}>{p.tp !== null ? fmtPx(p.tp, state.mintick) : "—"}</td>
                        <td className="px-1.5 py-1.5 text-right font-mono font-bold" style={{ color: p.pnl >= 0 ? C.green : C.red }}>
                          {p.pnl >= 0 ? "+" : "−"}
                          {Math.abs(p.pnl).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t px-3 py-1.5 text-[9.5px] font-mono" style={{ borderColor: C.lineInner }}>
                <span style={{ color: C.label }}>Total open P&L</span>
                <span
                  key={pnlFlash}
                  className={`rounded px-1 font-bold ${pnlFlash > 0 ? "halo-value-flash" : ""}`}
                  style={{ color: openPnl >= 0 ? C.green : C.red }}
                >
                  {openPnl >= 0 ? "+" : "−"}
                  {Math.abs(openPnl).toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="min-h-0 flex-1 overflow-hidden px-1 pb-1">
          <HistoryPanel mintick={state.mintick} refreshKey={histKey} />
        </div>
      )}

      {tab === "log" && (
        <div className="halo-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2">
          {state.engine.log.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[11px]" style={{ color: C.label }}>Engine log is empty — still warming up.</div>
          ) : (
            state.engine.log.slice(0, 14).map((l, i) => (
              <div key={`${l.time}-${l.kind}-${i}`} className="halo-row-in flex items-center gap-1.5 text-[9.5px] font-mono">
                <span
                  className="w-14 shrink-0 rounded-sm px-1 py-px text-center text-[7.5px] font-extrabold"
                  style={{
                    background: l.kind === "fire" ? A.cyan(0.12) : l.kind === "win" ? A.green(0.14) : l.kind === "loss" ? A.red(0.14) : "rgba(140,152,174,0.12)",
                    color: l.kind === "fire" ? C.cyan : l.kind === "win" ? C.green : l.kind === "loss" ? C.red : C.muted,
                  }}
                >
                  {l.kind.toUpperCase()}
                </span>
                <span className="truncate" style={{ color: C.txt2 }}>
                  {l.kind === "fire"
                    ? `${l.dir === -1 ? "SELL" : "BUY"} @ ${fmtPx(l.entry, state.mintick)}`
                    : `${l.pips >= 0 ? "+" : "−"}${Math.abs(l.pips).toFixed(1)} pips`}
                </span>
                <span className="ml-auto shrink-0" style={{ color: C.label }}>
                  {new Date(l.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelCard>
  );
}
