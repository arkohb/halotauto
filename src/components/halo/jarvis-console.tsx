"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO JARVIS CONSOLE · conversational voice + chat assistant
//
//  READ-ONLY companion: every answer comes from /api/halo/assistant,
//  which grounds the model in a verified snapshot of the real system.
//  The console itself cannot place, close or modify anything — trading
//  controls stay exclusively in the existing dashboard panels.
//
//  • Text chat with transcript (persisted to localStorage, last 30)
//  • Push-to-talk mic (browser SpeechRecognition, en-US)
//  • Spoken replies (browser speechSynthesis) with voice + volume
//  • Interruption: sending or tapping the mic cancels current speech
//  • Graceful fallback: no SpeechRecognition → text-only, disclosed
//  • Voice state is mirrored to the HALO AI Core orb via onVoice
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Send, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { C, type VoiceState } from "@/lib/halo/ui-helpers";

// ── minimal SpeechRecognition typings (not in lib.dom) ──────────────────
interface HaloSRAlternative {
  transcript: string;
  confidence: number;
}
interface HaloSRResult {
  isFinal: boolean;
  length: number;
  [index: number]: HaloSRAlternative;
}
interface HaloSRResultList {
  length: number;
  [index: number]: HaloSRResult;
}
interface HaloSREvent {
  resultIndex: number;
  results: HaloSRResultList;
}
interface HaloSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: HaloSREvent) => void) | null;
}

function getSTTCtor(): (new () => HaloSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => HaloSpeechRecognition) | undefined;
  return ctor ?? null;
}

// ── transcript model ────────────────────────────────────────────────────
interface Msg {
  role: "user" | "halo";
  text: string;
  at: number;
  verifiedAt?: string;
  err?: boolean;
}

const STORE_KEY = "halo-jarvis-transcript";

function loadMsgs(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Msg[];
    return Array.isArray(arr) ? arr.slice(-30) : [];
  } catch {
    return [];
  }
}

const WELCOME: Msg = {
  role: "halo",
  text:
    "HALO online. I read the live engine, feed and broker state — ask me for a briefing, why a trade fired (or didn't), or your current risk. I'm read-only: orders and settings stay on your dashboard.",
  at: 0,
};

const CHIPS: { label: string; prompt: string }[] = [
  { label: "BRIEFING", prompt: "HALO, give me a market briefing." },
  { label: "WHY NO ENTRY?", prompt: "Why haven't I entered a trade yet?" },
  { label: "MY RISK", prompt: "Show me my current risk." },
  { label: "LAST TRADE", prompt: "Explain the last trade." },
  { label: "HEALTH", prompt: "Run a system health check." },
];

