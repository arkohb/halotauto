"use client";

// ════════════════════════════════════════════════════════════════════════
//  RISK GUARDIAN · account + risk posture card
//  Balance / equity / open P&L come from the REAL /api/brokers/live-account
//  feed (live broker when connected, honestly-labelled simulator otherwise).
//  Risk checks are computed from genuine system state — nothing is faked.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { A, C, fmtPips, runPips, type BotStateRes, openTrade } from "@/lib/halo/ui-helpers";
import { CheckRow, PanelCard, Pill, StatCell } from "./panel";
import { RiskShield, type ShieldLevel } from "./risk-shield";

interface LivePos {
  id: string;
  symbol: string;
  side: -1 | 1;
  volume: number;
  pnl: number;
  paper: boolean;
  ea: boolean;
}

interface LiveAcctPayload {
  ok?: boolean;
  live: boolean;
  degraded: string | null;
  kind: string;
  brokerLabel: string;
  account: { balance: number; equity: number; margin: number; freeMargin: number; marginLevel: number; currency: string } | null;
  positions: LivePos[];
  updatedAt: number;
}

export function RiskGuardian({ state }: { state: BotStateRes }) {
  const [acct, setAcct] = useState<LiveAcctPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/brokers/live-account", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: LiveAcctPayload) => {
          if (alive) setAcct(j);
        })
        .catch(() => {});
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
  const openPnl = acct?.positions.reduce((s, p) => s + (p.pnl ?? 0), 0) ?? 0;
  const hasPos = (acct?.positions.length ?? 0) > 0;
  const cur = a?.currency ?? "USD";
  const live = acct?.live === true;

  const rp = runPips(state);
  const feedOk = state.feed.source !== "simulator" && !/slow|error|unreachable/i.test(state.feed.note || "");
  const brokerOk = state.exec.broker?.status === "ok";
  const isLive = state.exec.executionMode === "live";

  // shield level — computed ONLY from the verified checks below it
  const exposurePct = a && a.equity > 0 && a.margin > 0 ? (a.margin / a.equity) * 100 : 0;
  const floatDrift = a && a.balance > 0 ? ((a.equity - a.balance) / a.balance) * 100 : 0;
  const marginLevel = a && a.marginLevel > 0 ? a.marginLevel : null;
  const breach = Boolean(acct?.degraded) || (isLive && !brokerOk);
  const warn = !breach && (!feedOk || exposurePct > 50 || (marginLevel !== null && marginLevel < 200));
  const shieldLevel: ShieldLevel = breach ? "breach" : warn ? "warn" : "pass";
  const shieldWord = breach ? "REVIEW REQUIRED" : warn ? "WATCHING" : "ALL CHECKS PASSING";
  const shieldSub = breach
    ? acct?.degraded
      ? "Broker link degraded — trading paused until it recovers"
      : "Live broker is not healthy — verify the connection before relying on routing"
    : warn
      ? !feedOk
        ? `Feed degraded (${state.feed.source}) — market data may lag`
        : exposurePct > 50
          ? `Margin exposure at ${exposurePct.toFixed(0)}% of equity`
          : `Margin level ${marginLevel?.toFixed(0)}% — keep an eye on free margin`
      : "Feed, execution, broker and engine verified healthy";

  return (
    <PanelCard
      title="RISK GUARDIAN"
      icon={ShieldCheck}
      accent="green"
      right={<Pill tone={live ? "live" : "muted"}>{live ? "LIVE ACCOUNT" : "SIMULATOR"}</Pill>}
      className="h-full"
    >
      <div className="flex h-full flex-col gap-2.5 p-3">
        {/* hero row — protective hologram + status word (mockup 05) */}
        <div className="flex items-center gap-4 rounded-xl border px-4 py-3" style={{ borderColor: C.lineInner, background: `radial-gradient(circle at 18% 50%, ${A.green(0.07)}, transparent 55%), rgba(2,11,26,0.6)` }}>
          <RiskShield level={shieldLevel} size={92} />
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: C.label }}>Risk Status</div>
            <div
              className="mt-0.5 text-[19px] font-extrabold leading-tight"
              style={{
                color: shieldLevel === "pass" ? C.green : shieldLevel === "warn" ? C.warn : C.red,
                textShadow: `0 0 18px ${shieldLevel === "pass" ? A.green(0.35) : shieldLevel === "warn" ? A.warn(0.3) : A.red(0.3)}`,
              }}
            >
              {breach ? "Review" : warn ? "Watching" : "Healthy"}
            </div>
            <div className="mt-0.5 text-[9.5px] leading-snug" style={{ color: C.muted }}>{shieldWord.charAt(0) + shieldWord.slice(1).toLowerCase()} · {shieldSub}</div>
          </div>
          <div className="ml-auto hidden shrink-0 text-right sm:block">
            <div className="text-[8px] font-bold tracking-[0.14em]" style={{ color: C.label }}>MARGIN LV</div>
            <div className="font-mono text-[13px] font-bold" style={{ color: marginLevel !== null ? (marginLevel < 200 ? C.warn : C.green) : C.txt }}>
              {marginLevel !== null ? `${marginLevel.toFixed(0)}%` : "—"}
            </div>
            <div className="mt-1 text-[8px] font-bold tracking-[0.14em]" style={{ color: C.label }}>FLOAT</div>
            <div className="font-mono text-[12px] font-bold" style={{ color: floatDrift >= 0 ? C.green : C.red }}>
              {floatDrift >= 0 ? "+" : "−"}
              {Math.abs(floatDrift).toFixed(2)}%
            </div>
          </div>
        </div>

        {/* risk metrics grid — 3 × 3, all real */}
        <div className="grid grid-cols-3 gap-1.5">
          <StatCell label="Balance" value={a ? `$${a.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"} sub={a ? cur : undefined} />
          <StatCell label="Equity" value={a ? `$${a.equity.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"} sub={a ? cur : undefined} />
          <StatCell
            label="Open P&L"
            value={hasPos ? `${openPnl >= 0 ? "+" : "−"}$${Math.abs(openPnl).toFixed(2)}` : "Flat"}
            color={hasPos ? (openPnl >= 0 ? C.green : C.red) : C.muted}
          />
          <StatCell
            label="Risk/trade"
            value={state.exec.sizingMode === "fixed" ? `${state.exec.sizeFixed} lots` : `${state.exec.sizePercent}%`}
          />
          <StatCell
            label="Exposure"
            value={a && a.equity > 0 && a.margin > 0 ? `${((a.margin / a.equity) * 100).toFixed(1)}%` : "0%"}
            color={exposurePct > 50 ? C.warn : undefined}
          />
          <StatCell
            label="Margin LV"
            value={marginLevel !== null ? `${marginLevel.toFixed(0)}%` : "—"}
            color={marginLevel !== null && marginLevel < 200 ? C.warn : marginLevel !== null ? C.green : undefined}
          />
          <StatCell
            label="Run P/L"
            value={openTrade(state) && rp !== null ? fmtPips(rp) : "—"}
            color={openTrade(state) && rp !== null ? (rp >= 0 ? C.green : C.red) : C.muted}
          />
          <StatCell
            label="Routing"
            value={isLive ? "LIVE" : "PAPER"}
            color={isLive ? C.red : C.cyan}
          />
          <StatCell
            label="Positions"
            value={String(acct?.positions.length ?? 0)}
            sub={acct?.positions.length ? "open" : "flat"}
          />
        </div>

        {/* safety checks — all real */}
        <div className="mt-auto rounded-lg border bg-[#020B1A]/70 px-2.5 py-1" style={{ borderColor: C.lineInner }}>
          <CheckRow label="Feed" verdict={feedOk ? "pass" : "info"} detail={feedOk ? `${state.feed.source} · live` : state.feed.note || state.feed.source} />
          <CheckRow
            label="Execution"
            verdict={isLive ? "info" : "pass"}
            detail={isLive ? "LIVE routing armed" : "Paper · simulated fills"}
          />
          <CheckRow
            label="Broker"
            verdict={isLive ? (brokerOk ? "pass" : "fail") : "info"}
            detail={isLive ? (brokerOk ? state.exec.broker?.label ?? "connected" : state.exec.broker?.statusMsg || "not healthy") : "not used in paper mode"}
          />
          <CheckRow label="Engine" verdict={state.enabled ? "pass" : "info"} detail={state.enabled ? "auto-exec active" : "standby · signal watch"} />
        </div>

        {acct?.degraded && (
          <div className="rounded-md border px-2 py-1 text-[9px] font-semibold" style={{ borderColor: A.red(0.4), background: A.red(0.08), color: C.red }}>
            Broker link degraded: {acct.degraded.slice(0, 90)}
          </div>
        )}
      </div>
    </PanelCard>
  );
}
