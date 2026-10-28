"use client";

// Backtest panel — replays the exact strategy over recent history

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { C, fmtPx, fmtPips } from "@/lib/halo/ui-helpers";
import type { HaloConfig, Stats } from "@/lib/halo/types";

interface BtTrade {
  dir: number;
  entry: number;
  result: "WIN" | "LOSS" | "OPEN";
  pips: number;
  openTime: number;
  closeTime: number | null;
}

interface BtResult {
  ok: boolean;
  symbol: string;
  tf: string;
  bars: number;
  source: string;
  mintick: number;
  stats: Stats;
  trades: BtTrade[];
  curve: Array<{ t: number; pips: number }>;
  error?: string;
}

interface Props {
  symbol: string;
  tf: string;
  config: HaloConfig;
}

export function BacktestPanel({ symbol, tf, config }: Props) {
  const [bars, setBars] = useState("500");
  const [res, setRes] = useState<BtResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, tf, bars: Number(bars) || 500, cfg: config }),
      });
      const j = (await r.json()) as BtResult;
      setRes(j);
    } catch (e) {
      setRes({ ok: false, symbol, tf, bars: 0, source: "", mintick: 0.01, stats: emptyStats(), trades: [], curve: [], error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const s = res?.stats;
  const tot = s ? s.wins + s.losses : 0;
  const wr = s && tot > 0 ? (s.wins * 100) / tot : null;
  const net = s ? s.sumTP - s.sumSL : 0;

  return (
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C2A47]">
        <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">BACKTEST · BAR CLOSE</span>
        <span className="text-[10px] text-[#8C98AE]">same engine, replayed</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={bars}
            min={100}
            max={1000}
            onChange={(e) => setBars(e.target.value)}
            className="w-24 h-8 text-xs font-mono bg-[#0B1426] border-[#2A3A5C] text-[#E8ECF4]"
          />
          <span className="text-[11px] text-[#8C98AE]">bars of {symbol} · {tf}</span>
          <Button
            onClick={() => void run()}
            disabled={busy}
            className="ml-auto h-8 px-4 rounded-md text-[11px] font-bold tracking-wider bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A]"
          >
            {busy ? "REPLAYING…" : "RUN"}
          </Button>
        </div>

        {res && !res.ok && <div className="text-[11px] text-[#F23645]">Backtest failed: {res.error}</div>}

        {res && res.ok && s && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Bt label="SIGNALS" value={String(tot + (s.skipped > 0 ? 0 : 0) + (res.trades.filter((t) => t.result === "OPEN").length))} />
              <Bt label="W / L" value={`${s.wins} / ${s.losses}`} />
              <Bt label="WIN RATE" value={wr !== null ? `${wr.toFixed(0)}%` : "—"} />
              <Bt label="NET PIPS" value={fmtPips(net)} color={net >= 0 ? C.green : C.red} />
              <Bt label="BURNED" value={String(s.burned)} />
              <Bt label="SKIP · CROWD" value={`${s.skipped} · ${s.tooClose}`} />
            </div>

            {res.curve.length > 1 && <EquitySvg curve={res.curve} />}

            <div className="max-h-40 overflow-y-auto halo-scroll rounded-lg border border-[#1C2A47]">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-[#101C33] text-[#8C98AE]">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">TIME</th>
                    <th className="text-left px-2 py-1 font-medium">DIR</th>
                    <th className="text-right px-2 py-1 font-medium">ENTRY</th>
                    <th className="text-right px-2 py-1 font-medium">RESULT</th>
                  </tr>
                </thead>
                <tbody>
                  {res.trades.map((t, i) => (
                    <tr key={i} className="border-t border-[#121D35]">
                      <td className="px-2 py-1 font-mono text-[#8C98AE]">
                        {new Date(t.openTime).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-2 py-1 font-bold" style={{ color: t.dir === -1 ? C.red : C.green }}>
                        {t.dir === -1 ? "SELL" : "BUY"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[#E8ECF4]">{fmtPx(t.entry, res.mintick)}</td>
                      <td className="px-2 py-1 text-right font-mono font-bold" style={{ color: t.result === "WIN" ? C.green : t.result === "LOSS" ? C.red : C.muted }}>
                        {t.result === "OPEN" ? "OPEN" : fmtPips(t.pips)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-[#8C98AE]">
              Replay source: <span className="uppercase text-[#D4AF37]">{res.source}</span> · {res.bars} bars · fired {res.trades.length} trades
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function emptyStats(): Stats {
  return { wins: 0, losses: 0, sumTP: 0, sumSL: 0, burned: 0, skipped: 0, tooClose: 0, lastResult: { text: "—", kind: "none" } };
}

function Bt({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-2 py-1.5">
      <div className="text-[9px] tracking-wider text-[#8C98AE]">{label}</div>
      <div className="font-mono text-xs font-bold" style={{ color: color ?? C.txt }}>
        {value}
      </div>
    </div>
  );
}

function EquitySvg({ curve }: { curve: Array<{ t: number; pips: number }> }) {
  const w = 300;
  const h = 64;
  const vals = curve.map((p) => p.pips);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = max - min || 1;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * h}`)
    .join(" ");
  const zeroY = h - ((0 - min) / span) * h;
  const last = vals[vals.length - 1] ?? 0;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-[#1C2A47] bg-[#0B1426]">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="#2A3A5C" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={pts} fill="none" stroke={last >= 0 ? C.green : C.red} strokeWidth="1.6" />
    </svg>
  );
}
