"use client";

// ════════════════════════════════════════════════════════════════════════
//  CANDLE TIMER · countdown to the current candle's close
//
//  The free TradingView embed is a cross-origin iframe — its own bar-close
//  countdown cannot be switched on from outside, so the timer is drawn as
//  a HALO overlay badge that sits on the chart (bottom-right) in BOTH
//  chart engines:
//   • TV WEB            — TradingView Advanced Chart widget
//   • TRADINGVIEW · 3EL — lightweight-charts (TradingView's chart engine)
//
//  Precision: when the live bar's open time is known (the app's own feed
//  drives both views) the countdown is EXACT — close = open + timeframe.
//  Without a bar reference it falls back to UTC-clock alignment, which is
//  exact for the UTC-aligned Binance / OANDA bars this app trades.
//
//  The last 10 seconds turn gold and pulse — the "new bar about to print"
//  cue traders watch for.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { tfSec } from "@/lib/market-symbols";

interface CandleTimerProps {
  /** chart timeframe, e.g. "5m" · "1h" · "1d" */
  tf: string;
  /** open time (ms epoch) of the current live bar — exact countdown when present */
  barOpenTime?: number | null;
}

/** ms epoch of the moment the current bar closes. */
function nextBarClose(tf: string, barOpenTime: number | null | undefined, now: number): number {
  const ms = Math.max(1, tfSec(tf)) * 1000;
  if (barOpenTime && barOpenTime > 0 && barOpenTime <= now) {
    const close = barOpenTime + ms;
    if (close > now) return close;
  }
  // fallback: align to the UTC clock grid (Binance / OANDA bars are UTC-aligned)
  if (tf === "1w") {
    const d = new Date(now);
    const daysToMonday = (8 - d.getUTCDay()) % 7 || 7; // weeks open Monday 00:00 UTC
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToMonday);
  }
  return (Math.floor(now / ms) + 1) * ms;
}

function fmtRemaining(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${two(h)}:${two(m)}:${two(sec)}`;
  if (h > 0) return `${two(h)}:${two(m)}:${two(sec)}`;
  return `${two(m)}:${two(sec)}`;
}

export function CandleTimer({ tf, barOpenTime }: CandleTimerProps) {
  // null until mounted — keeps SSR markup stable (no hydration mismatch)
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // first tick deferred to a macrotask — keeps the effect body synchronous-free
    const t0 = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, []);

  const ms = Math.max(1, tfSec(tf)) * 1000;
  const t = now ?? 0;
  const close = nextBarClose(tf, barOpenTime, t);
  const left = now === null ? ms : Math.max(0, close - t);
  const progress = Math.min(1, Math.max(0, 1 - left / ms));
  const urgent = now !== null && left > 0 && left <= 10_000;

  return (
    <div
      role="timer"
      aria-label="Time until the current candle closes"
      title="Candle timer — time left until this candle closes"
      className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 w-[118px] select-none rounded-lg border border-[#1C2A47] bg-[#0F1A30]/92 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1">
          {/* mini candle icon */}
          <svg width="8" height="13" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0">
            <line x1="5" y1="0.5" x2="5" y2="3.5" stroke="#D4AF37" strokeWidth="1.2" />
            <rect x="1.5" y="3.5" width="7" height="7" rx="0.8" fill="#D4AF37" opacity="0.9" />
            <line x1="5" y1="10.5" x2="5" y2="13.5" stroke="#D4AF37" strokeWidth="1.2" />
          </svg>
          <span className="text-[8px] font-extrabold uppercase tracking-[0.16em] text-[#8C98AE]">Close</span>
        </span>
        <span
          className={`font-mono text-[12px] font-bold leading-none tabular-nums ${urgent ? "animate-pulse" : ""}`}
          style={{ color: urgent ? "#D4AF37" : "#E8ECF4" }}
        >
          {now === null ? "--:--" : fmtRemaining(left)}
        </span>
      </div>
      {/* bar progress — how far this candle has printed */}
      <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-[#1C2A47]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${now === null ? 0 : progress * 100}%`,
            background: "linear-gradient(90deg, rgba(212,175,55,0.35), #D4AF37)",
          }}
        />
      </div>
    </div>
  );
}
