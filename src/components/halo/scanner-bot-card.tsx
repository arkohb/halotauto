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
    <svg viewBox="0 0 260 320" className="h-full w-full" role="img" aria-label="HALO Timeframe Scanner Bot illustration">
      <defs>
        <linearGradient id="tsba-armor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F6FCFF" />
          <stop offset="38%" stopColor="#CFE2F4" />
          <stop offset="72%" stopColor="#8FB2D6" />
          <stop offset="100%" stopColor="#4A6C99" />
        </linearGradient>
        <linearGradient id="tsba-armor2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E4F1FC" />
          <stop offset="55%" stopColor="#9FBCDA" />
          <stop offset="100%" stopColor="#3C5F8F" />
        </linearGradient>
        <linearGradient id="tsba-visor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0A1B38" />
          <stop offset="100%" stopColor="#040B1C" />
        </linearGradient>
        <radialGradient id="tsba-globe" cx="46%" cy="40%" r="62%">
          <stop offset="0%" stopColor="rgba(150,228,255,0.68)" />
          <stop offset="45%" stopColor="rgba(46,160,255,0.34)" />
          <stop offset="100%" stopColor="rgba(6,20,48,0.08)" />
        </radialGradient>
        <linearGradient id="tsba-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD97A" />
          <stop offset="100%" stopColor="#D9A22B" />
        </linearGradient>
      </defs>

      {/* ── golden arcs behind the bot (mockup detail) ── */}
      <circle cx="118" cy="118" r="112" fill="none" stroke="url(#tsba-gold)" strokeWidth="2" strokeDasharray="150 560" strokeLinecap="round" opacity="0.55" />
      <circle cx="118" cy="118" r="100" fill="none" stroke="url(#tsba-gold)" strokeWidth="1.2" strokeDasharray="90 520" strokeLinecap="round" opacity="0.4" />
      <circle cx="118" cy="118" r="88" fill="none" stroke={A.cyan(0.25)} strokeWidth="0.8" strokeDasharray="3 9" />

      {/* ── left arm · relaxed ── */}
      <path d="M56 150 L44 198" stroke="url(#tsba-armor2)" strokeWidth="19" strokeLinecap="round" />
      <path d="M44 198 L46 240" stroke="url(#tsba-armor)" strokeWidth="16" strokeLinecap="round" />
      <circle cx="47" cy="248" r="8.5" fill="url(#tsba-armor2)" stroke={A.cyan(0.4)} strokeWidth="0.8" />

      {/* ── torso ── */}
      {/* waist + glowing abdomen strip */}
      <rect x="76" y="200" width="72" height="34" rx="14" fill="url(#tsba-armor2)" stroke={A.cyan(0.35)} strokeWidth="0.8" />
      <rect x="86" y="212" width="52" height="5.5" rx="2.75" fill={A.cyan(0.35)} />
      <rect x="90" y="212" width="44" height="5.5" rx="2.75" fill={C.cyan}>
        <animate attributeName="opacity" values="0.95;0.45;0.95" dur="2.6s" repeatCount="indefinite" />
      </rect>
      {/* chest armor */}
      <path d="M60 150 Q60 124 84 121 L136 121 Q160 124 160 150 L160 176 Q160 198 136 199 L84 199 Q60 198 60 176 Z" fill="url(#tsba-armor)" stroke={A.cyan(0.45)} strokeWidth="1" />
      {/* collar */}
      <rect x="90" y="114" width="44" height="12" rx="6" fill="#33507B" />
      <rect x="96" y="116" width="32" height="4" rx="2" fill="#0E1F3E" />
      {/* side vents */}
      <rect x="64" y="150" width="9" height="38" rx="4.5" fill="#2E4C77" opacity="0.85" />
      <rect x="147" y="150" width="9" height="38" rx="4.5" fill="#2E4C77" opacity="0.85" />
      {/* chest emblem — dark panel, gold HALO + waveform (mockup detail) */}
      <rect x="84" y="138" width="56" height="48" rx="11" fill="#040D20" stroke="url(#tsba-gold)" strokeWidth="1.4" />
      <g fill={C.gold}>
        <rect x="100" y="150" width="3" height="6" rx="1.5" />
        <rect x="106" y="147" width="3" height="9" rx="1.5" />
        <rect x="112" y="144" width="3" height="12" rx="1.5" />
        <rect x="118" y="147" width="3" height="9" rx="1.5" />
        <rect x="124" y="150" width="3" height="6" rx="1.5" />
      </g>
      <text x="112" y="176" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontSize="12.5" fontWeight="800" letterSpacing="3" fill="url(#tsba-gold)">HALO</text>

      {/* ── shoulder pauldrons ── */}
      <circle cx="58" cy="140" r="19" fill="url(#tsba-armor)" stroke={A.cyan(0.5)} strokeWidth="1" />
      <circle cx="58" cy="140" r="9" fill="#0B1D3C" stroke={A.cyan(0.55)} strokeWidth="0.9" />
      <circle cx="166" cy="140" r="19" fill="url(#tsba-armor)" stroke={A.cyan(0.5)} strokeWidth="1" />
      <circle cx="166" cy="140" r="9" fill="#0B1D3C" stroke={A.cyan(0.55)} strokeWidth="0.9" />

      {/* ── right arm · raised, palm under the globe ── */}
      <path d="M170 150 L204 188" stroke="url(#tsba-armor2)" strokeWidth="20" strokeLinecap="round" />
      <path d="M204 188 L198 154" stroke="url(#tsba-armor)" strokeWidth="17" strokeLinecap="round" />
      {/* open palm + fingers */}
      <ellipse cx="197" cy="147" rx="11.5" ry="7.5" fill="url(#tsba-armor)" stroke={A.cyan(0.45)} strokeWidth="0.8" />
      <rect x="186" y="130" width="5" height="15" rx="2.5" fill="url(#tsba-armor2)" transform="rotate(-16 188 137)" />
      <rect x="194" y="127" width="5" height="17" rx="2.5" fill="url(#tsba-armor2)" transform="rotate(-4 196 135)" />
      <rect x="201" y="128" width="5" height="16" rx="2.5" fill="url(#tsba-armor2)" transform="rotate(9 203 136)" />
      <rect x="208" y="132" width="5" height="13" rx="2.5" fill="url(#tsba-armor2)" transform="rotate(22 210 138)" />

      {/* ── head ── */}
      {/* gold head fin (mockup accent) */}
      <path d="M86 40 Q90 22 104 18 L99 38 Z" fill="url(#tsba-gold)" opacity="0.95" />
      {/* helmet */}
      <path d="M68 70 Q68 34 110 34 Q152 34 152 70 L152 86 Q152 108 110 108 Q68 108 68 86 Z" fill="url(#tsba-armor)" stroke={A.cyan(0.55)} strokeWidth="1.1" />
      {/* helmet shine */}
      <path d="M78 54 Q86 40 104 36" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.65" />
      {/* ear pods */}
      <circle cx="66" cy="82" r="8" fill="#0B1D3C" stroke={A.cyan(0.6)} strokeWidth="1" />
      <circle cx="66" cy="82" r="3" fill={C.cyan}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx="154" cy="82" r="8" fill="#0B1D3C" stroke={A.cyan(0.6)} strokeWidth="1" />
      <circle cx="154" cy="82" r="3" fill={C.cyan}>
        <animate attributeName="opacity" values="1;0.4;1" dur="2.4s" begin="0.7s" repeatCount="indefinite" />
      </circle>
      {/* visor faceplate */}
      <rect x="76" y="58" width="68" height="38" rx="17" fill="url(#tsba-visor)" stroke={A.cyan(0.45)} strokeWidth="0.9" />
      {/* glowing eyes — angled, fierce (mockup detail) */}
      <ellipse cx="95" cy="77" rx="12" ry="7.5" fill={A.cyan(0.28)} />
      <ellipse cx="127" cy="77" rx="12" ry="7.5" fill={A.cyan(0.28)} />
      <path d="M84 78 Q95 68 106 77 Q95 83 84 78 Z" fill={C.cyan}>
        <animate attributeName="opacity" values="1;0.72;1" dur="3.1s" repeatCount="indefinite" />
      </path>
      <path d="M138 77 Q127 68 116 77 Q127 83 138 77 Z" fill={C.cyan}>
        <animate attributeName="opacity" values="1;0.72;1" dur="3.1s" begin="0.5s" repeatCount="indefinite" />
      </path>
      <ellipse cx="96" cy="75" rx="3" ry="1.8" fill="#EAFBFF" />
      <ellipse cx="126" cy="75" rx="3" ry="1.8" fill="#EAFBFF" />
      {/* chin slot */}
      <rect x="102" y="90" width="16" height="3.4" rx="1.7" fill={A.cyan(0.35)} />

      {/* ── holographic candle globe (mockup centrepiece) ── */}
      <circle cx="196" cy="92" r="50" fill="url(#tsba-globe)" />
      <circle cx="196" cy="92" r="50" fill="none" stroke={A.cyan(0.7)} strokeWidth="1.2" />
      <ellipse cx="196" cy="92" rx="50" ry="15" fill="none" stroke={A.cyan(0.38)} strokeWidth="0.7" />
      <ellipse cx="196" cy="92" rx="15" ry="50" fill="none" stroke={A.cyan(0.38)} strokeWidth="0.7" />
      <line x1="150" y1="80" x2="242" y2="80" stroke={A.cyan(0.16)} strokeWidth="0.7" />
      <line x1="150" y1="104" x2="242" y2="104" stroke={A.cyan(0.16)} strokeWidth="0.7" />
      {/* candles */}
      <line x1="176" y1="66" x2="176" y2="110" stroke={C.green} strokeWidth="1.3" />
      <rect x="172.5" y="78" width="7" height="20" rx="1" fill={C.green} />
      <line x1="190" y1="60" x2="190" y2="102" stroke={C.red} strokeWidth="1.3" />
      <rect x="186.5" y="70" width="7" height="17" rx="1" fill={C.red} />
      <line x1="204" y1="68" x2="204" y2="114" stroke={C.green} strokeWidth="1.3" />
      <rect x="200.5" y="80" width="7" height="22" rx="1" fill={C.green} />
      <line x1="218" y1="62" x2="218" y2="100" stroke={C.green} strokeWidth="1.3" />
      <rect x="214.5" y="70" width="7" height="15" rx="1" fill={C.green} />
      {/* orbit ring */}
      <g transform="rotate(-16 196 92)">
        <ellipse cx="196" cy="92" rx="64" ry="17" fill="none" stroke={A.cyan(0.4)} strokeWidth="1.2" />
        <path d="M132 92 A64 17 0 0 0 260 92" fill="none" stroke={A.cyan(0.85)} strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {/* glow pulse */}
      <circle cx="196" cy="92" r="50" fill="none" stroke={A.cyan(0.8)} strokeWidth="0.9">
        <animate attributeName="r" values="48;56;48" dur="3.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.5;0.08;0.5" dur="3.2s" repeatCount="indefinite" />
      </circle>
      {/* sparkles */}
      <g fill="#BFF0FF">
        <path d="M148 42 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z">
          <animate attributeName="opacity" values="1;0.15;1" dur="2.2s" repeatCount="indefinite" />
        </path>
        <path d="M246 58 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 3.2 -1.3 Z">
          <animate attributeName="opacity" values="0.2;1;0.2" dur="2.8s" repeatCount="indefinite" />
        </path>
        <path d="M152 138 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 Z">
          <animate attributeName="opacity" values="1;0.2;1" dur="3.4s" repeatCount="indefinite" />
        </path>
      </g>
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
  const failRef = useRef(0);
  const retryAtRef = useRef(0);
  const retryDelayRef = useRef(1200); // self-heal backoff start

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tf-scanner", { cache: "no-store" });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = (await r.json()) as ScannerState;
      if (!aliveRef.current || !j.ok) return;
      failRef.current = 0;
      retryDelayRef.current = 1200;
      setSt(j);
    } catch {
      if (!aliveRef.current) return;
      failRef.current += 1;
      // keep the last known state — the self-heal ticker retries fast
      retryAtRef.current = Date.now() + retryDelayRef.current;
      retryDelayRef.current = Math.min(5000, Math.round(retryDelayRef.current * 1.6));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const t = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), POLL_MS);
    const heal = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (failRef.current === 0 || Date.now() < retryAtRef.current) return;
      retryAtRef.current = Date.now() + retryDelayRef.current;
      retryDelayRef.current = Math.min(5000, Math.round(retryDelayRef.current * 1.6));
      void load();
    }, 400);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(t);
      window.clearInterval(id);
      window.clearInterval(heal);
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
