# HALO Voice — Personalized Welcome, Auto-Greeting & Wake Word

Delivery documentation for the JARVIS-style voice experience added to HALO 3EL
Autotrader. **No trading behaviour, strategy parameters, risk controls, broker
integration or settings logic was changed** — the voice layer is presentation
only and talks exclusively to the pre-existing read-only assistant core.

---

## 1. Voice technology selected

| Concern | Choice | Why |
|---|---|---|
| Text-to-speech | **Two engines, one contract.** Default: **neural voice** — `/api/halo/tts` generates natural 24 kHz server-side neural WAV (z-ai SDK, no client keys), cached server- and client-side, with a 7-voice picker (HALO James default). Fallback: browser **SpeechSynthesis** (Web Speech API). Neural failures (offline, 5xx, timeout) degrade transparently to the browser voice — a network hiccup can lower the voice quality but can never silence HALO. The `speaking` state is only ever set while audio is ACTUALLY playing | The OS voices sound robotic; the neural voice sounds human. The browser engine remains for offline resilience and as an explicit choice in Settings → Voice engine (NATURAL / BROWSER) |
| Speech input / wake word | Browser **SpeechRecognition** (`SpeechRecognition` / `webkitSpeechRecognition`) in continuous mode | Only practical option in a pure web app; Chrome/Edge/Android support it. **Not fully local**: the browser vendor's speech service processes audio. HALO never records, stores, or transmits mic audio itself |
| Brain | Existing `/api/halo/assistant` (z-ai SDK, server-side keys) | Already grounded in verified snapshots + rate-limited; extended with trader-name injection and a `mode:"voice"` short-reply addendum |
| Profile store | New Prisma `TraderProfile` singleton (SQLite) | No auth system exists in the project; server-backed so name + consents survive devices. Strictly additive table |

## 2. Files changed / created

**Created**
- `prisma/schema.prisma` — added `TraderProfile` model (additive push, all trading tables verified intact)
- `src/app/api/halo/profile/route.ts` — GET/PUT profile, strict name/phrase sanitization
- `src/lib/halo/greeting.ts` — pure greeting engine: time bands, 3 rotating variants, honest status clauses, wake ack + standby lines
- `src/lib/halo/speech.ts` — Web Speech typings, wake-phrase matcher (with "halo" mishear table), echo guard
- `src/components/halo/voice-provider.tsx` — app-wide voice brain: TTS with autoplay watchdog, once-per-session greeting, **always-on wake-word standby loop** (never auto-sleeps; re-arms after every answer, error or closed session), conversation turn-taking, exit phrases, barge-in interruption, 30 s brain-call timeout, wake+command single-utterance handling ("HALO, what's the gold price?"), transcript persistence
- `src/components/halo/welcome-greeting.tsx` — personalized welcome banner (full once per session → slim strip), Enable-voice onboarding, tap-to-retry chip, status chips, waveform
- `src/components/halo/voice-settings-card.tsx` — Settings card: name, voice/auto-welcome toggles, volume/speed/voice, test + replay, wake word + phrase, locked ALWAYS-ON listening mode indicator, mic permission
- `docs/VOICE-ASSISTANT.md` — this document

**Modified**
- `src/components/halo/jarvis-console.tsx` — rewritten as UI over the provider (transcript with timestamps + wake/greeting entries, mic session toggle, honest mic states)
- `src/components/halo/halo-core.tsx` — wake-word telemetry row, personalized identity line, provider-driven voice state
- `src/app/page.tsx` — `HaloVoiceProvider` wrapper, welcome row, settings card, removed old per-console voice plumbing
- `src/app/api/halo/assistant/route.ts` — name injection (server-side) + voice-mode reply rules. Read-only guarantees unchanged

## 3. Experience flow

1. **First visit** — banner greets by stored name (or "Trader" + PERSONALIZE button), shows `ENABLE HALO VOICE`. No mic is touched.
2. **Enable** — one click saves consent server-side and speaks the welcome immediately (user gesture ⇒ autoplay permitted).
3. **Return visits** — greeting is spoken automatically ~2.8 s after load (after the boot sequence). If the browser blocks autoplay, a `TAP ONCE TO ENABLE VOICE` chip retries on the next interaction. No hidden repeat audio; mute/consent always respected; once per browser session (refresh-safe).
4. **Wake word — always listening** — once enabled, the standby loop runs permanently: say "HALO" any time (configurable phrase; "hey HALO" also works) and HALO wakes instantly. "HALO, what's the gold price?" in one breath wakes AND carries the request. After every answer, error or closed session the mic re-arms by itself — ready for the next wake word. A session ends only via "goodbye HALO / stop listening / go to sleep", the console close button, mute or voice off — **never** a silence timeout (the old 12 s auto-standby was removed entirely).
5. **Conversation** — grounded read-only answers, spoken (short voice-mode replies) and transcribed with timestamps + `grounded · verified` stamps. Speaking stops automatically when the trader talks over it (echo-filtered barge-in) or when any control is used.

