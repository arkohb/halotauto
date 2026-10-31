"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO VOICE PROVIDER · app-wide voice brain (headless state machine)
//
//  Owns the entire voice experience so every surface (welcome banner,
//  HALO AI core, JARVIS console, settings) shares ONE source of truth and
//  exactly ONE speech engine — no double audio, no mic fights:
//
//   • Trader profile  — server-backed name + consents (/api/halo/profile)
//   • Device prefs    — volume / rate / voice / mute (local)
//   • TTS engine      — speechSynthesis with autoplay watchdog; speaks the
//                       personalized welcome automatically on return visits
//   • Wake word       — ALWAYS LISTENING: a continuous SpeechRecognition
//                       standby for the configurable wake phrase ("HALO" by
//                       default) that never shuts itself down. After every
//                       answer, error or closed session the mic re-arms by
//                       itself — HALO is ready for the next "HALO" instantly
//   • Conversation    — wake ack → listen → operator brain → speak →
//                       listen … forever, until an exit phrase, the close
//                       button, mute or voice off — never a silence timer
//   • Interruptions   — while HALO speaks inside a conversation a barge-in
//                       listener stops the speech when the trader talks
//                       (transcripts that merely echo HALO are ignored)
//   • OPERATIONS      — utterances route through /api/halo/brain: answers
//                       come from the verified snapshot; actions come back
//                       as allowlisted registry selections. UI-scope
//                       actions run through the registered ActionBridge
//                       runner on REAL app state; consequential actions
//                       require an explicit spoken confirm/cancel before
//                       the server executes anything.
//
//  SAFETY: this provider never invents results. It speaks success only
//  after the executor verified the real application state, and it never
//  bypasses the trading engine — consequential trading controls flow
//  through /api/halo/brain's audited confirmation path only.
// ════════════════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BotStateRes, VoiceState } from "@/lib/halo/ui-helpers";
import {
  displayGreeting,
  standbyLine,
  wakeAck,
  welcomeBackLine,
  welcomeBackMessage,
  welcomeFullDisplay,
  welcomeFullSpoken,
  type GreetCtx,
} from "@/lib/halo/greeting";
import { getSTTCtor, isEcho, ttsAvailable, wakeHit, type HaloSpeechRecognition } from "@/lib/halo/speech";
import { voiceEnergy } from "@/lib/halo/voice-energy";

// ── public types ─────────────────────────────────────────────────────────
export interface ProfileState {
  displayName: string;
  hasName: boolean;
  voiceEnabled: boolean;
  wakeEnabled: boolean;
  wakePhrase: string;
  autoGreeting: boolean;
  loaded: boolean;
}

export interface VoicePrefs {
  volume: number; // 0..1
  rate: number; // 0.7..1.4
  voiceURI: string; // browser-engine voice (fallback engine)
  muted: boolean;
  engine: "neural" | "browser"; // neural = natural server voice, browser = OS voices
  neuralVoice: string; // neural voice id (see NEURAL_VOICES)
  /** welcome experience: auto = full once, then short welcome-back */
  welcomeStyle: "auto" | "full" | "short";
  /** spoken reply verbosity for regular conversation */
  verbosity: "brief" | "balanced" | "detailed";
  // NOTE: the old liveMode/convoSeconds (silence auto-standby) settings were
  // removed — HALO now listens permanently. Old stored prefs carrying those
  // keys are sanitized on hydrate and dropped on the next persist.
}

export type MicState = "unsupported" | "denied" | "idle" | "listening";
export type WakeState = "off" | "standby" | "listening" | "denied" | "unsupported";
export type AssistantStatus = "initializing" | "online" | "offline";
export type MsgKind = "normal" | "greeting" | "wake" | "system" | "action" | "confirm";

/** Welcome overlay lifecycle: hidden → showing → (skipped/finished) fading → hidden */
export type WelcomeStage = "hidden" | "showing" | "fading";
/** full = first-opening welcome · back = short welcome-back (later sessions) */
export type WelcomeKind = "full" | "back";

export interface WelcomeState {
  stage: WelcomeStage;
  kind: WelcomeKind;
  /** index of the paragraph currently being SPOKEN (-1 = none/not syncing) */
  segment: number;
  /** true once speech actually started (false = silent/visual-only variant) */
  spoken: boolean;
  /** true only when the LAST segment actually finished playing */
  finished: boolean;
}

export interface Msg {
  role: "user" | "halo";
  text: string;
  at: number;
  verifiedAt?: string;
  err?: boolean;
  kind?: MsgKind;
}

export interface PendingConfirm {
  token: string;
  action: string;
  question: string;
  effect: string;
  at: number;
}

export interface ClientAction {
  id: string;
  params: Record<string, string | boolean>;
  description?: string;
}

export type ActionRunner = (a: ClientAction) => Promise<{ ok: boolean; detail: string }>;

interface SpeakOpts {
  onend?: () => void;
  onblocked?: () => void;
  /** bypass the session mute (explicit user actions like Test voice) */
  ignoreMute?: boolean;
}

type RecMode = "off" | "wake" | "convo" | "barge";

// ── constants ────────────────────────────────────────────────────────────
const PREFS_KEY = "halo-voice-prefs.v1";
const TRANSCRIPT_KEY = "halo-jarvis-transcript"; // same key the console always used
const GREET_KEY = "halo3el.voice.greeted.v1";
const WELCOME_FULL_SEEN_KEY = "halo3el.welcome.full.v1"; // first full welcome delivered (persistent)

// welcome pacing — the experience must never hold the dashboard hostage
const WELCOME_SILENT_AUTO_MS = 9_000; // visual-only welcome → auto-enter after 9 s
const WELCOME_END_HOLD_MS = 1_600; // after the last spoken segment → auto-enter
const WELCOME_FADE_MS = 650; // fade-out duration (keep in sync with the overlay CSS)

// ALWAYS LISTENING: silence never ends a session or the wake standby — HALO
// only stops listening via an exit phrase ("goodbye HALO / stop listening /
// go to sleep"), the console close button, mute, or voice off.
const DEFAULT_PREFS: VoicePrefs = {
  volume: 0.9,
  rate: 1.04,
  voiceURI: "",
  muted: false,
  engine: "neural",
  neuralVoice: "jam",
  welcomeStyle: "auto",
  verbosity: "balanced",
};

// Natural neural voices served by /api/halo/tts — far more human than the
// browser's robotic OS voices. jam is the English-accented default.
export const NEURAL_VOICES: { id: string; label: string; hint: string }[] = [
  { id: "jam", label: "HALO James", hint: "natural British co-pilot" },
  { id: "kazi", label: "HALO Kai", hint: "clear, brisk standard" },
  { id: "xiaochen", label: "HALO Chen", hint: "calm and professional" },
  { id: "tongtong", label: "Tongtong", hint: "warm and friendly" },
  { id: "luodo", label: "Luodo", hint: "expressive storyteller" },
  { id: "douji", label: "Douji", hint: "smooth and fluent" },
  { id: "chuichui", label: "Chuichui", hint: "bright and upbeat" },
];

// neural voice fetch — generating a LONG reply can legitimately take many
// seconds, so the fetch gets a generous ceiling and the abort NEVER drops a
// reply: a slow/failed neural voice degrades to the browser engine instead of
// going silent ("the bot does not speak back" regression).
const NEURAL_PLAY_TIMEOUT_MS = 4_500; // audio ready → it must actually START in this window
const NEURAL_FETCH_TIMEOUT_MS = 30_000;
const NEURAL_CACHE_MAX = 24;

// a hung operator-core request must never wedge the assistant (mic off +
// busy forever) — every brain call gets this hard ceiling
const BRAIN_TIMEOUT_MS = 30_000;

