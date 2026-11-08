"use client";

// ════════════════════════════════════════════════════════════════════════
//  SCANNER BOT VOICE LINK · the Timeframe Scanner Bot's own voice console
//
//  Gives the Scanner Bot a wake voice on its dedicated dashboard:
//    • LISTEN — shares the app-wide wake-word standby ("HALO"), re-armed
//      automatically after every turn; a bare call or "HALO, start scanning"
//      in one breath both work. The orb doubles as push-to-talk.
//    • SPEAK — the shared neural TTS engine (browser-voice fallback), with
//      the one-tap autoplay recovery if the browser blocks playback.
//    • INTERACT — every utterance routes through /api/halo/brain with the
//      scanner-console surface: the operator core answers AS the bot from
//      the LIVE scanner runtime and executes the bot's own functions
//      (start / pause / resume the sweep, report opportunities) on its own.
//    • QUICK COMMANDS — one-tap chips send the same commands as text for
//      moments when talking is not an option (replies still play aloud).
//
//  ONE mic, ONE engine: this panel never opens its own SpeechRecognition —
//  everything flows through HaloVoiceProvider, so the Scanner Bot's voice
//  and the app voice can never fight over the microphone or double-speak.
//  Consequential trading controls keep their explicit confirm gate — the
//  approve/cancel strip appears right here when one is pending.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo } from "react";
import { AudioLines, Bot, Check, Loader2, Mic, Radio, ShieldAlert, VolumeX, X, Zap } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { useHaloVoice } from "./voice-provider";

type ScannerStatus = "idle" | "scanning" | "paused" | "trade_lock";

interface Props {
  scannerStatus: ScannerStatus;
}

const CORNERS = [
  "left-0 top-0 border-l-2 border-t-2 rounded-tl-xl",
  "right-0 top-0 border-r-2 border-t-2 rounded-tr-xl",
  "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl",
  "bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl",
];

/** quick commands — the same words the trader could say out loud */
function chipsFor(status: ScannerStatus): { label: string; q: string; accent: string }[] {
  const chips: { label: string; q: string; accent: string }[] = [];
  if (status === "idle") chips.push({ label: "Start scanning", q: "start scanning", accent: C.green });
  else if (status === "paused") chips.push({ label: "Resume scanning", q: "resume scanning", accent: C.green });
  else if (status === "scanning") chips.push({ label: "Pause scanning", q: "pause scanning", accent: C.warn });
  chips.push(
    { label: "Scanner status", q: "what's your scanner status", accent: C.cyan },
    { label: "Latest opportunity", q: "what's the latest opportunity you found", accent: C.goldHover },
    { label: "Recent finds", q: "show my recent opportunities", accent: C.cyan },
    { label: "Tell me a joke", q: "tell me a joke", accent: C.ice },
  );
  return chips;
}

