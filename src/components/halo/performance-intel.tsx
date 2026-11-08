"use client";

// ════════════════════════════════════════════════════════════════════════
//  PERFORMANCE ANALYTICS · real book metrics from the DB closed trades
//  Equity curve / win rate / profit factor / expectancy / max drawdown /
//  monthly summary / win-loss distribution — every number is computed from
//  actual closed bot trades (pips book). No invented currency amounts.
//
//  LIVE ACTIVE TRADE — the top strip locks onto the one running trade the
//  moment it fires and follows it in real time (2s polls): live price,
//  floating P&L in pips, SL↔TP progress bar, run clock, feed source. When
//  the trade settles (TP/SL) the closed-book stats below refresh instantly.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, TrendingUp } from "lucide-react";
import { A, C, fmtPips, fmtPx, signedPips } from "@/lib/halo/ui-helpers";
import { PanelCard, Pill, StateFrame, StatCell } from "./panel";

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

// ── /api/trades/active payload ─────────────────────────────────────────
interface ActiveTrade {
  id: string;
  symbol: string;
  timeframe: string;
  dir: number;
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  mode: string;
  execMode: string;
  openedAt: string;
  riskPips: number;
  rewardPips: number;
}

interface ActiveResp {
  active: boolean;
  trade: ActiveTrade | null;
  price: number;
  mintick: number;
  pipSize: number;
  pipMult: number;
  source: string;
  serverTime: number;
  scanPaused: boolean;
  error?: string;
}

const POLL_MS = 2000;

function clampPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function fmtElapsed(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

export function PerformanceIntel({ refreshKey }: { refreshKey: number }) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [bookKey, setBookKey] = useState(0); // bumped when the running trade settles → book refreshes
  const [tradeRunning, setTradeRunning] = useState(false);

  const refetchBook = useCallback(() => setBookKey((k) => k + 1), []);

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
  }, [refreshKey, bookKey]);

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
        <div className="flex items-center gap-1.5">
          {tradeRunning && (
            <Pill tone="live" pulse>
              LIVE
            </Pill>
          )}
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
        </div>
      }
      bodyClassName="flex flex-col gap-2.5 p-3"
    >
      {/* the running trade, live — price and P&L move with the market */}
      <ActiveTradeLive onSettled={refetchBook} onActiveChange={setTradeRunning} />

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

