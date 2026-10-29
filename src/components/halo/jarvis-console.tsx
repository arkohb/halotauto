"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO JARVIS CONSOLE · conversational voice + chat operator (UI layer)
//
//  Pure presentation over the app-wide HaloVoiceProvider, which owns the
//  single TTS engine, the wake-word loop, the personalized greeting and
//  the operator brain (/api/halo/brain — verified answers + allowlisted
//  actions).
//
//  • Text chat with timestamped transcript (persisted by the provider)
//  • Mic button starts/ends a voice conversation session
//  • Wake-word standby status is shown honestly (armed / listening /
//    denied / unsupported / off)
//  • Spoken replies + interruption are handled by the provider
//  • CONSEQUENTIAL ACTIONS: HALO never executes trading controls without
//    an explicit confirmation — this console shows the pending request
//    with tap-friendly Confirm / Cancel buttons (same contract as the
//    spoken "confirm / cancel" reply).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { Mic, MicOff, Send, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";
import { useHaloVoice } from "./voice-provider";

function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const WAKE_LABEL: Record<string, string> = {
  off: "WAKE OFF",
  standby: "WAKE ARMED",
  listening: "WAKE LISTENING",
  denied: "MIC DENIED",
  unsupported: "NO MIC API",
};

const CHIPS: { label: string; prompt: string }[] = [
  { label: "BRIEFING", prompt: "HALO, give me a market briefing." },
  { label: "WHY NO ENTRY?", prompt: "Why haven't I entered a trade yet?" },
  { label: "MY RISK", prompt: "Show me my current risk." },
  { label: "OPEN STRATEGY LAB", prompt: "Open Strategy Lab and show me today's signals." },
  { label: "CALENDAR TODAY", prompt: "What high impact events are on the economic calendar today?" },
  { label: "MARKET NEWS", prompt: "What's the latest market news from Bloomberg?" },
  { label: "MT5 STATUS", prompt: "Is MT5 connected?" },
  { label: "HEALTH", prompt: "Run a system health check." },
];

