"use client";

// ════════════════════════════════════════════════════════════════════════
//  SCANNER BOT DASHBOARD · dedicated full-page command view
//
//  The Timeframe Scanner Bot (signal-only, /api/tf-scanner) gets its own
//  tab + dashboard:
//    • status band — status, universe coverage, setups, opportunities
//    • bot control — art + Start / Pause / Resume (the ONLY controls),
//      live scanning position, timeframe chips, trade-lock notice
//    • latest qualifying opportunity — every value exactly as the
//      existing 3EL engine calculated it
//    • recent opportunities book (last 8) + scan progress + activity log
//  Pure presentation + control over /api/tf-scanner (6 s poll, visibility
//  gated). The bot never executes trades — nothing here does either.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Crosshair, Radar, ScanSearch, ScrollText, Target } from "lucide-react";
import { A, C, type PillTone } from "@/lib/halo/ui-helpers";
import { PageHeader, PanelCard, Pill, StateFrame, StatCell, TelemetryRow } from "./panel";
import { ScannerBotArt } from "./scanner-bot-card";

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
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
}

const POLL_MS = 6000;
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

function fmtClock(ms: number): string {
  if (!ms) return "—";
  return `${new Date(ms).toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" })} UTC`;
}

function fmtDuration(from: number, to: number): string {
  if (!from || to <= from) return "—";
  const s = Math.floor((to - from) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

const STATUS_META: Record<ScannerState["status"], { label: string; tone: PillTone; color: string }> = {
  scanning: { label: "ACTIVE", tone: "live", color: C.green },
  trade_lock: { label: "PAUSED · TRADE RUNNING", tone: "warn", color: C.warn },
  paused: { label: "PAUSED", tone: "warn", color: C.warn },
  idle: { label: "IDLE", tone: "muted", color: C.muted },
};

function statusText(st: ScannerState): string {
  switch (st.status) {
    case "scanning":
      return st.currentSymbol
        ? `Scanning ${st.currentSymbol} · ${st.currentTf.toUpperCase()}`
        : "Warming up the market feeds";
    case "trade_lock":
      return `Trade running on ${st.lock?.symbol ?? ""} ${st.lock?.tf ?? ""} — auto-resumes after TP / SL`;
    case "paused":
      return "Paused by trader — press Resume";
    default:
      return "Idle — press Start";
  }
}

/** self-ticking uptime (isolated so the 1 s clock doesn't re-render the page) */
function Uptime({ startedAt, running }: { startedAt: number; running: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(id);
    };
  }, []);
  if (!running || !startedAt) return <>—</>;
  return <>{fmtDuration(startedAt, now)}</>;
}

function oppStatusColor(status: string): string {
  if (status.startsWith("TP")) return C.green;
  if (status.startsWith("SL")) return C.red;
  return C.cyan;
}

function TfChip({ tf, active }: { tf: string; active: boolean }) {
  return (
    <span
      className="rounded px-1.5 py-px font-mono text-[8.5px] font-bold"
      style={{
        border: `1px solid ${active ? C.cyan : "rgba(28,68,120,0.9)"}`,
        background: active ? A.cyan(0.18) : "rgba(2,18,41,0.8)",
        color: active ? C.cyan : C.txt2,
        boxShadow: active ? `0 0 8px ${A.cyan(0.3)}` : "none",
      }}
    >
      {TF_LABEL[tf] ?? tf.toUpperCase()}
    </span>
  );
}

