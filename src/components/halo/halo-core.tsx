"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO AI CORE · the JARVIS reactor strip
//
//  A central, animated AI-assistant visualization that reflects ONLY the
//  genuine application state polled from /api/bot/state (never fakes a
//  live connection):
//    OFFLINE    — no bot state yet (startup / API unreachable)
//    STANDBY    — EA switched off
//    SCANNING   — EA on, hunting for a C1/C2 formation
//    EVALUATING — one or more wick levels armed, waiting for the C3 break
//    MANAGING   — a trade is open (green BUY / red SELL tint)
//    WARNING    — feed degraded (simulator / stale / error), shown honestly
//  Voice activity (LISTENING · PROCESSING · SPEAKING) arrives from the
//  JARVIS console and takes over the orb with an equalizer animation.
//
//  Presentation only — reads the same BotStateRes the panels use; never
//  mutates engine state or routes orders.
// ════════════════════════════════════════════════════════════════════════

import { C, fmtPips, fmtPx, type BotStateRes, type VoiceState } from "@/lib/halo/ui-helpers";

type CoreState = "offline" | "standby" | "scanning" | "evaluating" | "managing" | "warning";

const META: Record<CoreState, { label: string; color: string }> = {
  offline: { label: "OFFLINE", color: "#5D606B" },
  standby: { label: "STANDBY", color: "#7FA8C4" },
  scanning: { label: "SCANNING", color: C.cyan },
  evaluating: { label: "EVALUATING", color: C.gold },
  managing: { label: "MANAGING", color: C.green },
  warning: { label: "FEED DEGRADED", color: "#FFB454" },
};

const VOICE_META: Record<Exclude<VoiceState, "idle">, { label: string }> = {
  listening: { label: "LISTENING" },
  processing: { label: "PROCESSING" },
  speaking: { label: "SPEAKING" },
};

function relTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return `${Math.max(1, Math.round(d / 1000))}s ago`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ── the reactor orb ──────────────────────────────────────────────────────
function Orb({ color, active, voice, pulse }: { color: string; active: boolean; voice: VoiceState; pulse: boolean }) {
  const speaking = voice === "listening" || voice === "processing" || voice === "speaking";
  return (
    <div
      className="relative h-[84px] w-[84px] shrink-0 sm:h-[92px] sm:w-[92px]"
      style={{ filter: active ? `drop-shadow(0 0 14px ${color}44)` : "none" }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={voice === "idle" ? "HALO AI core visualization" : `HALO AI core — voice ${VOICE_META[voice].label.toLowerCase()}`}>
        <defs>
          <radialGradient id="haloCoreGrad" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="55%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0B1426" stopOpacity="0.9" />
          </radialGradient>
        </defs>

        {/* 12 dial ticks */}
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1="50" y1="4.5" x2="50" y2="8.5"
            transform={`rotate(${i * 30} 50 50)`}
            stroke={color}
            strokeWidth="1.1"
            opacity={i % 3 === 0 ? 0.55 : 0.22}
          />
        ))}

        {/* outer dashed ring — slow orbit */}
        <circle
          cx="50" cy="50" r="45"
          fill="none" stroke={color} strokeWidth="1.4" strokeDasharray="5 7" opacity="0.55"
          className={active ? "halo-anim-orbit" : undefined}
          style={active ? { transformBox: "fill-box", transformOrigin: "center" } : undefined}
        />

        {/* inner segmented ring — counter-orbit */}
        <circle
          cx="50" cy="50" r="36"
          fill="none" stroke={color} strokeWidth="2.2" strokeDasharray="34 14 7 14" opacity="0.38"
          className={active ? "halo-anim-orbit-rev" : undefined}
          style={active ? { transformBox: "fill-box", transformOrigin: "center" } : undefined}
        />

        {/* state pulse ring */}
        {pulse && (
          <circle
            cx="50" cy="50" r="28" fill="none" stroke={color} strokeWidth="1.6" opacity="0.7"
            style={{ animation: "halo-core-ring 2.1s ease-out infinite", transformBox: "fill-box", transformOrigin: "center" }}
          />
        )}

        {/* breathing core */}
        <circle
          cx="50" cy="50" r="17.5" fill="url(#haloCoreGrad)"
          className={active ? "halo-anim-breathe" : undefined}
          style={active ? { transformBox: "fill-box", transformOrigin: "center" } : { opacity: 0.45 }}
        />
        <circle cx="50" cy="50" r="17.5" fill="none" stroke={color} strokeWidth="1" opacity="0.8" />

        {/* center glyph — equalizer while voice is active, HALO diamond otherwise */}
        {speaking ? (
          <g fill={color}>
            {[0, 1, 2, 3, 4].map((i) => (
              <rect
                key={i}
                x={40.4 + i * 4.4} width="2.6" y="43.5" height="13" rx="1.3"
                style={
                  active
                    ? { animation: `halo-eq 0.95s ease-in-out ${i * 0.13}s infinite`, transformBox: "fill-box", transformOrigin: "center" }
                    : { opacity: 0.5 }
                }
              />
            ))}
          </g>
        ) : (
          <g>
            <path d="M50 41.5 L57.5 50 L50 58.5 L42.5 50 Z" fill={color} opacity="0.92" />
            <line x1="36" y1="50" x2="41" y2="50" stroke={color} strokeWidth="1.3" opacity="0.75" />
            <line x1="59" y1="50" x2="64" y2="50" stroke={color} strokeWidth="1.3" opacity="0.75" />
          </g>
        )}
      </svg>
    </div>
  );
}