const WELCOME_BACK_MIN_HIDDEN_MS = 20_000; // quick tab flips stay silent
const WELCOME_BACK_THROTTLE_MS = 120_000; // at most one spoken ack per 2 minutes

const EXIT_RE = /(goodbye\s+halo|goodbye,?\s+halo|stop\s+listening|go\s+to\s+sleep)/i;
const WAKE_COOLDOWN_MS = 4000;
const ECHO_TAIL_MS = 3000;

// spoken confirmation of a consequential action — deterministic, no LLM
const AFFIRM_RE = /^(yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|proceed|approve|approved|affirmative|sure|ok|okay)\b/i;
const NEGATE_RE = /^(no|nope|nah|cancel|cancelled|canceled|stop|abort|don't|do not|dont|negative|nevermind|never mind)\b/i;

// strip a leading wake phrase (+ optional "hey/ok/hi/yo") —
// "HALO, what's the gold price?" → "what's the gold price?"
const stripWakePhrase = (text: string, phrase: string): string => {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`^\\s*(hey|ok|hi|yo)?[,.!?\\s]*${esc}\\b[,.!?\\s]*`, "i"), "")
    .trim();
};

// ── context ──────────────────────────────────────────────────────────────
interface HaloVoiceCtx {
  profile: ProfileState;
  saveProfile: (patch: Partial<Omit<ProfileState, "loaded" | "hasName">>) => Promise<boolean>;
  prefs: VoicePrefs;
  setPrefs: (patch: Partial<VoicePrefs>) => void;
  voices: { uri: string; label: string }[];
  status: AssistantStatus;
  voice: VoiceState;
  mic: MicState;
  requestMic: () => Promise<"granted" | "denied" | "unsupported">;
  wakeState: WakeState;
  convoOpen: boolean;
  blocked: boolean; // autoplay blocked → "Tap once to enable voice"
  msgs: Msg[];
  clearMsgs: () => void;
  /** append a HALO-side system line to the chat transcript (used by the
   *  Timeframe Scanner Bot — additive; never touches conversation flow) */
  pushBotMsg: (text: string) => void;
  /** tag which console the trader is talking from ("scanner-bot" = the
   *  Scanner Bot's own voice console) — the brain adapts its persona;
   *  pass null when the surface unmounts */
  setActiveSurface: (surface: string | null) => void;
  send: (text: string) => Promise<void>;
  startConvo: (fromWake?: boolean, command?: string) => void;
  closeConvo: (spoken?: boolean) => void;
  speak: (text: string, opts?: SpeakOpts) => boolean;
  stopSpeaking: () => void;
  testVoice: () => void;
  replayWelcome: () => void;
  enableVoice: () => Promise<void>;
  disableVoice: () => Promise<void>;
  enableWake: () => Promise<"granted" | "denied" | "unsupported">;
  disableWake: () => Promise<void>;
  greetingCopy: { headline: string; sub: string };
  // ── welcome experience (overlay) ──
  welcome: WelcomeState;
  /** display paragraphs for the active welcome (verbatim full script or back line) */
  welcomeParas: string[];
  /** skip / enter the command centre — stops speech and fades the overlay */
  dismissWelcome: () => void;
  /** (re)start speaking the active welcome — used by the overlay's play/enable controls */
  playWelcome: () => void;
  // ── operator actions ──
  registerActionRunner: (fn: ActionRunner | null) => void;
  pendingConfirm: PendingConfirm | null;
  approvePending: () => void;
  cancelPending: () => void;
}

const Ctx = createContext<HaloVoiceCtx | null>(null);

export function useHaloVoice(): HaloVoiceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHaloVoice must be used inside <HaloVoiceProvider>");
  return v;
}

