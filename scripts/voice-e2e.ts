/**
 * HALO voice E2E · always-live + screen-wake recognition (final v2)
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
 *    mic-independent observable of the session lifecycle.
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
  await ctx.grantPermissions(["microphone"], { origin: URL });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));

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

  // ── 2. ALWAYS-LIVE: session stays open past the 12s silence window ──
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("halo-voice-prefs.v1") || "{}");
    p.liveMode = true;
    localStorage.setItem("halo-voice-prefs.v1", JSON.stringify(p));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Open HALO console"));
    (b as HTMLElement)?.click();
  });
  await page.waitForTimeout(2000);
  const opened = await panelOpen();
  await page.waitForTimeout(16000); // > 12s old silence window
  const stillOpen = await panelOpen();
  ok("ALWAYS-LIVE: session still open after 16s silence (liveMode ON)", opened && stillOpen, `opened=${opened} stillOpen=${stillOpen}`);
  await page.screenshot({ path: `${SHOT}/voice-e2e-2-always-live.png` });

  // ── 3. SCREEN-WAKE: synthetic visibility cycle (handler-level) ──
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

  // ── 5. REGRESSION: liveMode OFF → silence window closes session again ──
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("halo-voice-prefs.v1") || "{}");
    p.liveMode = false;
    localStorage.setItem("halo-voice-prefs.v1", JSON.stringify(p));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Open HALO console"));
    (b as HTMLElement)?.click();
  });
  await page.waitForTimeout(2000);
  const opened2 = await panelOpen();
  await page.waitForTimeout(15000); // > 12s window
  const closed2 = await page.evaluate(() => {
    const launcher = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith("Open HALO console"));
    return !document.querySelector('[aria-label="HALO JARVIS console"]') && !!launcher;
  });
  ok("REGRESSION: liveMode OFF → 12s silence still ends the session", opened2 && closed2, `opened=${opened2} closed=${closed2}`);

  ok("NO PAGE ERRORS: zero uncaught exceptions across all scenarios", errors.length === 0, errors.join(" | ").slice(0, 160));

  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => {
  console.error(results.join("\n"));
  console.error("SCRIPT-ERROR:", String(e).slice(0, 300));
  process.exit(1);
});
