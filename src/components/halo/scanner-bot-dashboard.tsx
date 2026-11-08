"use client";

// ════════════════════════════════════════════════════════════════════════
//  SCANNER BOT DASHBOARD · "Neon Timeframe Scanner" mockup edition
//
//  Faithful rebuild of the owner's mockup as one HUD card:
//    • robot artwork left · title + status pill + controls + gear right
//    • info rows — Scanning Timeframes · Markets Analysed · Last Scan ·
//      Status · big glowing coverage ring with status word
//    • HALO message bubble with typing dots while scanning
//    • gold Latest Opportunity band + View Details expansion
//  Every value comes from /api/tf-scanner exactly as the existing 3EL
//  engine reports it — the ring is REAL universe coverage (rows warmed),
//  the R:R slot is the engine's real reward:risk (no invented confidence).
//  The bot never executes trades — nothing here does either.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, BarChart3, ChevronRight, Crosshair, ListChecks, RefreshCw, Search, Settings, Star, Zap } from "lucide-react";
import { A, C, fmtPx, type PillTone } from "@/lib/halo/ui-helpers";
import { getSymbolMeta } from "@/lib/market-symbols";
import { StateFrame, TelemetryRow } from "./panel";
import { ScannerBotArt } from "./scanner-bot-card";
import { ScannerVoicePanel } from "./scanner-voice-panel";
import { useHaloVoice } from "./voice-provider";

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

interface ScannerMsg {
  at: number;
  kind: "info" | "opportunity" | "pause" | "resume";
  text: string;
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
  rangeSkips: number;
  startedAt: number;
  opportunity: Opportunity | null;
  recent: Opportunity[];
  msgs: ScannerMsg[];
  lock: { symbol: string; tf: string } | null;
  source: string;
  sources: Record<string, number>;
  lastTickAt: number;
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
  onView?: (v: "settings") => void;
}

const POLL_MS = 6000;
const FAIL_FAST_MS = 1200; // first self-heal retry after a failed poll
const FAIL_MAX_MS = 5000; // self-heal backoff ceiling
const ERR_AFTER_FAILS = 3; // consecutive failures before the unreachable strip
const TF_LABEL: Record<string, string> = {
  "1m": "M1", "3m": "M3", "5m": "M5", "15m": "M15", "30m": "M30",
  "1h": "H1", "2h": "H2", "4h": "H4", "1d": "D1",
};

function fmtMockDate(ms: number): string {
  if (!ms) return "—";
  return `${new Date(ms).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZone: "UTC",
  })} UTC`;
}

function fmtClock(ms: number): string {
  if (!ms) return "—";
  return `${new Date(ms).toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" })} UTC`;
}

const STATUS_META: Record<ScannerState["status"], { label: string; tone: PillTone; color: string; ring: string }> = {
  scanning: { label: "Active", tone: "ok", color: C.green, ring: "Scanning…" },
  trade_lock: { label: "Trade Running", tone: "warn", color: C.warn, ring: "Trade Lock" },
  paused: { label: "Paused", tone: "warn", color: C.warn, ring: "Paused" },
  idle: { label: "Idle", tone: "muted", color: C.muted, ring: "Idle" },
};

function statusLine(st: ScannerState): string {
  switch (st.status) {
    case "scanning":
      return st.currentSymbol
        ? `Scanning ${st.currentSymbol} · ${st.currentTf.toUpperCase()}…`
        : "Analyzing market conditions…";
    case "trade_lock":
      return `Trade running on ${st.lock?.symbol ?? ""} ${st.lock?.tf.toUpperCase()} — auto-resumes after TP / SL`;
    case "paused":
      return "Paused by trader — press Resume";
    default:
      return "Idle — press Start";
  }
}

function subtitleFor(st: ScannerState | null): string {
  if (!st) return "Connecting to the scanner feed…";
  switch (st.status) {
    case "scanning":
      return "Scanning All Timeframes for Trading Opportunities…";
    case "trade_lock":
      return "Holding while a trade runs — scanning resumes automatically.";
    case "paused":
      return "Scanner paused — press Resume to continue the sweep.";
    default:
      return "Ready to scan every supported market and timeframe.";
  }
}

function oppStatusColor(status: string): string {
  if (status.startsWith("TP")) return C.green;
  if (status.startsWith("SL")) return C.red;
  return C.cyan;
}

/** Format a price with the symbol's real strategy precision — raw floats
 *  ("4940.6817002868065") must never reach the screen. */
function pxOf(symbol: string, v: number): string {
  if (!isFinite(v)) return "—";
  try {
    return fmtPx(v, getSymbolMeta(symbol).mintick);
  } catch {
    return String(v);
  }
}

