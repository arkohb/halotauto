/**
 * HALO personalized welcome E2E · JARVIS-style welcome experience
 * Run: Xvfb :99 then DISPLAY=:99 bun scripts/welcome-e2e.ts
 *
 * Honest scope notes:
 *  • Browser speechSynthesis/neural playback is exercised only indirectly:
 *    headless Chromium has no audible output; the overlay logic, session
 *    rules, personalization and time-band selection are asserted from the
 *    DOM, which is exactly what they render from.
 *  • The trader profile is SERVER-side (shared across contexts) — each test
 *    sets it via the real API and restores it afterwards.
 *  • Time-of-day is pinned by patching Date.getHours in an init script
 *    (the greeting reads the LOCAL clock, so the patch is the honest lever).
 */
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const URL = "http://localhost:3000";
const SHOT = "/home/z/my-project/download";
const results: string[] = [];
const ok = (name: string, pass: boolean, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

const DIALOG = '[role="dialog"][aria-label*="welcome"]';

async function setProfile(patch: Record<string, unknown>) {
  const r = await fetch(`${URL}/api/halo/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await r.json()) as { ok: boolean };
}

const hourShim = (h: number) => `
  (() => {
    const orig = Date.prototype.getHours;
    Date.prototype.getHours = function () { return ${h}; };
    window.__hourShim = true;
  })();
`;

async function newPage(ctx: { newPage: () => Promise<import("playwright").Page> }, hour?: number) {
  const page = await ctx.newPage();
  if (hour !== undefined) await page.addInitScript(hourShim(hour));
  return page;
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: "chromium",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });

  // ── deterministic baseline: named profile, voice + welcome on ──
  await setProfile({ displayName: "Bismark", voiceEnabled: true, autoGreeting: true, wakeEnabled: false });

  // ══ 1. first opening → FULL personalized welcome, correct time band ══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await newPage(ctx, 9); // 09:00 local → morning
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    let shown = false;
    try {
      await page.waitForSelector(DIALOG, { timeout: 15000 });
      shown = true;
    } catch {
      // ignore
    }
    const hero = shown ? await page.textContent(`${DIALOG} h1`) : "";
    const body = shown ? await page.textContent(DIALOG) : "";
    const personalized = !!hero && hero.includes("Good morning, Bismark");
    const attribution = !!body && body.includes("created by Bismark Arko-Ofori. All rights reserved.");
    const fullScript = !!body && body.includes("protecting your capital is just as important as making a profit");
    ok("FIRST OPEN: full welcome overlay appears", shown);
    ok("FIRST OPEN: personalized 'Good morning, Bismark' headline", personalized, hero?.trim().slice(0, 80));
    ok("FIRST OPEN: creator attribution spoken-script present verbatim", attribution);
    ok("FIRST OPEN: full welcome script shown (relax/capital beats)", fullScript);
    await page.screenshot({ path: `${SHOT}/welcome-e2e-1-full.png` });

    // skip must dismiss immediately and reveal the working dashboard
    const t0 = Date.now();
    await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
    let gone = false;
    try {
      await page.waitForSelector(DIALOG, { state: "detached", timeout: 3000 });
      gone = true;
    } catch {
      gone = !(await page.isVisible(DIALOG));
    }
    const skipMs = Date.now() - t0;
    ok("SKIP: overlay dismissed immediately", gone, `${skipMs}ms`);
    await page.waitForSelector("footer", { timeout: 10000 });
    const dashOk = await page.evaluate(() => !!document.querySelector("footer") && document.body.innerText.length > 400);
    ok("SKIP: dashboard underneath is live (footer + content)", dashOk);

    // footer attribution (spec §5)
    const footer = await page.textContent("footer");
    ok("FOOTER: creator attribution + all rights reserved", !!footer && footer.includes("BISMARK ARKO-OFORI") && footer.includes("ALL RIGHTS RESERVED"), footer?.slice(0, 110));
    await page.screenshot({ path: `${SHOT}/welcome-e2e-2-dashboard.png` });

    // ══ 2. reload in the SAME session → no replay ══
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const replayed = await page.isVisible(DIALOG);
    ok("SAME SESSION: reload does NOT replay the welcome", !replayed);

    // ══ 3. next session (session cleared, same device) → short WELCOME-BACK ══
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    let backShown = false;
    try {
      await page.waitForSelector(DIALOG, { timeout: 15000 });
      backShown = true;
    } catch {
      // ignore
    }
    const backText = backShown ? await page.textContent(DIALOG) : "";
    const isBack = !!backText && backText.includes("Welcome back, Bismark") && backText.includes("How can I assist you today?");
    const noAttribution = !!backText && !backText.includes("All rights reserved");
    ok("NEXT SESSION: short welcome-back appears", backShown);
    ok("NEXT SESSION: welcome-back message + no attribution repeat", isBack && noAttribution, backText?.slice(0, 90));
    await page.screenshot({ path: `${SHOT}/welcome-e2e-3-back.png` });
    await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
    await ctx.close();
  }

  // ══ 4. evening time band (19:00) ══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await newPage(ctx, 19);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    let shown = false;
    try {
      await page.waitForSelector(DIALOG, { timeout: 15000 });
      shown = true;
    } catch {
      // ignore
    }
    const hero = shown ? await page.textContent(`${DIALOG} h1`) : "";
    ok("TIME BAND: 19:00 → 'Good evening, Bismark'", !!hero && hero.includes("Good evening, Bismark"), hero?.trim().slice(0, 60));
    await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
    await ctx.close();
  }

  // ══ 5. no profile name → "Trader" fallback ══
  {
    await setProfile({ displayName: "" });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await newPage(ctx, 9);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    let shown = false;
    try {
      await page.waitForSelector(DIALOG, { timeout: 15000 });
      shown = true;
    } catch {
      // ignore
    }
    const hero = shown ? await page.textContent(`${DIALOG} h1`) : "";
    ok("FALLBACK: unnamed trader greeted as 'Trader'", !!hero && hero.includes("Good morning, Trader"), hero?.trim().slice(0, 60));
    await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
    await ctx.close();
    await setProfile({ displayName: "Bismark" }); // restore
  }

  // ══ 6. welcome style forced SHORT on a first visit (device pref) ══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await newPage(ctx, 9);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("halo-voice-prefs.v1", JSON.stringify({ volume: 0.9, rate: 1.04, voiceURI: "", muted: false, engine: "neural", neuralVoice: "jam", welcomeStyle: "short", verbosity: "balanced" }));
      } catch {
        // ignore
      }
    });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    let shown = false;
    try {
      await page.waitForSelector(DIALOG, { timeout: 15000 });
      shown = true;
    } catch {
      // ignore
    }
    const text = shown ? await page.textContent(DIALOG) : "";
    ok("PREF: welcomeStyle=short forces the welcome-back on first visit", !!text && text.includes("Welcome back"), text?.slice(0, 60));
    await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
    await ctx.close();
  }

  // ══ 7. welcome OFF (autoGreeting=false) → no overlay at all ══
  {
    await setProfile({ autoGreeting: false });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await newPage(ctx, 9);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const shown = await page.isVisible(DIALOG);
    ok("PREF: automatic welcome OFF → no welcome overlay", !shown);
    await ctx.close();
    await setProfile({ autoGreeting: true }); // restore
  }

  // ══ 8. mobile layout: overlay renders and skips on a phone viewport ══
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await newPage(ctx, 9);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    let shown = false;
    try {
      await page.waitForSelector(DIALOG, { timeout: 15000 });
      shown = true;
    } catch {
      // ignore
    }
    const hero = shown ? await page.textContent(`${DIALOG} h1`) : "";
    ok("MOBILE: welcome renders at 390×844", shown && !!hero && hero.includes("Bismark"), hero?.trim().slice(0, 60));
    await page.screenshot({ path: `${SHOT}/welcome-e2e-4-mobile.png` });
    await page.evaluate(() => (document.querySelector('[data-testid="welcome-skip"]') as HTMLElement)?.click());
    await page.waitForTimeout(1200);
    const gone = !(await page.isVisible(DIALOG));
    ok("MOBILE: skip works on touch layout", gone);
    await ctx.close();
  }

  await browser.close();

  console.log("\n════════ HALO WELCOME E2E RESULTS ════════");
  for (const r of results) console.log(r);
  const fails = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`════════ ${results.length - fails}/${results.length} passed ════════`);
  process.exit(fails > 0 ? 1 : 0);
})();
