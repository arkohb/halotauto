"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO AI CORE · the JARVIS reactor card (command-center edition)
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
//  JARVIS console and is reported truthfully on the telemetry rows.
//
//  Presentation only — reads the same BotStateRes the panels use; never
//  mutates engine state or routes orders.
// ════════════════════════════════════════════════════════════════════════

import { C, fmtPx, type BotStateRes, type VoiceState } from "@/lib/halo/ui-helpers";
import { PanelCard, TelemetryRow } from "./panel";
import { useHaloVoice, type WakeState } from "./voice-provider";
import { Bot, Globe2, Radar, Radio, Settings2, Mic, Waves } from "lucide-react";

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

const WAKE_META: Record<WakeState, { label: string; color?: string }> = {
  off: { label: "Off" },
  standby: { label: "Armed · say the wake word", color: C.cyan },
  listening: { label: "Listening for wake word", color: C.cyan },
  denied: { label: "Mic permission denied", color: "#FFB454" },
  unsupported: { label: "Mic API unavailable", color: "#FFB454" },
};

// ── the reactor avatar — robot face inside orbiting rings ────────────────
function CoreAvatar({ color, active, voice }: { color: string; active: boolean; voice: VoiceState }) {
  const speaking = voice === "listening" || voice === "processing" || voice === "speaking";
  return (
    <div className="relative h-[104px] w-[104px] shrink-0" style={{ filter: active ? `drop-shadow(0 0 16px ${color}55)` : "none" }}>
      <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={voice === "idle" ? "HALO AI core visualization" : `HALO AI core — voice ${VOICE_META[voice].label.toLowerCase()}`}>
        <defs>
          <radialGradient id="haloCoreGrad" cx="50%" cy="40%" r="68%">
            <stop offset="0%" stopColor={color} stopOpacity="0.9" />
            <stop offset="58%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0B1426" stopOpacity="0.95" />
          </radialGradient>
        </defs>

        {/* dial ticks */}
        {Array.from({ length: 12 }, (_, i) => (
          <line
            key={i}
            x1="50" y1="3.5" x2="50" y2="8"
            transform={`rotate(${i * 30} 50 50)`}
            stroke={color}
            strokeWidth="1.1"
            opacity={i % 3 === 0 ? 0.6 : 0.22}
          />
        ))}

        {/* outer dashed orbit */}
        <circle
          cx="50" cy="50" r="46.5" fill="none" stroke={color} strokeWidth="1.3" strokeDasharray="5 7" opacity="0.55"
          className={active ? "halo-anim-orbit" : undefined}
          style={active ? { transformBox: "fill-box", transformOrigin: "center" } : undefined}
        />
        {/* inner segmented counter-orbit */}
        <circle
          cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="1.8" strokeDasharray="30 12 6 12" opacity="0.4"
          className={active ? "halo-anim-orbit-rev" : undefined}
          style={active ? { transformBox: "fill-box", transformOrigin: "center" } : undefined}
        />

        {/* core disc */}
        <circle cx="50" cy="50" r="31" fill="url(#haloCoreGrad)" className={active ? "halo-anim-breathe" : undefined} style={active ? { transformBox: "fill-box", transformOrigin: "center" } : { opacity: 0.4 }} />
        <circle cx="50" cy="50" r="31" fill="none" stroke={color} strokeWidth="0.9" opacity="0.75" />

        {/* robot face plate */}
        <g>
          {/* head silhouette */}
          <path
            d="M50 30 C61 30 67 37 67 47 C67 57 62 66 57 69 L43 69 C38 66 33 57 33 47 C33 37 39 30 50 30 Z"
            fill="#0E1B33" stroke={color} strokeWidth="1.4" opacity="0.96"
          />
          {/* visor */}
          <path d="M37 45 C42 42.5 58 42.5 63 45 L63 51 C63 54 59 55.5 50 55.5 C41 55.5 37 54 37 51 Z" fill="#060D1B" stroke={color} strokeWidth="0.8" opacity="0.95" />
          {/* eyes — equalizer bars while voice is active, scanning eyes otherwise */}
          {speaking ? (
            <g fill={color}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect
                  key={i}
                  x={40 + i * 3.6} width="2" y="45.5" height="9" rx="1"
                  style={active ? { animation: `halo-eq 0.95s ease-in-out ${i * 0.11}s infinite`, transformBox: "fill-box", transformOrigin: "center" } : { opacity: 0.5 }}
                />
              ))}
            </g>
          ) : (
            <g>
              <rect x="41.5" y="47" width="5.4" height="2.6" rx="1.3" fill={color} className={active ? "halo-anim-breathe" : undefined} style={active ? { transformBox: "fill-box", transformOrigin: "center" } : undefined} />
              <rect x="53.1" y="47" width="5.4" height="2.6" rx="1.3" fill={color} className={active ? "halo-anim-breathe" : undefined} style={active ? { transformBox: "fill-box", transformOrigin: "center" } : undefined} />
            </g>
          )}
          {/* mouth grill */}
          <g stroke={color} strokeWidth="1" opacity="0.55">
            <line x1="44" y1="62" x2="56" y2="62" />
            <line x1="46" y1="65" x2="54" y2="65" />
          </g>
          {/* crown antenna */}
          <line x1="50" y1="30" x2="50" y2="25.5" stroke={color} strokeWidth="1.2" />
          <circle cx="50" cy="24.4" r="1.5" fill={color} className="halo-anim-beacon" style={{ ["--beacon" as string]: `${color}88` } as React.CSSProperties} />
        </g>
      </svg>
    </div>
  );
}