/** mockup progress ring — REAL coverage: rows warmed ÷ total universe rows */
function ProgressRing({ pct, word, scanning }: { pct: number; word: string; scanning: boolean }) {
  const R = 60;
  const CIRC = 2 * Math.PI * R;
  const p = Math.min(100, Math.max(0, pct));
  const off = CIRC * (1 - p / 100);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[148px] w-[148px]" style={{ filter: `drop-shadow(0 0 14px ${A.cyan(0.35)})` }}>
        <svg viewBox="0 0 150 150" className="h-full w-full -rotate-90" role="img" aria-label={`Scan coverage ${p}%`}>
          <defs>
            <linearGradient id="tsbd-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#EAF9FF" />
              <stop offset="45%" stopColor={C.cyan} />
              <stop offset="100%" stopColor={C.blue} />
            </linearGradient>
          </defs>
          <circle cx="75" cy="75" r={R} fill="none" stroke="rgba(8,34,66,0.95)" strokeWidth="11" />
          <circle cx="75" cy="75" r={R} fill="none" stroke={A.cyan(0.14)} strokeWidth="11" />
          <circle
            cx="75" cy="75" r={R} fill="none"
            stroke="url(#tsbd-ring)" strokeWidth="11" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={off}
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
          <circle cx="75" cy="75" r="71" fill="none" stroke={A.cyan(0.3)} strokeWidth="1.6" strokeDasharray="1.5 6.2" />
          <circle cx="75" cy="75" r="50" fill="none" stroke={A.cyan(0.14)} strokeWidth="1" />
          {/* glowing knob at the end of the progress arc */}
          {p > 0 && (() => {
            const th = ((p / 100) * 360 - 90) * (Math.PI / 180);
            const kx = 75 + R * Math.cos(th);
            const ky = 75 + R * Math.sin(th);
            return (
              <g>
                <circle cx={kx} cy={ky} r="7" fill={A.cyan(0.3)} />
                <circle cx={kx} cy={ky} r="3.6" fill="#EAFBFF" stroke={C.cyan} strokeWidth="1.4" />
              </g>
            );
          })()}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[27px] font-extrabold tracking-tight" style={{ color: C.txt, textShadow: `0 0 16px ${A.cyan(0.55)}` }}>
            {p}%
          </span>
        </div>
        {scanning && (
          <span
            className="halo-anim-beacon absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
            style={{ background: C.cyan, ["--beacon" as string]: `${C.cyan}88` } as React.CSSProperties}
            aria-hidden
          />
        )}
      </div>
      <span className="text-[12px] font-bold tracking-wide" style={{ color: C.ice }}>{word}</span>
    </div>
  );
}

function InfoRow({ icon, label, value, iconColor }: { icon: React.ReactNode; label: string; value: string; iconColor: string }) {
  return (
    <div className="flex items-start gap-2.5 border-b py-[7px] last:border-b-0" style={{ borderColor: "rgba(15,46,88,0.75)" }}>
      <span className="mt-[2px] shrink-0" style={{ color: iconColor }} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11.5px] font-bold leading-snug" style={{ color: C.txt }}>{label}</p>
        <p className="break-words text-[11.5px] leading-snug" style={{ color: C.txt2 }}>{value}</p>
      </div>
    </div>
  );
}

