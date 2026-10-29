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
import { Mic, MicOff, Play, RotateCcw, Save, ShieldCheck, Volume2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { useHaloVoice } from "./voice-provider";

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
          "inset 0 1px 0 rgba(79,216,255,0.07), inset 0 0 0 1px rgba(79,216,255,0.02), 0 12px 32px rgba(3,8,18,0.45), 0 2px 8px rgba(3,8,18,0.35)",
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

        <Row label="Automatic welcome" hint="Speak the personalized greeting on return visits without a click.">
          <Switch
            checked={v.profile.autoGreeting}
            disabled={!v.profile.voiceEnabled}
            onCheckedChange={(c) => void v.saveProfile({ autoGreeting: c })}
            aria-label="Automatic spoken welcome"
          />
        </Row>

        {/* ── audio prefs (this device) ── */}
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

        <Row label="Speaking speed" hint={`${v.prefs.rate.toFixed(2)}× — browser voices vary.`}>
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

        {v.voices.length > 0 && (
          <Row label="Voice" hint="Voices provided by your operating system / browser.">
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