function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function JarvisConsole({
  onVoice,
  variant = "floating",
}: {
  onVoice: (v: VoiceState) => void;
  /** floating = launcher + popup (default) · docked = inline right-rail panel */
  variant?: "floating" | "docked";
}) {
  const docked = variant === "docked";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [sttOk, setSttOk] = useState<boolean | null>(null);
  const [ttsOk, setTtsOk] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [voices, setVoices] = useState<{ uri: string; label: string }[]>([]);
  const [voiceURI, setVoiceURI] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recogRef = useRef<HaloSpeechRecognition | null>(null);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  // ── mount: restore transcript + detect voice capabilities ──
  useEffect(() => {
    const t = window.setTimeout(() => {
      const stored = loadMsgs();
      setMsgs(stored.length > 0 ? stored : [WELCOME]);
      setSttOk(getSTTCtor() !== null);
      setTtsOk("speechSynthesis" in window);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // persist transcript
  useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(msgs.filter((m) => m.at > 0).slice(-30)));
    } catch {
      // storage full/blocked — transcript just stays in memory
    }
  }, [msgs]);

  // auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open, busy]);

  // en voices for the reply engine
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!("speechSynthesis" in window)) return;
      const load = () => {
        const vs = window.speechSynthesis
          .getVoices()
          .filter((v) => v.lang.toLowerCase().startsWith("en"))
          .map((v) => ({ uri: v.voiceURI, label: `${v.name} (${v.lang})` }));
        setVoices(vs);
        setVoiceURI((prev) => {
          if (prev) return prev;
          const gb = vs.find((v) => /en-GB/i.test(v.label));
          return gb?.uri ?? vs[0]?.uri ?? "";
        });
      };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }, 0);
    return () => {
      window.clearTimeout(id);
      if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // leaving the console stops any ongoing speech
  useEffect(() => {
    if (open) return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    onVoice("idle");
  }, [open, onVoice]);

  // external open requests (HALO AI core card / voice tiles)
  useEffect(() => {
    const handler = () => {
      if (docked) {
        window.setTimeout(() => inputRef.current?.focus(), 60);
      } else {
        setOpen(true);
      }
    };
    window.addEventListener("halo:assistant-open", handler);
    return () => window.removeEventListener("halo:assistant-open", handler);
  }, [docked]);

  // ── speak a HALO reply aloud ──
  const speak = useCallback(
    (text: string) => {
      if (!voiceOnRef.current || !("speechSynthesis" in window)) {
        onVoice("idle");
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/⚠/g, ""));
      u.rate = 1.04;
      u.pitch = 0.92;
      u.volume = volume;
      const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI);
      if (v) u.voice = v;
      u.onend = () => onVoice("idle");
      u.onerror = () => onVoice("idle");
      window.speechSynthesis.speak(u);
      onVoice("speaking");
    },
    [volume, voiceURI, onVoice]
  );

  // ── send a question to the grounded, read-only core ──
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel(); // interrupt
      setMsgs((m) => [...m, { role: "user" as const, text, at: Date.now() }].slice(-30));
      setInput("");
      setBusy(true);
      onVoice("processing");
      try {
        const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
        const r = await fetch("/api/halo/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history }),
        });
        const j = (await r.json()) as { ok: boolean; reply?: string; error?: string; snapshotAt?: string };
        if (j.ok && j.reply) {
          setMsgs((m) => [...m, { role: "halo" as const, text: j.reply!, at: Date.now(), verifiedAt: j.snapshotAt }].slice(-30));
          speak(j.reply);
        } else {
          setMsgs((m) => [...m, { role: "halo" as const, text: `⚠ ${j.error ?? "Assistant unavailable — try again shortly."}`, at: Date.now(), err: true }].slice(-30));
          onVoice("idle");
        }
      } catch (e) {
        setMsgs((m) => [...m, { role: "halo" as const, text: `⚠ Connection lost: ${(e as Error).message}`, at: Date.now(), err: true }].slice(-30));
        onVoice("idle");
      } finally {
        setBusy(false);
      }
    },
    [busy, msgs, onVoice, speak]
  );

  // ── push-to-talk (toggle) ──
  const toggleMic = useCallback(() => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const Ctor = getSTTCtor();
    if (!Ctor) {
      setMsgs((m) =>
        [...m, { role: "halo" as const, text: "⚠ Voice input is not available in this browser — text chat still works.", at: Date.now(), err: true }].slice(-30)
      );
      return;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel(); // interrupt speech
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      setListening(true);
      onVoice("listening");
    };
    rec.onresult = (e) => {
      const said = e.results?.[e.results.length - 1]?.[0]?.transcript ?? "";
      if (said) void send(said);
    };
    rec.onerror = (ev) => {
      setMsgs((m) =>
        [...m, { role: "halo" as const, text: ev.error === "not-allowed" ? "⚠ Microphone permission denied — allow it in the browser bar, or type instead." : `⚠ Mic error: ${ev.error}`, at: Date.now(), err: true }].slice(-30)
      );
    };
    rec.onend = () => {
      setListening(false);
      onVoice("idle");
    };
    recogRef.current = rec;
    try {
      rec.start();
    } catch {
      setListening(false);
      onVoice("idle");
    }
  }, [listening, onVoice, send]);

  const clearLog = useCallback(() => {
    setMsgs([WELCOME]);
    try {
      window.localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <>
      {/* ── launcher (floating variant only) ── */}
      {!docked && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close HALO console" : "Open HALO console — talk or chat with the AI core"}
          aria-expanded={open}
          className="fixed bottom-3 right-[84px] z-50 flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur transition-transform hover:scale-105 sm:right-[104px]"
          style={{
            borderColor: listening ? C.cyan : `${C.cyan}55`,
            background: "rgba(11,20,38,0.92)",
            boxShadow: listening ? `0 0 16px 2px ${C.cyan}55` : `0 0 10px 0 ${C.cyan}22`,
          }}
        >
          {open ? (
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
                    ...(listening ? { animation: `halo-eq 0.9s ease-in-out ${i * 0.12}s infinite`, transformBox: "fill-box", transformOrigin: "bottom" } : {}),
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
      {(docked || open) && (
        <div
          role="dialog"
          aria-label="HALO JARVIS console"
          className={
            docked
              ? "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-[#0B1426]/97 backdrop-blur"
              : "fixed bottom-[86px] right-2 z-50 flex h-[min(64vh,520px)] w-[min(94vw,400px)] flex-col overflow-hidden rounded-xl border bg-[#0B1426]/97 shadow-2xl backdrop-blur sm:right-3"
          }
          style={{ borderColor: `${C.cyan}44`, ...(docked ? {} : { animation: "halo-pop 0.3s ease-out" }) }}
        >
          {/* header */}
          <div className="flex items-center gap-2 border-b border-[#1C2A47] px-3 py-2" style={{ background: "linear-gradient(90deg, rgba(79,216,255,0.07), transparent 70%)" }}>
            <span className="halo-anim-beacon inline-block h-2 w-2 rounded-full" style={{ background: C.cyan, ["--beacon" as string]: `${C.cyan}88` } as React.CSSProperties} aria-hidden />
            <span className="text-[10px] font-extrabold tracking-[0.22em]" style={{ color: C.cyan }}>
              HALO · JARVIS CONSOLE
            </span>
            <span className="hidden text-[8px] tracking-wider text-[#8C98AE] sm:inline">READ-ONLY</span>
            <div className="ml-auto flex items-center gap-1">
              {ttsOk && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setVoiceOn((v) => {
                        if (v && "speechSynthesis" in window) window.speechSynthesis.cancel();
                        return !v;
                      });
                    }}
                    aria-label={voiceOn ? "Mute spoken replies" : "Unmute spoken replies"}
                    className="rounded p-1 text-[#8C98AE] transition-colors hover:text-[#E8ECF4]"
                  >
                    {voiceOn ? <Volume2 size={14} color={C.cyan} /> : <VolumeX size={14} />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Reply volume"
                    className="h-1 w-12 accent-[#4FD8FF]"
                  />
                  {voices.length > 0 && (
                    <select
                      value={voiceURI}
                      onChange={(e) => setVoiceURI(e.target.value)}
                      aria-label="Reply voice"
                      className="max-w-[92px] rounded border border-[#2A3A5C] bg-[#101C33] px-1 py-0.5 text-[8.5px] text-[#E8ECF4] outline-none"
                    >
                      {voices.map((v) => (
                        <option key={v.uri} value={v.uri}>
                          {v.label.slice(0, 26)}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <button type="button" onClick={clearLog} aria-label="Clear transcript" className="rounded p-1 text-[#8C98AE] transition-colors hover:text-[#F23645]">
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {/* transcript */}
          <div ref={scrollRef} role="log" aria-live="polite" className="halo-scroll flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
            {msgs.map((m, i) => (
              <div key={`${m.at}-${i}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`} style={{ animation: "halo-msg 0.25s ease-out" }}>
                <div
                  className={`max-w-[86%] rounded-lg border px-2.5 py-1.5 ${m.role === "user" ? "rounded-br-sm" : "rounded-bl-sm"}`}
                  style={{
                    borderColor: m.err ? "rgba(242,54,69,0.5)" : m.role === "user" ? "rgba(212,175,55,0.4)" : "rgba(79,216,255,0.35)",
                    background: m.role === "user" ? "rgba(22,35,61,0.9)" : "rgba(15,26,48,0.9)",
                  }}
                >
                  <p className="whitespace-pre-wrap text-[11px] leading-snug text-[#E8ECF4]">{m.text}</p>
                  {(m.verifiedAt || m.at > 0) && (
                    <p className="mt-0.5 text-[7.5px] font-mono tracking-wider text-[#5D6B85]">
                      {m.role === "halo" && !m.err && m.verifiedAt ? `grounded · verified ${fmtClock(Date.parse(m.verifiedAt))}` : m.at > 0 ? fmtClock(m.at) : ""}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-lg rounded-bl-sm border border-[rgba(79,216,255,0.35)] bg-[#0F1A30]/90 px-2.5 py-2">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1 w-1 rounded-full"
                      style={{ background: C.cyan, animation: `halo-dot 1.1s ease-in-out ${i * 0.18}s infinite` }}
                    />
                  ))}
                  <span className="ml-1 text-[8.5px] font-mono tracking-[0.18em] text-[#8C98AE]">ANALYSING SNAPSHOT</span>
                </div>
              </div>
            )}
          </div>

          {/* quick prompts */}
          <div className="flex flex-wrap gap-1 border-t border-[#1C2A47]/70 px-2.5 py-1.5">
            {CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                disabled={busy}
                onClick={() => void send(c.prompt)}
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
              void send(input);
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={sttOk === false ? "Text chat — voice input unavailable here" : "Ask HALO about the market, risk, or the engine…"}
              disabled={busy}
              maxLength={800}
              className="h-8 min-w-0 flex-1 rounded-lg border border-[#2A3A5C] bg-[#101C33] px-2.5 text-[11px] text-[#E8ECF4] outline-none placeholder:text-[#5D6B85] focus:border-[#4FD8FF]/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={toggleMic}
              disabled={busy || sttOk === false}
              aria-label={listening ? "Stop listening" : "Push to talk"}
              title={sttOk === false ? "Speech recognition unavailable in this browser" : listening ? "Stop listening" : "Push to talk"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-35"
              style={{
                borderColor: listening ? C.cyan : "#2A3A5C",
                background: listening ? "rgba(79,216,255,0.14)" : "transparent",
                boxShadow: listening ? `0 0 10px 1px ${C.cyan}44` : "none",
              }}
            >
              <Mic size={14} color={listening ? C.cyan : "#8C98AE"} />
            </button>
            <button
              type="submit"
              disabled={busy || !input.trim()}
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
