"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO VOICE & PROFILE · settings card
//
//  Everything the trader controls about the voice experience in one place:
//  preferred name · voice on/off · automatic welcome · volume / speed /
//  voice selection · test voice · replay welcome · wake word + phrase ·
//  microphone permission state.
//
//  Presentational only — writes go to /api/halo/profile (name, consents)
//  or local device prefs (volume/rate/voice). No trading settings here.
// ════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AudioLines, Mic, MicOff, Play, RotateCcw, Save, ShieldCheck, Volume2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { NEURAL_VOICES, useHaloVoice } from "./voice-provider";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--hx-line-inner)]/60 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[10.5px] font-bold tracking-wide text-[var(--hx-txt3)]">{label}</div>
        {hint && <div className="mt-0.5 text-[9px] leading-snug text-[var(--hx-label)]">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Select({ value, onChange, options, ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; ariaLabel: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 max-w-[190px] rounded-lg border border-[var(--hx-line2)] bg-[var(--hx-card2)] px-2 text-[10.5px] text-[var(--hx-txt)] outline-none"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function VoiceSettingsCard() {
  const v = useHaloVoice();
  const [name, setName] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const nameValue = name ?? v.profile.displayName;
  const phraseValue = phrase ?? v.profile.wakePhrase;

  const saveName = async () => {
    setSavingName(true);
    await v.saveProfile({ displayName: nameValue });
    setSavingName(false);
  };

  const savePhrase = async () => {
    await v.saveProfile({ wakePhrase: phraseValue });
  };

  // hear the selected voice before committing to it — the sample is fixed
  // text spoken with the CURRENT prefs (the select has already updated them)
  const previewVoice = () => {
    const label = NEURAL_VOICES.find((nv) => nv.id === v.prefs.neuralVoice)?.label ?? "HALO";
    v.speak(`This is ${label}, your personal HALO voice.`, { ignoreMute: true });
  };

  const micChip =
    v.mic === "denied" ? (
      <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.12em]" style={{ background: A.red(0.12), color: C.red }}>
        DENIED
      </span>
    ) : v.mic === "unsupported" ? (
      <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.12em]" style={{ background: A.warn(0.12), color: C.warn }}>
        UNAVAILABLE
      </span>
    ) : (
      <span className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.12em]" style={{ background: A.green(0.12), color: C.green }}>
        READY
      </span>
    );

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        borderColor: C.panelLine,
        background: `linear-gradient(180deg, ${C.panel}, ${C.deep})`,
        // layered glass — the exact PanelCard recipe
        boxShadow:
          "inset 0 1px 0 rgba(46,204,255,0.07), inset 0 0 0 1px rgba(46,204,255,0.02), 0 12px 32px rgba(3,8,18,0.45), 0 2px 8px rgba(3,8,18,0.35)",
      }}
    >
      <div className="flex items-center justify-between border-b border-[var(--hx-line)] px-4 py-3">
        <span className="text-xs font-bold tracking-wider text-[var(--hx-txt)]">HALO VOICE &amp; PROFILE</span>
        <span className="flex items-center gap-1 text-[9px] font-bold tracking-[0.14em]" style={{ color: v.status === "online" ? C.cyan : v.status === "offline" ? C.red : C.muted }}>
          <ShieldCheck size={11} />
          READ-ONLY · {v.status.toUpperCase()}
        </span>
      </div>

      <div className="px-4 py-1">
        {/* ── profile ── */}
        <Row label="Preferred name" hint="Used in greetings and speech. Leave empty to be called “Trader”.">
          <Input
            value={nameValue}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bismark"
            className="h-8 w-[150px] border-[var(--hx-line2)] bg-[var(--hx-card2)] text-[11px] text-[var(--hx-txt)] placeholder:text-[var(--hx-label)]"
            aria-label="Preferred name"
          />
          <button
            type="button"
            onClick={() => void saveName()}
            disabled={savingName || (name === null && !v.profile.hasName)}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.12em] disabled:opacity-40"
            style={{ borderColor: A.gold(0.45), background: A.gold(0.1), color: C.gold }}
          >
            <Save size={11} /> SAVE
          </button>
        </Row>

        {/* ── voice master ── */}
        <Row label="HALO voice" hint="Spoken welcome + spoken replies. Turning it off also stops wake-word listening.">
          <Switch checked={v.profile.voiceEnabled} onCheckedChange={(c) => (c ? void v.enableVoice() : void v.disableVoice())} aria-label="Enable HALO voice" />
        </Row>

        <Row
          label="Automatic welcome"
          hint="Raise the personalized welcome when a session starts — spoken where the browser allows, with a text alternative when it doesn't."
        >
          <Switch
            checked={v.profile.autoGreeting}
            onCheckedChange={(c) => void v.saveProfile({ autoGreeting: c })}
            aria-label="Automatic spoken welcome"
          />
        </Row>

        <Row
          label="Welcome style"
          hint="Auto plays the full welcome on your first opening, then the short welcome-back on later sessions. Full / Short force one style every time."
        >
          <Select
            value={v.prefs.welcomeStyle}
            onChange={(val) => v.setPrefs({ welcomeStyle: val as "auto" | "full" | "short" })}
            options={[
              { value: "auto", label: "Auto — full once, then short" },
              { value: "full", label: "Always full welcome" },
              { value: "short", label: "Always short welcome-back" },
            ]}
            ariaLabel="Welcome style"
          />
        </Row>

        <Row
          label="Reply verbosity"
          hint="Brief keeps returns silent and trims chatter; Balanced is the default co-pilot; Detailed favours complete spoken summaries."
        >
          <Select
            value={v.prefs.verbosity}
            onChange={(val) => v.setPrefs({ verbosity: val as "brief" | "balanced" | "detailed" })}
            options={[
              { value: "brief", label: "Brief" },
              { value: "balanced", label: "Balanced" },
              { value: "detailed", label: "Detailed" },
            ]}
            ariaLabel="Reply verbosity"
          />
        </Row>

        {/* ── audio prefs (this device) ── */}
        <Row
          label="Voice engine"
          hint={
            v.prefs.engine === "neural"
              ? "Natural neural voice — generated server-side, far more human than OS voices. Falls back to the browser voice if offline."
              : "Browser voices from your operating system — robotic but fully offline."
          }
        >
          <div className="flex overflow-hidden rounded-lg" style={{ boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
            <button
              type="button"
              onClick={() => v.setPrefs({ engine: "neural" })}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.1em] transition-colors"
              style={{
                background: v.prefs.engine === "neural" ? A.cyan(0.16) : "transparent",
                color: v.prefs.engine === "neural" ? C.cyan : C.muted,
              }}
              aria-pressed={v.prefs.engine === "neural"}
            >
              <AudioLines size={11} /> NATURAL
            </button>
            <button
              type="button"
              onClick={() => v.setPrefs({ engine: "browser" })}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.1em] transition-colors"
              style={{
                background: v.prefs.engine === "browser" ? A.blue(0.16) : "transparent",
                color: v.prefs.engine === "browser" ? C.blue : C.muted,
              }}
              aria-pressed={v.prefs.engine === "browser"}
            >
              BROWSER
            </button>
          </div>
        </Row>

        {v.prefs.engine === "neural" && (
          <Row
            label="Natural voice"
            hint={`${NEURAL_VOICES.find((nv) => nv.id === v.prefs.neuralVoice)?.hint ?? "natural neural voice"} · generated on the server, cached on this device.`}
          >
            <select
              value={v.prefs.neuralVoice}
              onChange={(e) => v.setPrefs({ neuralVoice: e.target.value })}
              className="h-8 max-w-[190px] rounded-lg border border-[var(--hx-line2)] bg-[var(--hx-card2)] px-2 text-[10.5px] text-[var(--hx-txt)] outline-none"
              aria-label="Natural voice selection"
            >
              {NEURAL_VOICES.map((nv) => (
                <option key={nv.id} value={nv.id}>
                  {nv.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={previewVoice}
              className="flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.1em]"
              style={{ borderColor: A.cyan(0.45), background: A.cyan(0.08), color: C.cyan }}
              title="Hear a short sample with this voice"
            >
              <Play size={10} /> PREVIEW
            </button>
          </Row>
        )}

        <Row label="Volume" hint={`Reply volume ${Math.round(v.prefs.volume * 100)}% — stored on this device.`}>
          <Volume2 size={12} color={C.cyan} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={v.prefs.volume}
            onChange={(e) => v.setPrefs({ volume: Number(e.target.value) })}
            className="w-[120px] accent-[var(--hx-cyan)]"
            aria-label="Voice volume"
          />
        </Row>

        <Row label="Speaking speed" hint={`${v.prefs.rate.toFixed(2)}× — applies to both the natural and browser voices.`}>
          <input
            type="range"
            min={0.7}
            max={1.4}
            step={0.02}
            value={v.prefs.rate}
            onChange={(e) => v.setPrefs({ rate: Number(e.target.value) })}
            className="w-[120px] accent-[var(--hx-cyan)]"
            aria-label="Speaking rate"
          />
        </Row>

        {v.prefs.engine === "browser" && v.voices.length > 0 && (
          <Row label="Browser voice" hint="Voices provided by your operating system / browser.">
            <select
              value={v.prefs.voiceURI}
              onChange={(e) => v.setPrefs({ voiceURI: e.target.value })}
              className="h-8 max-w-[190px] rounded-lg border border-[var(--hx-line2)] bg-[var(--hx-card2)] px-2 text-[10.5px] text-[var(--hx-txt)] outline-none"
              aria-label="Voice selection"
            >
              {v.voices.map((vo) => (
                <option key={vo.uri} value={vo.uri}>
                  {vo.label}
                </option>
              ))}
            </select>
          </Row>
        )}

        <Row label="Test & replay" hint="Try the engine or hear the personalized welcome again.">
          <button
            type="button"
            onClick={v.testVoice}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.12em]"
            style={{ borderColor: A.cyan(0.45), background: A.cyan(0.08), color: C.cyan }}
          >
            <Play size={11} /> TEST VOICE
          </button>
          <button
            type="button"
            onClick={v.replayWelcome}
            className="flex items-center gap-1 rounded-lg border border-[var(--hx-line2)] px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.12em] text-[var(--hx-muted)]"
          >
            <RotateCcw size={11} /> REPLAY WELCOME
          </button>
        </Row>

        {/* ── wake word ── */}
        <Row
          label="Wake word listening"
          hint={
            v.mic === "denied"
              ? "Microphone permission denied — allow it in the browser's site settings, then re-enable."
              : "Keeps the mic on standby for the wake phrase. Your browser's speech service processes audio; HALO never records or stores it."
          }
        >
          {micChip}
          <Switch
            checked={v.profile.wakeEnabled && v.profile.voiceEnabled}
            disabled={v.mic === "unsupported" || !v.profile.voiceEnabled}
            onCheckedChange={(c) => (c ? void v.enableWake() : void v.disableWake())}
            aria-label="Enable wake word"
          />
        </Row>

        <Row label="Wake phrase" hint={`Default “halo”. Say “${phraseValue || "halo"}” (or “hey ${phraseValue || "halo"}”) to start talking.`}>
          <Input
            value={phraseValue}
            maxLength={24}
            onChange={(e) => setPhrase(e.target.value)}
            className="h-8 w-[120px] border-[var(--hx-line2)] bg-[var(--hx-card2)] text-[11px] text-[var(--hx-txt)]"
            aria-label="Wake phrase"
          />
          <button
            type="button"
            onClick={() => void savePhrase()}
            disabled={phrase === null}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.12em] disabled:opacity-40"
            style={{ borderColor: A.gold(0.45), background: A.gold(0.1), color: C.gold }}
          >
            <Save size={11} /> SAVE
          </button>
        </Row>

        <Row
          label="Listening mode"
          hint="Always on — HALO never sleeps on silence. Say the wake phrase any time; after every answer it returns to standby by itself. A session ends only with “goodbye HALO / stop listening / go to sleep”, the console close button, or by turning HALO voice off."
        >
          <span
            className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.14em]"
            style={{ background: A.cyan(0.12), color: C.cyan }}
            title="HALO is permanently ready for the wake word — no silence timeout exists anymore"
          >
            ALWAYS ON
          </span>
        </Row>

        <Row label="Microphone" hint="Grant or re-check mic access for wake-word + push-to-talk. Nothing is recorded.">
          {v.mic === "denied" ? <MicOff size={13} color={C.red} /> : <Mic size={13} color={C.cyan} />}
          <button
            type="button"
            onClick={() => void v.requestMic()}
            className="rounded-lg border px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.12em]"
            style={{ borderColor: A.cyan(0.45), background: A.cyan(0.08), color: C.cyan }}
          >
            {v.mic === "denied" ? "RE-CHECK PERMISSION" : "ALLOW MICROPHONE"}
          </button>
        </Row>
      </div>

      <div className="border-t border-[var(--hx-line)] bg-[var(--hx-bg)]/60 px-4 py-2 text-[8.5px] leading-relaxed tracking-wide text-[var(--hx-label)]">
        HALO&apos;s assistant is read-only: it can explain markets, strategy state, risk and trades, but it can never place, close or modify orders, and it can never change
        risk limits or strategy settings. Trading actions remain on the dashboard controls only.
      </div>
    </div>
  );
}
