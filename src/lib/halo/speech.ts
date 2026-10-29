// ════════════════════════════════════════════════════════════════════════
//  HALO SPEECH · browser Web Speech API capability helpers (client-safe)
//
//  Voice technology chosen for HALO:
//  • TTS  — window.speechSynthesis (local OS/browser voices, no keys,
//           no network audio, graceful when unavailable)
//  • STT  — window.SpeechRecognition / webkitSpeechRecognition (Chrome,
//           Edge, Safari 14.1+). NOTE: the browser vendor processes the
//           audio with its speech service; HALO itself never records or
//           stores microphone audio, and listening only ever starts after
//           an explicit permission grant + visible listening indicator.
// ════════════════════════════════════════════════════════════════════════

// ── minimal SpeechRecognition typings (not fully in lib.dom) ────────────
export interface HaloSRAlternative {
  transcript: string;
  confidence: number;
}
export interface HaloSRResult {
  isFinal: boolean;
  length: number;
  [index: number]: HaloSRAlternative;
}
export interface HaloSRResultList {
  length: number;
  [index: number]: HaloSRResult;
}
export interface HaloSREvent {
  resultIndex: number;
  results: HaloSRResultList;
}
export interface HaloSpeechRecognition {
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
  /** real microphone activity events (supported by Chrome's engine) */
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
}

export function getSTTCtor(): (new () => HaloSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => HaloSpeechRecognition) | undefined;
  return ctor ?? null;
}

export function ttsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Normalize a transcript for wake matching / echo filtering. */
export function normTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when the transcript contains the wake phrase (optionally with
 * lead-ins like "hey/ok/hi"). Includes a small mishear table for the
 * default phrase "halo" — configurable alternative phrases are matched
 * strictly. Requires the phrase as a standalone token/phrase.
 */
export function wakeHit(transcript: string, phrase: string): boolean {
  const t = normTokens(transcript).join(" ");
  if (!t) return false;
  const p = normTokens(phrase).join(" ");
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/' /g, "'?\\s?");
  const lead = /(^|\s)((hey|ok|hi|yo|hey,?)\s+)?/.source;
  const re = new RegExp(`${lead}${esc}(\\s|$)`, "i");
  if (re.test(t)) return true;
  if (p === "halo") {
    // frequent ASR mishears of "HALO" — guarded to standalone tokens
    return /(^|\s)(hello|hallo|hella|halo? low|hail oh)(\s|$)/i.test(t);
  }
  return false;
}

/**
 * Echo guard: true when a heard transcript is mostly a replay of what
 * HALO itself just said (speaker→mic loop). Prevents self-activation.
 */
export function isEcho(transcript: string, spoken: string | null): boolean {
  if (!spoken) return false;
  const heard = normTokens(transcript);
  if (heard.length === 0) return true;
  const said = new Set(normTokens(spoken));
  const overlap = heard.filter((w) => said.has(w)).length;
  return overlap / heard.length >= 0.6;
}