// ── main strip ───────────────────────────────────────────────────────────
export function HaloCore({ state, voice }: { state: BotStateRes | null; voice: VoiceState }) {
  // derive the honest core state from the polled bot state
  let core: CoreState = "offline";
  let dir: -1 | 1 = 1;
  if (state) {
    const note = (state.feed.note || "").toLowerCase();
    const degraded = state.feed.source === "simulator" || note.includes("slow") || note.includes("error") || note.includes("unreachable");
    if (degraded) core = "warning";
    else if (!state.enabled) core = "standby";
    else if (state.engine.trade) {
      core = "managing";
      dir = state.engine.trade.dir === -1 ? -1 : 1;
    } else if (state.engine.levels.length > 0) core = "evaluating";
    else core = "scanning";
  }

  const meta = META[core];
  const color = voice !== "idle" ? C.cyan : core === "managing" ? (dir === -1 ? C.red : C.green) : meta.color;
  const active = core !== "offline" && core !== "standby";
  const pulse = core === "evaluating" || core === "managing";

  const st = state;
  const lastDecisions = st ? st.engine.log.slice(0, 2) : [];
  const stat = st ? st.engine.stats : null;

  const stateLine = (() => {
    if (!st) return "Connecting to the EA engine…";
    if (core === "warning") return st.feed.note || `Feed degraded · ${st.feed.source}`;
    if (core === "standby") return "EA off — flip it ON and I start guarding the market.";
    const sym = `${st.symbol} · ${st.tf}`;
    if (core === "managing" && st.engine.trade) {
      const t = st.engine.trade;
      return `${t.dir === -1 ? "SELL" : "BUY"} open @ ${fmtPx(t.entry, st.mintick)} · SL ${fmtPx(t.sl, st.mintick)} · TP ${fmtPx(t.tp, st.mintick)}`;
    }
    if (core === "evaluating") {
      const sup = st.engine.levels.filter((l) => l.side === 1).length;
      const res = st.engine.levels.filter((l) => l.side === -1).length;
      return `Watching ${sym} — ${res > 0 ? `${res} resistance` : ""}${res > 0 && sup > 0 ? " + " : ""}${sup > 0 ? `${sup} support` : ""} armed for the C3 break & return`;
    }
    return `Hunting C1/C2 equal levels on ${sym}`;
  })();

  return (
    <section
      aria-label="HALO AI core status"
      className="relative overflow-hidden rounded-xl border bg-[#0F1A30]/85 p-3 backdrop-blur transition-colors"
      style={{ borderColor: `${color}55` }}
    >
      {/* faint cyan edge wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(80% 130% at 0% 50%, ${color}12 0%, transparent 55%)` }}
      />
      <div className="relative flex items-center gap-3">
        <Orb color={color} active={active} voice={voice} pulse={pulse} />

        {/* identity + state */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] font-extrabold tracking-[0.26em]" style={{ color }}>
              HALO AI CORE
            </span>
            <span
              className="halo-anim-beacon inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: active ? color : "#5D606B", ["--beacon" as string]: `${color}88` } as React.CSSProperties}
              aria-hidden
            />
            {voice !== "idle" && (
              <span
                className="rounded-full border px-1.5 py-px text-[8px] font-extrabold tracking-[0.18em]"
                style={{ borderColor: `${C.cyan}66`, color: C.cyan, background: "rgba(79,216,255,0.08)" }}
              >
                ● {VOICE_META[voice].label}
              </span>
            )}
            {st && (
              <span className="text-[9px] font-bold tracking-[0.18em] text-[#8C98AE]">
                EA {st.enabled ? "ON" : "OFF"} · {st.exec.executionMode === "live" ? "LIVE ORDERS" : "PAPER"} · FEED {st.feed.source.toUpperCase()}
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-[12px] font-semibold leading-snug" style={{ color: core === "warning" ? meta.color : "#E8ECF4" }} title={stateLine}>
            {stateLine}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9.5px] font-mono text-[#8C98AE]">
            {st && stat && (
              <>
                <span>
                  BOOK <span className="text-[#E8ECF4]">{fmtPips(st.feed.realizedPips)}</span> PIPS
                </span>
                <span>
                  <span className="text-[#089981]">{stat.wins}W</span> / <span className="text-[#F23645]">{stat.losses}L</span>
                </span>
                {st.engine.atr !== null && <span>ATR {st.engine.atr.toFixed(2)}</span>}
              </>
            )}
          </div>

          {/* recent decisions — straight from the engine log */}
          {lastDecisions.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-[#1C2A47]/70 pt-1.5">
              {lastDecisions.map((l, i) => (
                <div key={`${l.time}-${l.kind}-${i}`} className="flex items-center gap-1.5 text-[9px] font-mono tracking-wide">
                  <span
                    className="rounded-sm px-1 py-px text-[7.5px] font-extrabold"
                    style={{
                      background: l.kind === "fire" ? "rgba(79,216,255,0.12)" : l.kind === "win" ? "rgba(8,153,129,0.14)" : "rgba(242,54,69,0.14)",
                      color: l.kind === "fire" ? C.cyan : l.kind === "win" ? C.green : C.red,
                    }}
                  >
                    {l.kind.toUpperCase()}
                  </span>
                  <span className="text-[#8C98AE]">
                    {l.kind === "fire"
                      ? `${l.dir === -1 ? "SELL" : "BUY"} @ ${fmtPx(l.entry, st?.mintick ?? 0.01)}`
                      : l.kind === "loss"
                        ? fmtPips(-Math.abs(l.pips))
                        : fmtPips(l.pips)}
                  </span>
                  <span className="ml-auto text-[#5D6B85]">{fmtClock(l.time)} · {relTime(l.time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
