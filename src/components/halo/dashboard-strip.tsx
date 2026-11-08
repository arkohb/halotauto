"use client";

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD STRIP · the mockup's bottom row
//    LatestSignal   — the engine's live posture: an open trade (entry/SL/TP)
//                     or the nearest armed level. Straight from BotStateRes.
//    MonitorStatus  — the genuine engine state line (statusOf()).
//    RecentTrades   — the newest closed trades from the DB trade book.
//  Nothing here is invented — when the engine is flat and scanning, the
//  signal card says exactly that.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Activity, Crosshair, Radar } from "lucide-react";
import { A, C, decimalsOf, fmtPips, fmtPx, signedPips, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard, Pill, StateFrame } from "./panel";

/* ───────────────────────── latest signal ───────────────────────── */
export function LatestSignal({ state }: { state: BotStateRes }) {
  const t = state.engine.trade;
  const levels = state.engine.levels;
  const dec = decimalsOf(state.mintick);
  const active = state.enabled;

  const badge = t
    ? { text: t.dir === -1 ? "SELL" : "BUY", color: t.dir === -1 ? C.red : C.green }
    : levels.length > 0
      ? { text: "ARMED", color: C.warn }
      : { text: "SCAN", color: C.cyan };

  return (
    <PanelCard title="LATEST SIGNAL" icon={Crosshair} accent={t ? (t.dir === -1 ? "red" : "green") : "cyan"} className="h-full">
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded-md px-2.5 py-1 text-[12px] font-extrabold tracking-[0.08em]"
            style={{
              background: badge.color,
              color: "#03102A",
              boxShadow: `0 0 14px 0 ${badge.color}66`,
            }}
          >
            {badge.text}
          </span>
          <span className="text-[11.5px] font-bold tracking-wide" style={{ color: C.txt2 }}>
            {state.symbol} · {state.tf}
          </span>
          <span className="ml-auto">
            <Pill tone={active ? "ok" : "muted"} pulse={active}>
              {active ? "EA ON" : "EA OFF"}
            </Pill>
          </span>
        </div>

        {t ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
            <span style={{ color: C.label }}>Entry</span>
            <span className="font-bold" style={{ color: C.txt }}>{fmtPx(t.entry, state.mintick)}</span>
            <span aria-hidden style={{ color: C.dim }}>|</span>
            <span style={{ color: C.label }}>SL</span>
            <span className="font-bold" style={{ color: C.red }}>{fmtPx(t.sl, state.mintick)}</span>
            <span aria-hidden style={{ color: C.dim }}>|</span>
            <span style={{ color: C.label }}>TP</span>
            <span className="font-bold" style={{ color: C.green }}>{fmtPx(t.tp, state.mintick)}</span>
          </div>
        ) : levels.length > 0 ? (
          <div className="mt-1 font-mono text-[10.5px] leading-relaxed" style={{ color: C.txt2 }}>
            {levels.length} armed wick level{levels.length > 1 ? "s" : ""} · waiting for the C3 break —
            nearest zone{" "}
            <span className="font-bold" style={{ color: C.warn }}>
              {fmtPx(levels[0].ext, state.mintick)}
            </span>
          </div>
        ) : (
          <div className="mt-1 text-[10.5px] leading-relaxed" style={{ color: C.muted }}>
            No live signal — the engine is scanning for a fresh C1 / C2 equal-level formation on {state.symbol} {state.tf}.
          </div>
        )}

        <div className="mt-auto flex items-center justify-between border-t pt-1.5 text-[8.5px] font-mono" style={{ borderColor: C.lineInner, color: C.dim }}>
          <span>3EL v1.2 · {state.config.sigMode === "instant" ? "INSTANT" : "BAR CLOSE"}</span>
          <span>R:R 1:{state.config.rrMult.toFixed(1)}</span>
        </div>
      </div>
    </PanelCard>
  );
}