export function JarvisConsole({ variant = "floating" }: { variant?: "floating" | "docked" }) {
  const docked = variant === "docked";
  const v = useHaloVoice();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // floating panel visibility == voice conversation session
  const open = docked ? true : v.convoOpen;
  const busy = v.voice === "processing";
  const listening = v.convoOpen && v.voice === "listening";
  const micDisabled = v.mic === "unsupported" || v.mic === "denied";

  // auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [v.msgs, open, busy]);

  // focus input when the conversation opens
  useEffect(() => {
    if (open && !docked) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, docked]);

  return (
    <>
      {/* ── launcher (floating variant only) ── */}
      {!docked && (
        <button
          type="button"
          onClick={() => (v.convoOpen ? v.closeConvo(false) : v.startConvo())}
          aria-label={v.convoOpen ? "Close HALO console" : "Open HALO console — talk or chat with the AI core"}
          aria-expanded={v.convoOpen}
          className="fixed bottom-3 right-[84px] z-50 flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur transition-transform hover:scale-105 sm:right-[104px]"
          style={{
            borderColor: v.voice !== "idle" ? C.cyan : `${C.cyan}55`,
            background: "rgba(11,20,38,0.92)",
            boxShadow: v.voice !== "idle" ? `0 0 16px 2px ${C.cyan}55` : `0 0 10px 0 ${C.cyan}22`,
          }}
        >
          {v.convoOpen ? (
            <X size={18} color={C.cyan} />
          ) : (
            <span className="flex items-end gap-[2px]" aria-hidden>
              {[7, 12, 16, 12, 7].map((h, i) => (
                <span
                  key={i}
                  className="w-[2.5px] rounded-full"
                  style={{
                    height: h,
                    background: C.cyan,
                    ...(v.voice !== "idle" ? { animation: `halo-eq 0.9s ease-in-out ${i * 0.12}s infinite`, transformBox: "fill-box", transformOrigin: "bottom" } : {}),
                  }}
                />
              ))}
            </span>
          )}
          <span className="pointer-events-none absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full border border-[#1C2A47] bg-[#0F1A30]/95 px-1 text-[6px] font-extrabold tracking-[0.2em] text-[#4FD8FF]">
            HALO
          </span>
        </button>
      )}

      {/* ── console panel ── */}
      {open && (
        <div
          role="dialog"
          aria-label="HALO JARVIS console"
          className={
            docked
              ? "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-[#0B1426]/97 backdrop-blur"
              : "fixed bottom-[86px] right-2 z-50 flex h-[min(64vh,540px)] w-[min(94vw,400px)] flex-col overflow-hidden rounded-xl border bg-[#0B1426]/97 shadow-2xl backdrop-blur sm:right-3"
          }
          style={{ borderColor: `${C.cyan}44`, ...(docked ? {} : { animation: "halo-pop 0.3s ease-out" }) }}
        >
          {/* header */}
          <div className="flex items-center gap-2 border-b border-[#1C2A47] px-3 py-2" style={{ background: "linear-gradient(90deg, rgba(79,216,255,0.07), transparent 70%)" }}>
            <span className="halo-anim-beacon inline-block h-2 w-2 rounded-full" style={{ background: C.cyan, ["--beacon" as string]: `${C.cyan}88` } as React.CSSProperties} aria-hidden />
            <span className="text-[10px] font-extrabold tracking-[0.22em]" style={{ color: C.cyan }}>
              HALO · AI ASSISTANT
            </span>
            <span
              className="hidden rounded-full px-1.5 py-px text-[7.5px] font-extrabold tracking-[0.14em] sm:inline"
              style={{
                background: v.status === "online" ? "rgba(79,216,255,0.1)" : v.status === "offline" ? "rgba(242,54,69,0.12)" : "rgba(140,152,174,0.12)",
                color: v.status === "online" ? C.cyan : v.status === "offline" ? C.red : C.muted,
              }}
            >
              {v.status.toUpperCase()}
            </span>
            <span className="hidden text-[8px] tracking-wider text-[#8C98AE] md:inline">VOICE OPERATOR</span>
            <div className="ml-auto flex items-center gap-1">
              {v.wakeState !== "off" && (
                <span
                  className="rounded-full px-1.5 py-px text-[7px] font-extrabold tracking-[0.12em]"
                  style={{
                    background: v.wakeState === "listening" ? "rgba(79,216,255,0.14)" : v.wakeState === "standby" ? "rgba(79,216,255,0.06)" : "rgba(242,54,69,0.1)",
                    color: v.wakeState === "denied" || v.wakeState === "unsupported" ? "#FFB454" : C.cyan,
                  }}
                  title={`Say “${v.profile.wakePhrase}” to start a conversation`}
                >
                  {WAKE_LABEL[v.wakeState]}
                </span>
              )}
              <button
                type="button"
                onClick={() => v.setPrefs({ muted: !v.prefs.muted })}
                aria-label={v.prefs.muted ? "Unmute spoken replies" : "Mute spoken replies"}
                className="rounded p-1 text-[#8C98AE] transition-colors hover:text-[#E8ECF4]"
              >
                {v.prefs.muted ? <VolumeX size={14} color="#FFB454" /> : <Volume2 size={14} color={C.cyan} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={v.prefs.volume}
                onChange={(e) => v.setPrefs({ volume: Number(e.target.value) })}
                aria-label="Reply volume"
                className="h-1 w-12 accent-[#4FD8FF]"
              />
              {v.voices.length > 0 && (
                <select
                  value={v.prefs.voiceURI}
                  onChange={(e) => v.setPrefs({ voiceURI: e.target.value })}
                  aria-label="Reply voice"
                  className="max-w-[92px] rounded border border-[#2A3A5C] bg-[#101C33] px-1 py-0.5 text-[8.5px] text-[#E8ECF4] outline-none"
                >
                  {v.voices.map((vo) => (
                    <option key={vo.uri} value={vo.uri}>
                      {vo.label.slice(0, 26)}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" onClick={v.clearMsgs} aria-label="Clear transcript" className="rounded p-1 text-[#8C98AE] transition-colors hover:text-[#F23645]">
                <Trash2 size={13} />
              </button>
              {!docked && (
                <button type="button" onClick={() => v.closeConvo(false)} aria-label="Close console" className="rounded p-1 text-[#8C98AE] transition-colors hover:text-[#E8ECF4]">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* transcript */}
          <div ref={scrollRef} role="log" aria-live="polite" className="halo-scroll flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
            {v.msgs.length === 0 && (
              <div className="rounded-lg border border-[rgba(79,216,255,0.25)] bg-[#0F1A30]/90 px-2.5 py-2 text-[11px] leading-snug text-[#B8C2D6]">
                HALO online. I can open sections, switch symbol or timeframe, filter the trade book, read verified stats — and pause or resume entries with your explicit confirmation. Just say “{v.profile.wakePhrase}” or type below.
              </div>
            )}
            {v.msgs.map((m, i) =>
              m.kind === "wake" ? (
                <div key={`${m.at}-${i}`} className="flex justify-center" style={{ animation: "halo-msg 0.25s ease-out" }}>
                  <span className="rounded-full border border-[rgba(79,216,255,0.35)] bg-[rgba(79,216,255,0.07)] px-2.5 py-0.5 text-[8px] font-extrabold tracking-[0.2em] text-[#4FD8FF]">
                    WAKE WORD · {m.text} · {fmtClock(m.at)}
                  </span>
                </div>
              ) : (
                <div key={`${m.at}-${i}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} style={{ animation: "halo-msg 0.25s ease-out" }}>
                  <div
                    className={`max-w-[86%] rounded-lg border px-2.5 py-1.5 ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
                    style={{
                      borderColor: m.err ? "rgba(242,54,69,0.5)" : m.kind === "confirm" ? "rgba(212,175,55,0.55)" : m.kind === "action" ? "rgba(212,175,55,0.4)" : m.role === "user" ? "rgba(212,175,55,0.4)" : m.kind === "greeting" ? "rgba(155,232,255,0.45)" : "rgba(79,216,255,0.35)",
                      background: m.kind === "confirm" ? "rgba(42,36,16,0.55)" : m.role === "user" ? "rgba(22,35,61,0.9)" : "rgba(15,26,48,0.9)",
                    }}
                  >
                    {m.kind === "greeting" && (
                      <p className="mb-0.5 text-[7.5px] font-extrabold tracking-[0.2em] text-[#9BE8FF]">PERSONAL WELCOME</p>
                    )}
                    {m.kind === "action" && (
                      <p className="mb-0.5 text-[7.5px] font-extrabold tracking-[0.2em]" style={{ color: C.gold }}>ACTION EXECUTED</p>
                    )}
                    {m.kind === "confirm" && (
                      <p className="mb-0.5 text-[7.5px] font-extrabold tracking-[0.2em]" style={{ color: C.gold }}>CONFIRMATION REQUIRED</p>
                    )}
                    <p className="whitespace-pre-wrap text-[11px] leading-snug text-[#E8ECF4]">{m.text}</p>
                    {(m.verifiedAt || m.at > 0) && (
                      <p className="mt-0.5 text-[7.5px] font-mono tracking-wider text-[#5D6B85]">
                        {m.role === "halo" && !m.err && m.verifiedAt ? `grounded · verified ${fmtClock(Date.parse(m.verifiedAt))}` : m.at > 0 ? fmtClock(m.at) : ""}
                      </p>
                    )}
                  </div>
                </div>
              )
            )}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-lg rounded-bl-sm border border-[rgba(79,216,255,0.35)] bg-[#0F1A30]/90 px-2.5 py-2">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1 w-1 rounded-full" style={{ background: C.cyan, animation: `halo-dot 1.1s ease-in-out ${i * 0.18}s infinite` }} />
                  ))}
                  <span className="ml-1 text-[8.5px] font-mono tracking-[0.18em] text-[#8C98AE]">ANALYSING SNAPSHOT</span>
                </div>
              </div>
            )}
          </div>

          {/* pending consequential action — tap-friendly confirm/cancel */}
          {v.pendingConfirm && !busy && (
            <div
              role="alertdialog"
              aria-label="Confirm consequential action"
              className="border-t px-2.5 py-2"
              style={{ borderColor: "rgba(212,175,55,0.5)", background: "rgba(42,36,16,0.35)" }}
            >
              <p className="text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.gold }}>
                CONFIRM · {v.pendingConfirm.action.replace(/_/g, " ").toUpperCase()}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-[#E8ECF4]">{v.pendingConfirm.question}</p>
              {v.pendingConfirm.effect && <p className="mt-0.5 text-[9px] leading-snug text-[#8C98AE]">{v.pendingConfirm.effect}</p>}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={v.approvePending}
                  className="rounded-md px-2.5 py-1 text-[9.5px] font-extrabold tracking-wider"
                  style={{ background: "rgba(212,175,55,0.16)", color: C.gold, border: `1px solid ${C.gold}66` }}
                >
                  CONFIRM
                </button>
                <button
                  type="button"
                  onClick={v.cancelPending}
                  className="rounded-md border px-2.5 py-1 text-[9.5px] font-extrabold tracking-wider"
                  style={{ borderColor: "#2A3A5C", color: "#8C98AE" }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {/* quick prompts */}
          <div className="flex flex-wrap gap-1 border-t border-[#1C2A47]/70 px-2.5 py-1.5">
            {CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                onClick={() => void v.send(c.prompt)}
                className="rounded-full border px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em] transition-colors disabled:opacity-40"
                style={{ borderColor: `${C.cyan}33`, color: C.cyan, background: "rgba(79,216,255,0.05)" }}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* input row */}
          <form
            className="flex items-center gap-1.5 border-t border-[#1C2A47] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const el = e.currentTarget.elements.namedItem("q") as HTMLInputElement | null;
              void v.send(el?.value ?? "");
              if (el) el.value = "";
            }}
          >
            <input
              ref={inputRef}
              name="q"
              maxLength={800}
              placeholder={micDisabled ? (v.mic === "denied" ? "Mic denied — text chat works" : "Text chat — voice input unavailable here") : v.convoOpen ? "Listening… or type a follow-up" : "Ask HALO about the market, risk, or the engine…"}
              disabled={busy}
              className="h-8 min-w-0 flex-1 rounded-lg border border-[#2A3A5C] bg-[#101C33] px-2.5 text-[11px] text-[#E8ECF4] outline-none placeholder:text-[#5D6B85] focus:border-[#4FD8FF]/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => (v.convoOpen && v.voice === "listening" ? v.closeConvo(false) : v.startConvo())}
              disabled={v.mic === "unsupported"}
              aria-label={v.convoOpen && v.voice === "listening" ? "End voice session" : "Start voice conversation"}
              title={
                v.mic === "unsupported"
                  ? "Speech recognition unavailable in this browser"
                  : v.mic === "denied"
                    ? "Microphone permission denied — allow it in the browser bar"
                    : v.convoOpen && v.voice === "listening"
                      ? "End voice session"
                      : `Talk (or just say “${v.profile.wakePhrase}” when wake is armed)`
              }
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-35"
              style={{
                borderColor: listening ? C.cyan : v.mic === "denied" ? "rgba(255,180,84,0.5)" : "#2A3A5C",
                background: listening ? "rgba(79,216,255,0.14)" : "transparent",
                boxShadow: listening ? `0 0 10px 1px ${C.cyan}44` : "none",
              }}
            >
              {v.mic === "denied" ? <MicOff size={14} color="#FFB454" /> : <Mic size={14} color={listening ? C.cyan : "#8C98AE"} />}
            </button>
            <button
              type="submit"
              disabled={busy}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-35"
              style={{ borderColor: `${C.gold}66`, background: "rgba(212,175,55,0.1)" }}
            >
              <Send size={14} color={C.gold} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
