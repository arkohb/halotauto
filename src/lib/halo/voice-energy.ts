"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO VOICE ENERGY BUS · imperative bridge between real events and the
//  3D AI core renderer.
//
//  Everything the AI core animates comes from REAL system events:
//    • setSpeaking / bumpSpeech  — actual SpeechSynthesis playback
//      (onstart / onboundary word events fired by the browser while the
//      utterance is audibly playing)
//    • startMic / stopMic / bumpMic — real SpeechRecognition sessions and
//      its onspeechstart events; startMic additionally opens a tiny
//      AnalyserNode stream (amplitude only, never recorded) so the
//      listening rings can pulse with the trader's actual voice level.
//      The analyser is only created in FULL fx mode to save battery.
//    • firePulse / alertPulse   — confirmed engine events (fire/win/loss)
//      and verified warnings, forwarded by the dashboard cards.
//    • setExecuting / errorPulse — REAL action-execution windows (the
//      ActionBridge running an allowlisted command) and verified failures;
//      the executing animation only ever runs while an operation is
//      actually in flight, never before results are verified.
//
//  No React state lives here — the orb polls these values inside its own
//  animation loop, so voice traffic never re-renders the app.
// ════════════════════════════════════════════════════════════════════════

interface EnergyState {
  speaking: boolean;
  lastBoundaryAt: number;
  micActive: boolean;
  lastMicAt: number;
  fireAt: number;
  fireDir: number; // -1 sell · +1 buy
  alertAt: number;
  executing: boolean;
  lastErrorAt: number;
}

const s: EnergyState = {
  speaking: false,
  lastBoundaryAt: 0,
  micActive: false,
  lastMicAt: 0,
  fireAt: 0,
  fireDir: 1,
  alertAt: 0,
  executing: false,
  lastErrorAt: 0,
};

// ── mic analyser (amplitude only — never recorded, never uploaded) ──────
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let timeBuf: Uint8Array<ArrayBuffer> | null = null;
let levelEma = 0;

function currentFxMode(): string {
  try {
    return document.documentElement.dataset.fx ?? "full";
  } catch {
    return "full";
  }
}

export const voiceEnergy = {
  /** actual TTS playback started/stopped (browser-confirmed) */
  setSpeaking(v: boolean) {
    s.speaking = v;
    if (v) s.lastBoundaryAt = performance.now();
  },
  /** a word boundary fired while the utterance is audibly playing */
  bumpSpeech() {
    s.lastBoundaryAt = performance.now();
  },
  /** SpeechRecognition reported speech activity (real mic event) */
  bumpMic() {
    s.lastMicAt = performance.now();
  },
  /** confirmed engine event — a 3EL trade fired (dir -1 SELL / +1 BUY) */
  firePulse(dir: number) {
    s.fireAt = performance.now();
    s.fireDir = dir >= 0 ? 1 : -1;
  },
  /** verified warning surfaced by the dashboard */
  alertPulse() {
    s.alertAt = performance.now();
  },

  /** a real allowlisted action started/stopped executing (ActionBridge) */
  setExecuting(v: boolean) {
    s.executing = v;
  },

  /** an action finished and verification FAILED — honest error flash */
  errorPulse() {
    s.lastErrorAt = performance.now();
  },

  /** open the amplitude analyser while the assistant is actually listening */
  startMic() {
    s.micActive = true;
    if (currentFxMode() !== "full") return; // battery: analyser only in full FX mode
    if (stream) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC || !stream) throw new Error("no audio context");
        audioCtx = new AC();
        if (audioCtx.state === "suspended") {
          try {
            await audioCtx.resume();
          } catch {
            // autoplay policy — activity bumps still drive the core
          }
        }
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        timeBuf = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        // permission denied / unsupported — onspeechstart bumps still work
      }
    })();
  },

  /** listening session ended — release the mic immediately */
  stopMic() {
    s.micActive = false;
    levelEma = 0;
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    stream = null;
    try {
      void audioCtx?.close();
    } catch {
      // ignore
    }
    audioCtx = null;
    analyser = null;
    timeBuf = null;
  },

  /** smoothed mic RMS in 0..1 (0 when no analyser is available) */
  readMicLevel(): number {
    if (!analyser || !timeBuf || !s.micActive) {
      levelEma = Math.max(0, levelEma - 0.035);
      return levelEma;
    }
    try {
      analyser.getByteTimeDomainData(timeBuf);
      let sum = 0;
      for (let i = 0; i < timeBuf.length; i++) {
        const v = (timeBuf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / timeBuf.length);
      const lvl = Math.min(1, rms * 3.4);
      levelEma = levelEma * 0.72 + lvl * 0.28;
      return levelEma;
    } catch {
      return levelEma;
    }
  },

  snapshot(): EnergyState {
    return { ...s };
  },
};
