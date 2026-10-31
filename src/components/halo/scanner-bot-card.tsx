"use client";

// ════════════════════════════════════════════════════════════════════════
//  TIMEFRAME SCANNER BOT · chat card (visual design per the owner's mockup)
//
//  Lives inside the existing HALO chat console (floating + docked). It is
//  a pure PRESENTATION + CONTROL surface over /api/tf-scanner:
//    • polls scanner state every 8 s (status, markets, last scan, message,
//      latest qualifying opportunity)
//    • Start / Pause / Resume — the only controls the bot exposes
//    • View Details — expands the strategy-provided opportunity values
//      (entry / SL / TP / R-R / signal time / confirmation status)
//  No strategy logic lives here — every trading value is exactly what the
//  existing engine calculated. No artificial progress percentages.
//  Styling is fully local (inline + tokens) so no existing style leaks.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Radar } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";

interface Opportunity {
  symbol: string;
  symbolLabel: string;
  tf: string;
  dir: -1 | 1;
  entry: number;
  sl: number;
  tp: number;
  riskPips: number;
  rewardPips: number;
  rr: string;
  time: number;
  sigMode: string;
  status: string;
}

interface ScannerState {
  ok: boolean;
  enabled: boolean;
  status: "idle" | "scanning" | "paused" | "trade_lock";
  tfs: string[];
  marketsTotal: number;
  marketsAnalysed: number;
  currentSymbol: string;
  currentTf: string;
  lastScanAt: number;
  lastPassAt: number;
  passes: number;
  scannedRows: number;
  setupsWatched: number;
  opportunitiesFound: number;
  msgs: { at: number; kind: string; text: string }[];
  opportunity: Opportunity | null;
  lock: { symbol: string; tf: string } | null;
  source: string;
}

const POLL_MS = 8000;
const TF_LABEL: Record<string, string> = {
  "1m": "M1", "3m": "M3", "5m": "M5", "15m": "M15", "30m": "M30",
  "1h": "H1", "2h": "H2", "4h": "H4", "1d": "D1",
};

function fmtUtc(ms: number): string {
  if (!ms) return "—";
  return `${new Date(ms).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "UTC",
  })} UTC`;
}

