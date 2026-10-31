"use client";

// Dashboard panel — faithful mirror of the PineScript HALO 3EL dashboard table

import { Table2 } from "lucide-react";
import { A, C, fmtPips, fmtPx, runPips, statusOf, toneClasses, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "@/components/halo/panel";

export function DashboardPanel({ state }: { state: BotStateRes }) {
  const e = state.engine;
  const s = e.stats;
  const t = e.trade;
  const pip = state.mintick * state.config.pipMult;
  const { text, tone } = statusOf(state);
  const toneCls = toneClasses(tone);

  let nRes = 0;
  let nSup = 0;
  let rLvl: number | null = null;
  let sLvl: number | null = null;
  for (const l of e.levels) {
    if (l.side === -1) {
      nRes += 1;
      rLvl = rLvl === null ? l.top : Math.min(rLvl, l.top);
    } else {
      nSup += 1;
      sLvl = sLvl === null ? l.bot : Math.max(sLvl, l.bot);
    }
  }

  const tot = s.wins + s.losses;
  const wr = tot > 0 ? (s.wins * 100.0) / tot : null;
  const net = s.sumTP - s.sumSL;
  const rp = runPips(state);

  return (
    <PanelCard title="◆ HALO 3EL · EQUAL LEVEL REJECTION" icon={Table2} accent="gold">
      <div
        className="divide-y divide-[#0F2E58]/60"
        style={{ ["--zA" as string]: C.navy, ["--zB" as string]: C.navy2 }}
      >
        <Row k="Symbol · TF" v={`${state.symbol} · ${state.tf}`} vc={C.txt} />
        <div className="grid grid-cols-1" style={{ background: toneCls.bg }}>
          <div className="px-3 py-2 text-center text-xs font-bold tracking-wide" style={{ color: toneCls.fg }}>
            {text}
          </div>
        </div>
        <Row
          k="Resistance (sell)"
          v={nRes > 0 ? `${nRes} fresh · ${fmtPx(rLvl as number, state.mintick)}` : "none"}
          vc={nRes > 0 ? C.red : C.muted}
        />
        <Row
          k="Support (buy)"
          v={nSup > 0 ? `${nSup} fresh · ${fmtPx(sLvl as number, state.mintick)}` : "none"}
          vc={nSup > 0 ? C.green : C.muted}
        />
        <Row k="Signal mode" v={state.config.sigMode === "instant" ? "INSTANT" : "BAR CLOSE"} vc={C.txt} />
        <Row
          k="Direction"
          v={t ? (t.dir === -1 ? "SELL ▼" : "BUY ▲") : "FLAT"}
          vc={t ? (t.dir === -1 ? C.red : C.green) : C.muted}
        />
        <Row k="Entry" v={t ? fmtPx(t.entry, state.mintick) : "—"} vc={C.txt} />
        <Row
          k="Stop loss"
          v={t ? `${fmtPx(t.sl, state.mintick)} (${t.riskPips.toFixed(0)} p)` : "—"}
          vc={C.red}
        />
        <Row
          k="Take profit"
          v={t ? `${fmtPx(t.tp, state.mintick)} (${t.rewardPips.toFixed(0)} p)` : "—"}
          vc={C.green}
        />
        <Row k="Risk : Reward" v={`1 : ${state.config.rrMult.toFixed(1)}`} vc={C.gold} />
        <Row
          k="Run P/L"
          v={t && rp !== null ? `${fmtPips(rp)} pips` : "—"}
          vc={t && rp !== null ? (rp >= 0 ? C.green : C.red) : C.muted}
        />
        <Row k="Last result" v={s.lastResult.text} vc={s.lastResult.kind === "win" ? C.green : s.lastResult.kind === "loss" ? C.red : C.muted} />
        <Row k="Wins / Losses" v={`${s.wins} W / ${s.losses} L`} vc={C.txt} />
        <Row
          k="Win rate"
          v={wr !== null ? `${wr.toFixed(1)} %` : "—"}
          vc={wr !== null ? (wr >= 25 ? C.green : C.red) : C.muted}
        />
        <Row k="TP pips / SL pips" v={`+${s.sumTP.toFixed(0)} / −${s.sumSL.toFixed(0)}`} vc={C.txt} />
        <Row k="Net pips" v={fmtPips(net)} vc={net >= 0 ? C.green : C.red} />
        <Row k="Burned · Busy · Crowded" v={`${s.burned} · ${s.skipped} · ${s.tooClose}`} vc={C.muted} />
        <Row
          k="Range skips · S/R too close"
          v={`${s.rangeSkipped}`}
          vc={s.rangeSkipped > 0 ? C.warn : C.muted}
        />
        <Row
          k="Bot engine"
          v={state.enabled ? "RUNNING · auto-exec" : "STOPPED · signal watch"}
          vc={state.enabled ? C.green : C.muted}
        />
      </div>
      <div className="px-3 py-2 text-center text-[10px] tracking-[0.18em]" style={{ background: C.navy, color: A.gold(0.7) }}>
        HALO SUITE · 3EL AUTOTRADER · PAPER EA
      </div>
    </PanelCard>
  );
}

function Row({ k, v, vc }: { k: string; v: string; vc: string }) {
  return (
    <div className="grid grid-cols-2 items-center px-3 py-1.5 odd:bg-(--zA) even:bg-(--zB)">
      <span className="text-[11px]" style={{ color: C.muted }}>{k}</span>
      <span className="text-[11px] font-mono font-semibold text-right" style={{ color: vc }}>
        {v}
      </span>
    </div>
  );
}