// ════════════════════════════════════════════════════════════════════════
//  ACTIVE TRADE LIVE — polls /api/trades/active every 2s while the tab is
//  visible. Renders the hunting strip when nothing runs; once a trade is
//  open it shows the side, entry → live price (flashing on every tick),
//  floating P&L in pips, the SL→TP progress bar with the price marker, the
//  run clock and the feed source. Fires onSettled() exactly once when the
//  running trade closes so the closed-book stats refresh immediately.
// ════════════════════════════════════════════════════════════════════════
function ActiveTradeLive({ onSettled, onActiveChange }: { onSettled: () => void; onActiveChange: (running: boolean) => void }) {
  const [snap, setSnap] = useState<ActiveResp | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef(0);
  const wasActiveRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);

  // live poll — 2s, visibility-gated, hard 8s ceiling like every other strip
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/trades/active", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`http ${r.status}`);
        const j = (await r.json()) as ActiveResp;
        if (!alive) return;
        setFailed(false);
        setSnap(j);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // 1s heartbeat — the run clock ticks even between price polls
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // price tick flash — green on the way up, red on the way down
  useEffect(() => {
    const price = snap?.price ?? 0;
    if (price <= 0) return;
    const prev = prevPriceRef.current;
    prevPriceRef.current = price;
    if (prev <= 0 || price === prev) return;
    setFlash(price > prev ? "up" : "down");
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 650);
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, [snap?.price]);

  // settle detection — the running trade just closed → refresh the book once
  useEffect(() => {
    const active = snap?.active ?? false;
    if (wasActiveRef.current && !active) onSettled();
    wasActiveRef.current = active;
    onActiveChange(active);
  }, [snap?.active, onSettled, onActiveChange]);

  const t = snap?.trade ?? null;
  const price = snap?.price ?? 0;
  const mintick = snap?.mintick ?? 0.01;
  const pipSize = snap && snap.pipSize > 0 ? snap.pipSize : mintick * 10;

  // floating P&L — the exact engine formula: ((price − entry) × dir) / pipSize
  const pips = t && price > 0 ? ((price - t.entry) * (t.dir === -1 ? -1 : 1)) / pipSize : null;
  const riskPips = t ? (t.riskPips > 0 ? t.riskPips : Math.abs(t.entry - t.sl) / pipSize) : 0;
  const rewardPips = t ? (t.rewardPips > 0 ? t.rewardPips : Math.abs(t.tp - t.entry) / pipSize) : 0;
  const range = riskPips + rewardPips;
  const prog = pips !== null && range > 0 ? clampPct(((pips + riskPips) / range) * 100) : null;
  const zeroPct = range > 0 ? (riskPips / range) * 100 : 50;
  const elapsed = t ? now - new Date(t.openedAt).getTime() : 0;

  // ── loading / unreachable ────────────────────────────────────────────
  if (!snap && !failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[8.5px] font-bold tracking-[0.14em]" style={{ borderColor: C.lineInner, background: `${C.navy}80`, color: C.label }}>
        <Activity size={11} className="animate-pulse" style={{ color: C.cyan }} />
        CONNECTING TO THE TAPE…
      </div>
    );
  }

  // ── idle: no trade runs — the scanner is hunting ─────────────────────
  if (!t) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5"
        style={{ borderColor: C.lineInner, background: `${C.navy}80` }}
        aria-label="No active trade — scanner hunting"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: C.cyan }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.cyan }} />
          </span>
          <span className="text-[8.5px] font-extrabold tracking-[0.14em]" style={{ color: C.txt2 }}>
            NO ACTIVE TRADE — SCANNER HUNTING
          </span>
        </div>
        <span className="text-[7.5px] tracking-[0.08em]" style={{ color: failed ? C.warn : C.label }}>
          {failed ? "FEED RECONNECTING…" : "THE NEXT FIRE LOCKS ON HERE AND RUNS LIVE"}
        </span>
      </div>
    );
  }

  // ── live runner ──────────────────────────────────────────────────────
  const dirCol = t.side === "BUY" ? C.green : C.red;
  const pnlCol = pips === null ? C.txt2 : pips >= 0 ? C.green : C.red;
  const priceCol = flash === "up" ? C.green : flash === "down" ? C.red : C.txt;
  const feedLive = price > 0;
  const isPaper = t.execMode !== "LIVE";

  return (
    <div
      className="rounded-lg border p-2"
      style={{
        borderColor: pips !== null && pips >= 0 ? A.green(0.45) : A.red(0.45),
        background: `linear-gradient(135deg, ${pips !== null && pips >= 0 ? A.green(0.07) : A.red(0.07)}, ${C.navy}E6 55%)`,
        boxShadow: `inset 0 0 18px ${pips !== null && pips >= 0 ? A.green(0.05) : A.red(0.05)}`,
      }}
      aria-label={`Active ${t.side} trade on ${t.symbol} running live`}
    >
      {/* header row: side badge · instrument · mode · run clock · LIVE */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-black tracking-[0.12em]"
            style={{ background: dirCol, color: "#03101F" }}
          >
            {t.side === "BUY" ? "▲ BUY" : "▼ SELL"}
          </span>
          <span className="truncate text-[10.5px] font-extrabold tracking-[0.06em]" style={{ color: C.txt }}>
            {t.symbol}
            <span style={{ color: C.muted }}> · {t.timeframe}</span>
          </span>
          <span
            className="rounded px-1 py-px text-[7px] font-bold tracking-[0.1em]"
            style={{
              background: isPaper ? A.cyan(0.12) : A.gold(0.14),
              color: isPaper ? C.cyan : C.goldHover,
              boxShadow: `inset 0 0 0 1px ${isPaper ? A.cyan(0.35) : A.gold(0.4)}`,
            }}
          >
            {t.execMode === "LIVE" ? "LIVE" : "PAPER"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono">
          <span className="text-[9px] font-bold tabular-nums" style={{ color: C.txt2 }}>
            ⏱ {fmtElapsed(elapsed)}
          </span>
          <span className="flex items-center gap-1 rounded px-1 py-px text-[7.5px] font-black tracking-[0.14em]" style={{ background: A.green(0.13), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.45)}` }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: C.green }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.green }} />
            </span>
            LIVE
          </span>
        </div>
      </div>

      {/* big row: floating P&L · entry → live price */}
      <div className="mb-1.5 flex items-end justify-between gap-2">
        <div>
          <div className="text-[7.5px] font-bold tracking-[0.16em]" style={{ color: C.label }}>
            FLOATING P&L
          </div>
          <div
            className="font-mono text-[22px] font-black leading-none tabular-nums transition-colors duration-300"
            style={{ color: pnlCol, textShadow: `0 0 14px ${pips !== null && pips >= 0 ? A.green(0.35) : A.red(0.3)}` }}
          >
            {pips !== null ? fmtPips(pips) : "…"}
            <span className="ml-1 text-[10px] font-bold" style={{ color: C.label }}>
              pips
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[7.5px] font-bold tracking-[0.16em]" style={{ color: C.label }}>
            {feedLive ? "MARKET PRICE" : "FEED RECONNECTING"}
          </div>
          <div
            className="font-mono text-[15px] font-black leading-tight tabular-nums transition-colors duration-300"
            style={{ color: priceCol }}
          >
            {feedLive ? fmtPx(price, mintick) : fmtPx(t.entry, mintick)}
            {feedLive && flash && (
              <span className="ml-1 text-[9px]" style={{ color: priceCol }}>
                {flash === "up" ? "▲" : "▼"}
              </span>
            )}
          </div>
          <div className="font-mono text-[8px] tabular-nums" style={{ color: C.label }}>
            entry {fmtPx(t.entry, mintick)}
          </div>
        </div>
      </div>

      {/* SL→TP progress bar with the live price marker */}
      <div className="relative mb-1 h-2.5 overflow-hidden rounded-full" style={{ background: C.deep, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
        {/* loss zone (left of entry) and profit zone (right) */}
        <div className="absolute inset-y-0 left-0" style={{ width: `${zeroPct}%`, background: A.red(0.18) }} />
        <div className="absolute inset-y-0 right-0" style={{ width: `${100 - zeroPct}%`, background: A.green(0.14) }} />
        {/* filled from entry to the current mark */}
        {prog !== null && (
          <div
            className="absolute inset-y-0 transition-all duration-700"
            style={{
              left: `${Math.min(zeroPct, prog)}%`,
              width: `${Math.abs(prog - zeroPct)}%`,
              background: prog >= zeroPct ? A.green(0.45) : A.red(0.45),
            }}
          />
        )}
        {/* entry line */}
        <div className="absolute inset-y-0 w-px" style={{ left: `${zeroPct}%`, background: `${C.label}90` }} />
        {/* live price marker */}
        {prog !== null && (
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all duration-700"
            style={{
              left: `${prog}%`,
              background: pnlCol,
              borderColor: C.deep,
              boxShadow: `0 0 10px ${pips !== null && pips >= 0 ? A.green(0.8) : A.red(0.8)}`,
            }}
          />
        )}
      </div>
      <div className="flex items-center justify-between font-mono text-[8px] tabular-nums">
        <span style={{ color: C.red }}>
          SL {fmtPx(t.sl, mintick)} <span style={{ color: C.label }}>−{riskPips.toFixed(1)}p</span>
        </span>
        <span style={{ color: C.muted }}>
          {range > 0 ? `R:R 1:${(rewardPips / Math.max(riskPips, 0.0001)).toFixed(2)}` : ""}
        </span>
        <span style={{ color: C.green }}>
          TP {fmtPx(t.tp, mintick)} <span style={{ color: C.label }}>+{rewardPips.toFixed(1)}p</span>
        </span>
      </div>

      {/* one-trade rule note + feed source */}
      <div className="mt-1 flex items-center justify-between text-[7.5px] tracking-[0.08em]">
        <span style={{ color: C.warn }}>⏸ SCANNING PAUSED — RESUMES THE MOMENT THIS TRADE HITS SL OR TP</span>
        <span className="font-mono uppercase" style={{ color: C.dim }}>
          {t.mode} · feed {snap?.source || "…"}
        </span>
      </div>
    </div>
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
