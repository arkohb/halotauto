"use client";

// ════════════════════════════════════════════════════════════════════════
//  ACCOUNT SUMMARY · live broker account card (dashboard right column)
//
//  Reads the same real /api/brokers/live-account feed as Risk Guardian:
//  balance · equity · floating P&L · equity-vs-balance meter. When no
//  broker is connected the simulator values are shown and labelled SIM —
//  the card never pretends a demo figure is a live one.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { PanelCard, Pill, StateFrame } from "./panel";

interface LiveAcctPayload {
  ok?: boolean;
  live: boolean;
  degraded: string | null;
  kind: string;
  brokerLabel: string;
  account: { balance: number; equity: number; margin: number; freeMargin: number; marginLevel: number; currency: string } | null;
  positions: { id: string; pnl: number }[];
  updatedAt: number;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AccountSummary() {
  const [acct, setAcct] = useState<LiveAcctPayload | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/brokers/live-account", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: LiveAcctPayload) => {
          if (alive) {
            setAcct(j);
            setErr(false);
          }
        })
        .catch(() => {
          if (alive) setErr(true);
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
  }, []);

  const a = acct?.account ?? null;
  const cur = a?.currency ?? "USD";
  const openPnl = acct?.positions.reduce((s, p) => s + (p.pnl ?? 0), 0) ?? 0;
  const hasPos = (acct?.positions.length ?? 0) > 0;

  // equity vs balance meter — real floating drift, clamped for display
  const driftPct = a && a.balance > 0 ? ((a.equity - a.balance) / a.balance) * 100 : 0;
  const meter = Math.max(-5, Math.min(5, driftPct)); // ±5% window
  const meterPct = 50 + (meter / 5) * 50; // 0..100 on the bar

  return (
    <PanelCard
      title="ACCOUNT SUMMARY"
      icon={Wallet}
      accent="gold"
      right={<Pill tone={acct?.live ? "live" : "muted"}>{acct?.live ? "LIVE" : acct ? "SIM" : "—"}</Pill>}
    >
      {!acct ? (
        <div className="flex h-full items-center justify-center px-4 py-6">
          <StateFrame
            state={err ? "offline" : "loading"}
            title={err ? "Account feed unavailable" : "Loading account…"}
            hint={err ? "Balance and equity come from the broker feed only — retrying keeps them honest." : undefined}
            compact
            className="mx-3"
          />
        </div>
      ) : (
        <div className="flex h-full flex-col gap-2 p-3">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: C.lineInner, background: "rgba(2,11,26,0.65)" }}>
              <div className="text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: C.label }}>Balance</div>
              <div className="truncate font-mono text-[14px] font-bold" style={{ color: C.txt }}>
                {a ? `$${usd(a.balance)}` : "—"}
              </div>
            </div>
            <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: C.lineInner, background: "rgba(2,11,26,0.65)" }}>
              <div className="text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: C.label }}>Equity</div>
              <div className="truncate font-mono text-[14px] font-bold" style={{ color: C.txt }}>
                {a ? `$${usd(a.equity)}` : "—"}
              </div>
            </div>
          </div>

          <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: C.lineInner, background: "rgba(2,11,26,0.65)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: C.label }}>Floating P&L</span>
              <span className="font-mono text-[8.5px]" style={{ color: C.label }}>{a ? cur : ""}</span>
            </div>
            <div
              className="font-mono text-[16px] font-bold leading-tight"
              style={{ color: hasPos ? (openPnl >= 0 ? C.green : C.red) : C.muted }}
            >
              {hasPos ? `${openPnl >= 0 ? "+" : "−"}$${usd(Math.abs(openPnl))}` : "Flat"}
            </div>
          </div>

          {/* equity drift meter — real (equity − balance) / balance */}
          <div className="mt-auto">
            <div className="mb-1 flex items-center justify-between text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: C.label }}>
              <span>Equity drift</span>
              <span style={{ color: driftPct >= 0 ? C.green : C.red }}>
                {driftPct >= 0 ? "+" : "−"}
                {Math.abs(driftPct).toFixed(2)}%
              </span>
            </div>
            <div className="relative h-[6px] overflow-hidden rounded-full" style={{ background: C.deep, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
              <span aria-hidden className="absolute left-1/2 top-0 h-full w-px" style={{ background: C.line2 }} />
              <span
                className="absolute top-0 h-full w-[3px] rounded-full transition-all duration-500"
                style={{
                  left: `calc(${Math.min(99, Math.max(1, meterPct))}% - 1.5px)`,
                  background: driftPct >= 0 ? C.green : C.red,
                  boxShadow: `0 0 8px 0 ${driftPct >= 0 ? A.green(0.7) : A.red(0.7)}`,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[7.5px]" style={{ color: C.dim }}>
              <span>−5%</span>
              <span>balance</span>
              <span>+5%</span>
            </div>
          </div>
        </div>
      )}
    </PanelCard>
  );
}
