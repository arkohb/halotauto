"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { C, fmtPx } from "@/lib/halo/ui-helpers";

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
}

export function HistoryPanel({ mintick, refreshKey }: Props) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/trades?limit=60", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { trades: TradeRow[] };
        setTrades(j.trades ?? []);
      }
    } catch {
      // ignore
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

  return (
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C2A47]">
        <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">TRADE HISTORY · BOT</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-[#8C98AE] hover:text-[#E8ECF4]" onClick={() => void load()}>
          refresh
        </Button>
      </div>
      {loading ? (
        <div className="px-4 py-4 text-xs text-[#8C98AE]">Loading trades…</div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-4 text-xs text-[#8C98AE]">
          No bot trades yet. Start the EA — every C3 fire will be logged here with its SL/TP result.
        </div>
      ) : (
        <ScrollArea className="max-h-72">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[#101C33]">
              <tr className="text-[10px] tracking-wider text-[#8C98AE]">
                <th className="text-left font-medium px-3 py-1.5">TIME</th>
                <th className="text-left font-medium px-2 py-1.5">DIR</th>
                <th className="text-right font-medium px-2 py-1.5">ENTRY</th>
                <th className="text-right font-medium px-2 py-1.5">R:R</th>
                <th className="text-right font-medium px-2 py-1.5">RESULT</th>
                <th className="text-right font-medium px-3 py-1.5">STATE</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-[#121D35]">
                  <td className="px-3 py-1.5 font-mono text-[#8C98AE]">
                    {new Date(t.openedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="font-bold" style={{ color: t.direction === -1 ? C.red : C.green }}>
                      {t.direction === -1 ? "SELL" : "BUY"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[#E8ECF4]">{fmtPx(t.entry, mintick)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-[#8C98AE]">1:{t.rewardPips > 0 && t.riskPips > 0 ? (t.rewardPips / t.riskPips).toFixed(1) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold" style={{ color: t.status === "WIN" ? C.green : t.status === "LOSS" ? C.red : C.muted }}>
                    {t.resultPips === null ? "—" : `${t.resultPips >= 0 ? "+" : "−"}${Math.abs(t.resultPips).toFixed(1)}p`}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: t.status === "WIN" ? "rgba(8,153,129,0.15)" : t.status === "LOSS" ? "rgba(242,54,69,0.15)" : "rgba(140,152,174,0.15)", color: t.status === "WIN" ? C.green : t.status === "LOSS" ? C.red : C.muted }}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </div>
  );
}
