"use client";

// ════════════════════════════════════════════════════════════════════════
//  BACKTEST DASHBOARD · REAL MARKET DATA · ∞ BARS · ANY PAIR · ANY BAR SIZE
//  Replays the exact live engine (wick-line break → return) over real OHLC
//  history walked page-by-page from the live feeds. Bar count is UNCAPPED —
//  type any number or pick ALL to walk back to the feed's very first bar —
//  with 17 timeframes (M1→W1) and any symbol of preference (typed freely).
//  If only a simulator were reachable the run is REFUSED — the dashboard
//  never fabricates demo equity.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { C, fmtPx, fmtPips } from "@/lib/halo/ui-helpers";
import { BT_TIMEFRAMES, SYMBOLS, SYMBOL_GROUPS } from "@/lib/market-symbols";
import type { HaloConfig } from "@/lib/halo/types";

interface BtTrade {
  dir: number;
  entry: number;
  exit: number | null;
  sl: number;
  tp: number;
  result: "WIN" | "LOSS" | "OPEN";
  exitReason: "TP" | "SL" | null;
  pips: number;
  riskPips: number;
  r: number | null;
  openTime: number;
  closeTime: number | null;
  holdMin: number | null;
}

interface BtStats {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPips: number;
  grossWinPips: number;
  grossLossPips: number;
  profitFactor: number | null;
  expectancyPips: number | null;
  avgWinPips: number | null;
  avgLossPips: number | null;
  bestPips: number | null;
  worstPips: number | null;
  maxDrawdownPips: number;
  maxConsecLosses: number;
  maxConsecWins: number;
  avgHoldMin: number | null;
  burned: number;
  skipped: number;
  tooClose: number;
}

interface BtResult {
  ok: boolean;
  code?: string;
  error?: string;
  symbol: string;
  symbolLabel?: string;
  group?: string;
  tf: string;
  bars: number;
  requestedBars?: number | "all";
  from?: string | null;
  source: string;
  complete?: boolean;
  mintick: number;
  pip?: number;
  spreadPips: number;
  span: { from: number; to: number };
  cfgEcho: { sigMode: string; slMode: string; rrMult: number; breakATR: number; eqTolATR: number };
  stats: BtStats;
  equity: { final: number; maxDrawdown: number };
  curve: Array<{ t: number; pips: number }>;
  tradesTotal?: number;
  trades: BtTrade[];
}

interface Props {
  symbol: string;
  tf: string;
  config: HaloConfig;
}

const day = (t: number) => new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
const dt = (t: number) =>
  new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const num = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(d);

const BAR_PRESETS: Array<[string, string]> = [
  ["2000", "2K"],
  ["20000", "20K"],
  ["100000", "100K"],
  ["all", "ALL ∞"],
];