/** typing dots shown while the bot is actively scanning (mockup detail) */
function TypingDots() {
  return (
    <span className="ml-1.5 inline-flex translate-y-[-1px] items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-[4px] w-[4px] animate-bounce rounded-full"
          style={{ background: C.cyan, animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

/* ───────────────────── recent opportunities (inside details) ───────────── */
function RecentBook({ recent }: { recent: Opportunity[] }) {
  if (recent.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-[10px]" style={{ borderColor: "rgba(15,46,88,0.9)", color: C.muted }}>
        No opportunities on record yet — the book fills in as real scanner fires arrive. Nothing is invented.
      </p>
    );
  }
  return (
    <div className="halo-scroll max-h-[300px] overflow-auto rounded-lg border" style={{ borderColor: "rgba(15,46,88,0.9)" }}>
      <table className="w-full min-w-[600px] border-collapse text-left">
        <thead>
          <tr>
            {["SIGNAL TIME", "SYMBOL", "TF", "SIDE", "ENTRY", "SL", "TP", "R:R", "STATUS"].map((h) => (
              <th key={h} className="border-b px-2.5 py-1.5 text-[8px] font-extrabold tracking-[0.14em]" style={{ borderColor: C.lineInner, background: "rgba(2,16,36,0.95)", color: C.label }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recent.map((o, i) => (
            <tr key={`${o.symbol}:${o.tf}:${o.time}:${i}`} className="transition-colors hover:bg-[rgba(46,204,255,0.04)]">
              <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.muted }}>{fmtClock(o.time)}</td>
              <td className="border-b px-2.5 py-1.5 text-[10.5px] font-bold" style={{ borderColor: C.divider, color: C.txt }}>{o.symbolLabel.split("·")[0].trim() || o.symbol}</td>
              <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px] font-bold" style={{ borderColor: C.divider, color: C.txt2 }}>{TF_LABEL[o.tf] ?? o.tf.toUpperCase()}</td>
              <td className="border-b px-2.5 py-1.5">
                <span className="rounded px-1.5 py-px text-[8px] font-extrabold tracking-wider" style={{ background: o.dir === -1 ? A.red(0.14) : A.green(0.14), color: o.dir === -1 ? C.red : C.green }}>
                  {o.dir === -1 ? "SELL" : "BUY"}
                </span>
              </td>
              <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.txt2 }}>{pxOf(o.symbol, o.entry)}</td>
              <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.red }}>{pxOf(o.symbol, o.sl)}</td>
              <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.green }}>{pxOf(o.symbol, o.tp)}</td>
              <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.goldHover }}>{o.rr}</td>
              <td className="border-b px-2.5 py-1.5 text-[8.5px] font-extrabold tracking-wide" style={{ borderColor: C.divider, color: oppStatusColor(o.status) }}>{o.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────── live market feed strip ───────────── */
const SOURCE_LABEL: Record<string, string> = {
  simulator: "SIM MARKET",
  yahoo: "YAHOO",
  binance: "BINANCE",
  bybit: "BYBIT",
  okx: "OKX",
  coinbase: "COINBASE",
};

const SOURCE_ORDER = ["yahoo", "binance", "bybit", "okx", "coinbase", "simulator"];

/**
 * LIVE MARKET FEED strip — the dashboard's honest heartbeat. Shows which
 * feeds are actually streaming right now (rows warmed per source, the
 * simulated market included) and the age of the newest tick. The simulated
 * market is a REAL feed here by design — amber chip, pulsing like the rest.
 */
function FeedStrip({ st, scanning }: { st: ScannerState | null; scanning: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const sources = st?.sources ?? {};
  const entries = SOURCE_ORDER.filter((s) => (sources[s] ?? 0) > 0)
    .map((s) => [s, sources[s] as number] as const)
    // any source the engine reports that we don't label explicitly
    .concat(Object.entries(sources).filter(([s, n]) => n > 0 && !SOURCE_ORDER.includes(s)) as Array<[string, number]>);
  const tickAgeSec = st?.lastTickAt ? Math.max(0, Math.round((Date.now() - st.lastTickAt) / 1000)) : null;
  const beating = tickAgeSec != null && tickAgeSec <= 20 && Boolean(st?.enabled);
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-3 py-2 sm:px-5"
      style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(1,12,28,0.7)" }}
      role="status"
      aria-label="Live market feed status"
    >
      <span className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.16em]" style={{ color: beating ? C.green : C.muted }}>
        <span
          className={`inline-block h-[7px] w-[7px] rounded-full ${beating ? (scanning ? "halo-anim-beacon" : "animate-pulse") : ""}`}
          style={{ background: beating ? C.green : C.muted, boxShadow: beating ? `0 0 8px ${A.green(0.8)}` : "none", ["--beacon" as string]: `${C.green}88` } as React.CSSProperties}
          aria-hidden
        />
        LIVE MARKET FEED
      </span>
      {entries.length === 0 ? (
        <span className="text-[10.5px] font-bold" style={{ color: C.muted }}>
          {scanning ? "connecting — warming the first rows…" : st ? "idle — start the bot to open the feeds" : "connecting…"}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          {entries.map(([src, n]) => {
            const sim = src === "simulator";
            const color = sim ? C.warn : C.cyan;
            return (
              <span
                key={src}
                className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-extrabold uppercase tracking-wider"
                style={{ borderColor: sim ? A.warn(0.45) : A.cyan(0.35), background: sim ? A.warn(0.08) : A.cyan(0.07), color }}
              >
                <span className={`inline-block h-[5px] w-[5px] rounded-full ${scanning ? "animate-pulse" : ""}`} style={{ background: color }} aria-hidden />
                {SOURCE_LABEL[src] ?? src} · {n}{sim ? " · LIVE" : ""}
              </span>
            );
          })}
        </span>
      )}
      <span className="ml-auto font-mono text-[9.5px] font-bold tracking-wide" style={{ color: C.txt2 }}>
        {tickAgeSec == null ? "no ticks yet" : tickAgeSec <= 2 ? "last tick just now" : `last tick ${tickAgeSec}s ago`}
      </span>
    </div>
  );
}

