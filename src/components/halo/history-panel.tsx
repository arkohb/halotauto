"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { A, C, fmtPx } from "@/lib/halo/ui-helpers";
import { StateFrame } from "./panel";
import type { HistoryPeriod } from "@/lib/halo/actions";

interface TradeRow {
  id: string;
  symbol: string;
  timeframe: string;
  direction: number;
  entry: number;
  sl: number;
  tp: number;
  riskPips: number;
  rewardPips: number;
  status: string;
  resultPips: number | null;
  openedAt: string;
  closedAt: string | null;
}

interface Props {
  mintick: number;
  refreshKey: number; // bump to force refresh (e.g. when stats change)
  /** optional display filter (voice operator) — pure client-side, changes nothing on any broker */
  filter?: HistoryPeriod;
}

const FILTER_LABEL: Record<HistoryPeriod, string> = {
  today: "TODAY",
  week: "THIS WEEK",
  month: "THIS MONTH",
  all: "",
};

export function HistoryPanel({ mintick, refreshKey, filter = "all" }: Props) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  // honest-state: set only by the existing fetch catch, cleared when data arrives
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/trades?limit=60", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { trades: TradeRow[] };
        setTrades(j.trades ?? []);
        setErr(false);
      }
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 6000);
    return () => clearInterval(id);
  }, [load, refreshKey]);

  // period filter (display only) — computed from real openedAt timestamps
  const startOf = (period: HistoryPeriod): number | null => {
    if (period === "all") return null;
    const d = new Date();
    if (period === "today") {
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (period === "week") {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - 6);
      return d.getTime();
    }
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const filtered = filter === "all" ? trades : trades.filter((t) => new Date(t.openedAt).getTime() >= (startOf(filter) ?? 0));

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: C.line, background: C.navy4 }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: C.line }}>
        <span className="text-xs font-bold tracking-wider" style={{ color: C.txt }}>
          TRADE HISTORY · BOT{FILTER_LABEL[filter] ? <span className="ml-2 rounded px-1.5 py-0.5 text-[9px]" style={{ background: A.gold(0.12), color: C.gold }}>FILTER · {FILTER_LABEL[filter]}</span> : null}
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] hover:text-[#EAF3FF]" style={{ color: C.muted }} onClick={() => void load()}>
          refresh
        </Button>
      </div>
      {loading ? (
        <StateFrame state="loading" title="Loading trades…" compact className="m-3" />
      ) : err && trades.length === 0 ? (
        <StateFrame state="error" title="Could not load trade history" onRetry={() => void load()} compact className="m-3" />
      ) : trades.length === 0 ? (
        <StateFrame
          state="empty"
          title="No bot trades yet"
          hint="Start the EA — every C3 fire will be logged here with its SL/TP result."
          className="m-3"
        />
      ) : filtered.length === 0 ? (
        <StateFrame
          state="empty"
          title="No trades in the selected period"
          hint="Clear the filter to see the full book."
          className="m-3"
        />
      ) : (
        <div className="halo-scroll max-h-72 overflow-auto">
          <table className="w-full min-w-[560px] text-[11px]">
            <thead className="sticky top-0" style={{ background: C.navy2 }}>
              <tr className="text-[10px] tracking-wider" style={{ color: C.muted }}>
                <th className="text-left font-medium px-3 py-1.5">TIME</th>
                <th className="text-left font-medium px-2 py-1.5">DIR</th>
                <th className="text-right font-medium px-2 py-1.5">ENTRY</th>
                <th className="text-right font-medium px-2 py-1.5">R:R</th>
                <th className="text-right font-medium px-2 py-1.5">RESULT</th>
                <th className="text-right font-medium px-3 py-1.5">STATE</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: C.divider }}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono" style={{ color: C.muted }}>
                    {new Date(t.openedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="font-bold" style={{ color: t.direction === -1 ? C.red : C.green }}>
                      {t.direction === -1 ? "SELL" : "BUY"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: C.txt }}>{fmtPx(t.entry, mintick)}</td>
                  <td className="px-2 py-1.5 text-right font-mono" style={{ color: C.muted }}>1:{t.rewardPips > 0 && t.riskPips > 0 ? (t.rewardPips / t.riskPips).toFixed(1) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: t.status === "WIN" ? C.green : t.status === "LOSS" ? C.red : C.muted }}>
                    {t.resultPips === null ? "—" : `${t.resultPips >= 0 ? "+" : "−"}${Math.abs(t.resultPips).toFixed(1)}p`}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: t.status === "WIN" ? A.green(0.15) : t.status === "LOSS" ? A.red(0.15) : "rgba(140,152,174,0.15)", color: t.status === "WIN" ? C.green : t.status === "LOSS" ? C.red : C.muted }}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
