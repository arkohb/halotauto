"use client";

// ════════════════════════════════════════════════════════════════════════
//  MARKET PULSE · live instrument card (top-left of the dashboard)
//  Every figure is real: feed price, loaded-window change (computed from
//  the polled candles), ATR, session clock (UTC math), feed telemetry.
// ════════════════════════════════════════════════════════════════════════

import { C, decimalsOf, fmtPx, type BotStateRes } from "@/lib/halo/ui-helpers";
import type { Candle } from "@/lib/halo/types";
import { getSymbolMeta } from "@/lib/market-symbols";
import { PanelCard } from "./panel";
import { Gauge } from "lucide-react";

/** Active FX/metal sessions for the current UTC instant (factual clock math). */
function activeSessions(now: Date): string[] {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const out: string[] = [];
  if (h >= 0 && h < 9) out.push("Tokyo");
  if (h >= 7 && h < 16) out.push("London");
  if (h >= 12 && h < 21) out.push("New York");
  if (h >= 21 || h < 6) out.push("Sydney");
  return out;
}

export function MarketPulse({ state, candles }: { state: BotStateRes; candles: Candle[] }) {
  const meta = getSymbolMeta(state.symbol);
  const name = meta.label.split("·")[0].trim() || state.symbol;
  const dec = decimalsOf(state.mintick);
  const price = state.feed.price;

  // window change — honestly labelled as the loaded window, not a daily stat
  let chg: number | null = null;
  let chgPct: number | null = null;
  if (candles.length >= 2 && price > 0) {
    const base = candles[0].close;
    chg = price - base;
    chgPct = base > 0 ? (chg / base) * 100 : null;
  }

  const age = state.feed.lastTickAt ? Math.round((Date.now() - state.feed.lastTickAt) / 1000) : null;
  const fresh = age !== null && age < 30;
  const sessions = activeSessions(new Date());
  const atr = state.engine.atr;

  return (
    <PanelCard
      title={`${name} · LIVE`}
      icon={Gauge}
      accent="gold"
      right={
        <span
          className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
          style={{
            background: fresh ? "rgba(8,153,129,0.12)" : "rgba(212,175,55,0.12)",
            color: fresh ? C.green : C.gold,
          }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: fresh ? C.green : C.gold }} />
          {state.feed.source.toUpperCase()}
        </span>
      }
    >
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-end gap-2.5">
          <span className="font-mono text-[30px] font-bold leading-none tracking-tight text-[#F5D778]" style={{ textShadow: "0 0 22px rgba(212,175,55,0.30)" }}>
            {price > 0 ? fmtPx(price, state.mintick) : "—"}
          </span>
          {chg !== null && chgPct !== null && (
            <span
              className="mb-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
              style={{
                background: chg >= 0 ? "rgba(8,153,129,0.14)" : "rgba(242,54,69,0.14)",
                color: chg >= 0 ? C.green : C.red,
              }}
            >
              {chg >= 0 ? "+" : "−"}
              {Math.abs(chg ?? 0).toFixed(dec)} ({chgPct >= 0 ? "+" : "−"}
              {Math.abs(chgPct).toFixed(2)}%)
            </span>
          )}
        </div>
        <div className="text-[8.5px] font-medium tracking-wide text-[#6B7A94]">
          change over loaded {state.tf} window · {candles.length} bars
        </div>

        <div className="mt-auto grid grid-cols-3 gap-1.5">
          <MiniStat label="ATR" value={atr !== null ? atr.toFixed(dec) : "—"} />
          <MiniStat label="SESSION" value={sessions.length > 0 ? sessions.join(" · ") : "Closed"} small />
          <MiniStat label="FEED AGE" value={age !== null ? `${age}s` : "—"} color={fresh ? C.green : C.gold} />
        </div>

        <div className="flex items-center justify-between border-t border-[#16263F]/70 pt-1.5 text-[9px] font-mono text-[#6B7A94]">
          <span>
            {state.symbol} · {state.tf}
          </span>
          <span>
            BOOK <span style={{ color: state.feed.realizedPips >= 0 ? C.green : C.red }}>{state.feed.realizedPips >= 0 ? "+" : "−"}{Math.abs(state.feed.realizedPips).toFixed(1)}</span> PIPS
          </span>
        </div>
      </div>
    </PanelCard>
  );
}

function MiniStat({ label, value, color, small }: { label: string; value: string; color?: string; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#16263F] bg-[#0B1426]/70 px-2 py-1.5">
      <div className="truncate text-[7.5px] font-bold uppercase tracking-[0.16em] text-[#6B7A94]">{label}</div>
      <div className={`truncate font-mono font-bold ${small ? "text-[9.5px]" : "text-[11.5px]"}`} style={{ color: color ?? C.txt }}>
        {value}
      </div>
    </div>
  );
}
