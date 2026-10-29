"use client";

// ════════════════════════════════════════════════════════════════════════
//  PERFORMANCE INTELLIGENCE · real book metrics from the DB trade history
//  Win rate / profit factor / expectancy / max drawdown are computed from
//  actual closed bot trades — the sparkline is the real cumulative pips curve.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";
import { PanelCard, StatCell } from "./panel";

interface TradeRow {
  id: string;
  status: string;
  resultPips: number | null;
  closedAt: string | null;
}

export function PerformanceIntel({ refreshKey }: { refreshKey: number }) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/trades?limit=100", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { trades?: TradeRow[] }) => {
        if (alive) {
          setTrades(j.trades ?? []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const m = useMemo(() => {
    const closed = trades.filter((t) => (t.status === "WIN" || t.status === "LOSS") && t.resultPips !== null);
    const wins = closed.filter((t) => t.status === "WIN");
    const losses = closed.filter((t) => t.status === "LOSS");
    const grossWin = wins.reduce((s, t) => s + Math.max(0, t.resultPips ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, t.resultPips ?? 0), 0));
    const net = grossWin - grossLoss;
    const wr = closed.length > 0 ? (wins.length * 100) / closed.length : null;
    const pf = grossLoss > 0 ? grossWin / grossLoss : null;
    const exp = closed.length > 0 ? net / closed.length : null;

    // cumulative curve + max drawdown (pips) — plain loop, closure-free
    const pipsSeq = closed
      .slice()
      .reverse() // oldest → newest
      .map((t) => t.resultPips ?? 0);
    const curve: number[] = new Array(pipsSeq.length);
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    for (let i = 0; i < pipsSeq.length; i++) {
      cum += pipsSeq[i];
      curve[i] = cum;
      peak = Math.max(peak, cum);
      maxDd = Math.max(maxDd, peak - cum);
    }
    return { n: closed.length, wr, pf, exp, net, maxDd, curve };
  }, [trades]);

  return (
    <PanelCard
      title="PERFORMANCE"
      icon={TrendingUp}
      accent="cyan"
      className="h-full"
      right={<span className="font-mono text-[8.5px] tracking-wider text-[#6B7A94]">{m.n} CLOSED</span>}
      bodyClassName="flex flex-col gap-2 p-3"
    >
      <div className="grid grid-cols-2 gap-1.5">
        <StatCell label="Win rate" value={m.wr !== null ? `${m.wr.toFixed(1)}%` : "—"} color={m.wr !== null ? (m.wr >= 25 ? C.green : C.red) : undefined} />
        <StatCell label="Profit factor" value={m.pf !== null ? m.pf.toFixed(2) : "—"} color={m.pf !== null ? (m.pf >= 1 ? C.green : C.red) : undefined} />
        <StatCell label="Expectancy" value={m.exp !== null ? `${m.exp >= 0 ? "+" : "−"}${Math.abs(m.exp).toFixed(1)}p` : "—"} color={m.exp !== null ? (m.exp >= 0 ? C.green : C.red) : undefined} />
        <StatCell label="Max drawdown" value={m.maxDd > 0 ? `−${m.maxDd.toFixed(0)}p` : "—"} color={m.maxDd > 0 ? C.red : undefined} />
      </div>

      {/* real cumulative pips curve */}
      <div className="mt-auto rounded-lg border border-[#16263F] bg-[#0B1426]/70 px-2 pb-1.5 pt-2">
        <div className="mb-1 flex items-center justify-between text-[8.5px] font-bold tracking-[0.14em] text-[#6B7A94]">
          <span>CUMULATIVE PIPS</span>
          <span style={{ color: m.net >= 0 ? C.green : C.red }}>
            {m.n > 0 ? `${m.net >= 0 ? "+" : "−"}${Math.abs(m.net).toFixed(0)}p` : "—"}
          </span>
        </div>
        <Sparkline data={m.curve} />
        {!loaded && <div className="py-3 text-center text-[10px] text-[#6B7A94]">Loading book…</div>}
        {loaded && m.n === 0 && (
          <div className="py-3 text-center text-[10px] leading-snug text-[#6B7A94]">
            No closed trades yet — the curve draws itself as the EA books real results.
          </div>
        )}
      </div>
    </PanelCard>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-9" />;
  const w = 220;
  const h = 36;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * h}`);
  const zeroY = h - ((0 - min) / span) * h;
  const last = data[data.length - 1];
  const col = last >= 0 ? "#089981" : "#F23645";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" role="img" aria-label="Cumulative pips curve">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="#1C2A47" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
