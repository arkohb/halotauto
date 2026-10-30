"use client";

// ════════════════════════════════════════════════════════════════════════
//  MARKET CONDITIONS + 3EL SETUP · mockup 02 right-rail cards
//  Every figure is real:
//   • Trend       — SMA-20 slope of the loaded candle window (computed here)
//   • Volatility  — engine ATR vs the window's own ATR (candle math)
//   • Session     — factual UTC clock math
//   • Next news   — live ForexFactory calendar feed (first upcoming event)
//   • 3EL setup   — genuine engine snapshot: armed levels, trigger distance,
//                   signal mode, phase. No invented percentage score.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, CalendarClock } from "lucide-react";
import { A, C, decimalsOf, fmtPx, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import type { Candle } from "@/lib/halo/types";
import { PanelCard } from "./panel";

interface CalEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

function activeSessions(now: Date): string[] {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const out: string[] = [];
  if (h >= 0 && h < 9) out.push("Tokyo");
  if (h >= 7 && h < 16) out.push("London");
  if (h >= 12 && h < 21) out.push("New York");
  if (h >= 21 || h < 6) out.push("Sydney");
  return out;
}

/** window SMA series (period p) — real math on the polled candles */
function sma(data: Candle[], p: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= p) sum -= data[i - p].close;
    if (i >= p - 1) out.push(sum / p);
  }
  return out;
}

/** window ATR series (Wilder-free, simple true-range mean over p) */
function atrOf(data: Candle[], p = 14): number | null {
  if (data.length < p + 1) return null;
  let sum = 0;
  for (let i = data.length - p; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    sum += tr;
  }
  return sum / p;
}

