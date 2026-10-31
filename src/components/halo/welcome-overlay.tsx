"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO WELCOME OVERLAY · the personalized JARVIS-style welcome experience
//
//  Raised by the voice provider once per application session:
//    • full welcome  — first application opening (spec §1 script, verbatim)
//    • welcome-back  — every later session (short, spec §4)
//
//  HONESTY RULES (mirrors the AI core):
//    • the orb shows only REAL states — speaking/listening/processing from
//      the voice engine, offline when the assistant link is down. It never
//      fakes a connection or a success animation.
//    • the sound-wave moves only while audio is ACTUALLY playing.
//    • the paragraph highlight tracks the REAL spoken segment.
//
//  NEVER HOSTAGE-WARE: the skip control is always available, Escape skips,
//  and the silent variant auto-enters after 9 s (provider-side). The
//  dashboard renders and polls underneath the whole time — nothing about
//  market data, MT5 checks or the trading engine waits for this overlay.
//
//  Accessibility: respects prefers-reduced-motion (static orb, no staged
//  reveal, minimal fade), role=dialog, Escape to skip, aria-live headline.
// ════════════════════════════════════════════════════════════════════════

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ChevronRight, Mic, Sparkles, Volume2, VolumeX } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { useHaloVoice } from "./voice-provider";
import type { OrbVisual } from "./ai-orb";

// the 3D holographic core is GPU-bound → lazy client bundle (same recipe
// as the dashboard HALO AI card — one visual language everywhere)
const HaloOrb = dynamic(() => import("./ai-orb").then((m) => m.HaloOrb), {
  ssr: false,
  loading: () => (
    <div aria-hidden className="relative h-[120px] w-[120px] sm:h-[150px] sm:w-[150px]">
      <div className="absolute inset-0 animate-pulse rounded-full" style={{ border: `1px solid ${A.cyan(0.25)}` }} />
      <div
        className="absolute inset-[22%] rounded-full"
        style={{ background: `radial-gradient(circle at 42% 36%, ${A.cyan(0.55)}, rgba(2,11,26,0.9) 75%)` }}
      />
    </div>
  ),
});