/* ───────────────────── found trades · always-visible list ───────────── */
/**
 * Every trade the scanner bot found this session, in one visible list —
 * newest first, no hiding behind an expansion. Same engine-exact values as
 * the View Details book; the section appears the moment the first setup is
 * identified and grows as more fire.
 */
function FoundTradesList({ recent, scanning }: { recent: Opportunity[]; scanning: boolean }) {
  if (recent.length === 0) {
    if (!scanning) return null;
    return (
      <div className="border-t px-3 py-3 sm:px-5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(1,10,24,0.65)" }}>
        <div className="flex items-center gap-2">
          <ListChecks size={14} style={{ color: C.muted }} aria-hidden />
          <p className="text-[8.5px] font-extrabold tracking-[0.2em]" style={{ color: C.muted }}>FOUND TRADES · LIVE LIST</p>
        </div>
        <p className="mt-2 rounded-lg border border-dashed px-3 py-2.5 text-[10.5px]" style={{ borderColor: "rgba(15,46,88,0.9)", color: C.muted }}>
          No trades found yet — the scanner is watching every market × timeframe against the existing HALO strategy. The moment a setup qualifies it appears here, newest first.
        </p>
      </div>
    );
  }
  return (
    <div className="border-t px-3 py-3 sm:px-5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(1,10,24,0.65)" }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <ListChecks size={14} style={{ color: C.gold }} aria-hidden />
        <p className="text-[8.5px] font-extrabold tracking-[0.2em]" style={{ color: C.gold }}>FOUND TRADES · SCANNER PICKS</p>
        <span
          className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-wider"
          style={{ borderColor: A.green(0.5), background: A.green(0.1), color: C.green }}
        >
          <Zap size={9} aria-hidden /> {recent.length} ON RECORD
        </span>
      </div>
      <div className="halo-scroll max-h-[320px] overflow-auto rounded-lg border" style={{ borderColor: "rgba(15,46,88,0.9)" }}>
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr>
              {["SIGNAL TIME", "SYMBOL", "TF", "SIDE", "ENTRY", "SL", "TP", "R:R", "STATUS"].map((h) => (
                <th key={h} className="sticky top-0 border-b px-2.5 py-1.5 text-[8px] font-extrabold tracking-[0.14em]" style={{ borderColor: C.lineInner, background: "rgba(2,16,36,0.98)", color: C.label }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map((o, i) => (
              <tr key={`${o.symbol}:${o.tf}:${o.time}:${o.dir}:${i}`} className="transition-colors hover:bg-[rgba(46,204,255,0.05)]">
                <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.muted }}>{fmtClock(o.time)}</td>
                <td className="border-b px-2.5 py-1.5 text-[10.5px] font-bold" style={{ borderColor: C.divider, color: C.txt }}>{o.symbolLabel.split("·")[0].trim() || o.symbol}</td>
                <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px] font-bold" style={{ borderColor: C.divider, color: C.txt2 }}>{TF_LABEL[o.tf] ?? o.tf.toUpperCase()}</td>
                <td className="border-b px-2.5 py-1.5">
                  <span className="rounded px-1.5 py-px text-[8px] font-extrabold tracking-wider" style={{ background: o.dir === -1 ? A.red(0.14) : A.green(0.14), color: o.dir === -1 ? C.red : C.green }}>
                    {o.dir === -1 ? "SELL" : "BUY"}
                  </span>
                </td>
                <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.txt2 }}>{pxOf(o.symbol, o.entry)}</td>
                <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.red }}>{pxOf(o.symbol, o.sl)}</td>
                <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.green }}>{pxOf(o.symbol, o.tp)}</td>
                <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px] font-bold" style={{ borderColor: C.divider, color: C.goldHover }}>{o.rr}</td>
                <td className="border-b px-2.5 py-1.5 text-[8.5px] font-extrabold tracking-wide" style={{ borderColor: C.divider, color: oppStatusColor(o.status) }}>{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════ main dashboard ═══════════════════════ */
export function ScannerBotDashboard({ notify, onView }: Props) {
  const [st, setSt] = useState<ScannerState | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const aliveRef = useRef(true);
  const sigRef = useRef("");
  const failRef = useRef(0); // consecutive failed polls
  const retryAtRef = useRef(0); // when the next self-heal retry may fire
  const retryDelayRef = useRef(FAIL_FAST_MS); // current backoff delay
  // the bot's voice: shared provider engine (one mic / one speaker app-wide)
  const { profile, prefs, voice, convoOpen, speak } = useHaloVoice();

  const load = useCallback(async () => {
    try {
      // hard 8 s ceiling — a hung request must resolve as a failure so the
      // self-heal backoff keeps probing instead of waiting on a dead socket
      const r = await fetch("/api/tf-scanner", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (r.status === 401) {
        // the session is genuinely gone — the honest fix is a fresh sign-in,
        // not an endless "unreachable" strip over stale data
        window.location.assign("/login?next=%2F");
        return;
      }
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = (await r.json()) as ScannerState;
      if (!aliveRef.current) return;
      if (!j.ok) throw new Error("bad payload");
      failRef.current = 0;
      retryDelayRef.current = FAIL_FAST_MS;
      const sig = JSON.stringify(j);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSt(j);
      }
      setErr(false);
    } catch {
      if (!aliveRef.current) return;
      failRef.current += 1;
      // last known card stays visible; the strip only appears once the feed
      // is REPEATEDLY dead — a single hiccup never flashes the banner
      if (failRef.current >= ERR_AFTER_FAILS) setErr(true);
      retryAtRef.current = Date.now() + retryDelayRef.current;
      retryDelayRef.current = Math.min(FAIL_MAX_MS, Math.round(retryDelayRef.current * 1.6));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const t = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    // self-heal ticker — after a failed poll the feed retries on the backoff
    // schedule above instead of waiting out the whole 6 s poll, so the strip
    // clears almost the moment the server answers again
    const heal = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (failRef.current === 0 || Date.now() < retryAtRef.current) return;
      retryAtRef.current = Date.now() + retryDelayRef.current;
      retryDelayRef.current = Math.min(FAIL_MAX_MS, Math.round(retryDelayRef.current * 1.6));
      void load();
    }, 400);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(t);
      window.clearInterval(id);
      window.clearInterval(heal);
    };
  }, [load]);

  const control = useCallback(
    async (action: "start" | "pause" | "resume") => {
      setBusy(true);
      try {
        const r = await fetch("/api/tf-scanner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const j = (await r.json()) as ScannerState & { error?: string };
        if (!j.ok) {
          notify("Scanner Bot action failed", j.error, true);
        } else {
          sigRef.current = JSON.stringify(j);
          setSt(j);
          notify(
            action === "pause" ? "SCANNER BOT PAUSED" : action === "resume" ? "SCANNER BOT RESUMED" : "SCANNER BOT STARTED",
            action === "pause"
              ? "Scanning is on hold — press Resume to continue."
              : "Sweeping every supported market × timeframe against the existing HALO strategy. Signal-only — no trades are executed.",
          );
        }
      } catch (e) {
        notify("Scanner Bot request failed", (e as Error).message, true);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const status = st?.status ?? "idle";
  const meta = STATUS_META[status];
  const scanning = status === "scanning";
  const warm = st?.marketsAnalysed ?? 0;
  const total = st?.marketsTotal ?? 0;
  const pct = total > 0 ? Math.round((warm / total) * 100) : 0;
  const opp = st?.opportunity ?? null;
  const lastMsg = st?.msgs.length ? st.msgs[st.msgs.length - 1] : null;

  // ── FULLY AUTOMATED VOICE ANNOUNCEMENTS ──────────────────────────────
  //  The moment the sweep qualifies a NEW opportunity the bot SPEAKS it —
  //  no button, no refresh, no confirmation. Guards keep it polite: voice
  //  enabled + unmuted, nobody mid-conversation, audio idle, tab visible,
  //  and never on the first observation after mount (no replay spam).
  const oppKeyRef = useRef("");
  const oppAnnouncedAtRef = useRef(0);
  useEffect(() => {
    const o = st?.opportunity;
    if (!o) return;
    const key = `${o.symbol}:${o.tf}:${o.time}:${o.dir}`;
    if (!oppKeyRef.current) {
      oppKeyRef.current = key; // first observation after mount — stay silent
      return;
    }
    if (key === oppKeyRef.current) return;
    oppKeyRef.current = key;
    if (!profile.voiceEnabled || prefs.muted) return;
    if (convoOpen || voice !== "idle") return; // never talk over the operator
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (Date.now() - oppAnnouncedAtRef.current < 8000) return; // debounce bursts
    oppAnnouncedAtRef.current = Date.now();
    const short = o.symbolLabel.split("·")[0].trim() || o.symbol;
    const side = o.dir === -1 ? "sell" : "buy";
    const rr = String(o.rr).replace(":", " to ");
    const line = `Scanner opportunity: ${short}, ${TF_LABEL[o.tf] ?? o.tf.toUpperCase()}, ${side} side. Entry ${pxOf(o.symbol, o.entry)}, stop ${pxOf(o.symbol, o.sl)}, target ${pxOf(o.symbol, o.tp)}, reward to risk ${rr}. Details are on the Scanner Bot console.`;
    speak(line);
  }, [st?.opportunity, profile.voiceEnabled, prefs.muted, convoOpen, voice, speak]);

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      {/* feed error — honest strip above the card, last data stays */}
      {err && (
        <div className="mb-2.5">
          <StateFrame state="error" compact title="Scanner feed unreachable — showing the last known state" onRetry={() => void load()} />
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-2xl border-2"
        style={{
          borderColor: A.cyan(0.5),
          background: "linear-gradient(160deg, #051531 0%, #020B1A 55%, #010714 100%)",
          boxShadow: `0 0 34px ${A.cyan(0.18)}, 0 18px 44px rgba(0,4,12,0.55), inset 0 0 44px rgba(2,11,26,0.85)`,
        }}
      >
        {/* HUD corner brackets */}
        {[
          "left-0 top-0 border-l-2 border-t-2 rounded-tl-2xl",
          "right-0 top-0 border-r-2 border-t-2 rounded-tr-2xl",
          "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-2xl",
          "bottom-0 right-0 border-b-2 border-r-2 rounded-br-2xl",
        ].map((pos) => (
          <span key={pos} aria-hidden className={`pointer-events-none absolute z-10 h-5 w-5 ${pos}`} style={{ borderColor: A.cyan(0.9) }} />
        ))}

        {/* ═══ hero: robot · title/info/ring ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr]">
          {/* robot cell — golden arcs + tech grid + the HALO bot */}
          <div
            className="relative flex items-center justify-center overflow-hidden border-b py-5 lg:border-b-0 lg:border-r"
            style={{
              borderColor: "rgba(15,46,88,0.8)",
              background: "radial-gradient(circle at 50% 42%, rgba(30,144,255,0.14), transparent 68%)",
            }}
          >
            {/* faint tech grid */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.13]"
              style={{
                backgroundImage: `linear-gradient(${A.cyan(0.55)} 1px, transparent 1px), linear-gradient(90deg, ${A.cyan(0.55)} 1px, transparent 1px)`,
                backgroundSize: "26px 26px",
                maskImage: "radial-gradient(circle at 50% 46%, black 20%, transparent 74%)",
                WebkitMaskImage: "radial-gradient(circle at 50% 46%, black 20%, transparent 74%)",
              }}
            />
            <div className="relative w-[190px] sm:w-[215px] lg:w-[236px]" style={{ filter: `drop-shadow(0 0 22px ${A.cyan(0.28)})` }}>
              <ScannerBotArt />
            </div>
          </div>

          {/* right cell — title · subtitle · info rows · ring */}
          <div className="min-w-0 p-4 sm:p-5">
            {/* header */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <Crosshair size={22} style={{ color: C.gold }} aria-hidden />
              <h1 className="text-[20px] font-extrabold tracking-tight sm:text-[24px]" style={{ color: C.txt, textShadow: `0 0 20px ${A.cyan(0.25)}` }}>
                Timeframe <span className="italic" style={{ color: C.goldHover }}>Scanner Bot</span>
              </h1>
              <div className="ml-auto flex items-center gap-2">
                {/* status pill (mockup: green Active chip) */}
                <span
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold"
                  style={{ borderColor: meta.color, background: `${meta.color}14`, color: meta.color, boxShadow: scanning ? `0 0 12px ${A.green(0.25)}` : "none" }}
                  role="status"
                >
                  <span
                    className={`inline-block h-[6px] w-[6px] rounded-full ${scanning ? "halo-anim-beacon" : ""}`}
                    style={{ background: meta.color, ["--beacon" as string]: `${meta.color}88` } as React.CSSProperties}
                    aria-hidden
                  />
                  {meta.label}
                </span>
                {/* the bot's only controls, in mockup chip style */}
                {(status === "idle" || status === "paused") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void control(status === "paused" ? "resume" : "start")}
                    className="rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition-all hover:brightness-110 disabled:opacity-40"
                    style={{ borderColor: A.green(0.6), background: A.green(0.12), color: C.green }}
                  >
                    {status === "paused" ? "RESUME" : "START"}
                  </button>
                )}
                {scanning && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void control("pause")}
                    className="rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition-all hover:brightness-110 disabled:opacity-40"
                    style={{ borderColor: A.warn(0.6), background: A.warn(0.1), color: C.warn }}
                  >
                    PAUSE
                  </button>
                )}
                {onView && (
                  <button
                    type="button"
                    onClick={() => onView("settings")}
                    aria-label="Open settings"
                    title="Strategy settings (the scanner shares the EA settings)"
                    className="rounded-lg border p-1.5 transition-all hover:brightness-110"
                    style={{ borderColor: A.cyan(0.4), background: A.cyan(0.08), color: C.cyan }}
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-[12px] font-medium" style={{ color: A.ice(0.9) }}>{subtitleFor(st)}</p>

            {/* info rows + ring */}
            <div className="mt-3 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_170px]">
              <div className="min-w-0 rounded-xl border px-3 py-1.5" style={{ borderColor: "rgba(20,52,96,0.9)", background: "rgba(2,16,36,0.55)" }}>
                <InfoRow
                  icon={<BarChart3 size={15} />}
                  label="Scanning Timeframes:"
                  value={(st?.tfs ?? []).map((tf) => TF_LABEL[tf] ?? tf.toUpperCase()).join(", ") || "—"}
                  iconColor={C.cyan}
                />
                <InfoRow
                  icon={<Search size={15} />}
                  label="Markets Analysed:"
                  value={total > 0 ? `All Symbols · ${warm} / ${total} rows warmed` : "All Symbols"}
                  iconColor={C.cyan}
                />
                <InfoRow icon={<RefreshCw size={15} className={scanning ? "animate-spin" : ""} style={{ animationDuration: "3s" }} />} label="Last Scan:" value={fmtMockDate(st?.lastScanAt ?? 0)} iconColor={C.cyan} />
                <InfoRow icon={<Activity size={15} />} label="Status:" value={st ? statusLine(st) : "Connecting to the scanner feed…"} iconColor={C.green} />
              </div>
              <div className="flex justify-center">
                <ProgressRing pct={pct} word={st ? meta.ring : "Connecting…"} scanning={scanning} />
              </div>
            </div>
          </div>
        </div>

        {/* ═══ live market feed strip — which feeds are streaming right now ═══ */}
        <FeedStrip st={st} scanning={scanning} />

        {/* ═══ HALO message band ═══ */}
        <div className="flex items-center gap-3 border-t px-3 py-3 sm:px-5" style={{ borderColor: A.cyan(0.28), background: "rgba(2,14,32,0.6)" }}>
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2"
            style={{ borderColor: A.cyan(0.6), background: `radial-gradient(circle, ${A.cyan(0.22)}, rgba(2,11,26,0.95))`, boxShadow: `0 0 16px ${A.cyan(0.35)}` }}
            aria-hidden
          >
            <BarChart3 size={18} style={{ color: C.cyan }} />
          </span>
          <div className="min-w-0 flex-1 rounded-xl border px-3 py-2" style={{ borderColor: A.cyan(0.32), background: "rgba(4,18,43,0.85)" }}>
            <p className="text-[12px] leading-relaxed" style={{ color: "#EAF3FF" }}>
              <span className="font-extrabold" style={{ color: C.txt }}>HALO:</span>{" "}
              {lastMsg
                ? lastMsg.text
                : status === "scanning"
                  ? "Timeframe Scanner is actively scanning all supported markets and timeframes for high-probability trading opportunities. Please wait…"
                  : status === "trade_lock"
                    ? "A trade is currently running — the scanner holds and resumes automatically once it hits TP or SL."
                    : status === "paused"
                      ? "Timeframe Scanner Bot is paused — press Resume to continue scanning all supported markets and timeframes."
                      : "Timeframe Scanner Bot ready — press Start to begin scanning all supported markets and timeframes using the existing HALO trading strategy."}
              {scanning && <TypingDots />}
            </p>
          </div>
        </div>

        {/* ═══ latest opportunity band (mockup gold band) ═══ */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2.5 sm:px-5"
          style={{ borderColor: A.gold(0.4), background: `linear-gradient(90deg, ${A.gold(0.08)}, rgba(2,18,41,0.55) 58%)` }}
        >
          <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold tracking-wide" style={{ color: C.goldHover }}>
            <Star size={14} fill={C.gold} style={{ color: C.gold }} aria-hidden />
            Latest Opportunity
          </span>
          {opp ? (
            <>
              <span className="text-[14px] font-extrabold" style={{ color: C.txt }}>{opp.symbolLabel.split("·")[0].trim() || opp.symbol}</span>
              <span className="flex items-center gap-1 text-[12px] font-bold" style={{ color: opp.dir === -1 ? C.red : C.green }}>
                {opp.dir === -1 ? "▼" : "▲"} {opp.dir === -1 ? "Sell" : "Buy"} Signal
              </span>
              <span className="text-[11.5px]" style={{ color: C.txt2 }}>
                Timeframe: <span className="font-bold" style={{ color: C.txt }}>{TF_LABEL[opp.tf] ?? opp.tf.toUpperCase()}</span>
              </span>
              <span className="text-[11.5px] font-bold" style={{ color: C.green }}>R:R: {opp.rr}</span>
              <span className="font-mono text-[11.5px] font-bold" style={{ color: C.txt2 }}>{pxOf(opp.symbol, opp.entry)}</span>
              <button
                type="button"
                onClick={() => setDetails((d) => !d)}
                aria-expanded={details}
                className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-extrabold transition-all hover:brightness-110"
                style={{ borderColor: A.cyan(0.55), background: A.cyan(0.1), color: C.cyan, boxShadow: `0 0 10px ${A.cyan(0.15)}` }}
              >
                {details ? "Hide Details" : "View Details"}
                <ChevronRight size={13} className={`transition-transform ${details ? "rotate-90" : ""}`} aria-hidden />
              </button>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: C.muted }}>
              No qualifying opportunity on record yet — the scanner is watching every market × timeframe against the existing HALO strategy.
            </span>
          )}
        </div>

        {/* ═══ found trades · every pick in one visible list ═══ */}
        <FoundTradesList recent={st?.recent ?? []} scanning={scanning} />

        {/* ═══ View Details expansion — engine-exact values + recent book ═══ */}
        {details && opp && (
          <div className="border-t px-3 py-3 sm:px-5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(1,10,24,0.65)" }}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[8.5px] font-extrabold tracking-[0.2em]" style={{ color: C.gold }}>OPPORTUNITY DETAILS · ENGINE-EXACT VALUES</p>
                <div className="grid grid-cols-4 gap-1.5 text-center">
                  {[
                    { l: "ENTRY · DOTTED TRIGGER", v: pxOf(opp.symbol, opp.entry), c: C.txt2 },
                    { l: "STOP LOSS", v: pxOf(opp.symbol, opp.sl), c: C.red },
                    { l: "TAKE PROFIT", v: pxOf(opp.symbol, opp.tp), c: C.green },
                  ].map((x) => (
                    <div key={x.l} className="rounded-lg border px-1 py-1.5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(2,11,26,0.75)" }}>
                      <p className="truncate text-[7px] font-extrabold tracking-[0.1em]" style={{ color: C.muted }}>{x.l}</p>
                      <p className="truncate font-mono text-[12px] font-semibold" style={{ color: x.c }}>{x.v}</p>
                    </div>
                  ))}
                  <div className="rounded-lg border px-1 py-1.5" style={{ borderColor: A.gold(0.5), background: A.gold(0.08) }}>
                    <p className="text-[7px] font-extrabold tracking-[0.1em]" style={{ color: C.muted }}>RISK : REWARD</p>
                    <p className="font-mono text-[12px] font-semibold" style={{ color: C.goldHover }}>{opp.rr}</p>
                  </div>
                </div>
                <div className="mt-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(2,11,26,0.55)" }}>
                  <TelemetryRow label="Instrument" value={`${opp.symbolLabel} (${opp.symbol})`} />
                  <TelemetryRow label="Direction" value={opp.dir === -1 ? "SELL" : "BUY"} color={opp.dir === -1 ? C.red : C.green} />
                  <TelemetryRow label="Timeframe" value={(TF_LABEL[opp.tf] ?? opp.tf).toUpperCase()} />
                  <TelemetryRow label="Risk → Reward" value={`${opp.riskPips.toFixed(1)} → ${opp.rewardPips.toFixed(1)} pips (${opp.rr})`} />
                  <TelemetryRow label="Signal time" value={fmtMockDate(opp.time)} />
                  <TelemetryRow label="Confirmation" value={`Existing HALO strategy · ${opp.sigMode}`} color={C.cyan} />
                  <TelemetryRow label="Signal status" value={opp.status} color={oppStatusColor(opp.status)} />
                </div>
                <p className="mt-2 text-[8.5px] leading-snug" style={{ color: C.muted }}>
                  All values are exactly as calculated by the existing HALO strategy engine. The Scanner Bot is signal-only — it never executes, modifies or closes trades.
                </p>
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-[8.5px] font-extrabold tracking-[0.2em]" style={{ color: C.gold }}>RECENT OPPORTUNITIES · LAST 8</p>
                <RecentBook recent={st?.recent ?? []} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ voice link — the Scanner Bot listens, speaks and runs its own
          functions hands-free (wake word, neural voice, auto-execution) ═══ */}
      <div className="mt-3">
        <ScannerVoicePanel scannerStatus={status} />
      </div>
    </div>
  );
}
