"use client";

// ════════════════════════════════════════════════════════════════════════
//  STRATEGY RADAR · holographic sweep over the real multi-symbol scanner
//
//  Every blip IS a real watchlist row running the full 3EL engine:
//    radius    = distance from price to the nearest armed level (ATR) —
//                a setup near its trigger sits close to the core
//    angle     = stable per-symbol slot (spread + deterministic jitter)
//    colour    = verified row status:
//                  amber  — C3 WATCH (conditions incomplete, awaiting break)
//                  green  — RUNNING (trade open, engine managing)
//                  red    — ERROR (feed invalid)
//                  cyan   — SCANNING (no levels yet)
//                  gray   — PAUSED / WARMING
//    reason    = built from the row's genuine fields — why it qualifies,
//                is rejected or is still being evaluated
//
//  The sweep rotates ONLY while a real analysis is happening: a manual
//  scan is in flight, or a server engine tick just refreshed the rows.
//  Blips are focusable buttons — full keyboard + screen-reader access.
//
//  INFORMATIONAL ONLY: the radar never creates, approves or executes
//  anything. Trading stays exclusively in the existing scanner/terminal.
// ════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { Crosshair, Info } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import type { Side } from "@/lib/halo/types";
import { useFx } from "@/lib/halo/fx";

export interface RadarRow {
  id: string;
  symbol: string;
  symbolLabel: string;
  tf: string;
  status: string;
  price: number;
  atr: number | null;
  freshSell: number;
  freshBuy: number;
  nearest: { side: Side; distAtr: number } | null;
  lastSignal: { dir: Side; kind: string; time: number } | null;
  source: string;
  error: string;
  warm: boolean;
}

interface Props {
  rows: RadarRow[];
  /** a manual SCAN NOW is in flight */
  scanning: boolean;
  /** server engine lastRun timestamp — a change means a real tick happened */
  lastRun: number;
  onJumpToSymbol?: (symbol: string) => void;
}

const CTR = 200;
const RAD = 168;

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

interface Blip {
  row: RadarRow;
  x: number; // px in the 400-space
  y: number;
  color: string;
  glow: string;
  ping: boolean;
  label: string;
  reason: string;
}

function statusColor(status: string): { color: string; ping: boolean } {
  switch (status) {
    case "RUNNING":
      return { color: C.green, ping: true };
    case "C3 WATCH":
      return { color: C.gold, ping: true };
    case "ERROR":
      return { color: C.red, ping: false };
    case "PAUSED":
      return { color: C.gray, ping: false };
    case "WARMING":
      return { color: C.muted, ping: false };
    default:
      return { color: C.cyan, ping: false };
  }
}

function reasonOf(row: RadarRow): string {
  if (row.status === "ERROR" && row.error) return `Feed problem — ${row.error}`;
  if (row.status === "RUNNING") return "A 3EL trade is live from this row — the engine is managing it right now.";
  if (row.status === "C3 WATCH") {
    const sideTxt = row.nearest?.side === -1 ? "Resistance" : "Support";
    return `${sideTxt} armed ${row.nearest ? `${row.nearest.distAtr.toFixed(2)}·ATR` : ""} from price — waiting for the C3 wick break and return to the dotted line.`;
  }
  if (row.status === "PAUSED") return "Row paused — the engine holds this symbol until you re-enable it.";
  if (row.status === "WARMING") return "Engine is warming over history — conditions are not evaluated yet.";
  return `No armed level yet — ${row.freshBuy} fresh buy / ${row.freshSell} fresh sell conditions forming.`;
}

