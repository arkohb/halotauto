"use client";

import { TrendingUp } from "lucide-react";
import { C, fmtPx, fmtPips, runPips, type BotStateRes, openTrade } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";

export function TradeCard({ state }: { state: BotStateRes }) {
  const t = openTrade(state);
  const rp = runPips(state);
  const pip = state.mintick * state.config.pipMult;

  if (!t) {
    return (
      <div
        className="rounded-xl border border-dashed px-4 py-4 text-center text-sm"
        style={{ borderColor: C.line, background: C.navy, color: C.muted }}
      >
        FLAT — no open position · EA waits for a fresh C1/C2 level and a valid C3
      </div>
    );
  }

  const dirBg = t.dir === -1 ? C.red : C.green;
  const runCol = rp === null ? C.muted : rp >= 0 ? C.green : C.red;

  return (
    <PanelCard
      title="OPEN TRADE"
      icon={TrendingUp}
      accent="green"
      right={
        <>
          <span className="rounded px-2 py-0.5 text-xs font-bold text-white" style={{ background: dirBg }}>
            {t.dir === -1 ? "SELL ▼" : "BUY ▲"}
          </span>
          <span className="text-xs" style={{ color: C.muted }}>{t.source ? `${t.slModeLabel} trade` : `${t.slModeLabel} stop`}</span>
          <span className="text-xs font-mono" style={{ color: runCol }}>
            RUN {rp === null ? "—" : fmtPips(rp)} pips
          </span>
        </>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-[#0F2E58]">
        <Cell label="ENTRY" value={fmtPx(t.entry, state.mintick)} />
        <Cell
          label="STOP LOSS"
          value={fmtPx(t.sl, state.mintick)}
          sub={`−${t.riskPips.toFixed(1)} pips`}
          color={C.red}
        />
        <Cell
          label="TAKE PROFIT"
          value={fmtPx(t.tp, state.mintick)}
          sub={`+${t.rewardPips.toFixed(1)} pips`}
          color={C.green}
        />
        {t.source ? (
          <Cell label="FIRED BY" value={`${t.slModeLabel.split(" ")[0]} · ${t.symbol ?? ""} ${(t.tf ?? "").toUpperCase()}`} small />
        ) : (
          <Cell label="LEVEL ZONE" value={`${fmtPx(t.levelBot, state.mintick)} → ${fmtPx(t.levelTop, state.mintick)}`} small />
        )}
        <Cell
          label="RISK : REWARD"
          value={`1 : ${(t.riskPips > 0 ? t.rewardPips / t.riskPips : state.config.rrMult).toFixed(1)}`}
          sub={pip ? `${t.risk.toFixed(state.mintick >= 0.01 ? 2 : 4)} risk` : undefined}
          color={C.gold}
        />
      </div>
    </PanelCard>
  );
}

function Cell({ label, value, sub, color, small }: { label: string; value: string; sub?: string; color?: string; small?: boolean }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] tracking-wider" style={{ color: C.muted }}>{label}</div>
      <div className={`font-mono font-semibold ${small ? "text-[11px]" : "text-sm"}`} style={{ color: color ?? C.txt }}>
        {value}
      </div>
      {sub && <div className="text-[10px] font-mono" style={{ color: C.muted }}>{sub}</div>}
    </div>
  );
}