// ── provider ─────────────────────────────────────────────────────────────
export function HaloVoiceProvider({ children, snapshot }: { children: React.ReactNode; snapshot: BotStateRes | null }) {
  // ── server profile ──
  const [profile, setProfile] = useState<ProfileState>({
    displayName: "",
    hasName: false,
    voiceEnabled: false,
    wakeEnabled: false,
    wakePhrase: "halo",
    autoGreeting: true,
    loaded: false,
  });
  const [status, setStatus] = useState<AssistantStatus>("initializing");

  // ── device prefs (volume/rate/voice/mute/convo length) ──
  const [prefs, setPrefsState] = useState<VoicePrefs>(DEFAULT_PREFS);

  // ── engine state ──
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [mic, setMic] = useState<MicState>("idle");
  const [wakeActive, setWakeActive] = useState(false);
  const [convoOpen, setConvoOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [voices, setVoices] = useState<{ uri: string; label: string }[]>([]);

  // ── refs (latest values for callbacks / guards) ──
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const snapshotRef = useRef<BotStateRes | null>(snapshot);
  snapshotRef.current = snapshot;
  const voiceRef = useRef<VoiceState>("idle");
  voiceRef.current = voice;
  const micRef = useRef<MicState>("idle");
  micRef.current = mic;
  const convoRef = useRef(false);
  const busyRef = useRef(false);
  const msgsRef = useRef<Msg[]>([]);
  const speakTokenRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  const speechEndedAtRef = useRef(0);
  const speechStartedAtRef = useRef(0); // when the CURRENT audible playback began
  const recRef = useRef<HaloSpeechRecognition | null>(null);
  const recGenRef = useRef(0);
  const recModeRef = useRef<RecMode>("off");
  const errStreakRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const lastActRef = useRef(0);
  const ackIdxRef = useRef(0);
  // (silence-timer refs removed — HALO never auto-stands-by on silence)
  const greetedAttemptRef = useRef(false);
  const spokenGreetRef = useRef(false);
  const pendingGreetRef = useRef<string | null>(null);
  const lastGreetRef = useRef<string>("");
  const profileRetryRef = useRef<number | null>(null);
  const hydratedRef = useRef(false); // prefs hydrate done — persist only after (never clobber stored prefs with defaults)
  const hiddenAtRef = useRef(0);
  const lastBackAckRef = useRef(0);
  const backIdxRef = useRef(0);
  const runnerRef = useRef<ActionRunner | null>(null);
  // active console surface — set by whichever console is mounted (e.g. the
  // Scanner Bot's voice panel) so brain turns know who is being addressed
  const surfaceRef = useRef<string | null>(null);
  const pendingConfirmRef = useRef<PendingConfirm | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  // neural voice engine — shared <audio> element + client-side LRU of
  // generated replies (data URLs) so greetings replay instantly
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const neuralAbortRef = useRef<AbortController | null>(null);
  const neuralCacheRef = useRef<Map<string, string>>(new Map());

  // ── welcome experience (overlay) state ──
  const [welcome, setWelcome] = useState<WelcomeState>({ stage: "hidden", kind: "full", segment: -1, spoken: false, finished: false });
  const welcomeRef = useRef<WelcomeState>(welcome);
  welcomeRef.current = welcome;
  const welcomeTimersRef = useRef<number[]>([]);
  const welcomeAbortRef = useRef(false); // a run cancelled by skip/dismiss

  // ── helpers ──
  const greetCtx = useCallback((): GreetCtx => {
    const p = profileRef.current;
    return { name: p.displayName || "Trader", hasName: p.hasName, wakeEnabled: p.voiceEnabled && p.wakeEnabled, wakePhrase: p.wakePhrase };
  }, []);

  const addMsg = useCallback((m: Msg) => {
    setMsgs((prev) => [...prev, m].slice(-40));
  }, []);

  // ── profile persistence ──
  const saveProfile = useCallback(async (patch: Partial<Omit<ProfileState, "loaded" | "hasName">>): Promise<boolean> => {
    const prev = profileRef.current;
    setProfile((p) => ({ ...p, ...patch }));
    try {
      const r = await fetch("/api/halo/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = (await r.json()) as { ok: boolean; profile?: Omit<ProfileState, "loaded">; error?: string };
      if (j.ok && j.profile) {
        setProfile({ ...j.profile, loaded: true });
        return true;
      }
      setProfile(prev);
      return false;
    } catch {
      setProfile(prev);
      return false;
    }
  }, []);

  // ── recognition control ──
  const stopRec = useCallback(() => {
    recGenRef.current += 1; // invalidate pending restarts/handlers
    const rec = recRef.current;
    recRef.current = null;
    recModeRef.current = "off";
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }
    setMic((m) => (m === "listening" ? "idle" : m));
    setWakeActive(false);
    voiceEnergy.stopMic(); // the mic is genuinely closed — the orb must know
  }, []);

  const shouldWake = useCallback(() => {
    const p = profileRef.current;
    return (
      p.loaded &&
      p.voiceEnabled &&
      p.wakeEnabled &&
      !convoRef.current &&
      !busyRef.current &&
      voiceRef.current !== "speaking" &&
      voiceRef.current !== "processing" &&
      micRef.current !== "denied" &&
      micRef.current !== "unsupported" &&
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    );
  }, []);

  // Echo guard window: the tail after playback ended PLUS the WHOLE time HALO
  // is still speaking. Our own voice reaching the mic through speakers must
  // never barge-in over (or after) the reply itself — that self-interruption
  // is the other classic "HALO never finishes a sentence" bug.
  const heardEcho = useCallback((t: string) => {
    const anchor = Math.max(speechEndedAtRef.current, voiceRef.current === "speaking" ? speechStartedAtRef.current : 0);
    return isEcho(t, lastSpokenRef.current) && Date.now() - anchor < ECHO_TAIL_MS;
  }, []);

  const startRec = useCallback(
    (mode: RecMode) => {
      stopRec();
      const Ctor = getSTTCtor();
      if (!Ctor) {
        setMic("unsupported");
        return;
      }
      const gen = ++recGenRef.current;
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        if (gen !== recGenRef.current) return;
        errStreakRef.current = 0;
        setMic("listening");
        if (mode === "wake") setWakeActive(true);
        if (mode === "convo") setVoice("listening");
        // the assistant is genuinely listening — feed the AI core's
        // listening rings (analyser only in full FX; events always flow)
        if (mode === "convo" || mode === "barge") voiceEnergy.startMic();
      };

      rec.onspeechstart = () => {
        if (gen !== recGenRef.current) return;
        voiceEnergy.bumpMic(); // real microphone activity
      };

      rec.onend = () => {
        if (gen !== recGenRef.current) return;
        recRef.current = null;
        setMic((m) => (m === "listening" ? "idle" : m));
        setWakeActive(false);
        if (mode === "convo") setVoice((v) => (v === "listening" ? "idle" : v));
        // auto-restart (Chrome ends continuous sessions periodically) —
        // this loop is what keeps the assistant alive indefinitely
        const delay = errStreakRef.current === 0 ? 250 : Math.min(10_000, 900 * errStreakRef.current);
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (gen !== recGenRef.current) return;
          if (mode === "wake" && shouldWake()) startRec("wake");
          else if (mode === "convo" && convoRef.current && voiceRef.current === "idle" && !busyRef.current) startRec("convo");
          else if (mode === "barge" && convoRef.current && voiceRef.current === "speaking") startRec("barge");
        }, delay);
      };

      rec.onerror = (ev) => {
        if (gen !== recGenRef.current) return;
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          errStreakRef.current = 0;
          setMic("denied");
          stopRec();
          addMsg({
            role: "halo",
            text: "⚠ Microphone permission is denied, so I can't listen. Allow the mic in your browser's site settings, or keep using text chat.",
            at: Date.now(),
            err: true,
          });
        } else if (ev.error === "network" || ev.error === "audio-capture") {
          errStreakRef.current += 1;
        }
        // "no-speech" / "aborted" — onend restart covers these
      };

      rec.onresult = (e) => {
        if (gen !== recGenRef.current) return;
        let finalText = "";
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const t = r[0]?.transcript ?? "";
          if (r.isFinal) finalText += `${t} `;
          else interimText += t;
        }

        if (mode === "wake") {
          // echo guard FIRST — on loud speakers our own spoken lines (e.g. the
          // standby line "…say HALO when you need me again") must never
          // re-wake the assistant
          const echo = heardEcho;
          const phrase = profileRef.current.wakePhrase;
          if (finalText && wakeHit(finalText, phrase) && !echo(finalText)) {
            if (Date.now() - lastActRef.current > WAKE_COOLDOWN_MS) {
              lastActRef.current = Date.now();
              // "HALO, what's the gold price?" — wake AND carry the request
              const cmd = stripWakePhrase(finalText, phrase);
              stopRec();
              startConvo(true, cmd || undefined);
            }
            return;
          }
          if (interimText && wakeHit(interimText, phrase) && !echo(interimText)) {
            // bare call ("halo" / "hey halo") → wake instantly; a longer
            // sentence ("halo what's the gold price") waits for the final
            // result so the command is not cut off mid-utterance
            if (!stripWakePhrase(interimText, phrase) && Date.now() - lastActRef.current > WAKE_COOLDOWN_MS) {
              lastActRef.current = Date.now();
              stopRec();
              startConvo(true);
            }
            return;
          }
          return;
        }

        // convo / barge
        if (interimText.trim() && mode === "convo") setVoice("listening");
        const text = finalText.trim();
        if (!text) return;
        // echo guard — ignore our own voice bouncing back (the window covers
        // the whole playback, so speakers can never barge-in over HALO itself)
        if (heardEcho(text)) return;

        if (mode === "barge") {
          // the trader started talking over HALO — stop speaking, take over
          stopSpeaking();
          startRec("convo");
        }
        handleUtterance(text);
      };

      recRef.current = rec;
      recModeRef.current = mode;
      try {
        rec.start();
      } catch {
        // InvalidStateError — already started; onend will re-schedule
        recRef.current = null;
      }
    },
     
    [stopRec, shouldWake, addMsg, heardEcho]
  );

  // A failed turn (network loss, brain 5xx, 30 s timeout) must never leave
  // HALO deaf: re-arm the mic exactly as speak()'s finish() would —
  // conversation listening if a session is open, wake-word standby otherwise.
  const resumeAfterTurn = useCallback(() => {
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      if (busyRef.current) return;
      if (convoRef.current && voiceRef.current === "idle") startRec("convo");
      else if (!convoRef.current && shouldWake()) startRec("wake");
    }, 250);
  }, [startRec, shouldWake]);

  // ── TTS engine ──
  // Two engines, one contract:
  //   • NEURAL (default) — /api/halo/tts returns natural 24 kHz neural WAV;
  //     replies are cached client-side so greetings replay instantly.
  //   • BROWSER — the OS speechSynthesis voices (robotic, but offline).
  // Neural failures fall back to the browser engine transparently: a network
  // hiccup can degrade the voice quality but can never silence HALO. The
  // "speaking" state is only ever set when audio is ACTUALLY playing.
  const clearWatchdog = () => {
    if (watchdogRef.current) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const stopSpeaking = useCallback(() => {
    speakTokenRef.current += 1;
    clearWatchdog();
    if (neuralAbortRef.current) {
      try {
        neuralAbortRef.current.abort();
      } catch {
        // ignore
      }
      neuralAbortRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // ignore
      }
    }
    if (ttsAvailable()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setVoice((v) => (v === "speaking" ? "idle" : v));
  }, []);

  /** browser engine — the pre-neural fallback (robotic but offline-safe) */
  const speakBrowser = useCallback(
    (text: string, token: number, opts: SpeakOpts, finish: (fireEnd: boolean) => void): void => {
      if (audioRef.current) {
        try {
          audioRef.current.pause(); // never overlap engines
        } catch {
          // ignore
        }
      }
      const synth = window.speechSynthesis;
      try {
        synth.cancel();
      } catch {
        // ignore
      }
      // an engine with NO voices can only ever fake-play (instant onend with
      // zero audio) — that must count as blocked, never as a played segment
      if (synth.getVoices().length === 0) {
        finish(false);
        opts.onblocked?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(text.slice(0, 1200));
      u.volume = Math.max(0, Math.min(1, prefsRef.current.volume));
      u.rate = Math.max(0.7, Math.min(1.4, prefsRef.current.rate));
      u.pitch = 0.92;
      const vs = synth.getVoices();
      const v =
        vs.find((x) => x.voiceURI === prefsRef.current.voiceURI) ??
        vs.find((x) => /en[-_]GB/i.test(x.lang)) ??
        vs.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;

      let started = false;
      u.onstart = () => {
        if (token !== speakTokenRef.current) return;
        started = true;
        speechStartedAtRef.current = Date.now();
        clearWatchdog();
        setVoice("speaking");
        voiceEnergy.setSpeaking(true); // actual audible playback began
        // while HALO talks: barge-in listener inside a conversation, silence otherwise
        if (convoRef.current && micRef.current !== "denied" && micRef.current !== "unsupported") startRec("barge");
        else stopRec();
      };
      u.onboundary = () => {
        if (token !== speakTokenRef.current) return;
        voiceEnergy.bumpSpeech(); // real word event while the audio plays
      };
      u.onend = () => {
        // an utterance that ends WITHOUT ever starting produced no audio —
        // advancing a welcome chain on it would fast-cycle the script
        if (!started) {
          finish(false);
          opts.onblocked?.();
          return;
        }
        finish(true);
      };
      u.onerror = () => finish(false);

      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        if (token === speakTokenRef.current && !started) {
          // Autoplay policy or missing voices silently swallowed the utterance.
          finish(false);
          opts.onblocked?.();
        }
      }, 1700);

      window.setTimeout(() => {
        if (token !== speakTokenRef.current) return;
        try {
          synth.speak(u);
        } catch {
          finish(false);
        }
      }, 60);
    },
    [startRec, stopRec]
  );

  const speak = useCallback(
    (text: string, opts: SpeakOpts = {}): boolean => {
      const token = ++speakTokenRef.current;
      // EVERY blocked utterance must surface the one-tap recovery banner.
      // Conversational replies used to pass no onblocked, so when the browser
      // blocked autoplay (fresh reload, no click yet — Chrome requires a user
      // gesture before any audio) the reply died silently: text appeared in
      // the console, but no voice ever played and nothing asked for a tap —
      // the exact "the bot does not speak back" report.
      const o: SpeakOpts = { ...opts, onblocked: opts.onblocked ?? (() => setBlocked(true)) };
      const finish = (fireEnd: boolean) => {
        if (token !== speakTokenRef.current) return;
        clearWatchdog();
        speechEndedAtRef.current = Date.now();
        voiceEnergy.setSpeaking(false); // audible playback truly ended
        setVoice((v) => (v === "speaking" ? "idle" : v));
        // hand the mic back: conversation listening, or wake standby
        if (convoRef.current && !busyRef.current) startRec("convo");
        else if (shouldWake()) {
          if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
          restartTimerRef.current = window.setTimeout(() => {
            if (shouldWake()) startRec("wake");
          }, 250);
        }
        if (fireEnd) o.onend?.();
      };

      // any new utterance stops whatever was playing (single-voice semantics)
      if (neuralAbortRef.current) {
        try {
          neuralAbortRef.current.abort();
        } catch {
          // ignore
        }
        neuralAbortRef.current = null;
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch {
          // ignore
        }
      }
      if (ttsAvailable()) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // ignore
        }
      }

      const clean = text.replace(/⚠/g, "").trim();

      const silentFinish = (): boolean => {
        window.setTimeout(() => {
          if (token !== speakTokenRef.current) return;
          speechEndedAtRef.current = Date.now();
          if (convoRef.current && !busyRef.current) startRec("convo");
          else if (shouldWake()) {
            restartTimerRef.current = window.setTimeout(() => {
              if (shouldWake()) startRec("wake");
            }, 250);
          }
          opts.onend?.();
        }, 40);
        return false;
      };

      if (prefsRef.current.muted && !opts.ignoreMute) return silentFinish();

      // ── NEURAL engine (default) ──
      if (prefsRef.current.engine !== "browser") {
        const key = `${prefsRef.current.neuralVoice}:${prefsRef.current.rate.toFixed(2)}:${clean}`;
        const cached = neuralCacheRef.current.get(key);
        let handedOff = false;
        let startedPlay = false; // the returned audio is ACTUALLY audible
        let playWatchdog = 0;
        const fallback = (why: string) => {
          if (handedOff || token !== speakTokenRef.current) return;
          handedOff = true;
          if (playWatchdog) window.clearTimeout(playWatchdog);
          console.warn(`[halo-voice] neural engine unavailable (${why}) — falling back to the browser voice`);
          if (!ttsAvailable()) {
            finish(false);
            o.onblocked?.();
            return;
          }
          speakBrowser(clean, token, o, finish);
        };

        void (async () => {
          try {
            let audioUrl = cached ?? null;
            if (!audioUrl) {
              const ctrl = new AbortController();
              neuralAbortRef.current = ctrl;
              const aborter = window.setTimeout(() => ctrl.abort(), NEURAL_FETCH_TIMEOUT_MS);
              let r: Response;
              try {
                r = await fetch("/api/halo/tts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: clean, voice: prefsRef.current.neuralVoice, speed: prefsRef.current.rate }),
                  signal: ctrl.signal,
                });
              } finally {
                window.clearTimeout(aborter);
              }
              if (token !== speakTokenRef.current) return;
              const j = (await r.json()) as { ok: boolean; audio?: string; mime?: string; error?: string };
              if (!j.ok || !j.audio) throw new Error(j.error ?? `voice service returned ${r.status}`);
              audioUrl = `data:${j.mime ?? "audio/wav"};base64,${j.audio}`;
              // LRU — remember this reply so repeats are instant
              const cache = neuralCacheRef.current;
              cache.delete(key);
              cache.set(key, audioUrl);
              while (cache.size > NEURAL_CACHE_MAX) {
                const oldest = cache.keys().next().value;
                if (oldest === undefined) break;
                cache.delete(oldest);
              }
            }
            if (token !== speakTokenRef.current || handedOff) return;

            let a = audioRef.current;
            if (!a) {
              a = new Audio();
              a.preload = "auto";
              audioRef.current = a;
            }
            a.onplaying = () => {
              if (token !== speakTokenRef.current) return;
              startedPlay = true;
              if (playWatchdog) window.clearTimeout(playWatchdog);
              speechStartedAtRef.current = Date.now();
              setVoice("speaking");
              voiceEnergy.setSpeaking(true); // real audible playback began
              if (convoRef.current && micRef.current !== "denied" && micRef.current !== "unsupported") startRec("barge");
              else stopRec();
            };
            a.ontimeupdate = () => {
              if (token !== speakTokenRef.current) return;
              voiceEnergy.bumpSpeech(); // the orb pulses with the real audio
            };
            a.onended = () => {
              if (token !== speakTokenRef.current) return;
              finish(true);
            };
            a.onerror = () => {
              if (token !== speakTokenRef.current) return;
              if (a!.src) fallback("audio element failed");
              else finish(false);
            };
            a.src = audioUrl;
            a.volume = Math.max(0, Math.min(1, prefsRef.current.volume));
            // once the audio is ready it must actually START — a play() that
            // never settles (autoplay edge cases) must not stall the turn
            playWatchdog = window.setTimeout(() => {
              if (token === speakTokenRef.current && !handedOff && !startedPlay) fallback("audio did not start in time");
            }, NEURAL_PLAY_TIMEOUT_MS);
            try {
              await a.play();
            } catch {
              // autoplay policy — surface the tap-to-enable banner like the browser engine
              if (token === speakTokenRef.current && !handedOff) {
                handedOff = true;
                if (playWatchdog) window.clearTimeout(playWatchdog);
                finish(false);
                o.onblocked?.();
              }
            }
          } catch (e) {
            if (playWatchdog) window.clearTimeout(playWatchdog);
            if ((e as Error).name === "AbortError") {
              // token still current ⇒ the trader did NOT interrupt (stopSpeaking
              // bumps the token first) — the fetch ceiling fired, so the natural
              // voice is unavailable for this reply. DEGRADE to the browser
              // voice instead of dropping the reply silently.
              fallback("neural voice did not respond in time");
              return;
            }
            fallback((e as Error).message || "voice request failed");
          }
        })();
        return true;
      }

      // ── BROWSER engine ──
      if (!ttsAvailable()) return silentFinish();
      speakBrowser(clean, token, o, finish);
      return true;
    },

    [startRec, stopRec, shouldWake, speakBrowser]
  );

  // ── operator actions: runner registration + pending confirmation ──
  const registerActionRunner = useCallback((fn: ActionRunner | null) => {
    runnerRef.current = fn;
  }, []);

  const setPending = useCallback((p: PendingConfirm | null) => {
    pendingConfirmRef.current = p;
    setPendingConfirm(p);
  }, []);

  const sendConfirm = useCallback(
    async (token: string, approve: boolean) => {
      setPending(null);
      busyRef.current = true;
      stopRec();
      setVoice("processing");
      const ctrl = new AbortController();
      const kill = window.setTimeout(() => ctrl.abort(), BRAIN_TIMEOUT_MS);
      try {
        const r = await fetch("/api/halo/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmToken: token, approve }),
          signal: ctrl.signal,
        });
        const j = (await r.json()) as { ok: boolean; say?: string; error?: string; declined?: boolean };
        if (j.ok && j.say) {
          addMsg({ role: "halo", text: j.say, at: Date.now(), kind: approve ? "action" : "system" });
          lastSpokenRef.current = j.say;
          setVoice("idle");
          speak(j.say);
        } else {
          const line = j.error ?? "The confirmation could not be processed — nothing was changed.";
          addMsg({ role: "halo", text: `⚠ ${line}`, at: Date.now(), err: true });
          setVoice("idle");
          speak(line);
        }
      } catch (e) {
        const line =
          (e as Error).name === "AbortError"
            ? "The operator core did not respond in 30 s — nothing was changed. Try again shortly."
            : `Connection lost during confirmation: ${(e as Error).message}`;
        addMsg({ role: "halo", text: `⚠ ${line}`, at: Date.now(), err: true });
        setVoice("idle");
        if (convoRef.current) {
          lastSpokenRef.current = line;
          pendingGreetRef.current = line;
          speak(line); // never go deaf after a failed confirmation
        } else {
          resumeAfterTurn();
        }
      } finally {
        window.clearTimeout(kill);
        busyRef.current = false;
      }
    },
    [addMsg, speak, stopRec, resumeAfterTurn]
  );

  const approvePending = useCallback(() => {
    const p = pendingConfirmRef.current;
    if (!p || busyRef.current) return;
    void sendConfirm(p.token, true);
  }, [sendConfirm]);

  const cancelPending = useCallback(() => {
    const p = pendingConfirmRef.current;
    if (!p || busyRef.current) return;
    void sendConfirm(p.token, false);
  }, [sendConfirm]);

  // ── conversation turns ──
  const handleUtterance = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, 800);
      if (!text) return;
      if (EXIT_RE.test(text)) {
        addMsg({ role: "user", text, at: Date.now() });
        closeConvo(true);
        return;
      }
      // pending consequential action? a plain yes/no resolves it — anything
      // else supersedes it (the request is cancelled, never silently kept)
      const pc = pendingConfirmRef.current;
      if (pc) {
        if (AFFIRM_RE.test(text)) {
          addMsg({ role: "user", text, at: Date.now() });
          approvePending();
          return;
        }
        if (NEGATE_RE.test(text)) {
          addMsg({ role: "user", text, at: Date.now() });
          cancelPending();
          return;
        }
        addMsg({ role: "halo", text: "Previous request cancelled — nothing was changed.", at: Date.now(), kind: "system" });
        setPending(null);
      }
      // strip a leading wake phrase — "HALO, what's the gold price?"
      const stripped = stripWakePhrase(text, profileRef.current.wakePhrase);
      void send(stripped || text, "voice");
    },
    [addMsg, approvePending, cancelPending, setPending]
  );

  const send = useCallback(
    async (raw: string, origin: "voice" | "text" = "text") => {
      const text = raw.trim().slice(0, 800);
      if (!text || busyRef.current) return;
      // typed exit phrase ends the session too — same contract as the voice path
      if (convoRef.current && EXIT_RE.test(text)) {
        addMsg({ role: "user", text, at: Date.now() });
        closeConvo(true);
        return;
      }
      // typed confirm/cancel answers a pending consequential action directly
      if (pendingConfirmRef.current && AFFIRM_RE.test(text)) {
        addMsg({ role: "user", text, at: Date.now() });
        approvePending();
        return;
      }
      if (pendingConfirmRef.current && NEGATE_RE.test(text)) {
        addMsg({ role: "user", text, at: Date.now() });
        cancelPending();
        return;
      }
      if (pendingConfirmRef.current) {
        addMsg({ role: "halo", text: "Previous request cancelled — nothing was changed.", at: Date.now(), kind: "system" });
        setPending(null);
      }
      busyRef.current = true;
      stopSpeaking();
      stopRec();
      addMsg({ role: "user", text, at: Date.now() });
      setVoice("processing");

      const history = msgsRef.current.slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const ctrl = new AbortController();
      const kill = window.setTimeout(() => ctrl.abort(), BRAIN_TIMEOUT_MS);
      try {
        const r = await fetch("/api/halo/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history, mode: "voice", source: origin, verbosity: prefsRef.current.verbosity, surface: surfaceRef.current ?? undefined }),
          signal: ctrl.signal,
        });
        const j = (await r.json()) as {
          ok: boolean;
          say?: string;
          error?: string;
          verifiedAt?: string;
          actions?: ClientAction[];
          readResults?: { id: string; ok: boolean; detail: string }[];
          confirmation?: { token: string; action: string; question: string; effect: string };
          declined?: boolean;
        };

        if (!j.ok || !j.say) {
          const line = j.error ?? "Operator core unavailable — try again shortly.";
          addMsg({ role: "halo", text: `⚠ ${line}`, at: Date.now(), err: true });
          setVoice("idle");
          if (origin === "voice" || convoRef.current) {
            // a spoken turn deserves a spoken failure — never leave the trader
            // talking to a silent assistant (speak() re-arms the mic itself)
            lastSpokenRef.current = line;
            pendingGreetRef.current = line;
            speak(line);
          } else {
            resumeAfterTurn(); // text chat: session stays open, stays quiet
          }
          return;
        }

        // ── consequential action → hold for explicit confirm ──
        if (j.confirmation) {
          const pc: PendingConfirm = { ...j.confirmation, at: Date.now() };
          setPending(pc);
          const spoken = `${j.say} ${pc.question}`.trim();
          addMsg({ role: "halo", text: j.say, at: Date.now(), verifiedAt: j.verifiedAt, kind: "confirm" });
          if (pc.effect) addMsg({ role: "halo", text: pc.effect, at: Date.now(), kind: "confirm" });
          lastSpokenRef.current = spoken;
          setVoice("idle");
          speak(spoken);
          return;
        }

        // ── declined consequential confirmation ──
        if (j.declined) {
          addMsg({ role: "halo", text: j.say, at: Date.now(), kind: "system" });
          lastSpokenRef.current = j.say;
          setVoice("idle");
          speak(j.say);
          return;
        }

        // ── allowlisted UI actions → execute on real state, verify, then speak ──
        if (j.actions && j.actions.length > 0) {
          const lines: string[] = [];
          let failures = 0;
          for (const a of j.actions) {
            const runner = runnerRef.current;
            if (!runner) {
              failures += 1;
              lines.push(`✗ ${a.id.replace(/_/g, " ")} — executor not attached`);
              continue;
            }
            try {
              const res = await runner({ id: a.id, params: a.params ?? {} });
              if (!res.ok) failures += 1;
              lines.push(`${res.ok ? "✓" : "✗"} ${res.detail}`);
            } catch (e) {
              failures += 1;
              lines.push(`✗ ${(e as Error).message}`);
            }
          }
          addMsg({ role: "halo", text: lines.join("\n"), at: Date.now(), kind: "action" });
          const spoken = failures > 0 ? `${j.say} However, ${failures === 1 ? "one step failed" : `${failures} steps failed`} — the details are on screen.` : j.say;
          lastSpokenRef.current = spoken;
          setVoice("idle");
          speak(spoken);
          return;
        }

        // ── grounded answer / verified read-out ──
        addMsg({ role: "halo", text: j.say, at: Date.now(), verifiedAt: j.verifiedAt });
        lastSpokenRef.current = j.say;
        setVoice("idle");
        speak(j.say);
      } catch (e) {
        const line =
          (e as Error).name === "AbortError"
            ? "The operator core did not respond in 30 s — try again shortly."
            : `Connection lost: ${(e as Error).message}`;
        addMsg({ role: "halo", text: `⚠ ${line}`, at: Date.now(), err: true });
        setVoice("idle");
        if (origin === "voice" || convoRef.current) {
          lastSpokenRef.current = line;
          pendingGreetRef.current = line;
          speak(line); // spoken failure, then the mic re-arms automatically
        } else {
          resumeAfterTurn(); // the session stays open — never go deaf on an error
        }
      } finally {
        window.clearTimeout(kill);
        busyRef.current = false;
      }
    },
    [addMsg, speak, stopRec, stopSpeaking, resumeAfterTurn, approvePending, cancelPending, setPending]
  );

  const startConvo = useCallback(
    (fromWake = false, command?: string) => {
      convoRef.current = true;
      setConvoOpen(true);
      if (fromWake) {
        const ctx = greetCtx();
        const ack = wakeAck(ctx, ackIdxRef.current++);
        addMsg({ role: "user", text: `“${profileRef.current.wakePhrase.toUpperCase()}”`, at: Date.now(), kind: "wake" });
        lastSpokenRef.current = ack;
        if (command) {
          // wake + request in one breath ("HALO, start scanning") — the
          // command fires NOW, no spoken ack first: the answer itself is the
          // acknowledgment and the operator fast path returns it in well
          // under a second, so the bot reacts the instant speech ends
          void send(command, "voice");
        } else {
          speak(ack);
        }
      } else {
        // manual open — user gesture; go straight to listening
        stopSpeaking();
        startRec("convo");
      }
    },

    [addMsg, speak, send, startRec, stopSpeaking, greetCtx]
  );

  const closeConvo = useCallback(
    (spoken = false) => {
      const wasOpen = convoRef.current;
      convoRef.current = false;
      setConvoOpen(false);
      stopRec();
      if (!wasOpen) return;
      if (spoken && profileRef.current.voiceEnabled) {
        const line = standbyLine(greetCtx());
        lastSpokenRef.current = line;
        speak(line); // speak() hands the mic back to wake standby afterwards
      } else if (shouldWake()) {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (shouldWake()) startRec("wake");
        }, 250);
      }
    },
     
    [stopRec, speak, shouldWake, startRec, greetCtx]
  );

  // ── personalized welcome experience (overlay) ──────────────────────────
  const clearWelcomeTimers = useCallback(() => {
    for (const id of welcomeTimersRef.current) window.clearTimeout(id);
    welcomeTimersRef.current = [];
  }, []);

  /** Skip / enter the command centre — stops speech, fades, hands the mic back. */
  const dismissWelcome = useCallback(() => {
    clearWelcomeTimers();
    welcomeAbortRef.current = true;
    stopSpeaking();
    setWelcome((w) => (w.stage === "hidden" ? w : { ...w, stage: "fading", segment: -1 }));
    welcomeTimersRef.current.push(
      window.setTimeout(
        () => {
          welcomeAbortRef.current = false;
          setWelcome((w) => ({ stage: "hidden", kind: w.kind, segment: -1, spoken: false, finished: false }));
          // hand the mic back exactly as speak()'s finish() would — a skip
          // mid-speech bumps the speak token, so its own hand-back never runs
          if (convoRef.current && !busyRef.current) startRec("convo");
          else if (shouldWake()) {
            if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
            restartTimerRef.current = window.setTimeout(() => {
              if (shouldWake()) startRec("wake");
            }, 300);
          }
        },
        WELCOME_FADE_MS
      )
    );
  }, [clearWelcomeTimers, stopSpeaking, startRec, shouldWake]);

  /** Run the welcome overlay: full script (first opening) or welcome-back. */
  const runWelcome = useCallback(
    (kind: WelcomeKind) => {
      clearWelcomeTimers();
      welcomeAbortRef.current = false;
      const ctx = greetCtx();
      const canSpeak = profileRef.current.voiceEnabled && !prefsRef.current.muted && ttsAvailable();
      const segs = kind === "full" ? welcomeFullSpoken(ctx, snapshotRef.current) : [welcomeBackMessage(ctx)];
      const spokenText = segs.join(" ");
      lastGreetRef.current = spokenText;
      setWelcome({ stage: "showing", kind, segment: -1, spoken: false, finished: false });
      addMsg({ role: "halo", text: spokenText, at: Date.now(), kind: "greeting" });

      if (!canSpeak) {
        // Visual welcome with a text alternative — the overlay carries the
        // "Enable HALO Voice" control. Never trap the trader: auto-enter.
        welcomeTimersRef.current.push(window.setTimeout(() => dismissWelcome(), WELCOME_SILENT_AUTO_MS));
        return;
      }

      spokenGreetRef.current = true;
      pendingGreetRef.current = spokenText;
      // speak segment by segment so the overlay highlights the REAL speech
      const speakSeg = (i: number) => {
        if (welcomeAbortRef.current) return;
        if (i >= segs.length) {
          pendingGreetRef.current = null;
          setWelcome((w) => ({ ...w, segment: Math.max(0, segs.length - 1), spoken: true, finished: true }));
          welcomeTimersRef.current.push(window.setTimeout(() => dismissWelcome(), WELCOME_END_HOLD_MS));
          return;
        }
        setWelcome((w) => ({ ...w, segment: i, spoken: true, finished: false }));
        lastSpokenRef.current = segs[i]; // echo guard for the wake standby
        speak(segs[i], {
          onend: () => speakSeg(i + 1),
          onblocked: () => setBlocked(true),
        });
      };
      speakSeg(0);
    },
    [addMsg, speak, greetCtx, clearWelcomeTimers, dismissWelcome]
  );

  /** (Re)start speaking the active welcome — overlay play/enable control. */
  const playWelcome = useCallback(() => {
    setBlocked(false);
    runWelcome(welcomeRef.current.kind);
  }, [runWelcome]);

  // session-start trigger: full welcome on the first application opening,
  // short welcome-back on subsequent sessions — once per session, never on
  // tab switches or refreshes
  const attemptGreeting = useCallback(() => {
    const p = profileRef.current;
    greetedAttemptRef.current = true;
    try {
      if (window.sessionStorage.getItem(GREET_KEY) === "1") return;
      window.sessionStorage.setItem(GREET_KEY, "1");
    } catch {
      // storage blocked (private mode) — in-memory guard still prevents dupes
    }
    if (!p.autoGreeting) return; // welcome on/off — the banner still greets
    let fullSeen = false;
    try {
      fullSeen = window.localStorage.getItem(WELCOME_FULL_SEEN_KEY) === "1";
    } catch {
      // ignore
    }
    const style = prefsRef.current.welcomeStyle;
    const wantFull = style === "full" || (style === "auto" && !fullSeen);
    const kind: WelcomeKind = wantFull ? "full" : "back";
    if (wantFull) {
      try {
        window.localStorage.setItem(WELCOME_FULL_SEEN_KEY, "1");
      } catch {
        // ignore
      }
    }
    // let the boot sequence clear, then raise the overlay + speak
    welcomeTimersRef.current.push(
      window.setTimeout(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        runWelcome(kind);
      }, 2600)
    );
  }, [runWelcome]);

  const replayWelcome = useCallback(() => {
    const script = lastGreetRef.current || welcomeFullSpoken(greetCtx(), snapshotRef.current).join(" ");
    lastSpokenRef.current = script;
    speak(script);
     
  }, [speak, greetCtx]);

  const testVoice = useCallback(() => {
    const ctx = greetCtx();
    const line = ctx.hasName ? `Voice check complete. HALO is online, ${ctx.name}.` : "Voice check complete. HALO is online.";
    lastSpokenRef.current = line;
    speak(line);
     
  }, [speak, greetCtx]);

  const enableVoice = useCallback(async () => {
    const ok = await saveProfile({ voiceEnabled: true });
    if (!ok) return;
    // the welcome overlay is up → (re)run the active welcome with voice,
    // straight from its first segment (a user gesture, so autoplay allows it)
    if (welcomeRef.current.stage === "showing") {
      setBlocked(false);
      runWelcome(welcomeRef.current.kind);
      return;
    }
    if (!spokenGreetRef.current && profileRef.current.autoGreeting) {
      // first-time activation: deliver the welcome right away — a pending
      // silent auto-welcome timer must be cancelled so it never doubles up
      clearWelcomeTimers();
      const ctx = greetCtx();
      const segs = welcomeRef.current.kind === "back" ? [welcomeBackMessage(ctx)] : welcomeFullSpoken(ctx, snapshotRef.current);
      const script = segs.join(" ");
      lastGreetRef.current = script;
      spokenGreetRef.current = true;
      pendingGreetRef.current = null;
      addMsg({ role: "halo", text: script, at: Date.now(), kind: "greeting" });
      lastSpokenRef.current = script;
      speak(script);
    } else {
      const line = "HALO voice enabled.";
      lastSpokenRef.current = line;
      speak(line);
    }
     
  }, [speak, addMsg, greetCtx, runWelcome, clearWelcomeTimers]);

  const disableVoice = useCallback(async () => {
    await saveProfile({ voiceEnabled: false, wakeEnabled: false });
    stopSpeaking();
    stopRec();
    closeConvo(false);
     
  }, [saveProfile, stopSpeaking, stopRec, closeConvo]);

  // ── microphone permission ──
  const requestMic = useCallback(async (): Promise<"granted" | "denied" | "unsupported"> => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMic("unsupported");
      return "unsupported";
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // permission persists; we never record
      setMic("idle");
      return "granted";
    } catch {
      setMic("denied");
      return "denied";
    }
  }, []);

  const enableWake = useCallback(async (): Promise<"granted" | "denied" | "unsupported"> => {
    const res = await requestMic();
    if (res !== "granted") return res;
    await saveProfile({ wakeEnabled: true });
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      if (shouldWake()) startRec("wake");
    }, 500);
    return "granted";
  }, [requestMic, saveProfile, shouldWake, startRec]);

  const disableWake = useCallback(async () => {
    await saveProfile({ wakeEnabled: false });
    if (recModeRef.current === "wake") stopRec();
  }, [saveProfile, stopRec]);

  // ── mount: hydrate prefs + transcript, detect capabilities ──
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(PREFS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as Partial<VoicePrefs>;
          // pick known keys only — older stores may carry removed settings
          // (liveMode / convoSeconds), which must never resurrect
          setPrefsState({
            volume: typeof p.volume === "number" ? p.volume : DEFAULT_PREFS.volume,
            rate: typeof p.rate === "number" ? p.rate : DEFAULT_PREFS.rate,
            voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : "",
            muted: p.muted === true,
            engine: p.engine === "browser" ? "browser" : "neural",
            neuralVoice: typeof p.neuralVoice === "string" && NEURAL_VOICES.some((nv) => nv.id === p.neuralVoice) ? p.neuralVoice : DEFAULT_PREFS.neuralVoice,
            welcomeStyle: p.welcomeStyle === "full" || p.welcomeStyle === "short" ? p.welcomeStyle : "auto",
            verbosity: p.verbosity === "brief" || p.verbosity === "detailed" ? p.verbosity : "balanced",
          });
        }
      } catch {
        // ignore
      }
      try {
        const raw = window.localStorage.getItem(TRANSCRIPT_KEY);
        const arr = raw ? (JSON.parse(raw) as Msg[]) : [];
        setMsgs(Array.isArray(arr) ? arr.slice(-40) : []);
      } catch {
        // ignore
      }
      if (getSTTCtor() === null) setMic("unsupported");
      hydratedRef.current = true; // hydration complete — future pref changes may persist
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // persist prefs + transcript — ONLY after hydration completed, otherwise the
  // first mount render would overwrite the trader's stored prefs with defaults
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  useEffect(() => {
    if (msgs.length === 0) return;
    try {
      window.localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(msgs.filter((m) => m.at > 0).slice(-40)));
    } catch {
      // ignore
    }
  }, [msgs]);

  const setPrefs = useCallback((patch: Partial<VoicePrefs>) => {
    setPrefsState((p) => ({ ...p, ...patch }));
  }, []);

  const clearMsgs = useCallback(() => {
    setMsgs([]);
    try {
      window.localStorage.removeItem(TRANSCRIPT_KEY);
    } catch {
      // ignore
    }
  }, []);

  // ── profile fetch (with retry → honest Initializing/Offline status) ──
  useEffect(() => {
    let alive = true;
    const load = async (attempt = 0) => {
      try {
        const r = await fetch("/api/halo/profile", { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; profile?: Omit<ProfileState, "loaded">; error?: string };
        if (!alive) return;
        if (j.ok && j.profile) {
          setProfile({ ...j.profile, loaded: true });
          setStatus("online");
        } else throw new Error(j.error ?? "profile unavailable");
      } catch {
        if (!alive) return;
        setStatus("offline");
        const wait = Math.min(30_000, 4000 * (attempt + 1));
        profileRetryRef.current = window.setTimeout(() => load(attempt + 1), wait);
      }
    };
    const t = window.setTimeout(() => load(), 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
      if (profileRetryRef.current) window.clearTimeout(profileRetryRef.current);
    };
  }, []);

  // ── voice list (for the voice picker) ──
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!ttsAvailable()) return;
      const load = () => {
        const vs = window.speechSynthesis
          .getVoices()
          .filter((v) => v.lang.toLowerCase().startsWith("en"))
          .map((v) => ({ uri: v.voiceURI, label: `${v.name} (${v.lang})` }));
        setVoices(vs);
      };
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (ttsAvailable()) window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // ── greeting trigger: once per session, after profile + snapshot arrive ──
  useEffect(() => {
    if (!profile.loaded || !snapshot || greetedAttemptRef.current) return;
    const t = window.setTimeout(() => attemptGreeting(), 200);
    return () => window.clearTimeout(t);
  }, [profile.loaded, snapshot, attemptGreeting]);

  // ── ALWAYS-ON arming: the mic must come up WITH the app ────────────────
  //  The wake standby used to be armed only as a SIDE EFFECT of the welcome
  //  speech finishing (or a visibility change). On every reload where the
  //  session was already greeted the welcome stayed silent — so nothing
  //  armed the mic and HALO looked online ("standby" pill) while being
  //  completely deaf to "HALO …" until the trader clicked something. This
  //  effect arms the standby directly from real state, so the assistant
  //  listens from the moment it is enabled, welcome or not.
  useEffect(() => {
    if (!profile.loaded) return;
    if (welcome.stage !== "hidden") return; // the welcome owns the audio flow
    if (recModeRef.current !== "off" || convoRef.current || busyRef.current) return; // already armed / busy
    if (!shouldWake()) return; // disabled, denied, unsupported or hidden tab
    const t = window.setTimeout(() => {
      if (welcomeRef.current.stage !== "hidden") return;
      if (shouldWake() && recModeRef.current === "off") startRec("wake");
    }, 700);
    return () => window.clearTimeout(t);
  }, [profile.loaded, profile.voiceEnabled, profile.wakeEnabled, welcome.stage, mic, shouldWake, startRec]);

  // ── autoplay blocked → one-tap retry on the next qualifying interaction ──
  useEffect(() => {
    if (!blocked) return;
    const retry = () => {
      setBlocked(false);
      // while the welcome overlay is up it owns recovery through its own
      // explicit play/enable controls — a stray click must not double-speak
      if (welcomeRef.current.stage !== "hidden") return;
      const pending = pendingGreetRef.current;
      pendingGreetRef.current = null;
      // a reply blocked MID-CONVERSATION replays the last thing HALO wanted to
      // say — not the welcome script
      const script = pending ?? lastSpokenRef.current ?? lastGreetRef.current;
      if (script) {
        lastSpokenRef.current = script;
        speak(script, { onblocked: () => setBlocked(true) });
      }
    };
    const evs: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    evs.forEach((ev) => window.addEventListener(ev, retry, { once: true }));
    return () => evs.forEach((ev) => window.removeEventListener(ev, retry));
  }, [blocked, speak]);

  // ── screen wake / phone-on recognition ──────────────────────────────
  //  • screen off / tab hidden / OS idle  → mic stops (never secret recording)
  //  • screen on / tab visible again      → mic resumes INSTANTLY (convo or
  //    wake standby, whichever was active) and, if the device was away long
  //    enough, HALO briefly acknowledges the return out loud (throttled —
  //    quick tab flips stay silent, full welcome never repeats here)
  //  • network restored                   → listening resumes automatically
  useEffect(() => {
    const resumeListening = () => {
      if (convoRef.current && !busyRef.current && voiceRef.current === "idle") {
        startRec("convo"); // live session survives screen idle — pick up mid-conversation
      } else if (shouldWake() && recModeRef.current === "off") {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (shouldWake()) startRec("wake");
        }, 600);
      }
    };

    const onVisible = () => {
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = 0;
      const p = profileRef.current;
      const canAck =
        p.loaded &&
        p.voiceEnabled &&
        p.autoGreeting &&
        ttsAvailable() &&
        !prefsRef.current.muted &&
        prefsRef.current.verbosity !== "brief" && // brief → silent returns
        welcomeRef.current.stage === "hidden" && // never talk over the welcome
        !busyRef.current &&
        voiceRef.current !== "speaking" &&
        hiddenFor >= WELCOME_BACK_MIN_HIDDEN_MS &&
        Date.now() - lastBackAckRef.current > WELCOME_BACK_THROTTLE_MS;
      if (canAck) {
        // throttled spoken welcome-back (mic hand-back happens in speak())
        lastBackAckRef.current = Date.now();
        const line = welcomeBackLine(greetCtx(), backIdxRef.current++);
        lastSpokenRef.current = line;
        addMsg({ role: "halo", text: line, at: Date.now(), kind: "system" });
        speak(line);
      } else {
        resumeListening();
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") onVisible();
      else {
        hiddenAtRef.current = Date.now();
        stopRec();
      }
    };

    // Page Lifecycle (Android Chrome): page froze while the phone slept
    const onResume = () => {
      if (document.visibilityState === "visible") onVisible();
    };
    const onFreeze = () => {
      hiddenAtRef.current = hiddenAtRef.current || Date.now();
      stopRec();
    };

    // connectivity: wake the mic back up once the network returns
    const onOnline = () => {
      if (document.visibilityState === "visible") {
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        resumeListening();
      }
    };

    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("resume", onResume as EventListener);
    document.addEventListener("freeze", onFreeze as EventListener);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("resume", onResume as EventListener);
      document.removeEventListener("freeze", onFreeze as EventListener);
      window.removeEventListener("online", onOnline);
    };
  }, [shouldWake, startRec, stopRec, speak, addMsg, greetCtx]);

  // ── unmount: full teardown (no orphan mic or audio) ──
  useEffect(() => {
    return () => {
      stopRec();
      stopSpeaking();
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    };
  }, []);

  // ── derived ──
  const wakeState: WakeState = useMemo(() => {
    const p = profile;
    if (!p.loaded || !p.voiceEnabled || !p.wakeEnabled) return "off";
    if (mic === "denied") return "denied";
    if (mic === "unsupported") return "unsupported";
    return wakeActive ? "listening" : "standby";
  }, [profile, mic, wakeActive]);

  const greetingCopy = useMemo(() => displayGreeting(snapshot, { name: profile.displayName || "Trader", hasName: profile.hasName, wakeEnabled: profile.voiceEnabled && profile.wakeEnabled, wakePhrase: profile.wakePhrase }), [snapshot, profile]);

  const welcomeParas = useMemo(
    () => (welcome.kind === "full" ? welcomeFullDisplay({ name: profile.displayName || "Trader", hasName: profile.hasName, wakeEnabled: profile.voiceEnabled && profile.wakeEnabled, wakePhrase: profile.wakePhrase }) : [welcomeBackMessage({ name: profile.displayName || "Trader", hasName: profile.hasName, wakeEnabled: profile.voiceEnabled && profile.wakeEnabled, wakePhrase: profile.wakePhrase })]),
    [welcome.kind, profile]
  );

  const value: HaloVoiceCtx = {
    profile,
    saveProfile,
    prefs,
    setPrefs,
    voices,
    status,
    voice,
    mic,
    requestMic,
    wakeState,
    convoOpen,
    blocked,
    msgs,
    pushBotMsg: (text: string) => addMsg({ role: "halo", text, at: Date.now(), kind: "system" }),
    setActiveSurface: (surface: string | null) => {
      surfaceRef.current = surface;
    },
    clearMsgs,
    send,
    startConvo,
    closeConvo,
    speak,
    stopSpeaking,
    testVoice,
    replayWelcome,
    enableVoice,
    disableVoice,
    enableWake,
    disableWake,
    greetingCopy,
    welcome,
    welcomeParas,
    dismissWelcome,
    playWelcome,
    registerActionRunner,
    pendingConfirm,
    approvePending,
    cancelPending,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