/** HALO robot holding a holographic globe of candlesticks — mockup artwork. */
export function ScannerBotArt(): React.ReactElement {
  return (
    <svg viewBox="0 0 120 150" className="h-full w-full" role="img" aria-label="HALO Timeframe Scanner Bot illustration">
      <defs>
        <radialGradient id="tfsb-globe" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="rgba(46,204,255,0.5)" />
          <stop offset="70%" stopColor="rgba(30,144,255,0.16)" />
          <stop offset="100%" stopColor="rgba(2,11,26,0)" />
        </radialGradient>
        <linearGradient id="tfsb-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9BE8FF" />
          <stop offset="55%" stopColor="#3E6FB4" />
          <stop offset="100%" stopColor="#12264A" />
        </linearGradient>
      </defs>
      {/* antenna */}
      <line x1="60" y1="10" x2="60" y2="22" stroke={C.gold} strokeWidth="1.6" />
      <circle cx="60" cy="8" r="3.2" fill={C.gold}>
        <animate attributeName="opacity" values="1;0.35;1" dur="1.8s" repeatCount="indefinite" />
      </circle>
      {/* head */}
      <rect x="38" y="22" width="44" height="30" rx="10" fill="url(#tfsb-body)" stroke={A.cyan(0.65)} strokeWidth="1.2" />
      <rect x="44" y="30" width="32" height="12" rx="6" fill="#020B1A" stroke={A.cyan(0.5)} strokeWidth="0.8" />
      <circle cx="53" cy="36" r="2.6" fill={C.cyan}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="67" cy="36" r="2.6" fill={C.cyan}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" begin="0.6s" repeatCount="indefinite" />
      </circle>
      <rect x="50" y="46" width="20" height="2.4" rx="1.2" fill={A.cyan(0.4)} />
      {/* torso */}
      <rect x="42" y="56" width="36" height="30" rx="9" fill="url(#tfsb-body)" stroke={A.cyan(0.5)} strokeWidth="1.1" />
      <rect x="52" y="64" width="16" height="10" rx="3" fill="#020B1A" stroke={A.gold(0.75)} strokeWidth="1" />
      <circle cx="60" cy="69" r="2.2" fill={C.gold} />
      {/* left arm holding the globe */}
      <path d="M42 62 Q28 66 26 80" fill="none" stroke="#3E6FB4" strokeWidth="5" strokeLinecap="round" />
      <circle cx="24" cy="86" r="3.4" fill="#9BE8FF" stroke={A.cyan(0.7)} strokeWidth="0.8" />
      {/* right arm */}
      <path d="M78 62 Q92 66 94 80" fill="none" stroke="#3E6FB4" strokeWidth="5" strokeLinecap="round" />
      <circle cx="96" cy="86" r="3.4" fill="#9BE8FF" stroke={A.cyan(0.7)} strokeWidth="0.8" />
      {/* holographic globe with candles */}
      <circle cx="60" cy="104" r="30" fill="url(#tfsb-globe)" />
      <circle cx="60" cy="104" r="30" fill="none" stroke={A.cyan(0.55)} strokeWidth="1.2" />
      <ellipse cx="60" cy="104" rx="30" ry="11" fill="none" stroke={A.cyan(0.3)} strokeWidth="0.8" />
      <ellipse cx="60" cy="104" rx="11" ry="30" fill="none" stroke={A.cyan(0.3)} strokeWidth="0.8" />
      {/* candlesticks inside the globe */}
      <line x1="48" y1="92" x2="48" y2="112" stroke={C.green} strokeWidth="1.4" />
      <rect x="45" y="97" width="6" height="9" rx="1" fill={C.green} />
      <line x1="60" y1="88" x2="60" y2="110" stroke={C.red} strokeWidth="1.4" />
      <rect x="57" y="92" width="6" height="10" rx="1" fill={C.red} />
      <line x1="72" y1="94" x2="72" y2="116" stroke={C.green} strokeWidth="1.4" />
      <rect x="69" y="99" width="6" height="10" rx="1" fill={C.green} />
      {/* glow pulse */}
      <circle cx="60" cy="104" r="30" fill="none" stroke={A.cyan(0.8)} strokeWidth="0.8" opacity="0.5">
        <animate attributeName="r" values="28;33;28" dur="3.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.55;0.1;0.55" dur="3.2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.muted }}>{label}</span>
      <span className="truncate font-mono text-[10px] font-semibold" style={{ color: valueColor ?? C.txt2 }}>{value}</span>
    </div>
  );
}

