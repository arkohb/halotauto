"use client";

// ════════════════════════════════════════════════════════════════════════
//  3EL INDICATOR RAIL · the indicator ATTACHED to the TradingView chart
//  The Advanced Chart widget is a cross-origin iframe — custom drawings
//  cannot be injected inside it. So the 3EL indicator attaches as a live
//  legend rail floating over the chart: BOTH armed levels (the support
//  BUY line + the resistance SELL line — old signals are never shown),
//  the C3 forming tracker and the open position's ENTRY / SL /
//  TP card drawn in the TradingView position-tool style (risk vs reward
//  split bar).
//  ⚠ Presentation only — the live strategy runs untouched.
// ════════════════════════════════════════════════════════════════════════

import type { Candle, HaloConfig, LevelSnapshot, Side, TradeSnapshot } from "@/lib/halo/types";
import { C, fmtPx } from "@/lib/halo/ui-helpers";
import { bestC3Form, c3FormCheck } from "@/lib/halo/c3-form";

interface RailProps {
  /** fresh levels only (engine state) */
  levels: LevelSnapshot[];
  trade: TradeSnapshot | null;
  /** live unconfirmed candle */
  live: Candle | undefined;
  /** last feed price (fallback: live candle close) */
  price: number;
  atr: number | null;
  cfg: HaloConfig;
  mintick: number;
  /** which side of the chart the rail docks to (left = TradingView legend spot) */
  side?: "left" | "right";
}

function sideColor(side: Side, alpha: string): string {
  const rgb = side === -1 ? "242,54,69" : "8,153,129";
  return `rgba(${rgb},${alpha})`;
}