/* ───────────────────────── monitoring status ───────────────────────── */
export function MonitorStatus({ state }: { state: BotStateRes }) {
  const st = statusOf(state);
  const tone =
    st.tone === "runBuy" || st.tone === "enterBuy"
      ? { fg: C.green }
      : st.tone === "runSell" || st.tone === "enterSell"
        ? { fg: C.red }
        : st.tone === "wait"
          ? { fg: C.warn }
          : { fg: C.cyan };

  return (
    <PanelCard title="MONITORING" icon={Radar} accent="cyan" className="h-full">
      <div className="flex h-full flex-col justify-center gap-2 p-3">
        <div className="flex items-center gap-2">
          <span
            className="halo-anim-beacon inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: tone.fg, ["--beacon" as string]: `${tone.fg}77` } as React.CSSProperties}
          />
          <span className="text-[15px] font-extrabold tracking-wide" style={{ color: tone.fg, textShadow: `0 0 16px ${tone.fg}55` }}>
            {state.enabled ? "Active" : "Standby"}
          </span>
        </div>
        <p className="text-[10px] leading-relaxed" style={{ color: C.muted }}>
          {st.text.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}
        </p>
        <div className="mt-auto flex items-center justify-between font-mono text-[8.5px]" style={{ color: C.dim }}>
          <span>feed · {state.feed.source}</span>
          <span>atr · {state.engine.atr !== null ? state.engine.atr.toFixed(decimalsOf(state.mintick)) : "—"}</span>
        </div>
      </div>
    </PanelCard>
  );
}

/* ───────────────────────── recent trades ───────────────────────── */
interface TradeRow {
  id: string;
  symbol: string;
  direction: number;
  status: string;
  resultPips: number | null;
  openedAt: string;
}

export function RecentTrades({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/trades?limit=6", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { trades: TradeRow[] };
          if (alive) {
            setTrades(j.trades ?? []);
            setErr(false);
          }
        }
      } catch {
        if (alive) setErr(true);
      } finally {
        if (alive) setLoaded(true);
      }
    };
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <PanelCard
      title="RECENT TRADES"
      icon={Activity}
      accent="cyan"
      className="h-full"
      right={
        onOpenHistory ? (
          <button
            type="button"
            onClick={onOpenHistory}
            className="rounded-md border px-2 py-0.5 text-[8px] font-extrabold tracking-[0.12em] transition-colors hover:brightness-125"
            style={{ borderColor: A.cyan(0.4), color: C.cyan, background: A.cyan(0.06) }}
          >
            VIEW ALL
          </button>
        ) : undefined
      }
    >
      {!loaded ? (
        <div className="flex h-full items-center justify-center">
          <StateFrame state="loading" title="Loading book…" compact className="mx-3" />
        </div>
      ) : err && trades.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <StateFrame state="error" title="Trade book unreachable" compact className="mx-3" />
        </div>
      ) : trades.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[10.5px]" style={{ color: C.label }}>
          No closed trades yet — the first C3 fire will appear here the moment it books.
        </div>
      ) : (
        <div className="flex flex-col px-2 py-1.5">
          {trades.map((t) => {
            const win = t.status === "WIN";
            const loss = t.status === "LOSS";
            const dot = win ? C.green : loss ? C.red : C.warn;
            return (
              <div
                key={t.id}
                className="halo-row-in flex items-center gap-2 rounded-md px-1.5 py-[5px]"
                style={{ borderBottom: `1px solid ${C.divider}` }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 6px 0 ${dot}99` }} />
                <span className="w-[58px] shrink-0 truncate text-[10px] font-bold" style={{ color: C.txt2 }}>{t.symbol}</span>
                <span className="w-[30px] shrink-0 text-[9.5px] font-extrabold" style={{ color: t.direction === -1 ? C.red : C.green }}>
                  {t.direction === -1 ? "SELL" : "BUY"}
                </span>
                <span
                  className="ml-auto font-mono text-[10px] font-bold tabular-nums"
                  style={{ color: t.resultPips == null ? C.dim : win ? C.green : loss ? C.red : C.txt2 }}
                >
                  {t.resultPips == null ? "OPEN" : `${fmtPips(signedPips(t.status, t.resultPips))}p`}
                </span>
                <span className="w-[34px] shrink-0 text-right font-mono text-[8.5px]" style={{ color: C.dim }}>
                  {new Date(t.openedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}