// ── main card ────────────────────────────────────────────────────────────
export function HaloCore({ state }: { state: BotStateRes | null }) {
  const v = useHaloVoice();
  const voice = v.voice;
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
  const speaking = voice !== "idle";

  const st = state;

  const connection = (() => {
    if (!st) return "Linking…";
    const age = st.feed.lastTickAt ? Math.round((Date.now() - st.feed.lastTickAt) / 1000) : null;
    if (core === "warning") return `Degraded · ${st.feed.source}`;
    return age !== null && age < 30 ? `Online · ${st.feed.source}` : `Stale · ${age ?? "?"}s`;
  })();

  const monitor = (() => {
    if (!st) return "—";
    if (core === "managing" && st.engine.trade) return `${st.engine.trade.dir === -1 ? "SELL" : "BUY"} live`;
    if (core === "evaluating") return `${st.engine.levels.length} armed`;
    if (core === "scanning") return "Hunting C1/C2";
    return meta.label;
  })();

  const openAssistant = () => v.startConvo();

  // personalized identity line — the trader's own name, never invented
  const bandWord = (() => {
    const h = new Date().getHours();
    return h < 12 ? "GOOD MORNING" : h < 17 ? "GOOD AFTERNOON" : h < 22 ? "GOOD EVENING" : "LATE SHIFT";
  })();

  return (
    <PanelCard
      title="HALO AI CORE"
      icon={Bot}
      accent="cyan"
      className="h-full"
      right={
        <span
          className="rounded-full px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.14em]"
          style={{ background: `${color}1A`, color }}
        >
          {voice !== "idle" ? `● ${VOICE_META[voice].label}` : meta.label}
        </span>
      }
      bodyClassName="flex flex-col p-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <CoreAvatar color={color} active={active} voice={voice} />

        {/* identity + telemetry */}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold tracking-wide text-[#E8ECF4]">HALO</div>
          <div className="mb-1 truncate text-[8.5px] font-bold tracking-[0.2em] text-[#6B7A94]">
            {v.profile.hasName ? `${bandWord}, ${v.profile.displayName.toUpperCase()} · READ-ONLY` : "YOUR TRADING CO-PILOT · READ-ONLY"}
          </div>

          <TelemetryRow icon={<Globe2 size={11} />} label="Connection" value={connection} color={core === "warning" ? "#FFB454" : connection.startsWith("Online") ? C.green : connection.startsWith("Stale") ? C.gold : "#8C98AE"} />
          <TelemetryRow
            icon={<Settings2 size={11} />}
            label="Mode"
            value={st ? `Auto ${st.enabled ? "ON" : "OFF"} · ${st.exec.executionMode === "live" ? "LIVE" : "PAPER"}` : "—"}
            color={st?.enabled ? C.green : "#8C98AE"}
          />
          <TelemetryRow icon={<Radar size={11} />} label="Market monitor" value={monitor} color={color} />
          <TelemetryRow icon={<Bot size={11} />} label="Strategy" value={st ? `3EL v1.2 · ${st.symbol} ${st.tf}` : "—"} />
          <TelemetryRow
            icon={<Waves size={11} />}
            label="Voice"
            value={speaking ? VOICE_META[voice].label : v.prefs.muted ? "Muted" : "Standby"}
            color={speaking ? C.cyan : "#8C98AE"}
          />
          <TelemetryRow
            icon={<Radio size={11} />}
            label="Wake word"
            value={WAKE_META[v.wakeState].label}
            color={WAKE_META[v.wakeState].color ?? "#8C98AE"}
          />
        </div>
      </div>

      {/* voice gateway — opens the JARVIS console (chat / push-to-talk) */}
      <button
        type="button"
        onClick={openAssistant}
        aria-label="Open the HALO assistant to talk or chat"
        className="mt-2.5 flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border transition-all hover:brightness-125"
        style={{
          borderColor: speaking ? C.cyan : "rgba(79,216,255,0.45)",
          background: speaking ? "rgba(79,216,255,0.14)" : "rgba(79,216,255,0.06)",
          boxShadow: speaking ? `0 0 14px 1px ${C.cyan}44` : "none",
        }}
      >
        <Mic size={13} color={C.cyan} />
        <span className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.cyan }}>
          {voice === "listening" ? "LISTENING…" : voice === "processing" ? "THINKING…" : voice === "speaking" ? "SPEAKING…" : `TALK TO HALO${v.profile.voiceEnabled ? "" : " · VOICE OFF"}`}
        </span>
        {/* mini equalizer */}
        <span className="flex items-end gap-[2px]" aria-hidden>
          {[4, 7, 10, 7, 4].map((h, i) => (
            <span
              key={i}
              className="w-[2px] rounded-full"
              style={{
                height: h,
                background: C.cyan,
                opacity: speaking ? 1 : 0.35,
                ...(speaking ? { animation: `halo-eq 0.9s ease-in-out ${i * 0.12}s infinite`, transformBox: "fill-box", transformOrigin: "bottom" } : {}),
              }}
            />
          ))}
        </span>
      </button>

      {/* latest decision — straight from the engine log */}
      {st && st.engine.log.length > 0 && (
        <div className="mt-1.5 flex shrink-0 items-center gap-1.5 border-t border-[#16263F]/70 pt-1.5 text-[9px] font-mono">
          <span className="shrink-0 text-[8px] font-extrabold tracking-[0.16em] text-[#6B7A94]">RECENT</span>
          {(() => {
            const l = st.engine.log[0];
            return (
              <>
                <span
                  className="rounded-sm px-1 py-px text-[7.5px] font-extrabold"
                  style={{
                    background: l.kind === "fire" ? "rgba(79,216,255,0.12)" : l.kind === "win" ? "rgba(8,153,129,0.14)" : "rgba(242,54,69,0.14)",
                    color: l.kind === "fire" ? C.cyan : l.kind === "win" ? C.green : C.red,
                  }}
                >
                  {l.kind.toUpperCase()}
                </span>
                <span className="truncate text-[#8C98AE]">
                  {l.kind === "fire"
                    ? `${l.dir === -1 ? "SELL" : "BUY"} @ ${fmtPx(l.entry, st.mintick)}`
                    : `${l.pips >= 0 ? "+" : "−"}${Math.abs(l.pips).toFixed(1)} pips`}
                </span>
                <span className="ml-auto shrink-0 text-[#5D6B85]">
                  {new Date(l.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            );
          })()}
        </div>
      )}
    </PanelCard>
  );
}