export function StrategyRadar({ rows, scanning, lastRun, onJumpToSymbol }: Props) {
  const { mode } = useFx();
  const [selected, setSelected] = useState<string | null>(null);

  // the sweep spins ONLY while a real analysis is fresh: a manual scan in
  // flight, or a server engine tick within the last 3.5s. Derived during
  // render — the 4s polling cadence keeps it honest without extra state.
  const sweepLive = scanning || (lastRun > 0 && Date.now() - lastRun < 3500);

  const blips = useMemo<Blip[]>(() => {
    const sorted = [...rows].sort((a, b) => `${a.symbol}${a.tf}`.localeCompare(`${b.symbol}${b.tf}`));
    return sorted.map((row, i) => {
      const { color, ping } = statusColor(row.status);
      let frac: number;
      if (row.nearest && isFinite(row.nearest.distAtr)) frac = 0.12 + 0.84 * Math.min(1, row.nearest.distAtr / 2.5);
      else frac = 0.94;
      const jitter = (hash01(row.symbol + row.tf) - 0.5) * 26;
      const ang = ((i / Math.max(1, sorted.length)) * 360 + jitter - 90) * (Math.PI / 180);
      const r = RAD * frac;
      const x = CTR + Math.cos(ang) * r;
      const y = CTR + Math.sin(ang) * r;
      const label =
        row.status === "ERROR"
          ? `${row.symbol} ${row.tf} — feed error`
          : row.status === "C3 WATCH"
            ? `${row.symbol} ${row.tf} — armed, waiting for C3 break (${row.nearest ? `${row.nearest.distAtr.toFixed(2)}·ATR away` : "level armed"})`
            : row.status === "RUNNING"
              ? `${row.symbol} ${row.tf} — trade running`
              : `${row.symbol} ${row.tf} — ${row.status.toLowerCase()}`;
      return { row, x, y, color, glow: `${color}55`, ping: ping && mode !== "off", label, reason: reasonOf(row) };
    });
  }, [rows, mode]);

  const sel = blips.find((b) => b.row.id === selected) ?? null;
  const animate = mode !== "off";

  return (
    <section
      aria-label="Strategy radar — live 3EL setup map"
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: C.line, background: C.navy4 }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderBottomColor: C.line }}>
        <div className="flex items-center gap-2">
          <Crosshair size={13} style={{ color: C.cyan }} aria-hidden />
          <span className="text-sm font-bold tracking-wider" style={{ color: C.txt }}>STRATEGY RADAR</span>
          <span
            className="rounded-full px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
            style={{ background: sweepLive ? A.cyan(0.12) : `${C.muted}1A`, color: sweepLive ? C.cyan : C.muted }}
          >
            {scanning ? "SCANNING NOW" : sweepLive ? "ENGINE TICK" : "IDLE SWEEP"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[8.5px] font-bold tracking-[0.1em]">
          {[
            { c: C.gold, t: "C3 ARMED (INCOMPLETE)" },
            { c: C.green, t: "TRADE RUNNING" },
            { c: C.cyan, t: "SCANNING" },
            { c: C.red, t: "FEED ERROR" },
            { c: C.gray, t: "PAUSED" },
          ].map((l) => (
            <span key={l.t} className="flex items-center gap-1" style={{ color: C.muted }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.c, boxShadow: `0 0 6px ${l.c}66` }} />
              {l.t}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ── the holographic sweep ── */}
        <div className="relative mx-auto w-full max-w-[340px]" style={{ aspectRatio: "1 / 1" }}>
          <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" role="img" aria-label={blips.length > 0 ? `Radar with ${blips.length} watchlist symbols` : "Radar — watchlist empty"}>
            <defs>
              <radialGradient id="radarBg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={A.cyan(0.1)} />
                <stop offset="70%" stopColor={`${C.navy}40`} />
                <stop offset="100%" stopColor={`${C.navy}00`} />
              </radialGradient>
              <linearGradient id="radarBeam" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={A.cyan(0.55)} />
                <stop offset="100%" stopColor={A.cyan(0)} />
              </linearGradient>
            </defs>

            <circle cx={CTR} cy={CTR} r={RAD} fill="url(#radarBg)" />
            {/* range rings — 2.5 / 1.66 / 0.83 / 0 ATR from trigger */}
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <circle key={f} cx={CTR} cy={CTR} r={RAD * f} fill="none" stroke={A.cyan(0.16)} strokeWidth="1" strokeDasharray={f === 1 ? "none" : "3 5"} />
            ))}
            {/* cross hairs + ticks */}
            <line x1={CTR - RAD} y1={CTR} x2={CTR + RAD} y2={CTR} stroke={A.cyan(0.1)} strokeWidth="1" />
            <line x1={CTR} y1={CTR - RAD} x2={CTR} y2={CTR + RAD} stroke={A.cyan(0.1)} strokeWidth="1" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i * 15 * Math.PI) / 180;
              const inner = RAD * (i % 6 === 0 ? 0.94 : 0.97);
              return (
                <line
                  key={i}
                  x1={CTR + Math.cos(a) * inner}
                  y1={CTR + Math.sin(a) * inner}
                  x2={CTR + Math.cos(a) * RAD}
                  y2={CTR + Math.sin(a) * RAD}
                  stroke={A.cyan(0.28)}
                  strokeWidth={i % 6 === 0 ? 1.4 : 0.8}
                />
              );
            })}
            {/* range labels along the top radius */}
            {[
              { f: 0.25, t: "0.6·ATR" },
              { f: 0.5, t: "1.25" },
              { f: 0.75, t: "1.9" },
              { f: 1, t: "2.5" },
            ].map((l) => (
              <text key={l.f} x={CTR + 4} y={CTR - RAD * l.f - 3} fill={`${C.muted}BF`} fontSize="9" fontFamily="monospace">
                {l.t}
              </text>
            ))}

            {/* sweep beam — rotates only during real analysis */}
            <g className={`halo-radar-sweep ${sweepLive ? "is-live" : ""}`}>
              <path
                d={`M ${CTR} ${CTR} L ${CTR + RAD} ${CTR - 26} A ${RAD} ${RAD} 0 0 1 ${CTR + RAD} ${CTR + 26} Z`}
                fill="url(#radarBeam)"
                opacity="0.5"
              />
              <line x1={CTR} y1={CTR} x2={CTR + RAD} y2={CTR} stroke={A.cyan(0.65)} strokeWidth="1.4" />
            </g>

            {/* core emblem */}
            <circle cx={CTR} cy={CTR} r="5.5" fill={C.cyan} opacity="0.9" />
            <circle cx={CTR} cy={CTR} r="11" fill="none" stroke={A.cyan(0.4)} strokeWidth="1" strokeDasharray="4 3" />
          </svg>

          {/* blips — real, focusable buttons over the scope */}
          {blips.map((b) => {
            const active = selected === b.row.id;
            return (
              <button
                key={b.row.id}
                type="button"
                onClick={() => setSelected(active ? null : b.row.id)}
                aria-label={b.label}
                aria-pressed={active}
                title={b.label}
                className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full p-2 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#4FD8FF] hover:scale-125"
                style={{ left: `${(b.x / 400) * 100}%`, top: `${(b.y / 400) * 100}%` }}
              >
                {b.ping && animate && (
                  <span
                    className="halo-radar-ping absolute inset-1 rounded-full"
                    style={{ border: `1.5px solid ${b.color}` }}
                    aria-hidden
                  />
                )}
                <span
                  className="relative block rounded-full"
                  style={{
                    width: b.row.status === "C3 WATCH" || b.row.status === "RUNNING" ? 10 : 7,
                    height: b.row.status === "C3 WATCH" || b.row.status === "RUNNING" ? 10 : 7,
                    background: b.color,
                    boxShadow: `0 0 10px 2px ${b.glow}${active ? `, 0 0 0 3px ${A.cyan(0.5)}` : ""}`,
                  }}
                />
                <span
                  className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap font-mono text-[8px] font-bold tracking-wider transition-opacity"
                  style={{ color: active ? C.txt : C.muted, opacity: active ? 1 : 0.75, textShadow: "0 1px 3px rgba(4,8,18,0.9)" }}
                >
                  {b.row.symbol.replace(/USDT$|USDTm$/i, "")}
                </span>
              </button>
            );
          })}

          {blips.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="max-w-[200px] text-center text-[10.5px] leading-snug" style={{ color: C.label }}>
                Watchlist empty — add symbols below and the radar lights up with their real 3EL states.
              </p>
            </div>
          )}
        </div>

        {/* ── selected setup inspector — genuine row data only ── */}
        <div className="min-w-0">
          {sel ? (
            <div className="flex h-full flex-col gap-2 rounded-lg border p-3" style={{ borderColor: C.line2, background: `${C.navy}CC`, animation: animate ? "halo-msg 0.25s ease-out" : undefined }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-extrabold tracking-wide" style={{ color: C.txt }}>
                  {sel.row.symbolLabel.split("·")[0].trim()} <span className="font-mono text-[10px]" style={{ color: C.muted }}>{sel.row.tf}</span>
                </span>
                <span
                  className="rounded-full px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
                  style={{ background: `${sel.color}1A`, color: sel.color }}
                >
                  {sel.row.status}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold text-[#8C98AE] transition-colors hover:text-[#E8ECF4]"
                  aria-label="Close setup details"
                >
                  ✕
                </button>
              </div>

              <p className="flex items-start gap-1.5 text-[10.5px] leading-snug" style={{ color: C.txt2 }}>
                <Info size={11} className="mt-0.5 shrink-0" style={{ color: sel.color }} aria-hidden />
                {sel.reason}
              </p>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {[
                  { l: "PRICE", v: sel.row.price ? sel.row.price.toLocaleString("en-US") : "—" },
                  { l: "ATR", v: sel.row.atr ? sel.row.atr.toFixed(2) : "—" },
                  { l: "FRESH S / B", v: `${sel.row.freshSell} / ${sel.row.freshBuy}` },
                  {
                    l: "NEAREST LEVEL",
                    v: sel.row.nearest ? `${sel.row.nearest.side === -1 ? "R" : "S"} ${sel.row.nearest.distAtr.toFixed(2)}·ATR` : "—",
                  },
                  {
                    l: "LAST SIGNAL",
                    v: sel.row.lastSignal ? `${sel.row.lastSignal.kind.toUpperCase()} ${sel.row.lastSignal.dir === -1 ? "▼" : "▲"}` : "—",
                  },
                  { l: "FEED", v: sel.row.source },
                ].map((f) => (
                  <div key={f.l} className="min-w-0 rounded-md border px-2 py-1.5" style={{ borderColor: C.lineInner, background: `${C.panel}CC` }}>
                    <div className="truncate text-[8px] font-bold tracking-[0.14em]" style={{ color: C.label }}>{f.l}</div>
                    <div className="truncate font-mono text-[11px] font-bold" style={{ color: C.txt }}>{f.v}</div>
                  </div>
                ))}
              </div>

              {onJumpToSymbol && (
                <button
                  type="button"
                  onClick={() => onJumpToSymbol(sel.row.symbol)}
                  className="mt-auto flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border text-[9.5px] font-extrabold tracking-[0.16em] transition-all hover:brightness-125"
                  style={{ borderColor: `${C.gold}66`, background: `${C.gold}14`, color: C.gold }}
                >
                  OPEN {sel.row.symbol} IN TERMINAL
                </button>
              )}
              <p className="text-[8.5px] leading-snug text-[#5D6B85]">
                Radar is informational — setups are approved and executed only by the existing 3EL engine and its execution rules.
              </p>
            </div>
          ) : (
            <div className="flex h-full min-h-[180px] flex-col justify-center gap-2 rounded-lg border border-dashed p-4" style={{ borderColor: C.line2, background: `${C.navy}66` }}>
              <p className="text-[10.5px] font-bold tracking-[0.14em]" style={{ color: C.label }}>SETUP INSPECTOR</p>
              <p className="text-[10.5px] leading-relaxed" style={{ color: C.muted }}>
                Tap any blip to inspect its real engine conditions — status, distance to the armed wick line in
                ATR, fresh condition counts, the last confirmed signal and the honest reason the setup qualifies,
                is still being evaluated, or was rejected.
              </p>
              <p className="text-[9.5px] leading-relaxed text-[#5D6B85]">
                Blips closest to the core are nearest to their C3 trigger. The sweep moves only while the engine
                is actually analysing — never for decoration.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