export function IndicatorRail({ levels, trade, live, price, atr, cfg, mintick, side = "right" }: RailProps) {
  const forming = c3FormCheck(live, levels, atr, cfg);
  const formMap = new Map(forming.map((f) => [f.levelId, f.stage]));
  const best = bestC3Form(forming);
  const pip = mintick * cfg.pipMult;
  const ref = price > 0 ? price : live?.close ?? 0;
  // BOTH armed levels — the support AND the resistance the EA is watching
  // (newest first). Burned / stale history is never rendered.
  const shown = [...levels].sort((a, b) => b.b2Time - a.b2Time);

  return (
    <div
      aria-label="3EL indicator overlay attached to TradingView chart"
      className={`pointer-events-none absolute top-10 z-10 flex w-[192px] flex-col gap-1.5 xl:w-[214px] ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {/* header chip */}
      <div className="flex items-center justify-between rounded-lg border border-[#1C4478] bg-[#021229]/92 px-2 py-1.5 backdrop-blur">
        <span className="text-[8.5px] font-extrabold tracking-[0.18em]" style={{ color: C.gold }}>
          ◎ 3EL INDICATOR
        </span>
        <span
          className="rounded px-1 py-[1px] text-[7.5px] font-extrabold tracking-wider"
          style={{ background: "rgba(233,185,78,0.16)", color: C.gold }}
        >
          {shown.length > 1 ? "SUP + RES ARMED" : shown.length === 1 ? "CURRENT SIGNAL" : "SCANNING"}
        </span>
      </div>

      {/* C3 forming banner */}
      {best && (
        <div
          aria-label="C3 forming on live candle"
          className="animate-pulse rounded-lg border px-2 py-1.5 text-center text-[9px] font-extrabold tracking-[0.14em] backdrop-blur"
          style={{ borderColor: "rgba(233,185,78,0.65)", background: "rgba(233,185,78,0.16)", color: C.gold }}
        >
          C3 {best.stage === "retest" ? "RETEST · FIRE IMMINENT" : best.stage === "break" ? "BREAKING WICK LINE" : "AT WICK LINE"} {best.side === -1 ? "▼ SELL SETUP" : "▲ BUY SETUP"}
        </div>
      )}

      {/* open position card — TradingView position-tool style */}
      {trade && (
        <div className="rounded-lg border bg-[#021229]/92 backdrop-blur" style={{ borderColor: sideColor(trade.dir, "0.55") }}>
          <div
            className="flex items-center gap-1.5 rounded-t-lg px-2 py-1"
            style={{ background: sideColor(trade.dir, "0.2") }}
          >
            <span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: sideColor(trade.dir, "1") }}>
              {trade.dir === -1 ? "▼ SELL POSITION" : "▲ BUY POSITION"}
            </span>
            <span
              className="ml-auto animate-pulse rounded px-1 py-[1px] text-[7px] font-extrabold tracking-widest"
              style={{ background: sideColor(trade.dir, "0.28"), color: sideColor(trade.dir, "1") }}
            >
              OPEN
            </span>
          </div>
          <div className="space-y-0.5 px-2 py-1.5 text-[9.5px] font-bold tabular-nums">
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8AA2C2]">ENTRY</span>
              <span className="text-[#EAF3FF]">{fmtPx(trade.entry, mintick)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8AA2C2]">SL</span>
              <span style={{ color: C.red }}>
                {fmtPx(trade.sl, mintick)} <span className="text-[8px]">−{trade.riskPips.toFixed(1)}p</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8AA2C2]">TP</span>
              <span style={{ color: C.green }}>
                {fmtPx(trade.tp, mintick)} <span className="text-[8px]">+{trade.rewardPips.toFixed(1)}p</span>
              </span>
            </div>
          </div>
          {/* risk : reward split bar (position tool proportions) */}
          <div className="px-2 pb-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-[#07203F]">
              <div
                style={{
                  width: `${(trade.riskPips / Math.max(1e-9, trade.riskPips + trade.rewardPips)) * 100}%`,
                  background: C.red,
                }}
              />
              <div
                style={{
                  width: `${(trade.rewardPips / Math.max(1e-9, trade.riskPips + trade.rewardPips)) * 100}%`,
                  background: C.green,
                }}
              />
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[7.5px] font-bold tracking-wider text-[#8AA2C2]">
              <span>RISK {trade.riskPips.toFixed(0)}p</span>
              <span style={{ color: C.gold }}>
                R:R 1:{(trade.rewardPips / Math.max(1e-9, trade.riskPips)).toFixed(1)}
              </span>
              <span>REWARD {trade.rewardPips.toFixed(0)}p</span>
            </div>
          </div>
        </div>
      )}

      {/* fresh level rows */}
      {shown.map((d) => {
        const stage = formMap.get(d.id);
        const trigDist = ref > 0 ? ((d.side === -1 ? d.ext - ref : ref - d.ext) / pip) : NaN;
        return (
          <div
            key={d.id}
            className="rounded-lg border bg-[#021229]/92 px-2 py-1.5 backdrop-blur"
            style={{ borderColor: stage ? "rgba(233,185,78,0.55)" : sideColor(d.side, "0.4") }}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-[3px] rounded" style={{ background: sideColor(d.side, "0.95") }} />
              <span className="text-[8.5px] font-extrabold tracking-[0.12em]" style={{ color: sideColor(d.side, "1") }}>
                {d.side === -1 ? "RESISTANCE" : "SUPPORT"}
              </span>
              <span className="ml-auto text-[7px] font-bold tracking-[0.18em] text-[#8AA2C2]">C1/C2 EQ</span>
            </div>
            <div className="mt-0.5 pl-[9px] text-[10px] font-bold tabular-nums text-[#EAF3FF]">
              {fmtPx(d.bot, mintick)} <span className="text-[#51678A]">–</span> {fmtPx(d.top, mintick)}
            </div>
            <div className="mt-0.5 flex items-center justify-between pl-[9px] text-[9px] font-bold tabular-nums">
              <span className="tracking-[0.14em] text-[#8AA2C2]">DOTTED TRIG</span>
              <span style={{ color: C.gold }}>{fmtPx(d.ext, mintick)}</span>
            </div>
            <div className="mt-1 pl-[9px]">
              {stage ? (
                <span
                  className="animate-pulse rounded px-1 py-[1px] text-[7.5px] font-extrabold tracking-widest"
                  style={{ background: "rgba(233,185,78,0.2)", color: C.gold }}
                >
                  C3 {stage === "retest" ? "RETEST · FIRE IMMINENT" : stage === "break" ? "BREAKING WICK LINE" : "AT WICK LINE"}
                </span>
              ) : (
                <span className="text-[7.5px] font-bold tracking-widest text-[#8AA2C2]">
                  C3 WATCH · {isFinite(trigDist) ? `${Math.max(0, trigDist).toFixed(1)}p TO TRIG` : "—"}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* idle hint */}
      {levels.length === 0 && !trade && (
        <div className="rounded-lg border border-[#0F2E58] bg-[#021229]/92 px-2 py-1.5 text-center text-[8.5px] font-bold tracking-[0.14em] text-[#8AA2C2] backdrop-blur">
          SCANNING FOR C1 / C2…
        </div>
      )}
    </div>
  );
}