export function BacktestPanel({ symbol, tf, config }: Props) {
  const known = SYMBOLS.some((s) => s.id === symbol);
  const [symPick, setSymPick] = useState(known ? symbol : "CUSTOM");
  const [customSym, setCustomSym] = useState(known ? "BTCUSD" : symbol);
  const activeSym = (symPick === "CUSTOM" ? customSym : symPick).toUpperCase().trim();
  const [btTf, setBtTf] = useState(BT_TIMEFRAMES.some((t) => t.id === tf) ? tf : "5m");
  const [bars, setBars] = useState("20000");
  const [from, setFrom] = useState("");
  const [spread, setSpread] = useState("0");
  const [res, setRes] = useState<BtResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const seq = useRef(0);

  // elapsed-seconds ticker while a deep walk is running
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    setElapsed(0);
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [busy]);

  const run = async () => {
    const id = ++seq.current;
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: activeSym,
          tf: btTf,
          bars: bars.trim() === "" ? 20000 : bars,
          from: from || undefined,
          spreadPips: Number(spread) || 0,
          cfg: config,
        }),
      });
      const j = (await r.json()) as BtResult;
      if (seq.current === id) setRes(j);
    } catch (e) {
      if (seq.current === id)
        setRes({
          ok: false,
          error: (e as Error).message,
          symbol: activeSym,
          tf: btTf,
          bars: 0,
          source: "",
          mintick: 0.01,
          spreadPips: 0,
          span: { from: 0, to: 0 },
          cfgEcho: { sigMode: "instant", slMode: "points", rrMult: 0, breakATR: 0, eqTolATR: 0 },
          stats: emptyStats(),
          equity: { final: 0, maxDrawdown: 0 },
          curve: [],
          trades: [],
        });
    } finally {
      if (seq.current === id) setBusy(false);
    }
  };

  const s = res?.ok ? res.stats : null;
  const requestedAll = res?.ok && res.requestedBars === "all";

  return (
    <div className="space-y-4">
      {/* ── header ── */}
      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[#1C2A47]">
          <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">BACKTEST DASHBOARD</span>
          <span
            className="rounded px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
            style={{ background: "rgba(8,153,129,0.16)", color: C.green }}
          >
            REAL MARKET DATA ONLY · NO DEMO
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
            style={{ background: "rgba(212,175,55,0.14)", color: "#D4AF37" }}
          >
            ∞ BARS · ANY PAIR · M1→W1
          </span>
          <span className="ml-auto text-[10px] text-[#8C98AE]">wick-line break → return · same live engine</span>
        </div>

        <div className="flex flex-wrap items-end gap-3 p-3">
          {/* symbol — known presets or ANY custom ticker */}
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8C98AE]">PAIR / SYMBOL</span>
            <select
              value={symPick}
              onChange={(e) => setSymPick(e.target.value)}
              className="h-8 rounded-md border border-[#2A3A5C] bg-[#0B1426] px-2 text-xs font-mono text-[#E8ECF4] outline-none focus:border-[#D4AF37]"
            >
              {SYMBOL_GROUPS.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {SYMBOLS.filter((sy) => sy.group === g.key).map((sy) => (
                    <option key={sy.id} value={sy.id}>
                      {sy.id}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="CUSTOM">CUSTOM — ANY TICKER…</option>
            </select>
          </label>
          {symPick === "CUSTOM" && (
            <label className="flex flex-col gap-1">
              <span className="text-[9px] font-bold tracking-[0.14em] text-[#8C98AE]">ANY TICKER</span>
              <Input
                value={customSym}
                onChange={(e) => setCustomSym(e.target.value.toUpperCase())}
                placeholder="BTCUSD, EURJPY, AAPL, ^GSPC…"
                className="w-44 h-8 text-xs font-mono bg-[#0B1426] border-[#2A3A5C] text-[#E8ECF4] placeholder:text-[#4A5878]"
              />
            </label>
          )}

          {/* timeframe — every standard bar size */}
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8C98AE]">BAR SIZE (TF)</span>
            <select
              value={btTf}
              onChange={(e) => setBtTf(e.target.value)}
              className="h-8 rounded-md border border-[#2A3A5C] bg-[#0B1426] px-2 text-xs font-mono text-[#E8ECF4] outline-none focus:border-[#D4AF37]"
            >
              {BT_TIMEFRAMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {/* bars — uncapped */}
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8C98AE]">BARS · NO CAP</span>
            <Input
              value={bars}
              onChange={(e) => setBars(e.target.value)}
              placeholder="any count · or ALL"
              className="w-32 h-8 text-xs font-mono bg-[#0B1426] border-[#2A3A5C] text-[#E8ECF4] placeholder:text-[#4A5878]"
            />
          </label>
          <div className="flex gap-1">
            {BAR_PRESETS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setBars(v)}
                className="h-8 rounded-md border px-2.5 text-[10px] font-bold tracking-wide transition-colors"
                style={{
                  borderColor: bars === v ? "#D4AF37" : "#2A3A5C",
                  color: bars === v ? "#D4AF37" : "#8C98AE",
                  background: bars === v ? "rgba(212,175,55,0.10)" : "transparent",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* optional FROM date */}
          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8C98AE]">FROM (OPTIONAL)</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-36 h-8 text-xs font-mono bg-[#0B1426] border-[#2A3A5C] text-[#E8ECF4]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-[0.14em] text-[#8C98AE]">SPREAD (PIPS / TRADE)</span>
            <Input
              type="number"
              value={spread}
              min={0}
              step={0.1}
              onChange={(e) => setSpread(e.target.value)}
              className="w-24 h-8 text-xs font-mono bg-[#0B1426] border-[#2A3A5C] text-[#E8ECF4]"
            />
          </label>

          <Button
            onClick={() => void run()}
            disabled={busy}
            className="h-8 px-5 rounded-md text-[11px] font-bold tracking-wider bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A]"
          >
            {busy ? `REPLAYING REAL HISTORY… ${elapsed}s` : "RUN BACKTEST"}
          </Button>
        </div>

        {busy && elapsed >= 6 && (
          <div className="px-3 pb-3 text-[10px] text-[#8C98AE]">
            Deep walk in progress — huge windows (ALL on M1) fetch hundreds of pages and can take up to ~2 minutes.
            Smaller bar counts and higher timeframes return in seconds.
          </div>
        )}
      </div>

      {/* ── results header strip ── */}
      {res?.ok && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-[#1C2A47] bg-[#0F1A30] px-4 py-2 text-[10px] text-[#8C98AE]">
          <span className="font-mono text-[11px] font-bold text-[#E8ECF4]">
            {res.symbol}
            {res.symbolLabel && res.symbolLabel !== res.symbol ? ` · ${res.symbolLabel}` : ""} · {res.tf.toUpperCase()}
          </span>
          <span>
            feed <span className="font-bold uppercase text-[#D4AF37]">{res.source}</span>
          </span>
          <span>
            <span className="font-mono font-bold text-[#E8ECF4]">{res.bars.toLocaleString()}</span> real bars
            {res.requestedBars !== undefined ? (
              <span className="text-[#4A5878]"> / requested {typeof res.requestedBars === "string" ? "ALL" : res.requestedBars.toLocaleString()}</span>
            ) : null}
          </span>
          <span className="font-mono">
            {day(res.span.from)} → {day(res.span.to)}
          </span>
          {requestedAll && (
            <span
              className="rounded px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
              style={{ background: "rgba(212,175,55,0.14)", color: "#D4AF37" }}
            >
              ALL-HISTORY RUN
            </span>
          )}
          {res.complete && (
            <span
              className="rounded px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
              style={{ background: "rgba(8,153,129,0.16)", color: C.green }}
            >
              FEED GENESIS REACHED · NOTHING OLDER EXISTS
            </span>
          )}
          {res.from && (
            <span className="rounded px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]" style={{ background: "rgba(42,58,92,0.5)", color: "#AEB9D6" }}>
              FROM {res.from}
            </span>
          )}
          <span>spread {res.spreadPips}p</span>
        </div>
      )}

      {/* ── no live data — refuse to show demo results ── */}
      {res && !res.ok && (
        <div
          className="rounded-xl border px-4 py-3 text-xs font-bold tracking-wide"
          style={{ borderColor: "rgba(242,54,69,0.5)", background: "rgba(242,54,69,0.10)", color: C.red }}
        >
          {res.code === "NO_LIVE_DATA"
            ? `NO LIVE DATA for ${res.symbol} ${res.tf} — the backtest runs on REAL market prices only. Demo/simulator results are never shown. Check the ticker spelling or try again shortly.`
            : `Backtest failed: ${res.error}`}
        </div>
      )}

      {/* ── dashboard ── */}
      {res?.ok && s && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* left: equity + KPIs */}
          <div className="space-y-4 min-w-0">
            <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
                <span className="text-[10px] font-bold tracking-[0.16em] text-[#8C98AE]">
                  EQUITY CURVE (PIPS, NET OF SPREAD)
                </span>
                <span className="font-mono text-sm font-extrabold" style={{ color: res.equity.final >= 0 ? C.green : C.red }}>
                  {fmtPips(res.equity.final)}
                </span>
              </div>
              {res.curve.length > 1 ? (
                <EquityChart curve={res.curve} />
              ) : (
                <div className="flex h-28 items-center justify-center text-[11px] text-[#8C98AE]">
                  Not enough closed trades to plot an equity curve — widen the window or relax the trigger filters.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-3">
              <div className="px-1 pb-2 text-[10px] font-bold tracking-[0.16em] text-[#8C98AE]">PROFITABILITY</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Kpi label="NET PIPS" value={fmtPips(s.netPips)} color={s.netPips >= 0 ? C.green : C.red} big />
                <Kpi label="WIN RATE" value={s.winRate !== null ? `${s.winRate.toFixed(1)}%` : "—"} big />
                <Kpi
                  label="PROFIT FACTOR"
                  value={s.profitFactor === null ? "—" : s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}
                  color={s.profitFactor !== null && s.profitFactor !== Infinity && s.profitFactor >= 1.5 ? C.green : s.profitFactor !== null && s.profitFactor < 1 ? C.red : undefined}
                  big
                />
                <Kpi label="EXPECTANCY" value={s.expectancyPips !== null ? `${fmtPips(s.expectancyPips)} p/trade` : "—"} color={(s.expectancyPips ?? 0) >= 0 ? C.green : C.red} big />
                <Kpi label="TRADES (W/L)" value={`${s.closed} (${s.wins}/${s.losses})${s.open > 0 ? ` +${s.open} open` : ""}`} />
                <Kpi label="MAX DRAWDOWN" value={`−${num(s.maxDrawdownPips)}p`} color={C.red} />
                <Kpi label="AVG WIN" value={s.avgWinPips !== null ? `+${num(s.avgWinPips)}p` : "—"} color={C.green} />
                <Kpi label="AVG LOSS" value={s.avgLossPips !== null ? `−${num(s.avgLossPips)}p` : "—"} color={C.red} />
                <Kpi label="MAX LOSING STREAK" value={String(s.maxConsecLosses)} />
                <Kpi label="MAX WIN STREAK" value={String(s.maxConsecWins)} />
                <Kpi label="BEST / WORST" value={`${s.bestPips !== null ? fmtPips(s.bestPips) : "—"} / ${s.worstPips !== null ? fmtPips(s.worstPips) : "—"}`} />
                <Kpi label="AVG HOLD" value={s.avgHoldMin !== null ? `${s.avgHoldMin < 60 ? `${num(s.avgHoldMin, 0)}m` : `${num(s.avgHoldMin / 60)}h`}` : "—"} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[10px] text-[#8C98AE]">
                <span>gross win <span className="font-mono" style={{ color: C.green }}>{fmtPips(s.grossWinPips)}</span></span>
                <span>gross loss <span className="font-mono" style={{ color: C.red }}>−{num(s.grossLossPips)}p</span></span>
                <span>levels burned <span className="font-mono">{s.burned}</span></span>
                <span>crowded/skipped <span className="font-mono">{s.skipped} · {s.tooClose}</span></span>
                <span>
                  strategy <span className="font-mono">{res.cfgEcho.sigMode.toUpperCase()} · SL {res.cfgEcho.slMode === "wick" ? "BREAK EXTREME" : res.cfgEcho.slMode.toUpperCase()} · RR 1:{num(res.cfgEcho.rrMult)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* right: trade log */}
          <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C2A47]">
              <span className="text-[10px] font-bold tracking-[0.16em] text-[#8C98AE]">
                TRADE LOG · LATEST {res.trades.length}
                {res.tradesTotal !== undefined && res.tradesTotal > res.trades.length
                  ? ` OF ${res.tradesTotal}`
                  : ""}
              </span>
              <span className="text-[10px] text-[#8C98AE]">same-bar SL+TP counted as SL (conservative)</span>
            </div>
            <div className="max-h-[430px] overflow-y-auto halo-scroll">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-[#101C33] text-[#8C98AE]">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium">OPENED</th>
                    <th className="text-left px-2 py-1.5 font-medium">DIR</th>
                    <th className="text-right px-2 py-1.5 font-medium">ENTRY</th>
                    <th className="text-right px-2 py-1.5 font-medium">EXIT</th>
                    <th className="text-right px-2 py-1.5 font-medium">RESULT</th>
                    <th className="text-right px-2 py-1.5 font-medium">R</th>
                    <th className="text-right px-2 py-1.5 font-medium">HOLD</th>
                  </tr>
                </thead>
                <tbody>
                  {res.trades.map((t, i) => (
                    <tr key={i} className="border-t border-[#121D35]">
                      <td className="px-2 py-1 font-mono text-[#8C98AE]">{dt(t.openTime)}</td>
                      <td className="px-2 py-1 font-bold" style={{ color: t.dir === -1 ? C.red : C.green }}>
                        {t.dir === -1 ? "SELL" : "BUY"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[#E8ECF4]">{fmtPx(t.entry, res.mintick)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#8C98AE]">{t.exit !== null ? fmtPx(t.exit, res.mintick) : "—"}</td>
                      <td className="px-2 py-1 text-right font-mono font-bold" style={{ color: t.result === "WIN" ? C.green : t.result === "LOSS" ? C.red : C.muted }}>
                        {t.result === "OPEN" ? "OPEN" : `${t.exitReason ?? ""} ${fmtPips(t.pips)}`}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: (t.r ?? 0) >= 0 ? C.green : C.red }}>
                        {t.r !== null ? `${t.r >= 0 ? "+" : "−"}${Math.abs(t.r).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[#8C98AE]">
                        {t.holdMin !== null ? (t.holdMin < 60 ? `${t.holdMin.toFixed(0)}m` : `${(t.holdMin / 60).toFixed(1)}h`) : "—"}
                      </td>
                    </tr>
                  ))}
                  {res.trades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-[11px] text-[#8C98AE]">
                        No fires in this window — try more bars or another timeframe.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function emptyStats(): BtStats {
  return {
    closed: 0, open: 0, wins: 0, losses: 0, winRate: null, netPips: 0, grossWinPips: 0, grossLossPips: 0,
    profitFactor: null, expectancyPips: null, avgWinPips: null, avgLossPips: null, bestPips: null,
    worstPips: null, maxDrawdownPips: 0, maxConsecLosses: 0, maxConsecWins: 0, avgHoldMin: null,
    burned: 0, skipped: 0, tooClose: 0,
  };
}

function Kpi({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-2.5 py-2">
      <div className="text-[8.5px] tracking-[0.14em] text-[#8C98AE]">{label}</div>
      <div className={`font-mono font-extrabold ${big ? "text-base" : "text-xs"}`} style={{ color: color ?? C.txt }}>
        {value}
      </div>
    </div>
  );
}

/** Equity curve with area fill, zero line and drawdown-aware scaling. */
function EquityChart({ curve }: { curve: Array<{ t: number; pips: number }> }) {
  const w = 640;
  const h = 170;
  const padL = 8;
  const padR = 52;
  const vals = curve.map((p) => p.pips);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 0);
  const span = max - min || 1;
  const xOf = (i: number) => padL + (i / Math.max(1, vals.length - 1)) * (w - padL - padR);
  const yOf = (v: number) => 10 + ((max - v) / span) * (h - 20);
  const line = vals.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const area = `${padL},${yOf(Math.max(min, 0)).toFixed(1)} ${line} ${xOf(vals.length - 1).toFixed(1)},${yOf(Math.max(min, 0)).toFixed(1)}`;
  const last = vals[vals.length - 1] ?? 0;
  const pos = last >= 0;
  const col = pos ? C.green : C.red;
  const t0 = curve[0]?.t ?? 0;
  const t1 = curve[curve.length - 1]?.t ?? 0;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-lg border border-[#1C2A47] bg-[#0B1426]" role="img" aria-label="Backtest equity curve">
        <defs>
          <linearGradient id="btEq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.28" />
            <stop offset="100%" stopColor={col} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* zero line */}
        <line x1={padL} y1={yOf(0)} x2={w - padR} y2={yOf(0)} stroke="#2A3A5C" strokeWidth="1" strokeDasharray="4 4" />
        <polyline points={area} fill="url(#btEq)" stroke="none" />
        <polyline points={line} fill="none" stroke={col} strokeWidth="1.8" />
        {/* right scale: final + max/min */}
        <text x={w - padR + 6} y={yOf(max) + 4} fontSize="9" fill={C.muted} fontFamily="monospace">+{max.toFixed(0)}</text>
        <text x={w - padR + 6} y={yOf(min) + 4} fontSize="9" fill={C.muted} fontFamily="monospace">{min.toFixed(0)}</text>
        <text x={w - padR + 6} y={yOf(last) + 4} fontSize="10" fontWeight="700" fill={col} fontFamily="monospace">
          {last >= 0 ? "+" : "−"}{Math.abs(last).toFixed(0)}p
        </text>
      </svg>
      <div className="flex justify-between px-1 pt-1 text-[9px] font-mono text-[#8C98AE]">
        <span>{dt(t0)}</span>
        <span>{vals.length} closed trades</span>
        <span>{dt(t1)}</span>
      </div>
    </div>
  );
}
