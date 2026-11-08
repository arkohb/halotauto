"use client";

// ════════════════════════════════════════════════════════════════════════
//  PERFORMANCE ANALYTICS · real book metrics from the DB closed trades
//  Equity curve / win rate / profit factor / expectancy / max drawdown /
//  monthly summary / win-loss distribution — every number is computed from
//  actual closed bot trades (pips book). No invented currency amounts.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { A, C, signedPips } from "@/lib/halo/ui-helpers";
import { PanelCard, StateFrame, StatCell } from "./panel";

interface TradeRow {
  id: string;
  symbol: string;
  status: string;
  resultPips: number | null;
  closedAt: string | null;
}

type Period = "7d" | "30d" | "90d" | "all";

const PERIODS: { id: Period; label: string; days: number | null }[] = [
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "all", label: "ALL", days: null },
];

interface MonthRow {
  key: string; // YYYY-MM
  label: string; // MMM YYYY
  trades: number;
  wins: number;
  wr: number;
  pips: number;
}

export function PerformanceIntel({ refreshKey }: { refreshKey: number }) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState<Period>("all");

  useEffect(() => {
    let alive = true;
    fetch("/api/trades?limit=200", { cache: "no-store" })
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
    const allClosed = trades.filter((t) => (t.status === "WIN" || t.status === "LOSS") && t.resultPips !== null);
    const p = PERIODS.find((x) => x.id === period);
    const cutoff = p?.days ? Date.now() - p.days * 86_400_000 : null;
    const closed = (
      cutoff
        ? allClosed.filter((t) => t.closedAt && new Date(t.closedAt).getTime() >= cutoff)
        : allClosed
    ).slice(); // newest → oldest

    const wins = closed.filter((t) => t.status === "WIN");
    const losses = closed.filter((t) => t.status === "LOSS");
    // the sign comes from the status (most LOSS rows store a positive magnitude)
    const grossWin = wins.reduce((s, t) => s + Math.max(0, signedPips(t.status, t.resultPips)), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, signedPips(t.status, t.resultPips)), 0));
    const net = grossWin - grossLoss;
    const wr = closed.length > 0 ? (wins.length * 100) / closed.length : null;
    const pf = grossLoss > 0 ? grossWin / grossLoss : null;
    const exp = closed.length > 0 ? net / closed.length : null;

    // cumulative curve + max drawdown (pips) — oldest → newest
    const seq = closed.slice().reverse();
    const curve: number[] = new Array(seq.length);
    const times: number[] = new Array(seq.length);
    let cum = 0;
    let peak = 0;
    let maxDd = 0;
    for (let i = 0; i < seq.length; i++) {
      cum += signedPips(seq[i].status, seq[i].resultPips);
      curve[i] = cum;
      times[i] = seq[i].closedAt ? new Date(seq[i].closedAt as string).getTime() : 0;
      peak = Math.max(peak, cum);
      maxDd = Math.max(maxDd, peak - cum);
    }

    // monthly buckets from real close times (chronological)
    const monthMap = new Map<string, MonthRow>();
    for (const t of seq) {
      if (!t.closedAt) continue;
      const d = new Date(t.closedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      let row = monthMap.get(key);
      if (!row) {
        row = {
          key,
          label: d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
          trades: 0,
          wins: 0,
          wr: 0,
          pips: 0,
        };
        monthMap.set(key, row);
      }
      row.trades += 1;
      if (t.status === "WIN") row.wins += 1;
      row.pips += signedPips(t.status, t.resultPips);
    }
    const months = Array.from(monthMap.values())
      .map((r) => ({ ...r, wr: r.trades > 0 ? (r.wins * 100) / r.trades : 0 }))
      .slice(-6); // last 6 months of real activity

    const winPct = closed.length > 0 ? (wins.length * 100) / closed.length : 0;

    return { n: closed.length, wr, pf, exp, net, maxDd, curve, times, months, wins: wins.length, losses: losses.length, winPct };
  }, [trades, period]);

  return (
    <PanelCard
      title="PERFORMANCE"
      icon={TrendingUp}
      accent="cyan"
      className="h-full"
      right={
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              aria-pressed={period === p.id}
              className="rounded px-1.5 py-0.5 text-[8px] font-extrabold tracking-[0.1em] transition-colors"
              style={{
                background: period === p.id ? A.cyan(0.14) : "transparent",
                color: period === p.id ? C.cyan : C.label,
                boxShadow: period === p.id ? `inset 0 0 0 1px ${A.cyan(0.4)}` : "none",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="flex flex-col gap-2.5 p-3"
    >
      <div className="grid grid-cols-2 gap-1.5">
        <StatCell
          label="Total P&L"
          value={m.n > 0 ? `${m.net >= 0 ? "+" : "−"}${Math.abs(m.net).toFixed(0)} pips` : "—"}
          color={m.n > 0 ? (m.net >= 0 ? C.green : C.red) : undefined}
          sub={`${m.n} closed`}
        />
        <StatCell label="Win rate" value={m.wr !== null ? `${m.wr.toFixed(1)}%` : "—"} color={m.wr !== null ? (m.wr >= 25 ? C.green : C.red) : undefined} sub={`${m.wins}W / ${m.losses}L`} />
        <StatCell label="Profit factor" value={m.pf !== null ? m.pf.toFixed(2) : "—"} color={m.pf !== null ? (m.pf >= 1 ? C.green : C.red) : undefined} />
        <StatCell label="Max drawdown" value={m.maxDd > 0 ? `−${m.maxDd.toFixed(0)} pips` : "—"} color={m.maxDd > 0 ? C.red : undefined} />
      </div>

      {/* real equity curve (cumulative pips of the actual closed book) */}
      <div className="rounded-lg border px-2 pb-1.5 pt-2" style={{ borderColor: C.lineInner, background: `${C.navy}B3` }}>
        <div className="mb-1 flex items-center justify-between text-[8.5px] font-bold tracking-[0.14em]" style={{ color: C.label }}>
          <span>EQUITY CURVE · PIPS</span>
          <span style={{ color: m.net >= 0 ? C.green : C.red }}>
            {m.n > 0 ? `${m.net >= 0 ? "+" : "−"}${Math.abs(m.net).toFixed(0)}p` : "—"}
          </span>
        </div>
        <EquityCurve data={m.curve} />
        {!loaded && <StateFrame compact state="loading" title="Loading book…" className="mt-1" />}
        {loaded && m.n === 0 && (
          <StateFrame
            compact
            state="empty"
            title={period === "all" ? "No closed trades yet — the curve draws itself as the EA books real results." : `No closed trades in the last ${PERIODS.find((x) => x.id === period)?.label} window.`}
            className="mt-1"
          />
        )}
      </div>

      {/* trade distribution (real win/loss ratio) */}
      {m.n > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[8.5px] font-bold tracking-[0.14em]" style={{ color: C.label }}>
            <span>TRADE DISTRIBUTION</span>
            <span className="font-mono">
              <span style={{ color: C.green }}>{m.winPct.toFixed(1)}% wins</span>
              <span style={{ color: C.label }}> · {(100 - m.winPct).toFixed(1)}% losses</span>
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full" style={{ background: A.red(0.25) }}>
            <div className="h-full transition-all" style={{ width: `${m.winPct}%`, background: C.green }} />
          </div>
        </div>
      )}

      {/* monthly summary — real buckets of the closed book */}
      {m.months.length > 0 && (
        <div className="rounded-lg border" style={{ borderColor: C.lineInner, background: `${C.navy}80` }}>
          <div className="border-b px-2 py-1 text-[8.5px] font-bold tracking-[0.14em]" style={{ borderColor: C.lineInner, color: C.label }}>
            MONTHLY SUMMARY
          </div>
          <table className="w-full text-[9px]">
            <thead>
              <tr className="text-[7.5px] uppercase tracking-[0.08em]" style={{ color: C.muted }}>
                <th className="px-2 py-1 text-left font-bold">Month</th>
                <th className="px-1 py-1 text-right font-bold">Trades</th>
                <th className="px-1 py-1 text-right font-bold">Win rate</th>
                <th className="px-2 py-1 text-right font-bold">P&L</th>
              </tr>
            </thead>
            <tbody>
              {m.months
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.key} className="border-t" style={{ borderColor: C.divider }}>
                    <td className="px-2 py-1 font-semibold" style={{ color: C.txt }}>{r.label}</td>
                    <td className="px-1 py-1 text-right font-mono" style={{ color: C.txt2 }}>{r.trades}</td>
                    <td className="px-1 py-1 text-right font-mono" style={{ color: r.wr >= 50 ? C.green : C.label }}>{r.wr.toFixed(1)}%</td>
                    <td className="px-2 py-1 text-right font-mono font-bold" style={{ color: r.pips >= 0 ? C.green : C.red }}>
                      {r.pips >= 0 ? "+" : "−"}
                      {Math.abs(r.pips).toFixed(0)}p
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

function EquityCurve({ data }: { data: number[] }) {
  if (data.length < 2) return <div className="h-20" />;
  const w = 300;
  const h = 80;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const zeroY = y(0);
  const last = data[data.length - 1];
  const col = last >= 0 ? C.green : C.red;
  const fill = `${pts.join(" ")} ${w},${h} 0,${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none" role="img" aria-label="Equity curve — cumulative pips of closed trades">
      <defs>
        <linearGradient id="halo-eq-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.22" />
          <stop offset="100%" stopColor={col} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke={C.line} strokeWidth="1" strokeDasharray="3 3" />
      <polygon points={fill} fill="url(#halo-eq-fill)" stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