export function ScannerBotCard(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<ScannerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tf-scanner", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as ScannerState;
      if (aliveRef.current && j.ok) setSt(j);
    } catch {
      // keep the last known state — the poll retries
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const t = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, [load]);

  const control = useCallback(async (action: "start" | "pause" | "resume") => {
    setBusy(true);
    try {
      const r = await fetch("/api/tf-scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) {
        const j = (await r.json()) as ScannerState;
        if (j.ok) setSt(j);
      }
    } catch {
      // next poll refreshes the truth
    } finally {
      setBusy(false);
    }
  }, []);

  const status = st?.status ?? "idle";
  const active = status === "scanning";
  const statusLabel =
    status === "scanning" ? "ACTIVE" :
    status === "trade_lock" ? "PAUSED · TRADE RUNNING" :
    status === "paused" ? "PAUSED" : "IDLE";
  const statusColor = active ? C.green : status === "trade_lock" ? C.warn : status === "paused" ? C.warn : C.muted;
  const lastMsg = st?.msgs.length ? st.msgs[st.msgs.length - 1] : null;
  const opp = st?.opportunity ?? null;

  return (
    <div className="mx-2.5 mb-1.5 shrink-0">
      {/* ── collapsed strip ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:brightness-110"
        style={{
          borderColor: active ? A.cyan(0.5) : "rgba(15,46,88,0.9)",
          background: "linear-gradient(90deg, rgba(46,204,255,0.08), rgba(2,11,26,0.6) 60%)",
          boxShadow: active ? `0 0 12px ${A.cyan(0.18)}` : "none",
        }}
      >
        <Radar size={13} style={{ color: active ? C.cyan : C.muted }} className={active ? "animate-spin" : ""} aria-hidden />
        <span className="text-[8.5px] font-extrabold tracking-[0.2em]" style={{ color: C.cyan }}>
          TIMEFRAME SCANNER BOT
        </span>
        <span
          className="ml-auto rounded-full px-1.5 py-px text-[7px] font-extrabold tracking-[0.14em]"
          style={{ background: `${statusColor}22`, color: statusColor }}
        >
          {statusLabel}
        </span>
        {open ? <ChevronUp size={12} color={C.muted} /> : <ChevronDown size={12} color={C.muted} />}
      </button>

      {/* ── expanded card (mockup design) ── */}
      {open && (
        <div
          className="mt-1.5 overflow-hidden rounded-xl border"
          style={{
            borderColor: A.cyan(0.45),
            background: "linear-gradient(160deg, #04122B 0%, #020B1A 55%, #010714 100%)",
            boxShadow: `0 0 18px ${A.cyan(0.16)}, inset 0 0 26px rgba(2,11,26,0.9)`,
          }}
        >
          {/* header band */}
          <div
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: "rgba(15,46,88,0.9)", background: "linear-gradient(90deg, rgba(46,204,255,0.1), transparent 75%)" }}
          >
            <span className="halo-anim-beacon inline-block h-1.5 w-1.5 rounded-full" style={{ background: active ? C.green : statusColor, ["--beacon" as string]: `${statusColor}88` } as React.CSSProperties} aria-hidden />
            <span className="text-[9px] font-extrabold tracking-[0.22em]" style={{ color: C.cyan }}>TIMEFRAME SCANNER BOT</span>
            <span
              className="ml-auto rounded-full px-1.5 py-px text-[7px] font-extrabold tracking-[0.14em]"
              style={{ background: `${statusColor}1e`, color: statusColor, border: `1px solid ${statusColor}55` }}
            >
              {statusLabel}
            </span>
          </div>

          <div className="flex gap-2 px-2.5 py-2.5">
            {/* robot artwork */}
            <div className="w-[86px] shrink-0 self-start" style={{ filter: `drop-shadow(0 0 8px ${A.cyan(0.25)})` }}>
              <ScannerBotArt />
            </div>

            {/* right content */}
            <div className="min-w-0 flex-1 space-y-2">
              {/* scanning timeframes */}
              <div>
                <p className="mb-1 text-[8px] font-extrabold tracking-[0.18em]" style={{ color: C.gold }}>SCANNING TIMEFRAMES</p>
                <div className="flex flex-wrap gap-1">
                  {(st?.tfs ?? []).map((tf) => {
                    const cur = st?.currentTf === tf && active;
                    return (
                      <span
                        key={tf}
                        className="rounded px-1.5 py-px font-mono text-[8px] font-bold"
                        style={{
                          border: `1px solid ${cur ? C.cyan : "rgba(28,68,120,0.9)"}`,
                          background: cur ? A.cyan(0.18) : "rgba(2,18,41,0.8)",
                          color: cur ? C.cyan : C.txt2,
                          boxShadow: cur ? `0 0 8px ${A.cyan(0.3)}` : "none",
                        }}
                      >
                        {TF_LABEL[tf] ?? tf.toUpperCase()}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* honest stats */}
              <div className="space-y-1 rounded-lg border border-[rgba(15,46,88,0.9)] bg-[rgba(2,18,41,0.55)] px-2 py-1.5">
                <StatRow label="MARKETS ANALYSED" value={`${st ? st.marketsAnalysed : 0} / ${st ? st.marketsTotal : 0} pairs × timeframes`} />
                <StatRow label="LAST SCAN" value={fmtUtc(st?.lastScanAt ?? 0)} />
                <StatRow
                  label="STATUS"
                  value={
                    status === "scanning"
                      ? st?.currentSymbol
                        ? `Scanning ${st.currentSymbol} · ${st.currentTf.toUpperCase()}…`
                        : "Warming up the market feeds…"
                      : status === "trade_lock"
                        ? `Paused — trade running on ${st?.lock?.symbol ?? ""} ${st?.lock?.tf ?? ""}`
                        : status === "paused"
                          ? "Paused by trader — press Resume"
                          : "Idle — press Start"
                  }
                  valueColor={status === "scanning" ? C.cyan : statusColor}
                />
                {st && st.passes > 0 && <StatRow label="PASSES" value={`${st.passes} full · ${st.scannedRows} rows scanned`} />}
                {st && st.opportunitiesFound > 0 && <StatRow label="OPPORTUNITIES" value={`${st.opportunitiesFound} found · ${st.setupsWatched} setups watched`} valueColor={C.green} />}
              </div>
            </div>
          </div>

          {/* HALO message */}
          <div className="px-2.5 pb-2">
            <div className="rounded-lg border px-2.5 py-2" style={{ borderColor: "rgba(46,204,255,0.28)", background: "rgba(2,18,41,0.9)" }}>
              <p className="mb-0.5 text-[7.5px] font-extrabold tracking-[0.2em]" style={{ color: C.cyan }}>HALO MESSAGE</p>
              <p className="text-[10.5px] leading-snug text-[#EAF3FF]">
                {lastMsg ? lastMsg.text : "Timeframe Scanner Bot ready. Press Start to begin scanning all supported markets and timeframes using the existing HALO trading strategy."}
              </p>
            </div>
          </div>

          {/* latest qualifying opportunity */}
          <div className="px-2.5 pb-2.5">
            <div
              className="rounded-lg border px-2.5 py-2"
              style={{
                borderColor: opp ? (opp.dir === -1 ? A.red(0.5) : A.green(0.5)) : "rgba(15,46,88,0.9)",
                background: opp ? (opp.dir === -1 ? "rgba(255,77,94,0.06)" : "rgba(0,214,143,0.06)") : "rgba(2,18,41,0.55)",
              }}
            >
              <div className="flex items-center gap-2">
                <p className="text-[7.5px] font-extrabold tracking-[0.2em]" style={{ color: C.gold }}>LATEST QUALIFYING OPPORTUNITY</p>
                {opp && (
                  <span
                    className="rounded px-1.5 py-px text-[7.5px] font-extrabold tracking-wider"
                    style={{ background: opp.dir === -1 ? A.red(0.16) : A.green(0.16), color: opp.dir === -1 ? C.red : C.green }}
                  >
                    {opp.dir === -1 ? "SELL" : "BUY"}
                  </span>
                )}
              </div>
              {opp ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-[13px] font-bold" style={{ color: C.txt }}>{opp.symbolLabel.split("·")[0].trim() || opp.symbol}</span>
                    <span className="rounded border border-[rgba(28,68,120,0.9)] bg-[rgba(2,18,41,0.8)] px-1 font-mono text-[8px] font-bold" style={{ color: C.txt2 }}>
                      {TF_LABEL[opp.tf] ?? opp.tf.toUpperCase()}
                    </span>
                    <span className="ml-auto font-mono text-[9px]" style={{ color: C.muted }}>{fmtUtc(opp.time)}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-1 text-center">
                    {[
                      { l: "ENTRY", v: opp.entry },
                      { l: "SL", v: opp.sl },
                      { l: "TP", v: opp.tp },
                    ].map((x) => (
                      <div key={x.l} className="rounded border border-[rgba(15,46,88,0.9)] bg-[rgba(2,11,26,0.7)] px-1 py-1">
                        <p className="text-[7px] font-extrabold tracking-[0.14em]" style={{ color: C.muted }}>{x.l}</p>
                        <p className="truncate font-mono text-[9.5px] font-semibold" style={{ color: C.txt2 }}>{x.v}</p>
                      </div>
                    ))}
                    <div className="rounded border px-1 py-1" style={{ borderColor: A.gold(0.5), background: A.gold(0.08) }}>
                      <p className="text-[7px] font-extrabold tracking-[0.14em]" style={{ color: C.muted }}>R:R</p>
                      <p className="font-mono text-[9.5px] font-semibold" style={{ color: C.goldHover }}>{opp.rr}</p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded px-1.5 py-px text-[7.5px] font-extrabold tracking-wider" style={{ background: A.cyan(0.12), color: C.cyan }}>
                      {opp.status}
                    </span>
                    <span className="truncate text-[8px]" style={{ color: C.muted }}>
                      Confirmed by the existing HALO strategy · {opp.sigMode}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetails((d) => !d)}
                      className="ml-auto shrink-0 rounded-md border px-2 py-1 text-[8px] font-extrabold tracking-[0.14em] transition-colors hover:brightness-110"
                      style={{ borderColor: A.cyan(0.55), background: A.cyan(0.12), color: C.cyan }}
                    >
                      {details ? "HIDE DETAILS" : "VIEW DETAILS"}
                    </button>
                  </div>
                  {details && (
                    <div className="mt-1.5 space-y-1 rounded border border-[rgba(15,46,88,0.9)] bg-[rgba(2,11,26,0.75)] px-2 py-1.5">
                      <StatRow label="INSTRUMENT" value={`${opp.symbolLabel} (${opp.symbol})`} />
                      <StatRow label="DIRECTION" value={opp.dir === -1 ? "SELL" : "BUY"} valueColor={opp.dir === -1 ? C.red : C.green} />
                      <StatRow label="TIMEFRAME" value={opp.tf.toUpperCase()} />
                      <StatRow label="ENTRY (DOTTED TRIGGER)" value={String(opp.entry)} />
                      <StatRow label="STOP LOSS" value={String(opp.sl)} valueColor={C.red} />
                      <StatRow label="TAKE PROFIT" value={String(opp.tp)} valueColor={C.green} />
                      <StatRow label="RISK → REWARD" value={`${opp.riskPips.toFixed(1)} → ${opp.rewardPips.toFixed(1)} pips (${opp.rr})`} />
                      <StatRow label="SIGNAL TIME" value={fmtUtc(opp.time)} />
                      <StatRow label="CONFIRMATION" value={`Existing HALO strategy · ${opp.sigMode}`} valueColor={C.cyan} />
                      <StatRow label="SIGNAL STATUS" value={opp.status} valueColor={opp.status === "ENTRY FIRED" ? C.cyan : C.goldHover} />
                      <p className="pt-0.5 text-[8px] leading-snug" style={{ color: C.muted }}>
                        All values are exactly as calculated by the existing HALO strategy engine. The scanner never executes trades.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-1 text-[10px] leading-snug" style={{ color: C.muted }}>
                  {status === "idle" || status === "paused"
                    ? "No qualifying opportunity on record yet — start or resume the scanner."
                    : "Scanning all supported markets and timeframes — no qualifying opportunity has been found yet. The latest one will appear here the moment the existing HALO strategy identifies it."}
                </p>
              )}
            </div>
          </div>

          {/* controls — start · pause · resume ONLY */}
          <div className="flex items-center gap-1.5 border-t px-2.5 py-2" style={{ borderColor: "rgba(15,46,88,0.9)" }}>
            {status !== "scanning" && status !== "trade_lock" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void control(status === "paused" ? "resume" : "start")}
                className="flex-1 rounded-md border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.16em] transition-colors hover:brightness-110 disabled:opacity-40"
                style={{ borderColor: A.green(0.55), background: A.green(0.12), color: C.green }}
              >
                {status === "paused" ? "RESUME SCANNING" : "START SCANNING"}
              </button>
            )}
            {status === "scanning" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void control("pause")}
                className="flex-1 rounded-md border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.16em] transition-colors hover:brightness-110 disabled:opacity-40"
                style={{ borderColor: A.warn(0.55), background: A.warn(0.1), color: C.warn }}
              >
                PAUSE SCANNING
              </button>
            )}
            {status === "trade_lock" && (
              <span className="flex-1 rounded-md border px-2 py-1.5 text-center text-[9px] font-extrabold tracking-[0.14em]" style={{ borderColor: "rgba(15,46,88,0.9)", color: C.muted }}>
                AUTO-RESUMES AFTER TP / SL
              </span>
            )}
            <span className="shrink-0 font-mono text-[7.5px] tracking-wider" style={{ color: C.dim }}>
              {st?.source && st.source !== "—" ? `feed · ${st.source}` : "signal-only bot"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
