"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO AI CORE · the JARVIS reactor card (mockup edition — centered orb)
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
//  JARVIS console and is reported truthfully on the telemetry rows. The
//  EXECUTING (teal) and ERROR (red) orb states mirror REAL action runs:
//  executing only while an allowlisted operation is actually in flight,
//  error only after a verified failure — never a decorative success.
//
//  Presentation only — reads the same BotStateRes the panels use; never
//  mutates engine state or routes orders.
// ════════════════════════════════════════════════════════════════════════

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Bot, Globe2, Radar, Radio, Settings2, Mic, Waves } from "lucide-react";
import { A, C, fmtPx, type BotStateRes, type VoiceState } from "@/lib/halo/ui-helpers";
import { PanelCard, TelemetryRow } from "./panel";
import { useHaloVoice, type WakeState } from "./voice-provider";
import { voiceEnergy } from "@/lib/halo/voice-energy";
import type { OrbVisual } from "./ai-orb";

// the 3D holographic core is decorative + GPU-bound → lazy client bundle
const HaloOrb = dynamic(() => import("./ai-orb").then((m) => m.HaloOrb), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="relative h-[150px] w-[150px] shrink-0">
      <div className="absolute inset-0 animate-pulse rounded-full" style={{ border: `1px solid ${A.cyan(0.25)}` }} />
      <div
        className="absolute inset-[22%] rounded-full"
        style={{ background: `radial-gradient(circle at 42% 36%, ${A.cyan(0.55)}, rgba(2,11,26,0.9) 75%)` }}
      />
    </div>
  ),
});

type CoreState = "offline" | "standby" | "scanning" | "evaluating" | "managing" | "warning";

const META: Record<CoreState, { label: string; color: string }> = {
  offline: { label: "OFFLINE", color: "#51678A" },
  standby: { label: "STANDBY", color: "#7FA8C4" },
  scanning: { label: "SCANNING", color: C.cyan },
  evaluating: { label: "EVALUATING", color: C.warn },
  managing: { label: "MANAGING", color: C.green },
  warning: { label: "FEED DEGRADED", color: C.warn },
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
  denied: { label: "Mic permission denied", color: C.warn },
  unsupported: { label: "Mic API unavailable", color: C.warn },
};