export function WelcomeOverlay() {
  const v = useHaloVoice();
  const w = v.welcome;
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // deferred like every other client-hydration read in this codebase —
    // avoids a sync setState inside the effect body
    const t = window.setTimeout(() => {
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Escape always skips — the trader is never trapped in the welcome
  useEffect(() => {
    if (w.stage !== "showing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") v.dismissWelcome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [w.stage, v]);

  if (w.stage === "hidden") return null;

  const isFull = w.kind === "full";
  const speaking = v.voice === "speaking";
  const paras = v.welcomeParas;
  const hero = paras[0] ?? "";
  const body = paras.slice(1);
  // blocked / not yet speaking → everything readable at once (text alternative);
  // otherwise the highlight tracks the REAL spoken segment
  const active = w.spoken && !v.blocked ? w.segment : -1;
  const done = w.finished && !speaking && w.stage === "showing";

  // orb mirrors ONLY real assistant states — never a decorative animation
  const orbState: OrbVisual =
    v.voice === "speaking"
      ? "speaking"
      : v.voice === "listening"
        ? "listening"
        : v.voice === "processing"
          ? "thinking"
          : v.status === "offline"
            ? "offline"
            : "idle";

  const paraStyle = (i: number): React.CSSProperties => {
    if (active === -1) {
      // silent variant / not yet speaking — everything readable at once
      return { color: C.txt2, opacity: 0.92 };
    }
    if (i === active) return { color: "#EAF3FF", opacity: 1, textShadow: "0 0 16px rgba(46,204,255,0.35)" };
    if (i < active) return { color: C.txt2, opacity: 0.55 };
    return { color: C.txt2, opacity: 0.28 };
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isFull ? "HALO personalized welcome" : "HALO welcome back"}
      className="fixed inset-0 z-[95] flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{
        background: `
          radial-gradient(1100px 560px at 50% -8%, ${A.cyan(0.13)}, transparent 65%),
          radial-gradient(820px 460px at 82% 108%, rgba(21,94,239,0.12), transparent 60%),
          radial-gradient(520px 300px at 12% 92%, ${A.gold(0.05)}, transparent 65%),
          linear-gradient(180deg, #020B1A 0%, #000714 100%)`,
        opacity: w.stage === "fading" || !mounted ? 0 : 1,
        transform: w.stage === "fading" ? "scale(1.02)" : "scale(1)",
        transition: reduced ? "opacity 200ms ease" : "opacity 650ms ease, transform 650ms ease",
        pointerEvents: w.stage === "fading" ? "none" : "auto",
      }}
    >
      {/* faint command-centre grid */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(${A.cyan(0.04)} 1px, transparent 1px), linear-gradient(90deg, ${A.cyan(0.04)} 1px, transparent 1px)`,
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(720px 480px at 50% 42%, black, transparent 78%)",
          WebkitMaskImage: "radial-gradient(720px 480px at 50% 42%, black, transparent 78%)",
        }}
      />
      {/* gold hairlines — restrained brand accents */}
      <span aria-hidden className="absolute left-1/2 top-0 h-px w-[min(560px,70vw)] -translate-x-1/2" style={{ background: `linear-gradient(90deg, transparent, ${A.gold(0.5)}, transparent)` }} />

      <div className="relative my-auto flex w-full max-w-[680px] min-w-0 flex-col items-center px-4 py-4 sm:px-8 sm:py-6">
        {/* ── the AI core ── */}
        <div className="relative" aria-hidden>
          {reduced ? (
            // reduced motion → static core, same visual language
            <div className="relative h-[110px] w-[110px] sm:h-[130px] sm:w-[130px]">
              <span className="absolute inset-0 rounded-full" style={{ border: `1px solid ${A.cyan(0.3)}` }} />
              <span
                className="absolute inset-[22%] rounded-full"
                style={{ background: `radial-gradient(circle at 42% 36%, ${A.cyan(0.6)}, rgba(2,11,26,0.92) 75%)`, boxShadow: `0 0 32px 2px ${A.cyan(0.25)}` }}
              />
            </div>
          ) : (
            <HaloOrb state={orbState} alertWarm={v.status === "offline"} size={150} />
          )}
          {speaking && !reduced && (
            <span
              className="halo-anim-beacon absolute right-1 top-1 h-2 w-2 rounded-full"
              style={{ background: C.cyan, ["--beacon" as string]: `${C.cyan}99` } as React.CSSProperties}
            />
          )}
        </div>

        {/* ── wordmark ── */}
        <div className="mt-2 text-center">
          <div className="text-[22px] font-extrabold tracking-[0.46em] sm:text-[26px]" style={{ color: C.gold, textShadow: `0 0 22px ${A.gold(0.35)}` }}>
            HALO
          </div>
          <div className="mt-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.4em]" style={{ color: C.cyan }}>
            3EL Autotrader · Personal AI Trading Assistant
          </div>
        </div>

        {/* ── sound wave — moves ONLY on real audio ── */}
        <span className="mt-3 flex h-5 items-end gap-[2.5px]" aria-hidden>
          {[5, 9, 13, 17, 13, 9, 5, 11, 7].map((h, i) => (
            <span
              key={i}
              className="w-[2.5px] rounded-full"
              style={{
                height: speaking ? h : Math.round(h * 0.4),
                background: speaking ? C.cyan : C.line2,
                opacity: speaking ? 1 : 0.6,
                ...(speaking && !reduced ? { animation: `halo-eq 0.9s ease-in-out ${i * 0.09}s infinite`, transformBox: "fill-box", transformOrigin: "bottom" } : {}),
              }}
            />
          ))}
        </span>

        {/* ── dynamic greeting + verbatim script ── */}
        <div aria-live="polite" className="mt-3 w-full text-center">
          <h1 className="text-balance text-[17px] font-extrabold leading-snug tracking-wide sm:text-[21px]" style={{ color: "#EAF3FF", textShadow: "0 0 24px rgba(46,204,255,0.25)" }}>
            {hero}
          </h1>
          {body.length > 0 && (
            <div
              className={`mx-auto mt-2.5 max-w-[600px] space-y-2 ${reduced ? "" : ""}`}
              style={{ maxHeight: "min(34vh, 300px)", overflowY: "auto", scrollbarWidth: "thin" }}
            >
              {body.map((p, i) => (
                <p
                  key={i}
                  className="mx-auto max-w-[560px] text-[12px] leading-relaxed transition-all duration-500 sm:text-[13px]"
                  style={paraStyle(i + 1)}
                >
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* ── honest status chips ── */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em]"
            style={{
              background: v.status === "online" ? A.cyan(0.1) : v.status === "offline" ? A.red(0.12) : "rgba(140,152,174,0.12)",
              color: v.status === "online" ? C.cyan : v.status === "offline" ? C.red : "#8AA2C2",
            }}
          >
            {v.status === "online" ? "ASSISTANT ONLINE" : v.status === "offline" ? "OFFLINE · RETRYING" : "INITIALIZING"}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em]"
            style={{ background: speaking ? A.cyan(0.14) : "rgba(140,152,174,0.1)", color: speaking ? C.cyan : "#8AA2C2" }}
          >
            {speaking ? "SPEAKING" : v.voice === "listening" ? "LISTENING" : v.prefs.muted ? "MUTED" : v.profile.voiceEnabled ? "VOICE READY" : "VOICE OFF"}
          </span>
          {v.profile.voiceEnabled && v.wakeState !== "off" && (
            <span
              className="hidden rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em] sm:inline"
              style={{
                background: v.wakeState === "listening" ? A.cyan(0.14) : v.wakeState === "standby" ? A.cyan(0.06) : A.warn(0.12),
                color: v.wakeState === "denied" || v.wakeState === "unsupported" ? C.warn : C.cyan,
              }}
              title={v.wakeState === "denied" ? "Microphone permission denied — wake word unavailable" : v.wakeState === "unsupported" ? "This browser does not expose a microphone API" : `Say “${v.profile.wakePhrase}” anytime`}
            >
              {v.wakeState === "listening"
                ? `“${v.profile.wakePhrase.toUpperCase()}” LISTENING`
                : v.wakeState === "standby"
                  ? `“${v.profile.wakePhrase.toUpperCase()}” ARMED`
                  : v.wakeState === "denied"
                    ? "MIC DENIED"
                    : "NO MIC API"}
            </span>
          )}
        </div>

        {/* ── controls — skip is ALWAYS available ── */}
        <div className="mt-4 flex w-full flex-col items-center justify-center gap-2 sm:flex-row">
          {!v.profile.voiceEnabled ? (
            <button
              type="button"
              onClick={() => void v.enableVoice()}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-[10.5px] font-extrabold tracking-[0.16em] transition-all hover:brightness-125 sm:w-auto sm:px-5"
              style={{
                borderColor: "rgba(46,204,255,0.55)",
                background: "linear-gradient(135deg, rgba(46,204,255,0.18), rgba(46,204,255,0.05))",
                color: C.cyan,
                boxShadow: "0 0 18px 0 rgba(46,204,255,0.2)",
              }}
              title="HALO will speak the welcome and replies aloud. Microphone access is only requested if you later turn on the wake word."
            >
              <Volume2 size={14} />
              ENABLE HALO VOICE
            </button>
          ) : v.blocked ? (
            <button
              type="button"
              onClick={v.playWelcome}
              className="flex h-10 w-full animate-pulse items-center justify-center gap-2 rounded-xl border text-[10.5px] font-extrabold tracking-[0.16em] sm:w-auto sm:px-5"
              style={{ borderColor: A.warn(0.6), background: A.warn(0.12), color: C.warn }}
              title="The browser blocked autoplay — one tap plays the welcome"
            >
              <VolumeX size={14} />
              PLAY WELCOME
            </button>
          ) : (
            <button
              type="button"
              onClick={v.playWelcome}
              className="flex h-10 items-center justify-center gap-2 rounded-xl border px-5 text-[10px] font-bold tracking-[0.14em] transition-colors hover:text-[#2ECCFF]"
              style={{ borderColor: C.line2, color: C.muted }}
              title="Hear the welcome from the beginning"
            >
              <Sparkles size={12} />
              REPLAY
            </button>
          )}

          <button
            type="button"
            onClick={v.dismissWelcome}
            autoFocus
            data-testid="welcome-skip"
            className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border text-[10.5px] font-extrabold tracking-[0.16em] transition-all hover:brightness-125 sm:px-5 ${done ? "w-full sm:w-auto" : "w-full sm:w-auto"}`}
            style={
              done
                ? {
                    borderColor: "rgba(46,204,255,0.55)",
                    background: "linear-gradient(135deg, rgba(46,204,255,0.16), rgba(46,204,255,0.04))",
                    color: C.cyan,
                    boxShadow: "0 0 16px 0 rgba(46,204,255,0.16)",
                  }
                : { borderColor: C.line2, background: "rgba(4,20,40,0.6)", color: C.muted }
            }
          >
            {done ? "ENTER COMMAND CENTRE" : "SKIP INTRO"}
            <ChevronRight size={13} />
          </button>
          {!v.profile.voiceEnabled && (
            <button
              type="button"
              onClick={() => void v.enableWake()}
              className="hidden h-10 items-center justify-center gap-2 rounded-xl border px-4 text-[10px] font-bold tracking-[0.14em] transition-colors hover:text-[#2ECCFF] sm:flex"
              style={{ borderColor: C.line2, color: C.muted }}
              title="Also allow the microphone for hands-free “HALO” wake-word control"
            >
              <Mic size={12} />
              WAKE WORD TOO
            </button>
          )}
        </div>

        <div className="mt-2.5 text-[8px] font-bold uppercase tracking-[0.3em]" style={{ color: "#51678A" }}>
          press ESC or skip to enter immediately
        </div>

        {/* creator attribution — also in the script above; subtle, never loud */}
        <div className="mt-4 text-[8.5px] tracking-[0.18em]" style={{ color: C.goldDim }}>
          CREATED BY BISMARK ARKO-OFORI · ALL RIGHTS RESERVED
        </div>
      </div>
    </div>
  );
}