/* ───────────────────── latest qualifying opportunity ───────────────────── */
function LatestOpportunity({ opp, status }: { opp: Opportunity | null; status: ScannerState["status"] }) {
  if (!opp) {
    return (
      <PanelCard title="LATEST QUALIFYING OPPORTUNITY" icon={Target} accent="gold">
        <StateFrame
          state="empty"
          title="No qualifying opportunity on record yet"
          hint={
            status === "idle" || status === "paused"
              ? "Start or resume the scanner — qualifying setups appear here the moment the existing HALO strategy identifies them."
              : "Scanning every supported market × timeframe — the first setup that meets the existing HALO strategy will appear here."
          }
        />
      </PanelCard>
    );
  }
  const sell = opp.dir === -1;
  return (
    <PanelCard
      title="LATEST QUALIFYING OPPORTUNITY"
      icon={Target}
      accent="gold"
      right={
        <span
          className="rounded px-2 py-0.5 text-[9px] font-extrabold tracking-[0.14em]"
          style={{ background: sell ? A.red(0.16) : A.green(0.16), color: sell ? C.red : C.green }}
        >
          {sell ? "SELL" : "BUY"}
        </span>
      }
    >
      <div className="space-y-2.5 p-3">
        {/* identity row */}
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[16px] font-bold" style={{ color: C.txt }}>
            {opp.symbolLabel.split("·")[0].trim() || opp.symbol}
          </span>
          <TfChip tf={opp.tf} active={false} />
          <span className="ml-auto font-mono text-[9.5px]" style={{ color: C.muted }}>
            {fmtUtc(opp.time)}
          </span>
        </div>

        {/* price grid */}
        <div className="grid grid-cols-4 gap-1.5 text-center">
          {[
            { l: "ENTRY · DOTTED TRIGGER", v: opp.entry, c: C.txt2 },
            { l: "STOP LOSS", v: opp.sl, c: C.red },
            { l: "TAKE PROFIT", v: opp.tp, c: C.green },
          ].map((x) => (
            <div key={x.l} className="rounded-lg border px-1 py-1.5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(2,11,26,0.7)" }}>
              <p className="truncate text-[7px] font-extrabold tracking-[0.12em]" style={{ color: C.muted }}>{x.l}</p>
              <p className="truncate font-mono text-[12px] font-semibold" style={{ color: x.c }}>{x.v}</p>
            </div>
          ))}
          <div className="rounded-lg border px-1 py-1.5" style={{ borderColor: A.gold(0.5), background: A.gold(0.08) }}>
            <p className="text-[7px] font-extrabold tracking-[0.12em]" style={{ color: C.muted }}>RISK : REWARD</p>
            <p className="font-mono text-[12px] font-semibold" style={{ color: C.goldHover }}>{opp.rr}</p>
          </div>
        </div>

        {/* full engine-provided detail */}
        <div className="rounded-lg border px-2.5 py-1.5" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(2,11,26,0.55)" }}>
          <TelemetryRow label="Instrument" value={`${opp.symbolLabel} (${opp.symbol})`} />
          <TelemetryRow label="Direction" value={sell ? "SELL" : "BUY"} color={sell ? C.red : C.green} />
          <TelemetryRow label="Timeframe" value={(TF_LABEL[opp.tf] ?? opp.tf).toUpperCase()} />
          <TelemetryRow label="Risk → Reward" value={`${opp.riskPips.toFixed(1)} → ${opp.rewardPips.toFixed(1)} pips (${opp.rr})`} />
          <TelemetryRow label="Confirmation" value={`Existing HALO strategy · ${opp.sigMode}`} color={C.cyan} />
          <TelemetryRow label="Signal status" value={opp.status} color={oppStatusColor(opp.status)} />
        </div>

        <p className="text-[8.5px] leading-snug" style={{ color: C.muted }}>
          All values are exactly as calculated by the existing HALO strategy engine. The Scanner Bot is signal-only — it never executes, modifies or closes trades.
        </p>
      </div>
    </PanelCard>
  );
}

