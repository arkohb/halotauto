"use client";

import { C, fmtPx, runPips, statusOf, toneClasses, type BotStateRes, openTrade } from "@/lib/halo/ui-helpers";
import { isLiveFor, useLivePrice } from "@/lib/halo/live-price";

export function StatusBanner({ state }: { state: BotStateRes }) {
  const { text, tone } = statusOf(state);
  const { bg, fg } = toneClasses(tone);
  const t = openTrade(state);
  const rp = runPips(state);
  const pulse = tone === "enterSell" || tone === "enterBuy";
  // the chart's live tick (same price, same basis as the candle) — the state
  // poll trails it by seconds and stays only as the fallback
  const live = useLivePrice();
  const px = isLiveFor(live, state.symbol) ? live.px : state.feed.price;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3"
      style={{ background: bg, borderColor: C.line }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {pulse && <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: fg }} />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: fg }} />
        </span>}
        <span className="text-sm sm:text-base font-bold tracking-wide truncate" style={{ color: fg }}>
          {text}
        </span>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono text-sm sm:text-base font-semibold" style={{ color: fg }}>
          {px ? fmtPx(px, state.mintick) : "—"}
        </div>
        {t && rp !== null && (
          <div className="text-[11px] font-mono" style={{ color: rp >= 0 ? C.green : C.red }}>
            run {rp >= 0 ? "+" : "−"}
            {Math.abs(rp).toFixed(1)} pips
          </div>
        )}
      </div>
    </div>
  );
}
