"use client";

// ════════════════════════════════════════════════════════════════════════
//  3EL INDICATOR RAIL · the indicator ATTACHED to the TradingView chart
//  The Advanced Chart widget is a cross-origin iframe — custom drawings
//  cannot be injected inside it. So the 3EL indicator attaches as a live
//  legend rail floating over the chart: the CURRENT C1/C2 equal level (old
//  signals are never shown — the rail follows the same single signal the
//  EA acts on), the C3 forming tracker and the open position's ENTRY / SL /
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
  // CURRENT SIGNAL ONLY — the newest fresh level is the one the EA follows;
  // older levels are never rendered, keeping the chart clean.
  const current = [...levels].sort((a, b) => b.b2Time - a.b2Time)[0] ?? null;
  const shown = current ? [current] : [];

  return (
    <div
      aria-label="3EL indicator overlay attached to TradingView chart"
      className={`pointer-events-none absolute top-10 z-10 flex w-[192px] flex-col gap-1.5 xl:w-[214px] ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {/* header chip */}
      <div className="flex items-center justify-between rounded-lg border border-[#2A3A5C] bg-[#0F1A30]/92 px-2 py-1.5 backdrop-blur">
        <span className="text-[8.5px] font-extrabold tracking-[0.18em]" style={{ color: C.gold }}>
          ◎ 3EL INDICATOR
        </span>
        <span
          className="rounded px-1 py-[1px] text-[7.5px] font-extrabold tracking-wider"
          style={{ background: "rgba(212,175,55,0.16)", color: C.gold }}
        >
          {current ? "CURRENT SIGNAL" : "SCANNING"}
        </span>
      </div>

      {/* C3 forming banner */}
      {best && (
        <div
          aria-label="C3 forming on live candle"
          className="animate-pulse rounded-lg border px-2 py-1.5 text-center text-[9px] font-extrabold tracking-[0.14em] backdrop-blur"
          style={{ borderColor: "rgba(212,175,55,0.65)", background: "rgba(212,175,55,0.16)", color: C.gold }}
        >
          C3 FORMING {best.side === -1 ? "▼ SELL SETUP" : "▲ BUY SETUP"}
          {best.stage === "through" ? " · WICK IN RANGE" : ""}
        </div>
      )}

      {/* open position card — TradingView position-tool style */}
      {trade && (
        <div className="rounded-lg border bg-[#0F1A30]/92 backdrop-blur" style={{ borderColor: sideColor(trade.dir, "0.55") }}>
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
              <span className="tracking-wider text-[#8C98AE]">ENTRY</span>
              <span className="text-[#E8ECF4]">{fmtPx(trade.entry, mintick)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8C98AE]">SL</span>
              <span style={{ color: C.red }}>
                {fmtPx(trade.sl, mintick)} <span className="text-[8px]">−{trade.riskPips.toFixed(1)}p</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="tracking-wider text-[#8C98AE]">TP</span>
              <span style={{ color: C.green }}>
                {fmtPx(trade.tp, mintick)} <span className="text-[8px]">+{trade.rewardPips.toFixed(1)}p</span>
              </span>
            </div>
          </div>
          {/* risk : reward split bar (position tool proportions) */}
          <div className="px-2 pb-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-[#16233D]">
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
            <div className="mt-0.5 flex items-center justify-between text-[7.5px] font-bold tracking-wider text-[#8C98AE]">
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
        const dist = ref > 0 ? Math.abs(d.side === -1 ? ref - d.top : d.bot - ref) / pip : NaN;
        return (
          <div
            key={d.id}
            className="rounded-lg border bg-[#0F1A30]/92 px-2 py-1.5 backdrop-blur"
            style={{ borderColor: stage ? "rgba(212,175,55,0.55)" : sideColor(d.side, "0.4") }}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-[3px] rounded" style={{ background: sideColor(d.side, "0.95") }} />
              <span className="text-[8.5px] font-extrabold tracking-[0.12em]" style={{ color: sideColor(d.side, "1") }}>
                {d.side === -1 ? "RESISTANCE" : "SUPPORT"}
              </span>
              <span className="ml-auto text-[7px] font-bold tracking-[0.18em] text-[#8C98AE]">C1/C2 EQ</span>
            </div>
            <div className="mt-0.5 pl-[9px] text-[10px] font-bold tabular-nums text-[#E8ECF4]">
              {fmtPx(d.bot, mintick)} <span className="text-[#5D606B]">–</span> {fmtPx(d.top, mintick)}
            </div>
            <div className="mt-1 pl-[9px]">
              {stage ? (
                <span
                  className="animate-pulse rounded px-1 py-[1px] text-[7.5px] font-extrabold tracking-widest"
                  style={{ background: "rgba(212,175,55,0.2)", color: C.gold }}
                >
                  C3 FORMING{stage === "through" ? " · IN RANGE" : ""}
                </span>
              ) : (
                <span className="text-[7.5px] font-bold tracking-widest text-[#8C98AE]">
                  C3 WATCH · {isFinite(dist) ? `${dist.toFixed(1)}p TO LINE` : "—"}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* idle hint */}
      {levels.length === 0 && !trade && (
        <div className="rounded-lg border border-[#1C2A47] bg-[#0F1A30]/92 px-2 py-1.5 text-center text-[8.5px] font-bold tracking-[0.14em] text-[#8C98AE] backdrop-blur">
          SCANNING FOR C1 / C2…
        </div>
      )}
    </div>
  );
}
