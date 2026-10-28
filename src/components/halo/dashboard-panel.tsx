"use client";

// Dashboard panel — faithful mirror of the PineScript HALO 3EL dashboard table

import { C, fmtPips, fmtPx, runPips, statusOf, toneClasses, type BotStateRes } from "@/lib/halo/ui-helpers";

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
    <div className="rounded-xl border-2 overflow-hidden" style={{ borderColor: "rgba(212,175,55,0.55)", background: C.navy }}>
      <div className="px-3 py-2 text-center text-xs font-bold tracking-[0.18em]" style={{ background: C.navy, color: C.gold }}>
        ◆ HALO 3EL · EQUAL LEVEL REJECTION
      </div>
      <div className="divide-y divide-[#1C2A47]/60">
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
          k="Bot engine"
          v={state.enabled ? "RUNNING · auto-exec" : "STOPPED · signal watch"}
          vc={state.enabled ? C.green : C.muted}
        />
      </div>
      <div className="px-3 py-2 text-center text-[10px] tracking-[0.18em]" style={{ background: C.navy, color: "rgba(212,175,55,0.7)" }}>
        HALO SUITE · 3EL AUTOTRADER · PAPER EA
      </div>
    </div>
  );
}

function Row({ k, v, vc }: { k: string; v: string; vc: string }) {
  return (
    <div className="grid grid-cols-2 items-center px-3 py-1.5 odd:bg-[#0B1426] even:bg-[#101C33]">
      <span className="text-[11px] text-[#8C98AE]">{k}</span>
      <span className="text-[11px] font-mono font-semibold text-right" style={{ color: vc }}>
        {v}
      </span>
    </div>
  );
}
