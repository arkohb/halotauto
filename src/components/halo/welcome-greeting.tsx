"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO WELCOME · personalized greeting banner (dashboard row 0)
//
//  • Greets the trader by their preferred name ("Welcome back, Trader"
//    + a personalize affordance when none is stored — the name is never
//    invented).
//  • Shows the assistant's real status: INITIALIZING / ONLINE / OFFLINE
//    plus voice (speaking · listening · processing) and wake-word state.
//  • "Enable HALO Voice" onboarding (first visit) — explains audio +
//    microphone; enabling speaks the welcome immediately (user gesture,
//    so autoplay policies allow it).
//  • If the browser blocks autoplay → minimal "Tap once to enable voice"
//    chip; the next interaction retries once. No hidden repeat audio.
//  • The full banner shows once per browser session, then collapses to a
//    slim strip — ordinary dashboard re-renders never re-play it.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { Mic, Pencil, RotateCcw, Sparkles, Volume2, VolumeX, Waves } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { useHaloVoice } from "./voice-provider";

const COLLAPSE_KEY = "halo3el.welcome-full.v1";

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  initializing: { bg: "rgba(140,152,174,0.12)", fg: "#8AA2C2" },
  online: { bg: "rgba(46,204,255,0.1)", fg: C.cyan },
  offline: { bg: "rgba(255,77,94,0.12)", fg: C.red },
};

const VOICE_LABEL: Record<string, string> = {
  idle: "VOICE IDLE",
  listening: "LISTENING",
  processing: "PROCESSING",
  speaking: "SPEAKING",
};

