"use client";

// ════════════════════════════════════════════════════════════════════════
//  PINE INDICATOR RAIL · legend for the trader's OWN compiled indicator
//
//  When a Pine strategy is attached (active) this rail replaces the
//  built-in 3EL indicator legend: the compiled script's name, its plotted
//  series (color swatch + title, exactly what the chart draws) and the
//  open position card in the same TradingView position-tool style.
//  The default 3EL indicator stays OFF the chart while a Pine strategy
//  is attached — single-indicator semantics, mirroring the single-strategy
//  trading rule.
//  ⚠ Presentation only — the live strategy runs untouched.
// ════════════════════════════════════════════════════════════════════════

import type { Side } from "@/lib/halo/types";
import { C, fmtPx, type PineOverlayInput } from "@/lib/halo/ui-helpers";

export interface PineRailPlot {
  title: string;
  color: string;
}

export interface PineRailPosition {
  dir: Side;
  entry: number;
  sl: number;
  tp: number;
  riskPips: number;
  rewardPips: number;
  /** where the trade came from when it is NOT the pine strategy's own
   *  ("SCAN" watchlist row, "SWEEP" all-pairs, "TV" webhook) — shown so
   *  the trader knows exactly which runner this card mirrors */
  label?: string;
}

interface RailProps {
  name: string;
  plots: PineRailPlot[];
  /** the indicator's input parameters with their resolved values — ALL of
   *  them, so the trader always sees the exact settings the bot trades with */
  inputs?: PineOverlayInput[];
  position: PineRailPosition | null;
  mintick: number;
  /** TV WEB embed note — plots cannot be injected into the cross-origin iframe */
  note?: string;
}

function sideColor(side: Side, alpha: string): string {
  const rgb = side === -1 ? "242,54,69" : "8,153,129";
  return `rgba(${rgb},${alpha})`;
}

export function PineIndicatorRail({ name, plots, inputs, position, mintick, note }: RailProps) {
  return (
    <div
      aria-label="Attached Pine indicator legend"
      className="pointer-events-none absolute left-2 z-10 flex w-[192px] flex-col gap-1.5 xl:w-[214px] top-[80px] sm:top-10"
    >
      {/* header chip — the trader's indicator is the one attached now */}
      <div className="flex items-center justify-between rounded-lg border border-[#1C4478] bg-[#021229]/92 px-2 py-1.5 backdrop-blur">
        <span className="truncate text-[8.5px] font-extrabold tracking-[0.18em]" style={{ color: C.green }}>
          ◎ {name.toUpperCase()}
        </span>
        <span
          className="ml-1 shrink-0 rounded px-1 py-[1px] text-[7.5px] font-extrabold tracking-wider"
          style={{ background: "rgba(0,214,143,0.16)", color: C.green }}
        >
          ATTACHED
        </span>
      </div>

      {/* open position card — same position-tool style as the 3EL rail */}
      {position && (
        <div className="rounded-lg border bg-[#021229]/92 backdrop-blur" style={{ borderColor: sideColor(position.dir, "0.55") }}>
          <div
            className="flex items-center gap-1.5 rounded-t-lg px-2 py-1"
            style={{ background: sideColor(position.dir, "0.2") }}
          >
            <span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: sideColor(position.dir, "1") }}>
              {position.dir === -1 ? "▼ SELL POSITION" : "▲ BUY POSITION"}
            </span>
            {position.label && (
              <span
                className="ml-1 rounded px-1 py-[1px] text-[7px] font-extrabold tracking-widest"
                style={{ background: "rgba(233,185,78,0.16)", color: C.gold }}
              >
                {position.label}
              </span>
            )}
            <span
              className="ml-auto animate-pulse rounded px-1 py-[1px] text-[7px] font-extrabold tracking-widest"
              style={{ background: sideColor(position.dir, "0.28"), color: sideColor(position.dir, "1") }}
            >
              OPEN
            </span>
          </div>
          <div className="space-y-0.5 px-2 py-1.5 text-[9.5px] font-bold tabular-nums">
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8AA2C2]">ENTRY</span>
              <span className="text-[#EAF3FF]">{fmtPx(position.entry, mintick)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8AA2C2]">SL</span>
              <span style={{ color: C.red }}>
                {fmtPx(position.sl, mintick)} <span className="text-[8px]">−{position.riskPips.toFixed(1)}p</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8AA2C2]">TP</span>
              <span style={{ color: C.green }}>
                {fmtPx(position.tp, mintick)} <span className="text-[8px]">+{position.rewardPips.toFixed(1)}p</span>
              </span>
            </div>
          </div>
          {/* risk : reward split bar */}
          <div className="px-2 pb-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-[#07203F]">
              <div
                style={{
                  width: `${(position.riskPips / Math.max(1e-9, position.riskPips + position.rewardPips)) * 100}%`,
                  background: C.red,
                }}
              />
              <div
                style={{
                  width: `${(position.rewardPips / Math.max(1e-9, position.riskPips + position.rewardPips)) * 100}%`,
                  background: C.green,
                }}
              />
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[7.5px] font-bold tracking-wider text-[#8AA2C2]">
              <span>RISK {position.riskPips.toFixed(0)}p</span>
              <span style={{ color: C.gold }}>
                R:R 1:{(position.rewardPips / Math.max(1e-9, position.riskPips)).toFixed(1)}
              </span>
              <span>REWARD {position.rewardPips.toFixed(0)}p</span>
            </div>
          </div>
        </div>
      )}

      {/* PARAMETERS — every input of the attached indicator with its live
          value. The trader sees the EXACT settings the bot is trading with,
          on both chart views, next to the running trade. */}
      {inputs && inputs.length > 0 && (
        <div className="rounded-lg border border-[#0F2E58] bg-[#021229]/92 px-2 py-1.5 backdrop-blur">
          <div className="mb-1 text-[7.5px] font-extrabold tracking-[0.18em] text-[#8AA2C2]">PARAMETERS</div>
          <div className="space-y-0.5">
            {inputs.slice(0, 12).map((p, i) => (
              <div key={`${p.title}-${i}`} className="flex items-center justify-between gap-2 text-[9px] font-bold tabular-nums">
                <span className="truncate tracking-wide text-[#8AA2C2]">{p.title}</span>
                <span className="shrink-0 text-[#EAF3FF]">{p.value}</span>
              </div>
            ))}
            {inputs.length > 12 && (
              <div className="pt-0.5 text-[7.5px] font-bold tracking-widest text-[#51678A]">+{inputs.length - 12} MORE</div>
            )}
          </div>
        </div>
      )}

      {/* plotted series legend — mirrors what the chart draws */}
      {plots.length > 0 && (
        <div className="rounded-lg border border-[#0F2E58] bg-[#021229]/92 px-2 py-1.5 backdrop-blur">
          <div className="mb-1 text-[7.5px] font-extrabold tracking-[0.18em] text-[#8AA2C2]">PLOTTED SERIES</div>
          <div className="space-y-1">
            {plots.slice(0, 8).map((p, i) => (
              <div key={`${p.title}-${i}`} className="flex items-center gap-1.5 text-[9.5px] font-bold text-[#EAF3FF]">
                <span className="h-[3px] w-4 shrink-0 rounded-full" style={{ background: p.color || C.cyan }} />
                <span className="truncate">{p.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TV embed note — the free widget is cross-origin */}
      {note && (
        <div className="rounded-lg border border-[#0F2E58] bg-[#021229]/92 px-2 py-1.5 text-[8px] font-bold leading-snug tracking-[0.08em] text-[#8AA2C2] backdrop-blur">
          {note}
        </div>
      )}
    </div>
  );
}