export function MarketConditions({ state, candles }: { state: BotStateRes; candles: Candle[] }) {
  const dec = decimalsOf(state.mintick);
  const [nextNews, setNextNews] = useState<{ title: string; at: string; impact: string } | null>(null);
  const [newsErr, setNewsErr] = useState(false);

  // live ForexFactory feed — first upcoming event today/this week
  useEffect(() => {
    let alive = true;
    const load = (day: "today" | "this_week") => {
      fetch(`/api/intel/calendar?day=${day}&impact=high&currency=ALL`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { events?: CalEvent[] }) => {
          if (!alive) return;
          const now = Date.now();
          const hit = (j.events ?? []).find((e) => {
            const t = e.date ? new Date(e.date).getTime() : 0;
            return t > now;
          });
          if (hit && hit.title) {
            const d = hit.date ? new Date(hit.date) : null;
            setNextNews({
              title: `${hit.country ?? ""} ${hit.title}`.trim(),
              at: d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—",
              impact: hit.impact ?? "High",
            });
            setNewsErr(false);
          } else if (day === "today") {
            load("this_week"); // nothing left today — try the rest of the week
          } else {
            setNextNews(null);
          }
        })
        .catch(() => {
          if (alive && day === "this_week") setNewsErr(true);
          else if (alive && day === "today") load("this_week");
        });
    };
    load("today");
    return () => {
      alive = false;
    };
  }, []);

  // ── real window analytics ────────────────────────────────────────────
  const an = useMemo(() => {
    if (candles.length < 25) return { trend: null as string | null, trendUp: null as boolean | null, vol: null as string | null, volUp: null as boolean | null };
    const s = sma(candles, 20);
    // slope of the last 5 SMA points as a fraction of ATR — honest trend label
    const recent = s.slice(-5);
    const slope = recent.length >= 2 ? recent[recent.length - 1] - recent[0] : 0;
    const atr = atrOf(candles, 14) ?? 1;
    const atrRef = atrOf(candles.slice(0, Math.floor(candles.length / 2)), 14);
    const slopeAtr = slope / atr;
    const trend = slopeAtr > 0.35 ? "Bullish" : slopeAtr < -0.35 ? "Bearish" : "Ranging";
    const volRatio = atrRef && atrRef > 0 ? atr / atrRef : null;
    const vol = volRatio === null ? null : volRatio > 1.25 ? "Elevated" : volRatio < 0.75 ? "Quiet" : "Normal";
    return { trend, trendUp: trend === "Bullish" ? true : trend === "Bearish" ? false : null, vol, volUp: volRatio !== null && volRatio > 1.25 };
  }, [candles]);

  const sessions = activeSessions(new Date());
  const st = statusOf(state);
  const levels = state.engine.levels;
  const nearest = useMemo(() => {
    // closest armed trigger distance in pips (real engine level ext / dotted line)
    const price = state.feed.price;
    if (!price || levels.length === 0) return null;
    let best: number | null = null;
    for (const l of levels) {
      const d = Math.abs(price - l.ext) / (state.mintick * state.config.pipMult);
      if (best === null || d < best) best = d;
    }
    return best;
  }, [levels, state.feed.price, state.mintick, state.config.pipMult]);

  return (
    <>
      <PanelCard title="MARKET CONDITIONS" icon={CalendarClock} accent="cyan" bodyClassName="flex flex-col gap-1.5 p-3">
        <CondRow label="Trend" value={an.trend ?? "—"} tone={an.trendUp === null ? undefined : an.trendUp ? C.green : an.trendUp === false && an.trend === "Bearish" ? C.red : C.gold} sub="SMA-20 slope · loaded window" />
        <CondRow label="Volatility" value={an.vol ?? "—"} tone={an.volUp === true ? C.red : an.vol === "Quiet" ? C.label : C.txt} sub={state.engine.atr !== null ? `ATR ${state.engine.atr.toFixed(dec)}` : "ATR —"} />
        <CondRow label="Session" value={sessions.length > 0 ? sessions.join(" · ") : "Closed"} tone={sessions.length > 0 ? C.cyan : C.label} sub="UTC clock" />
        <CondRow
          label="Next news"
          value={newsErr ? "feed offline" : nextNews ? nextNews.title : "—"}
          tone={newsErr ? C.label : C.gold}
          sub={nextNews ? `${nextNews.at} UTC · ${nextNews.impact} impact` : "ForexFactory high impact"}
          truncate
        />
      </PanelCard>

      <PanelCard title="3EL SETUP STATE" icon={BrainCircuit} accent="gold" bodyClassName="flex flex-col gap-1.5 p-3">
        <CondRow label="Phase" value={st.text} tone={st.tone === "runBuy" || st.tone === "enterBuy" ? C.green : st.tone === "runSell" || st.tone === "enterSell" ? C.red : C.cyan} sub="strategy engine" truncate />
        <CondRow label="Armed levels" value={levels.length > 0 ? `${levels.length} active` : "none"} tone={levels.length > 0 ? C.gold : C.label} sub={levels.length > 0 ? `${levels.filter((l) => l.side === 1).length} buy · ${levels.filter((l) => l.side === -1).length} sell` : "C1/C2 scanning"} />
        <CondRow label="C3 trigger" value={nearest !== null ? `${nearest.toFixed(0)} pips` : "—"} tone={nearest !== null && nearest < 20 ? C.cyan : C.txt} sub="nearest dotted wick line" />
        <CondRow label="Signal mode" value={state.config.sigMode === "instant" ? "INSTANT" : "BAR CLOSE"} tone={C.txt} sub={`SL ${state.config.slMode} · RR 1:${state.config.rrMult}`} />
      </PanelCard>
    </>
  );
}

function CondRow({
  label,
  value,
  tone,
  sub,
  truncate,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b pb-1.5 last:border-b-0 last:pb-0" style={{ borderColor: C.divider }}>
      <div className="min-w-0">
        <div className="text-[7.5px] font-bold uppercase tracking-[0.16em]" style={{ color: C.label }}>{label}</div>
        {sub && <div className="truncate text-[8px]" style={{ color: C.muted }}>{sub}</div>}
      </div>
      <div
        className={`shrink-0 text-right font-mono text-[10px] font-bold ${truncate ? "max-w-[130px] truncate" : ""}`}
        style={{ color: tone ?? C.txt }}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}