export function WelcomeGreeting() {
  const v = useHaloVoice();
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const checkedRef = useRef(false);

  // full banner once per browser session → slim strip afterwards
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (checkedRef.current) return;
      checkedRef.current = true;
      let seen = false;
      try {
        seen = window.sessionStorage.getItem(COLLAPSE_KEY) === "1";
        if (!seen) window.sessionStorage.setItem(COLLAPSE_KEY, "1");
      } catch {
        // storage blocked — show full once per mount
      }
      setFull(!seen);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) {
      setEditing(false);
      return;
    }
    const ok = await v.saveProfile({ displayName: name });
    if (ok) {
      setEditing(false);
      setNameDraft("");
      const line = `Perfect — I'll call you ${name}.`;
      v.speak(line);
    }
  };

  const st = STATUS_STYLE[v.status] ?? STATUS_STYLE.initializing;
  const speaking = v.voice === "speaking";
  const waveOn = speaking || v.voice === "listening";

  return (
    <section
      aria-label="Personalized welcome"
      className="relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border px-3.5 py-3 backdrop-blur sm:flex-row sm:items-center sm:gap-3"
      style={{
        borderColor: C.panelLine,
        background: `linear-gradient(120deg, ${A.blue(0.1)}, transparent 40%), linear-gradient(180deg, ${C.panel}, ${C.deep})`,
        boxShadow: `inset 0 1px 0 rgba(120,200,255,0.08), 0 12px 30px rgba(0,4,12,0.45)`,
      }}
    >
      {/* left glow line */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `linear-gradient(180deg, transparent, ${C.cyan}99, transparent)` }} />

      {/* greeting icon chip — the mockup's round badge */}
      <span
        aria-hidden
        className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border sm:flex"
        style={{ borderColor: A.cyan(0.4), background: `radial-gradient(circle at 35% 30%, ${A.blue(0.4)}, ${C.navy2})`, boxShadow: `0 0 16px 0 ${A.cyan(0.25)}` }}
      >
        <Sparkles size={17} style={{ color: C.ice }} />
      </span>

      {/* greeting copy */}
      <div className="min-w-0 flex-1">
        {full ? (
          <>
            <h1 className="truncate text-[16px] font-extrabold tracking-wide text-[#EAF3FF]">
              {v.greetingCopy.headline}
              {!v.profile.hasName && !editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    setNameDraft(v.profile.displayName);
                  }}
                  className="ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-[8.5px] font-bold tracking-[0.12em] transition-colors hover:bg-[rgba(46,204,255,0.1)]"
                  style={{ borderColor: A.cyan(0.4), color: C.cyan }}
                  title="Set the name HALO uses in greetings and speech"
                >
                  <Pencil size={9} /> PERSONALIZE
                </button>
              )}
            </h1>
            <p className="mt-0.5 truncate text-[11px]" style={{ color: C.muted }}>{v.greetingCopy.sub}</p>
          </>
        ) : (
          <p className="truncate text-[11.5px] font-bold tracking-wide" style={{ color: C.txt2 }}>
            <span style={{ color: C.cyan }}>◈ </span>
            {v.greetingCopy.headline} <span className="font-normal" style={{ color: C.muted }}>· HALO co-pilot {v.status === "online" ? "online" : v.status}</span>
          </p>
        )}

        {/* inline name editor */}
        {editing && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              autoFocus
              value={nameDraft}
              maxLength={24}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="Your preferred name (e.g. Bismark)"
              aria-label="Preferred name"
              className="h-7 w-[190px] rounded-lg border px-2 text-[11px] outline-none placeholder:text-[#51678A]"
              style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
            />
            <button
              type="button"
              onClick={() => void saveName()}
              className="rounded-lg border px-2.5 py-1 text-[9.5px] font-extrabold tracking-[0.14em]"
              style={{ borderColor: A.cyan(0.5), background: A.cyan(0.1), color: C.cyan }}
            >
              SAVE
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border px-2.5 py-1 text-[9.5px] font-bold"
              style={{ borderColor: C.line2, color: C.muted }}
            >
              CANCEL
            </button>
          </div>
        )}
      </div>

      {/* waveform while speaking/listening */}
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="flex h-5 items-end gap-[2px]" aria-hidden>
          {[6, 10, 14, 10, 6, 12, 8].map((h, i) => (
            <span
              key={i}
              className="w-[2.5px] rounded-full"
              style={{
                height: h,
                background: speaking ? C.cyan : v.voice === "listening" ? "#9BE8FF" : "#1C4478",
                opacity: waveOn ? 1 : 0.5,
                ...(waveOn ? { animation: `halo-eq 0.9s ease-in-out ${i * 0.09}s infinite`, transformBox: "fill-box", transformOrigin: "bottom" } : {}),
              }}
            />
          ))}
        </span>

        {/* status chips */}
        <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em]" style={{ background: st.bg, color: st.fg }}>
          {v.status === "initializing" ? "INITIALIZING" : v.status === "online" ? "ASSISTANT ONLINE" : "OFFLINE"}
        </span>
        <span
          className="hidden rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em] sm:inline"
          style={{
            background: v.voice === "idle" ? "rgba(140,152,174,0.1)" : "rgba(46,204,255,0.12)",
            color: v.voice === "idle" ? "#8AA2C2" : C.cyan,
          }}
        >
          {VOICE_LABEL[v.voice]}
        </span>
        {v.wakeState !== "off" && (
          <span
            className="hidden rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em] md:inline"
            style={{
              background: v.wakeState === "listening" ? A.cyan(0.14) : v.wakeState === "standby" ? A.cyan(0.06) : A.warn(0.12),
              color: v.wakeState === "denied" || v.wakeState === "unsupported" ? C.warn : C.cyan,
            }}
            title={`Say “${v.profile.wakePhrase}” to talk hands-free`}
          >
            {v.wakeState === "listening" ? `“${v.profile.wakePhrase.toUpperCase()}” LISTENING` : v.wakeState === "standby" ? `“${v.profile.wakePhrase.toUpperCase()}” ARMED` : v.wakeState === "denied" ? "MIC DENIED" : "NO MIC API"}
          </span>
        )}

        {/* actions */}
        {!v.profile.voiceEnabled ? (
          <button
            type="button"
            onClick={() => void v.enableVoice()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.14em] transition-all hover:brightness-125"
            style={{
              borderColor: "rgba(46,204,255,0.55)",
              background: "linear-gradient(135deg, rgba(46,204,255,0.16), rgba(46,204,255,0.05))",
              color: C.cyan,
              boxShadow: `0 0 14px 0 rgba(46,204,255,0.18)`,
            }}
            title="HALO will speak its welcome and replies aloud. Microphone access is only requested if you later enable wake-word listening."
          >
            <Volume2 size={12} />
            ENABLE HALO VOICE
          </button>
        ) : v.blocked ? (
          <button
            type="button"
            onClick={() => v.replayWelcome()}
            className="flex shrink-0 animate-pulse items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.14em]"
            style={{ borderColor: A.warn(0.6), background: A.warn(0.12), color: C.warn }}
            title="The browser blocked autoplay — one tap starts the audio"
          >
            <Sparkles size={12} />
            TAP ONCE TO ENABLE VOICE
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={v.replayWelcome}
              className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[9px] font-bold tracking-[0.1em] transition-colors hover:text-[#2ECCFF]"
              style={{ borderColor: C.line2, color: C.muted }}
              title="Hear the personalized welcome again"
            >
              <RotateCcw size={11} /> <span className="hidden sm:inline">REPLAY WELCOME</span>
            </button>
            <button
              type="button"
              onClick={v.testVoice}
              className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[9px] font-bold tracking-[0.1em] transition-colors hover:text-[#2ECCFF]"
              style={{ borderColor: C.line2, color: C.muted }}
              title="Test the voice engine"
            >
              <Waves size={11} /> <span className="hidden md:inline">TEST VOICE</span>
            </button>
            <button
              type="button"
              onClick={() => v.startConvo()}
              aria-label="Talk to HALO"
              className="flex h-7 w-7 items-center justify-center rounded-lg border transition-all hover:brightness-125"
              style={{
                borderColor: v.voice === "listening" ? C.cyan : A.cyan(0.45),
                background: v.voice === "listening" ? A.cyan(0.14) : A.cyan(0.06),
                boxShadow: v.voice === "listening" ? `0 0 12px 1px ${C.cyan}44` : "none",
              }}
            >
              <Mic size={12} color={C.cyan} />
            </button>
            <button
              type="button"
              onClick={() => void v.disableVoice()}
              aria-label="Disable HALO voice"
              title="Mute HALO completely (greetings + spoken replies + wake listening stop)"
              className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:text-[#FFB454]"
              style={{ borderColor: C.line2, color: C.muted }}
            >
              <VolumeX size={12} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