/* ───────────────────── recent opportunities book ───────────────────── */
function RecentOpportunities({ recent }: { recent: Opportunity[] }) {
  return (
    <PanelCard
      title="RECENT OPPORTUNITIES · LAST 8"
      icon={ScrollText}
      accent="cyan"
      right={<Pill tone="muted">{recent.length ? `${recent.length} on record` : "empty"}</Pill>}
    >
      {recent.length === 0 ? (
        <StateFrame state="empty" title="No opportunities yet" hint="The book fills in as real scanner fires arrive — nothing is invented." className="m-3" />
      ) : (
        <div className="halo-scroll max-h-[340px] overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr>
                {["SIGNAL TIME", "SYMBOL", "TF", "SIDE", "ENTRY", "SL", "TP", "R:R", "STATUS"].map((h) => (
                  <th
                    key={h}
                    className="sticky top-0 z-10 border-b px-2.5 py-1.5 text-[8px] font-extrabold tracking-[0.14em]"
                    style={{ borderColor: C.lineInner, background: C.panel, color: C.label }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((o, i) => (
                <tr key={`${o.symbol}:${o.tf}:${o.time}:${i}`} className="transition-colors hover:bg-[rgba(46,204,255,0.04)]">
                  <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.muted }}>
                    {fmtClock(o.time)}
                  </td>
                  <td className="border-b px-2.5 py-1.5 text-[10.5px] font-bold" style={{ borderColor: C.divider, color: C.txt }}>
                    {o.symbolLabel.split("·")[0].trim() || o.symbol}
                  </td>
                  <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px] font-bold" style={{ borderColor: C.divider, color: C.txt2 }}>
                    {TF_LABEL[o.tf] ?? o.tf.toUpperCase()}
                  </td>
                  <td className="border-b px-2.5 py-1.5">
                    <span className="rounded px-1.5 py-px text-[8px] font-extrabold tracking-wider" style={{ background: o.dir === -1 ? A.red(0.14) : A.green(0.14), color: o.dir === -1 ? C.red : C.green }}>
                      {o.dir === -1 ? "SELL" : "BUY"}
                    </span>
                  </td>
                  <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.txt2 }}>{o.entry}</td>
                  <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.red }}>{o.sl}</td>
                  <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.green }}>{o.tp}</td>
                  <td className="border-b px-2.5 py-1.5 font-mono text-[9.5px]" style={{ borderColor: C.divider, color: C.goldHover }}>{o.rr}</td>
                  <td className="border-b px-2.5 py-1.5 text-[8.5px] font-extrabold tracking-wide" style={{ borderColor: C.divider, color: oppStatusColor(o.status) }}>
                    {o.status}
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

/* ───────────────────── activity log ───────────────────── */
const KIND_META: Record<ScannerMsg["kind"], { tone: PillTone; label: string }> = {
  info: { tone: "info", label: "INFO" },
  opportunity: { tone: "gold", label: "OPPORTUNITY" },
  pause: { tone: "warn", label: "PAUSE" },
  resume: { tone: "ok", label: "RESUME" },
};

function ActivityLog({ msgs }: { msgs: ScannerMsg[] }) {
  const lines = [...msgs].reverse(); // newest first
  return (
    <PanelCard title="SCANNER LOG · LIVE MESSAGES" icon={ScanSearch} accent="cyan" right={<Pill tone="info">{lines.length}</Pill>}>
      {lines.length === 0 ? (
        <StateFrame state="empty" title="Log is empty" hint="Scanner messages appear here as they are broadcast to the chat." className="m-3" />
      ) : (
        <div className="halo-scroll max-h-[420px] space-y-1.5 overflow-y-auto p-2.5">
          {lines.map((m, i) => {
            const k = KIND_META[m.kind] ?? KIND_META.info;
            return (
              <div
                key={`${m.at}:${i}`}
                className="rounded-lg border px-2.5 py-1.5"
                style={{
                  borderColor: m.kind === "opportunity" ? `${A.gold(0.35)}` : "rgba(15,46,88,0.9)",
                  background: m.kind === "opportunity" ? "rgba(233,185,78,0.05)" : "rgba(2,18,41,0.55)",
                }}
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <Pill tone={k.tone}>{k.label}</Pill>
                  <span className="ml-auto font-mono text-[8px]" style={{ color: C.dim }}>{fmtClock(m.at)}</span>
                </div>
                <p className="text-[10px] leading-snug" style={{ color: C.txt2 }}>{m.text}</p>
              </div>
            );
          })}
        </div>
      )}
    </PanelCard>
  );
}

/* ───────────────────── main dashboard ───────────────────── */
export function ScannerBotDashboard({ notify }: Props) {
  const [st, setSt] = useState<ScannerState | null>(null);
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);
  const sigRef = useRef("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tf-scanner", { cache: "no-store" });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const j = (await r.json()) as ScannerState;
      if (!aliveRef.current) return;
      if (!j.ok) throw new Error("bad payload");
      const sig = JSON.stringify(j);
      if (sig !== sigRef.current) {
        sigRef.current = sig;
        setSt(j);
      }
      setErr(false);
    } catch {
      if (aliveRef.current) setErr(true); // last known data stays visible
    } finally {
      if (aliveRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    const t = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearTimeout(t);
      window.clearInterval(id);
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

  const meta = STATUS_META[st?.status ?? "idle"];
  const running = st?.status === "scanning" || st?.status === "trade_lock";
  const warm = st?.marketsAnalysed ?? 0;
  const total = st?.marketsTotal ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((warm / total) * 100)) : 0;
  const opp = st?.opportunity ?? null;

  return (
    <div>
      <PageHeader
        icon={Bot}
        title="SCANNER BOT"
        sub="One signal-only bot sweeping every supported market × timeframe against the existing HALO 3EL strategy. It reports qualifying opportunities — it never executes trades."
        right={
          <>
            <Pill tone={meta.tone} pulse={st?.status === "scanning"}>
              {meta.label}
            </Pill>
            <Pill tone="muted">
              <span className="flex items-center gap-1">
                UPTIME&nbsp;<Uptime startedAt={st?.startedAt ?? 0} running={running} />
              </span>
            </Pill>
          </>
        }
      />

      {/* connection strip — honest feed error, last data stays visible */}
      {err && loaded && (
        <div className="mb-3">
          <StateFrame state="error" compact title="Scanner feed unreachable — showing the last known state" onRetry={() => void load()} />
        </div>
      )}

      {/* ── status band ── */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <StatCell
          label="BOT STATUS"
          value={meta.label}
          color={meta.color}
          sub={st ? statusText(st) : "connecting to the scanner feed…"}
        />
        <StatCell label="MARKETS ANALYSED" value={`${warm} / ${total}`} color={C.cyan} sub={`${pct}% of the universe warmed`} />
        <StatCell label="SETUPS WATCHED" value={String(st?.setupsWatched ?? 0)} color={C.goldHover} sub="rows with armed levels" />
        <StatCell
          label="OPPORTUNITIES"
          value={String(st?.opportunitiesFound ?? 0)}
          color={(st?.opportunitiesFound ?? 0) > 0 ? C.green : C.txt}
          sub={st && st.recent.length ? `${st.recent.length} in recent book` : "none yet"}
        />
        <StatCell label="FULL PASSES" value={String(st?.passes ?? 0)} sub={`${(st?.scannedRows ?? 0).toLocaleString("en-US")} rows scanned`} />
        <StatCell label="RANGE-FILTER SKIPS" value={String(st?.rangeSkips ?? 0)} sub="strategy refused — ranging / S-R close" />
      </div>

      {/* ── universe coverage bar ── */}
      <div
        className="mt-2.5 rounded-xl border px-3 py-2.5"
        style={{ borderColor: C.lineInner, background: `linear-gradient(180deg, ${A.blue(0.05)}, ${C.deep})` }}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[8.5px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>
            UNIVERSE COVERAGE · SYMBOLS × TIMEFRAMES WARMED
          </span>
          <span className="font-mono text-[10px] font-bold" style={{ color: C.cyan }}>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(2,11,26,0.9)", boxShadow: `inset 0 0 0 1px ${A.cyan(0.12)}` }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(90deg, ${A.blue(0.9)}, ${C.cyan})`,
              boxShadow: `0 0 10px ${A.cyan(0.45)}`,
            }}
          />
        </div>
        <p className="mt-1 text-[8.5px] leading-snug" style={{ color: C.dim }}>
          Round-robin pacing · a few rows every 2.5 s tick · armed setups re-checked with priority — a full pass over every market × timeframe takes about 20 minutes.
        </p>
      </div>

      {/* ── main grid ── */}
      <div className="mt-3 grid grid-cols-12 gap-3">
        {/* left column — control + opportunities */}
        <div className="col-span-12 min-w-0 space-y-3 xl:col-span-8">
          {/* bot control */}
          <PanelCard
            title="SCANNER BOT CONTROL"
            icon={Radar}
            accent="cyan"
            right={<Pill tone={meta.tone} pulse={st?.status === "scanning"}>{meta.label}</Pill>}
          >
            {!loaded && !st ? (
              <StateFrame state="loading" className="m-3" />
            ) : !st ? (
              <StateFrame state="error" title="Could not reach the scanner feed" onRetry={() => void load()} className="m-3" />
            ) : (
              <div className="p-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  {/* artwork */}
                  <div className="mx-auto w-[104px] shrink-0 sm:mx-0" style={{ filter: `drop-shadow(0 0 10px ${A.cyan(0.25)})` }}>
                    <ScannerBotArt />
                  </div>

                  <div className="min-w-0 flex-1 space-y-2.5">
                    {/* live status line */}
                    <div
                      className="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                      style={{
                        borderColor: st.status === "scanning" ? A.cyan(0.4) : "rgba(15,46,88,0.9)",
                        background: "rgba(2,18,41,0.7)",
                      }}
                    >
                      <span
                        className="halo-anim-beacon inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: meta.color, ["--beacon" as string]: `${meta.color}88` } as React.CSSProperties}
                        aria-hidden
                      />
                      <p className="min-w-0 truncate text-[11px] font-bold" style={{ color: st.status === "scanning" ? C.cyan : meta.color }}>
                        {statusText(st)}
                      </p>
                    </div>

                    {/* trade-lock notice */}
                    {st.status === "trade_lock" && st.lock && (
                      <div
                        className="rounded-lg border px-2.5 py-2 text-[10px] leading-snug"
                        style={{ borderColor: A.warn(0.45), background: A.warn(0.08), color: C.warn }}
                        role="status"
                      >
                        GLOBAL TRADE LOCK — a trade is running on <span className="font-bold">{st.lock.symbol} {st.lock.tf.toUpperCase()}</span>. Scanning pauses
                        app-wide and resumes automatically once it hits TP or SL.
                      </div>
                    )}

                    {/* timeframes */}
                    <div>
                      <p className="mb-1 text-[8px] font-extrabold tracking-[0.18em]" style={{ color: C.gold }}>SCANNING TIMEFRAMES</p>
                      <div className="flex flex-wrap gap-1">
                        {st.tfs.map((tf) => (
                          <TfChip key={tf} tf={tf} active={st.status === "scanning" && st.currentTf === tf} />
                        ))}
                      </div>
                    </div>

                    {/* the only controls */}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {(st.status === "idle" || st.status === "paused") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void control(st.status === "paused" ? "resume" : "start")}
                          className="min-h-[36px] flex-1 rounded-lg border px-3 py-2 text-[10px] font-extrabold tracking-[0.16em] transition-all hover:brightness-110 disabled:opacity-40 sm:flex-none sm:px-6"
                          style={{ borderColor: A.green(0.55), background: A.green(0.12), color: C.green, boxShadow: `0 0 14px ${A.green(0.14)}` }}
                        >
                          {st.status === "paused" ? "RESUME SCANNING" : "START SCANNING"}
                        </button>
                      )}
                      {st.status === "scanning" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void control("pause")}
                          className="min-h-[36px] flex-1 rounded-lg border px-3 py-2 text-[10px] font-extrabold tracking-[0.16em] transition-all hover:brightness-110 disabled:opacity-40 sm:flex-none sm:px-6"
                          style={{ borderColor: A.warn(0.55), background: A.warn(0.1), color: C.warn }}
                        >
                          PAUSE SCANNING
                        </button>
                      )}
                      {st.status === "trade_lock" && (
                        <span
                          className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg border px-3 py-2 text-[10px] font-extrabold tracking-[0.14em]"
                          style={{ borderColor: "rgba(15,46,88,0.9)", color: C.muted }}
                        >
                          AUTO-RESUMES AFTER TP / SL
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[8px] tracking-wider" style={{ color: C.dim }}>
                        {st.source && st.source !== "—" ? `feed · ${st.source}` : "signal-only bot"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </PanelCard>

          <LatestOpportunity opp={opp} status={st?.status ?? "idle"} />
          <RecentOpportunities recent={st?.recent ?? []} />
        </div>

        {/* right column — progress + log */}
        <div className="col-span-12 min-w-0 space-y-3 xl:col-span-4">
          <PanelCard title="SCAN PROGRESS" icon={Crosshair} accent="teal">
            <div className="p-2.5">
              {st ? (
                <>
                  <TelemetryRow icon={<ScanSearch size={11} />} label="Markets analysed" value={`${warm} / ${total} warm`} color={C.cyan} />
                  <TelemetryRow icon={<Radar size={11} />} label="Rows scanned" value={st.scannedRows.toLocaleString("en-US")} />
                  <TelemetryRow icon={<Bot size={11} />} label="Full passes" value={String(st.passes)} />
                  <TelemetryRow label="Last scan tick" value={fmtUtc(st.lastScanAt)} />
                  <TelemetryRow label="Last full pass" value={fmtUtc(st.lastPassAt)} />
                  <TelemetryRow label="Session started" value={fmtUtc(st.startedAt)} />
                  <TelemetryRow label="Feed source" value={st.source && st.source !== "—" ? st.source : "—"} color={C.teal} />
                  <TelemetryRow
                    label="Universe"
                    value={`all catalog symbols × ${st.tfs.length} timeframes`}
                  />
                  <p className="mt-2 rounded-lg border border-dashed px-2.5 py-1.5 text-[8.5px] leading-snug" style={{ borderColor: `${A.cyan(0.25)}`, color: C.muted }}>
                    The bot shares the EA strategy settings byte-for-byte. Changing strategy settings in Settings rebuilds every scanner engine on the next tick.
                  </p>
                </>
              ) : (
                <StateFrame state="loading" compact />
              )}
            </div>
          </PanelCard>

          <ActivityLog msgs={st?.msgs ?? []} />
        </div>
      </div>
    </div>
  );
}