// ── main card ────────────────────────────────────────────────────────────
export function HaloCore({ state }: { state: BotStateRes | null }) {
  const v = useHaloVoice();
  const voice = v.voice;

  // ── real action-execution mirror (ActionBridge) ──
  // cheap 200ms boolean-sync: executing windows are short (~100-600ms),
  // far below the 2s bot-state poll — the orb would miss them otherwise
  const [executing, setExecuting] = useState(false);
  const [errFresh, setErrFresh] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const es = voiceEnergy.snapshot();
      setExecuting((p) => (p === es.executing ? p : es.executing));
      setErrFresh((p) => {
        const fresh = es.lastErrorAt > 0 && performance.now() - es.lastErrorAt < 2800;
        return p === fresh ? p : fresh;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, []);

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
  // AI-core badge: voice activity → real execution window → verified failure → EA state
  const badge =
    voice !== "idle"
      ? { label: `● ${VOICE_META[voice].label}`, color: C.cyan }
      : executing
        ? { label: "● EXECUTING", color: C.teal }
        : errFresh
          ? { label: "● ACTION FAILED", color: C.red }
          : { label: meta.label, color: core === "managing" ? (dir === -1 ? C.red : C.green) : meta.color };
  const color = badge.color;
  const speaking = voice !== "idle";

  const st = state;

  // verified warnings only — the alert pulse never fires on guesses
  const warnings: string[] = [];
  if (st && core === "warning") warnings.push(`Feed degraded · ${st.feed.source}`);
  if (v.profile.voiceEnabled && v.mic === "denied") warnings.push("Microphone denied — voice input unavailable");
  const assistantDown = v.status === "offline";
  if (assistantDown) warnings.push("Assistant link unreachable — retrying");

  // 3D core state — voice wins, then REAL execution windows / verified
  // failures, then verified alerts, then EA state. Never a fake animation:
  // executing exists only while the ActionBridge actually runs, error only
  // for 2.8 s after a verified failure.
  const orbState: OrbVisual =
    voice === "processing"
      ? "thinking"
      : voice === "speaking"
        ? "speaking"
        : voice === "listening"
          ? "listening"
          : executing
            ? "executing"
            : errFresh
              ? "error"
              : assistantDown || warnings.length > 0
                ? "alert"
                : v.status === "initializing"
                  ? "offline"
                  : "idle";

  // confirmed engine fire → one honest energy pulse on the core
  const lastLogRef = useRef<number | null>(null);
  useEffect(() => {
    const head = state?.engine.log[0];
    if (!head) return;
    if (lastLogRef.current !== null && head.time !== lastLogRef.current && head.kind === "fire") {
      voiceEnergy.firePulse(head.dir);
    }
    lastLogRef.current = head.time;
  }, [state?.engine.log]);

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

  const onlineWord = assistantDown ? "Offline" : core === "warning" ? "Degraded" : v.status === "initializing" ? "Linking…" : "Online";
  const onlineColor = assistantDown ? C.red : core === "warning" ? C.warn : v.status === "initializing" ? C.muted : C.green;

  return (
    <PanelCard title="HALO AI" icon={Bot} accent="cyan" bodyClassName="flex flex-col">
      {/* centered holographic core — mirrors the REAL assistant state */}
      <div className="relative flex flex-col items-center px-3 pb-1 pt-3">
        <div className="relative" title={warnings.length > 0 ? warnings.join(" · ") : undefined}>
          <HaloOrb
            state={orbState}
            alertWarm={assistantDown}
            size={150}
            idleColor={core === "managing" ? (dir === -1 ? [1.0, 0.3, 0.34] : [0.1, 0.85, 0.62]) : undefined}
          />
          {orbState === "listening" && (
            <span
              aria-hidden
              className="halo-anim-beacon absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
              style={{ background: C.cyan, ["--beacon" as string]: `${C.cyan}99` } as React.CSSProperties}
            />
          )}
        </div>

        <div className="mt-1.5 text-[15px] font-extrabold tracking-[0.08em]" style={{ color: C.txt, textShadow: "0 0 18px rgba(46,204,255,0.3)" }}>
          HALO AI
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold tracking-wide" style={{ color: onlineColor }}>
          <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: onlineColor, boxShadow: `0 0 8px 0 ${onlineColor}` }} />
          {onlineWord}
          {st && !assistantDown && <span className="font-medium" style={{ color: C.muted }}>· {st.feed.source}</span>}
        </div>

        {/* voice equalizer — active only on real voice activity */}
        <span className="mt-2 flex h-5 items-end gap-[2.5px]" aria-hidden>
          {[5, 9, 13, 17, 13, 9, 5, 11, 7].map((h, i) => (
            <span
              key={i}
              className="w-[2.5px] rounded-full"
              style={{
                height: speaking ? h : Math.round(h * 0.4),
                background: speaking ? C.cyan : C.line2,
                opacity: speaking ? 1 : 0.7,
                ...(speaking
                  ? { animation: `halo-eq 0.9s ease-in-out ${i * 0.09}s infinite`, transformBox: "fill-box", transformOrigin: "bottom" }
                  : {}),
              }}
            />
          ))}
        </span>

        {/* status badge — voice wins, then real execution, then EA state */}
        <span
          className="mt-2 rounded-full px-2.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.16em]"
          style={{ background: `${color}1A`, color, boxShadow: `inset 0 0 0 1px ${color}44` }}
        >
          {badge.label}
        </span>
      </div>

      {/* telemetry — compact 2-col grid keeps the mockup's tight right rail */}
      <div className="grid grid-cols-1 gap-x-3 px-3 sm:grid-cols-2">
        <TelemetryRow icon={<Globe2 size={11} />} label="Link" value={connection} color={core === "warning" ? C.warn : connection.startsWith("Online") ? C.green : connection.startsWith("Stale") ? C.warn : C.muted} />
        <TelemetryRow icon={<Settings2 size={11} />} label="Mode" value={st ? `Auto ${st.enabled ? "ON" : "OFF"} · ${st.exec.executionMode === "live" ? "LIVE" : "PAPER"}` : "—"} color={st?.enabled ? C.green : C.muted} />
        <TelemetryRow icon={<Radar size={11} />} label="Monitor" value={monitor} color={color} />
        <TelemetryRow icon={<Bot size={11} />} label="Strategy" value={st ? `3EL · ${st.symbol} ${st.tf}` : "—"} />
        <TelemetryRow icon={<Waves size={11} />} label="Voice" value={speaking ? VOICE_META[voice].label : v.prefs.muted ? "Muted" : "Standby"} color={speaking ? C.cyan : C.muted} />
        <TelemetryRow icon={<Radio size={11} />} label="Wake" value={WAKE_META[v.wakeState].label} color={WAKE_META[v.wakeState].color ?? C.muted} />
      </div>

      {/* voice gateway — opens the JARVIS console (chat / push-to-talk) */}
      <div className="mt-auto px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={openAssistant}
          aria-label="Open the HALO assistant to talk or chat"
          className="flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border transition-all hover:brightness-125"
          style={{
            borderColor: speaking ? C.cyan : A.cyan(0.45),
            background: speaking ? A.cyan(0.14) : `linear-gradient(135deg, ${A.blue(0.16)}, ${A.cyan(0.05)})`,
            boxShadow: speaking ? `0 0 14px 1px ${C.cyan}44` : "none",
          }}
        >
          <Mic size={13} color={C.cyan} />
          <span className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.cyan }}>
            {voice === "listening" ? "LISTENING…" : voice === "processing" ? "THINKING…" : voice === "speaking" ? "SPEAKING…" : `TALK TO HALO${v.profile.voiceEnabled ? "" : " · VOICE OFF"}`}
          </span>
        </button>

        {/* latest decision — straight from the engine log */}
        {st && st.engine.log.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 border-t pt-1.5 text-[9px] font-mono" style={{ borderColor: C.lineInner }}>
            <span className="shrink-0 text-[8px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>RECENT</span>
            {(() => {
              const l = st.engine.log[0];
              return (
                <>
                  <span
                    className="rounded-sm px-1 py-px text-[7.5px] font-extrabold"
                    style={{
                      background: l.kind === "fire" ? A.cyan(0.12) : l.kind === "win" ? A.green(0.14) : A.red(0.14),
                      color: l.kind === "fire" ? C.cyan : l.kind === "win" ? C.green : C.red,
                    }}
                  >
                    {l.kind.toUpperCase()}
                  </span>
                  <span className="truncate" style={{ color: C.muted }}>
                    {l.kind === "fire"
                      ? `${l.dir === -1 ? "SELL" : "BUY"} @ ${fmtPx(l.entry, st.mintick)}`
                      : `${l.pips >= 0 ? "+" : "−"}${Math.abs(l.pips).toFixed(1)} pips`}
                  </span>
                  <span className="ml-auto shrink-0" style={{ color: C.dim }}>
                    {new Date(l.time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </PanelCard>
  );
}
