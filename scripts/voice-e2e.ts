/**
 * HALO voice E2E · always-listening + wake re-arm + screen-wake recognition
 * Run: Xvfb :99 then DISPLAY=:99 bun scripts/voice-e2e.ts
 *
 * Honest scope notes:
 *  • Chromium's SpeechRecognition cannot pull audio from Chrome's fake capture
 *    device in this sandbox (audio-capture) → live ASR transcripts are NOT
 *    testable here; state-machine tests below are mic-result-independent.
 *  • The virtual display cannot produce native visibilitychange events, so the
 *    screen-wake scenario drives the provider's handler with synthetic
 *    visibilitychange events (handler-level verification of the exact code
 *    that real phone screen-on events trigger).
 *  • The floating JARVIS console panel is bound 1:1 to `convoOpen`, giving a
 *    mic-independent observable of the session lifecycle; the welcome banner's
 *    `“HALO” ARMED` chip is the mic-independent observable of wake standby.
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const SHOT = "/home/z/my-project/download";
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } }); // < xl → floating console
  // ── pre-login (commercial login-first mode): the app now always opens on
  // /login, so the E2E context must carry a real session cookie before any
  // navigation. Credentials come from the environment — never hardcoded.
  const E2E_EMAIL = process.env.HALO_E2E_EMAIL ?? "";
  const E2E_PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
  if (!E2E_EMAIL || !E2E_PASSWORD) {
    console.error("✗ set HALO_E2E_EMAIL and HALO_E2E_PASSWORD (login-first gate is active)");
    await browser.close();
    process.exit(1);
  }
  const loginRes = await fetch(`${URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: E2E_EMAIL, password: E2E_PASSWORD, remember: true }),
  });
  const loginJson = (await loginRes.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
  const setCookies = (loginRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const sessionPair = setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  if (!loginJson.ok || !sessionPair) {
    console.error(`✗ E2E pre-login failed: ${loginJson.error ?? "no halo_session cookie returned"}`);
    await browser.close();
    process.exit(1);
  }
  await ctx.addCookies([{ name: "halo_session", value: sessionPair.slice("halo_session=".length), domain: "localhost", path: "/" }]);
  console.log("✓ E2E pre-login ok — session cookie injected");
  await ctx.grantPermissions(["microphone"], { origin: URL });
  const page = await ctx.newPage();
  const errors: string[] = [];
  const fallbackWarns: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  page.on("console", (m) => {
    if (m.type() === "warning" && m.text().includes("[halo-voice] neural engine unavailable")) {
      fallbackWarns.push(m.text().slice(0, 120));
    }
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const panelOpen = () => page.evaluate(() => !!document.querySelector('[aria-label="HALO JARVIS console"]'));

  // ── 1. wake word arming (Settings → Enable wake word, polled) ──
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Settings");
    (nav as HTMLElement)?.click();
  });
  await page.waitForTimeout(1500);
  const settingsVisible = await page.evaluate(() => document.body.innerText.includes("HALO VOICE & PROFILE"));
  // enable wake only if not already armed (server profile persists across runs)
  await page.evaluate(() => {
    const sw = [...document.querySelectorAll("button[role=switch]")].find((x) => x.getAttribute("aria-label") === "Enable wake word");
    if (sw?.getAttribute("aria-checked") !== "true") (sw as HTMLElement)?.click();
  });
  let wakeArmed = false;
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(600);
    wakeArmed = await page.evaluate(() => {
      const sw = [...document.querySelectorAll("button[role=switch]")].find((x) => x.getAttribute("aria-label") === "Enable wake word");
      return sw?.getAttribute("aria-checked") === "true";
    });
    if (wakeArmed) break;
  }
  const chip = await page.evaluate(() => [...document.querySelectorAll("span")].map((x) => x.textContent).find((t) => t === "READY" || t === "DENIED" || t === "UNAVAILABLE"));
  ok("MIC + WAKE: permission granted and wake word armed", settingsVisible && wakeArmed && chip === "READY", `settings=${settingsVisible} wake=${wakeArmed} chip=${chip}`);
  await page.screenshot({ path: `${SHOT}/voice-e2e-1-wake-armed.png` });

  // ── 2. ALWAYS-ON: session stays open past the old 12s silence window ──
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Open HALO console"));
    (b as HTMLElement)?.click();
  });
  await page.waitForTimeout(2000);
  const opened = await panelOpen();
  await page.waitForTimeout(16000); // > 12s old silence window
  const stillOpen = await panelOpen();
  ok("ALWAYS-ON: session still open after 16s silence (never sleeps)", opened && stillOpen, `opened=${opened} stillOpen=${stillOpen}`);
  await page.screenshot({ path: `${SHOT}/voice-e2e-2-always-on.png` });

  // ── 3. SCREEN-WAKE: synthetic visibility cycle (handler-level) ──
  // the personalized welcome overlay speaks once per session — a real trader
  // has finished (or skipped) it before returning to the desk, so dismiss it
  // here; HALO must never talk over the welcome with a return-ack either way
  await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
  await page.waitForTimeout(1500);
  const welcomeGone = await page.evaluate(() => !document.querySelector('[data-testid="welcome-skip"]'));
  ok("WELCOME: session-start overlay dismissed before the screen-wake scenario", welcomeGone);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(21_000); // away > 20s threshold
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(4000);
  const wb = await page.evaluate(() => {
    try {
      const arr = JSON.parse(localStorage.getItem("halo-jarvis-transcript") || "[]") as { text: string }[];
      return arr.filter((m) => m.text.includes("Welcome back")).slice(-1)[0]?.text ?? "";
    } catch {
      return "";
    }
  });
  ok("SCREEN-WAKE: recognizes return after 21s idle → spoken welcome-back ack", wb.length > 0, `"${wb.slice(0, 64)}"`);
  const panelAfterWake = await panelOpen();
  ok("SCREEN-WAKE: live session survives screen idle (panel still open)", panelAfterWake);
  await page.screenshot({ path: `${SHOT}/voice-e2e-3-welcome-back.png` });

  // ── 4. EXIT PHRASE (typed — same send() contract now shared with voice) ──
  await page.evaluate(() => {
    const input = document.querySelector('[aria-label="HALO JARVIS console"] input[name="q"]') as HTMLInputElement | null;
    if (!input) return "no-input";
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "goodbye HALO");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return "sent";
  });
  await page.waitForTimeout(2500);
  const closedByExit = await page.evaluate(() => !document.querySelector('[aria-label="HALO JARVIS console"]'));
  ok("EXIT PHRASE: “goodbye HALO” ends the live session", closedByExit);
  await page.screenshot({ path: `${SHOT}/voice-e2e-4-exit.png` });

  // ── 5. WAKE RE-ARM: after a session ends, wake standby re-arms itself ──
  // (the silence-timeout regression test was retired — the timer no longer
  //  exists; HALO is permanently listening. This now verifies the other half
  //  of the always-awake contract: idle → ready for the next wake word.)
  await page.evaluate(() => {
    const nav = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Dashboard");
    (nav as HTMLElement)?.click(); // the ARMED chip lives in the welcome banner on the Dashboard view
  });
  await page.waitForTimeout(1500);
  let rearmed = false;
  for (let i = 0; i < 20; i++) {
    rearmed = await page.evaluate(() => document.body.innerText.includes("” ARMED"));
    if (rearmed) break;
    await page.waitForTimeout(600);
  }
  ok("WAKE RE-ARM: after exit phrase, wake-word standby re-arms by itself (< 12s)", rearmed);
  await page.screenshot({ path: `${SHOT}/voice-e2e-5-wake-rearm.png` });

  // ── 6. REGRESSION: prefs no longer carry the removed silence settings ──
  const prefsSanitized = await page.evaluate(() => {
    try {
      const p = JSON.parse(localStorage.getItem("halo-voice-prefs.v1") || "{}");
      return !("liveMode" in p) && !("convoSeconds" in p);
    } catch {
      return false;
    }
  });
  ok("REGRESSION: silence-timeout prefs removed from storage (sanitize on hydrate)", prefsSanitized);

  // ══ SPEAK-BACK REGRESSION SUITE ══════════════════════════════════════
  // The reported bug: “the bot does not speak back when spoken to” — replies
  // died silently when neural TTS was slow/failed. A reply counts as SPOKEN
  // only when the audio element actually plays. These tests drive real turns
  // through the console and observe real playback.
  await page.evaluate(() => {
    const w = window as unknown as { __haloAudio: { plays: { src: string }[] } };
    w.__haloAudio = { plays: [] };
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args: unknown[]) {
      try {
        w.__haloAudio.plays.push({ src: String((this as HTMLMediaElement).src).slice(0, 48) });
      } catch {
        // ignore
      }
      return orig.apply(this, args as []);
    };
  });
  const askHalo = async (q: string) => {
    await page.evaluate((question) => {
      const input = document.querySelector('[aria-label="HALO JARVIS console"] input[name="q"]') as HTMLInputElement | null;
      if (!input) throw new Error("console input not found");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, question);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }, q);
  };
  const lastHaloReply = async () =>
    page.evaluate(() => {
      try {
        const arr = JSON.parse(localStorage.getItem("halo-jarvis-transcript") || "[]") as { role: string; text: string }[];
        return arr.filter((m) => m.role === "halo").slice(-1)[0]?.text ?? "";
      } catch {
        return "";
      }
    });
  const audioPlays = () => page.evaluate(() => (window as unknown as { __haloAudio: { plays: { src: string }[] } }).__haloAudio.plays);

  // console must be open for the typed turns (wake-independent path)
  if (!(await panelOpen())) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Open HALO console"));
      (b as HTMLElement)?.click();
    });
    await page.waitForTimeout(1800);
  }

  // ── 7. VOICE REPLY (fast path): a turn produces REAL audio playback ──
  const playsBefore = (await audioPlays()).length;
  await askHalo("what is my account balance");
  let played = false;
  let replyText = "";
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(750);
    replyText = await lastHaloReply();
    if ((await audioPlays()).length > playsBefore) {
      played = true;
      break;
    }
  }
  ok(
    "VOICE REPLY: asking HALO produces real audio playback (not just text)",
    played && replyText.length > 0 && !replyText.startsWith("⚠"),
    `played=${played} reply="${replyText.slice(0, 56)}"`
  );
  await page.screenshot({ path: `${SHOT}/voice-e2e-7-reply-spoken.png` });

  // ── 8. SLOW NEURAL TTS: a >9s generation must still be SPOKEN ──
  // (the original bug: the old 9s start-abort dropped the reply silently)
  await page.route("**/api/halo/tts", async (route) => {
    await new Promise((r) => setTimeout(r, 12_000));
    await route.continue();
  });
  const playsBeforeSlow = (await audioPlays()).length;
  const warnsBeforeSlow = fallbackWarns.length;
  await askHalo("what is my risk status");
  let slowPlayed = false;
  for (let i = 0; i < 48; i++) {
    await page.waitForTimeout(750);
    if ((await audioPlays()).length > playsBeforeSlow) {
      slowPlayed = true;
      break;
    }
  }
  await page.unroute("**/api/halo/tts");
  ok(
    "SLOW TTS: 12s neural generation still plays the reply (no silent drop)",
    slowPlayed && fallbackWarns.length === warnsBeforeSlow,
    `played=${slowPlayed} warns+${fallbackWarns.length - warnsBeforeSlow}`
  );
  await page.screenshot({ path: `${SHOT}/voice-e2e-8-slow-tts.png` });

  // ── 9. NEURAL FAILURE: the reply degrades to the fallback voice — never silence ──
  await page.route("**/api/halo/tts", (route) => route.abort("failed"));
  const warnsBeforeFail = fallbackWarns.length;
  await askHalo("how many open positions do I have");
  await page.waitForTimeout(6000);
  await page.unroute("**/api/halo/tts");
  const failReply = await lastHaloReply();
  ok(
    "TTS FAILURE: neural outage degrades to the fallback voice (never silent)",
    fallbackWarns.length > warnsBeforeFail && failReply.length > 0 && !failReply.startsWith("⚠"),
    `warns+${fallbackWarns.length - warnsBeforeFail} reply="${failReply.slice(0, 48)}"`
  );
  await page.screenshot({ path: `${SHOT}/voice-e2e-9-tts-fallback.png` });

  // ── 10. ARM-ON-LOAD: a reload with ZERO interaction must re-arm the mic ──
  // (the reported bug: after any reload HALO showed "ARMED" but was deaf —
  //  the wake standby was only ever armed as a side effect of the welcome
  //  speech. Observable here: the provider itself must call rec.start() with
  //  no clicks, no keys, no visibility events — injected before the reload.)
  await page.addInitScript(() => {
    const w = window as unknown as { __haloStarts: number };
    w.__haloStarts = 0;
    const W = window as unknown as {
      SpeechRecognition?: { prototype: { start: () => void } };
      webkitSpeechRecognition?: { prototype: { start: () => void } };
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (Ctor) {
      const orig = Ctor.prototype.start;
      Ctor.prototype.start = function (this: unknown) {
        w.__haloStarts += 1;
        return orig.call(this);
      };
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200); // hydrate; NO interaction of any kind
  let startsOnLoad = 0;
  for (let i = 0; i < 22; i++) {
    startsOnLoad = await page.evaluate(() => (window as unknown as { __haloStarts: number }).__haloStarts);
    if (startsOnLoad > 0) break;
    await page.waitForTimeout(600);
  }
  ok("ARM-ON-LOAD: reload with zero interaction re-arms the wake mic by itself (< 15s)", startsOnLoad > 0, `rec.start() calls=${startsOnLoad}`);
  await page.screenshot({ path: `${SHOT}/voice-e2e-10-arm-on-load.png` });

  ok("NO PAGE ERRORS: zero uncaught exceptions across all scenarios", errors.length === 0, errors.join(" | ").slice(0, 160));

  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => {
  console.error(results.join("\n"));
  console.error("SCRIPT-ERROR:", String(e).slice(0, 300));
  process.exit(1);
});