## 4. Safety boundaries (unchanged, enforced)

- Assistant remains **read-only**: it cannot place/close/modify orders or change any setting; voice/typed requests are never treated as authorization.
- Wake word/conversation never touches `/api/bot/control` or `/api/bot/config`.
- LLM keys stay server-side; profile name is sanitized server-side; mic audio is never stored.
- Disabling voice also stops wake listening immediately; closing the tab tears down mic + audio.

## 5. Test results (executed 2026-10-29, headless Chromium 144 + curl; screenshots in `download/test-*.png`)

| # | Test | Result |
|---|---|---|
| 1 | First visit, voice not enabled | ✅ full banner + name + ENABLE HALO VOICE (`test-01`) |
| 2 | First-time voice activation | ✅ consent saved server-side, welcome spoken (transcript entry) + controls flip to REPLAY/TEST (`test-02`) |
| 3 | Personalized greeting content | ✅ name from profile, time band correct, verified engine clauses only (open BUY disclosed), no unverified health claims (`test-02/07`) |
| 4 | Missing trader name | ✅ sanitizer strips injected `<script>` payload; UI falls back to "Trader" + personalize affordance (curl test) |
| 5 | Return visit auto greeting | ✅ new tab greeted automatically, no click (`test-07`); refresh does **not** duplicate greeting (sessionStorage guard, `test-06`) |
| 6 | Full banner → slim strip | ✅ collapses after first session display (`test-06`) |
| 7 | Autoplay blocked fallback | ⚠️ partially executed — headless Chromium plays speech silently (no audio stack), so the watchdog path did not trigger; logic reviewed, real-browser manual check recommended |
| 8 | Muted/disabled voice | ✅ disable stops speech + wake loop (code path exercised via settings toggle) |
| 9 | Mic permission denied | ✅ honest DENIED chip, re-check button, transcript disclosure, text fallback (`test-05`, `test-10`) |
| 10 | Successful wake detection | ❌ **not executed** — requires real microphone + audio; headless has no mic. Matcher unit logic reviewed only |
| 11 | Wake false positives / duplicate activations | ❌ not executed (same reason); cooldown (4 s) + echo guard implemented |
| 12 | Conversation follow-ups & interruption | ⚠️ turn-taking verified via text chat (`test-03`); voice-side barge-in not executable headless |
| 13 | Unsupported browser / no mic | ✅ capability detection → text-only mode disclosed (`test-10`) |
| 14 | Assistant/network failure | ✅ error surfaced in transcript (connection-loss path) |
| 15 | Stale data / degraded feed | ✅ greeting + assistant disclose degraded feed/simulator & broker errors (seen: "Recent broker shows authorization errors, but paper mode is active") |
| 16 | Sensitive trading commands | ✅ by construction — assistant prompt hard-rule + no execution tools server-side |
| 17 | Trading strategy/execution/risk unchanged | ✅ EA stop→start via UI works (`test-09`), open BUY untouched, `db.trade.count()` intact, engine/state APIs untouched |

## 6. Setup steps

1. `bunx prisma db push` (already run — `TraderProfile` created; additive).
2. No env vars added; the assistant keeps using the existing server-side z-ai credentials.
3. Users opt in via **ENABLE HALO VOICE** (banner) and optionally **wake word** (Settings → HALO Voice & Profile).

## 7. Remaining limitations

- Wake-word recognition runs on the browser's speech service (Chrome/Edge/Android recommended; Firefox has no SpeechRecognition → push-to-talk unavailable there too, text chat always works). It requires the tab to be visible and permitted; background tabs pause standby and resume instantly on return.
- Wake detection needs a real microphone test in your environment; if "HALO" misfires in noisy rooms, set a custom wake phrase in Settings.
- Voice quality depends on OS-installed voices (pick a different voice in Settings → Voice).
- Chrome may auto-end continuous recognition sessions; the loop restarts automatically (backoff on repeated errors).
- There is no authenticated-account system in the project; the "profile" is a single server-side singleton, so any visitor of this deployment shares the same name/consents. When real auth is added, `TraderProfile` should get a user foreign key.
- Nothing was deployed to production (per your instruction) — dev-server verification only.