export function ScannerVoicePanel({ scannerStatus }: Props) {
  const {
    profile,
    status: coreStatus,
    prefs,
    setPrefs,
    voice,
    mic,
    wakeState,
    blocked,
    msgs,
    pendingConfirm,
    enableVoice,
    enableWake,
    startConvo,
    send,
    approvePending,
    cancelPending,
    setActiveSurface,
  } = useHaloVoice();

  // tell the operator core this conversation is the SCANNER BOT speaking
  useEffect(() => {
    setActiveSurface("scanner-bot");
    return () => setActiveSurface(null);
  }, [setActiveSurface]);

  const chips = useMemo(() => chipsFor(scannerStatus), [scannerStatus]);

  // ── orb state machine (one button drives the whole flow) ──
  const voiceOff = profile.loaded && !profile.voiceEnabled;
  const wakeOff = profile.loaded && profile.voiceEnabled && wakeState === "off";
  const thinking = voice === "processing";
  const speaking = voice === "speaking";
  const listening = voice === "listening" || wakeState === "listening";

  const orbLabel = voiceOff ? "ENABLE VOICE" : wakeOff ? "ARM WAKE WORD" : thinking ? "THINKING" : speaking ? "SPEAKING" : listening ? "LISTENING" : "TAP TO TALK";
  const orbColor = voiceOff ? C.cyan : wakeOff ? C.warn : thinking ? C.goldHover : speaking ? C.teal : listening ? C.green : C.cyan;

  const stateLine = (() => {
    if (!profile.loaded || coreStatus === "initializing") return "Connecting to the HALO voice core…";
    if (coreStatus === "offline") return "HALO core offline — quick commands still queue, spoken answers need the core.";
    if (!profile.voiceEnabled) return "Voice is off — tap Enable Voice to let the Scanner Bot listen and speak.";
    if (prefs.muted) return "Replies are muted on this device — tap MUTED to unmute.";
    if (blocked) return "The browser blocked audio playback — tap anywhere once to enable the voice.";
    if (thinking) return "Working on it — running the scanner and verifying real state…";
    if (speaking) return "Speaking — talk over me any time to barge in.";
    if (listening) return "Listening — go ahead.";
    if (mic === "denied") return "Microphone permission is denied — allow the mic in the browser, or use the quick commands below.";
    if (mic === "unsupported") return "This browser has no speech recognition — use the quick commands below; replies still play out loud.";
    if (wakeOff) return "Voice is on — arm the wake word so “HALO” summons the bot hands-free.";
    return `Standby — say “${profile.wakePhrase}”, or “${profile.wakePhrase}, start scanning”. Tap the orb to talk now.`;
  })();

  const onOrb = () => {
    if (voiceOff) {
      void enableVoice();
      return;
    }
    if (wakeOff) {
      void enableWake();
      return;
    }
    if (thinking || speaking) return; // the turn owns the audio right now
    startConvo(false);
  };

  const wakeChip = (() => {
    if (!profile.voiceEnabled) return { label: "WAKE OFF", tone: C.muted, bg: A.white(0.06) };
    switch (wakeState) {
      case "listening":
        return { label: "HEARD “HALO”", tone: C.green, bg: A.green(0.14) };
      case "standby":
        return { label: `SAY “${profile.wakePhrase.toUpperCase()}”`, tone: C.cyan, bg: A.cyan(0.12) };
      case "denied":
        return { label: "MIC BLOCKED", tone: C.warn, bg: A.warn(0.12) };
      case "unsupported":
        return { label: "NO MIC ENGINE", tone: C.warn, bg: A.warn(0.12) };
      default:
        return { label: "WAKE OFF", tone: C.muted, bg: A.white(0.06) };
    }
  })();

  // glanceable transcript — the full conversation lives in the JARVIS console
  const tape = msgs.slice(-4).reverse();

  return (
    <section
      className="relative overflow-hidden rounded-2xl border-2"
      style={{
        borderColor: A.cyan(0.34),
        background: "linear-gradient(150deg, #04122B 0%, #020A1B 60%, #010714 100%)",
        boxShadow: `0 0 24px ${A.cyan(0.12)}, 0 12px 30px rgba(0,4,12,0.5), inset 0 0 30px rgba(2,11,26,0.8)`,
      }}
      aria-label="Scanner Bot voice link"
    >
      {CORNERS.map((pos) => (
        <span key={pos} aria-hidden className={`pointer-events-none absolute z-10 h-4 w-4 ${pos}`} style={{ borderColor: A.cyan(0.75) }} />
      ))}

      <div className="p-4 sm:p-5">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2">
          <Bot size={18} style={{ color: C.ice }} aria-hidden />
          <h2 className="text-[13px] font-extrabold tracking-[0.16em]" style={{ color: C.txt }}>
            SCANNER BOT <span style={{ color: C.goldHover }}>· VOICE LINK</span>
          </h2>
          <span
            className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[9.5px] font-extrabold tracking-wider"
            style={{ borderColor: wakeChip.tone, background: wakeChip.bg, color: wakeChip.tone }}
            role="status"
          >
            <Radio size={10} aria-hidden />
            {wakeChip.label}
          </span>
          {prefs.muted && profile.voiceEnabled && (
            <button
              type="button"
              onClick={() => setPrefs({ muted: false })}
              className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[9.5px] font-extrabold tracking-wider transition-all hover:brightness-110"
              style={{ borderColor: A.warn(0.55), background: A.warn(0.12), color: C.warn }}
            >
              <VolumeX size={10} aria-hidden /> MUTED — TAP TO UNMUTE
            </button>
          )}
          <span className="ml-auto hidden text-[9.5px] font-bold tracking-wider sm:block" style={{ color: C.label }}>
            ONE MIC · ONE VOICE · SHARED WITH HALO
          </span>
        </div>

        {/* orb + state */}
        <div className="mt-3.5 grid grid-cols-1 items-center gap-4 sm:grid-cols-[104px_1fr]">
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative">
              {/* live rings while the bot actually listens / speaks */}
              {(listening || speaking) && (
                <>
                  <span
                    className="halo-anim-breathe pointer-events-none absolute -inset-2 rounded-full border"
                    style={{ borderColor: A.cyan(0.4) }}
                    aria-hidden
                  />
                  <span
                    className="halo-anim-breathe pointer-events-none absolute -inset-4 rounded-full border"
                    style={{ borderColor: A.cyan(0.18), animationDelay: "0.7s" }}
                    aria-hidden
                  />
                </>
              )}
              <button
                type="button"
                onClick={onOrb}
                disabled={thinking || speaking || !profile.loaded}
                aria-label={orbLabel}
                className="relative flex h-[84px] w-[84px] items-center justify-center rounded-full border-2 transition-all hover:brightness-110 disabled:cursor-progress"
                style={{
                  borderColor: orbColor,
                  background: `radial-gradient(circle at 50% 38%, ${A.cyan(0.16)}, rgba(2,11,26,0.92) 72%)`,
                  boxShadow: `0 0 22px ${A.cyan(0.28)}, inset 0 0 18px rgba(2,11,26,0.9)`,
                  opacity: thinking || speaking ? 0.85 : 1,
                }}
              >
                {thinking ? (
                  <Loader2 size={30} className="animate-spin" style={{ color: orbColor }} aria-hidden />
                ) : speaking ? (
                  <AudioLines size={30} style={{ color: orbColor }} aria-hidden />
                ) : (
                  <Mic size={30} style={{ color: orbColor }} aria-hidden />
                )}
                {(listening || wakeState === "standby") && (
                  <span
                    className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${wakeState === "listening" ? "halo-anim-beacon" : ""}`}
                    style={{ background: wakeState === "listening" ? C.green : C.cyan, ["--beacon" as string]: `${C.green}88` } as React.CSSProperties}
                    aria-hidden
                  />
                )}
              </button>
            </div>
            <span className="text-[9px] font-extrabold tracking-[0.18em]" style={{ color: orbColor }}>
              {orbLabel}
            </span>
          </div>

          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-snug" style={{ color: C.txt }}>
              {stateLine}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: C.txt2 }}>
              The bot listens for its wake word and runs its own functions hands-free: start, pause or resume the sweep, report status and read out every
              opportunity it finds — automatically. When a fire confirms, the bot takes the trade (paper or live, per the EA execution settings) and scans again after it closes.
            </p>
            {/* pending consequential confirm — trading controls keep their gate */}
            {pendingConfirm && (
              <div className="mt-2.5 rounded-lg border px-3 py-2" style={{ borderColor: A.warn(0.55), background: A.warn(0.08) }}>
                <p className="flex items-center gap-1.5 text-[11px] font-extrabold" style={{ color: C.warn }}>
                  <ShieldAlert size={12} aria-hidden /> {pendingConfirm.question}
                </p>
                {pendingConfirm.effect && (
                  <p className="mt-0.5 text-[10.5px]" style={{ color: C.txt2 }}>
                    {pendingConfirm.effect}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={approvePending}
                    className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-extrabold transition-all hover:brightness-110"
                    style={{ borderColor: A.green(0.6), background: A.green(0.12), color: C.green }}
                  >
                    <Check size={11} aria-hidden /> APPROVE
                  </button>
                  <button
                    type="button"
                    onClick={cancelPending}
                    className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-extrabold transition-all hover:brightness-110"
                    style={{ borderColor: A.red(0.6), background: A.red(0.1), color: C.red }}
                  >
                    <X size={11} aria-hidden /> CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* quick commands */}
        <div className="mt-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[9.5px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
            <Zap size={11} style={{ color: C.goldHover }} aria-hidden /> QUICK COMMANDS — TAP OR SAY IT
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.q}
                type="button"
                onClick={() => void send(c.q)}
                className="rounded-lg border px-2.5 py-1 text-[10.5px] font-extrabold transition-all hover:brightness-110 active:scale-[0.98]"
                style={{ borderColor: A.cyan(0.35), background: "rgba(2,16,36,0.7)", color: c.accent }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* mini transcript */}
        <div className="mt-4">
          <p className="mb-1.5 text-[9.5px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
            LIVE EXCHANGE
          </p>
          <div className="halo-scroll max-h-[132px] space-y-1.5 overflow-auto rounded-lg border px-2.5 py-2" style={{ borderColor: "rgba(15,46,88,0.9)", background: "rgba(2,16,36,0.55)" }}>
            {tape.length === 0 ? (
              <p className="text-[10.5px]" style={{ color: C.muted }}>
                No exchanges yet — say “{profile.wakePhrase}” or tap a quick command. Everything the bot hears and answers shows up here.
              </p>
            ) : (
              tape.map((m, i) => (
                <div key={`${m.at}-${i}`} className="flex items-start gap-2">
                  <span
                    className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{ background: m.role === "user" ? C.cyan : m.err ? C.red : m.kind === "action" || m.kind === "confirm" ? C.goldHover : C.teal }}
                    aria-hidden
                  />
                  <p className="min-w-0 break-words text-[10.5px] leading-snug" style={{ color: m.role === "user" ? C.ice : m.err ? C.red : C.txt2 }}>
                    <span className="font-extrabold" style={{ color: m.role === "user" ? C.cyan : C.txt3 }}>
                      {m.role === "user" ? "YOU" : "SCANNER BOT"}:
                    </span>{" "}
                    {m.text.length > 180 ? `${m.text.slice(0, 180)}…` : m.text}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
