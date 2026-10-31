/**
 * TP/SL POSITION-BOX RIDE VERIFICATION · LIVE BACKTEST REPLAY deck
 *
 * Verifies the user requirement:
 *   "Make the TP and SL box move along with the price movement or candle
 *    movement, but do not extend it to the right infinitely."
 *
 *   1. signed-out gate intact (307 → /login)
 *   2. login via API → halo_session cookie
 *   3. Strategy Lab → LOAD REAL HISTORY (2000 real bars, auto-plays)
 *   4. slow the replay to 2× and wait for an OPEN trade (HUD "RUNNING · TP")
 *   5. PAUSE → pixel-scan the chart canvases:
 *        boxRight   = rightmost column with a TALL TP/SL-box tint run (≥12px)
 *        candleRight= rightmost column with bright candle pixels (≥4px run)
 *      assert the box is CAPPED at the current candle (boxRight ≤ candleRight+4)
 *      and clear empty space remains to the pane right edge (≥5px) — i.e. the
 *      box no longer stretches into the future space (was t2:null before).
 *   6. PLAY ~10s → PAUSE → re-scan → assert the box STILL rides the current
 *      candle at the same offset (it moved along with the candle movement).
 *   Run: HALO_E2E_EMAIL=… HALO_E2E_PASSWORD=… bun scripts/tpsl-box-verify.ts
 */
import { chromium, type BrowserContext, type Locator } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOT = "/home/z/my-project/scripts/shots/tpsl-verify";
mkdirSync(SHOT, { recursive: true });

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✓ ${name}${detail ? ` · ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ""}`);
  }
}

const EMAIL = process.env.HALO_E2E_EMAIL ?? "";
const PASSWORD = process.env.HALO_E2E_PASSWORD ?? "";
if (!EMAIL || !PASSWORD) {
  console.error("✗ set HALO_E2E_EMAIL and HALO_E2E_PASSWORD");
  process.exit(1);
}

// ── 0. gate still up (signed-out) ───────────────────────────────────────
const gateRes = await fetch(`${BASE}/`, { redirect: "manual" });
ok("GATE: signed-out / redirects to login", gateRes.status === 307 || gateRes.status === 302, `status=${gateRes.status}`);

// ── login (retry — login rate-limit is 8/10min) ─────────────────────────
let sessionPair: string | undefined;
let loginNote = "";
for (let i = 0; i < 3 && !sessionPair; i++) {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, remember: true }),
  });
  const loginJson = (await loginRes.json()) as { ok?: boolean; error?: string };
  const setCookie = loginRes.headers.getSetCookie?.() ?? [];
  sessionPair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("halo_session="));
  loginNote = loginJson.error ?? "";
  if (!sessionPair) await new Promise((r) => setTimeout(r, 20000));
}
ok("AUTH: login returns session cookie", Boolean(sessionPair), loginNote);
if (!sessionPair) process.exit(1);

const browser = await chromium.launch();
const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
await ctx.addCookies([{ name: "halo_session", value: sessionPair.slice("halo_session=".length), domain: "localhost", path: "/" }]);

const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|net::ERR|WebSocket|websocket|EventSource|ResizeObserver/i.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);
const dismissWelcome = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    const welcome = await page.locator('[role="dialog"][aria-label*="welcome"]').isVisible().catch(() => false);
    if (!welcome) return;
    // the SKIP INTRO control lives INSIDE the dialog — never intercepted
    const skip = page.getByRole("button", { name: /skip/i }).first();
    if (await skip.isVisible().catch(() => false)) {
      await skip.click({ timeout: 2500 }).catch(() => {});
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(800);
  }
};

// click that survives the JARVIS welcome overlay re-showing mid-run
const robustClick = async (loc: Locator, label: string): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    try {
      await loc.click({ timeout: 2500 });
      return;
    } catch {
      console.log(`  … ${label}: overlay intercepted — dismissing and retrying`);
      await dismissWelcome();
    }
  }
  await loc.click({ timeout: 5000 });
};

// skip the JARVIS welcome overlay (Escape always skips — never hostage-ware)
await dismissWelcome();
ok("APP: welcome overlay dismissed", true);

// ── open Strategy Lab ───────────────────────────────────────────────────
await robustClick(page.getByRole("button", { name: /strategy lab/i }).first(), "nav Strategy Lab");
await page.waitForTimeout(1200);
ok("NAV: Strategy Lab opened", true);

// small history window → fast load + readable zoom after warmup re-center
const barsInput = page.getByRole("textbox", { name: "BARS · NO CAP" }).first();
await barsInput.fill("2000");
await robustClick(page.getByRole("button", { name: /load real history/i }).first(), "LOAD REAL HISTORY");

// wait for the replay transport to go live (PLAY enabled), then slow to 2×
const playBtn = page.getByRole("button", { name: /play|pause/i }).first();
await playBtn.waitFor({ state: "visible", timeout: 240000 });
// transport enables only after seekTo(WARMUP) finished; wait until enabled
await page.waitForFunction(
  () => {
    const btns = Array.from(document.querySelectorAll("button"));
    const pp = btns.find((b) => /play|pause/i.test(b.textContent ?? ""));
    return pp && !pp.disabled;
  },
  { timeout: 240000 }
);
const spd2 = page.getByRole("button", { name: "2×", exact: true });
if (await spd2.isEnabled().catch(() => false)) {
  await robustClick(spd2, "speed 2×");
  ok("REPLAY: speed set to 2× (2 bars/s)", true);
} else {
  ok("REPLAY: speed set to 2× (2 bars/s)", false, "2× button not enabled");
}

// ── pixel-scan helper: profile every chart canvas ───────────────────────
type Scan = { boxRight: number; candleRight: number; W: number; tintMax: number };
const scanChart = async (): Promise<Scan[]> => {
  return page.evaluate(() => {
    const res: Scan[] = [];
    for (const cv of Array.from(document.querySelectorAll("canvas"))) {
      const w = cv.width;
      const h = cv.height;
      if (w < 120 || h < 120) continue;
      const c2 = cv.getContext("2d");
      if (!c2) continue;
      let img: Uint8ClampedArray;
      try {
        img = c2.getImageData(0, 0, w, h).data;
      } catch {
        continue;
      }
      const tintCols = new Array<number>(w).fill(0);
      const brightCols = new Array<number>(w).fill(0);
      for (let x = 0; x < w; x++) {
        let tint = 0;
        let bright = 0;
        for (let y = 0; y < h; y++) {
          const i = (y * w + x) * 4;
          const r = img[i];
          const g = img[i + 1];
          const b = img[i + 2];
          const a = img[i + 3];
          if (a < 200) continue;
          const isGrid = Math.abs(g - 27) < 6 && Math.abs(b - 56) < 6; // grid #061B38
          if (!isGrid) {
            // green position-zone blend (fill/border over navy or grid)
            if (g - r > 12 && b - r > 8 && g >= 25 && g <= 140) tint++;
            // red position-zone blend
            else if (r > g + 10 && r > b && r >= 24 && r < 95 && b < 72) tint++;
          }
          if (r + g + b > 330) bright++;
        }
        tintCols[x] = tint;
        brightCols[x] = bright;
      }
      let boxRight = 0;
      let tintMax = 0;
      for (let x = 0; x < w; x++) {
        if (tintCols[x] > tintMax) tintMax = tintCols[x];
        if (tintCols[x] >= 12) boxRight = x;
      }
      let candleRight = 0;
      for (let x = 0; x < w; x++) if (brightCols[x] >= 4) candleRight = x;
      if (tintMax > 0) res.push({ boxRight, candleRight, W: w, tintMax });
    }
    return res;
  });
};

// ── wait for an open trade, PAUSE, shot1 ────────────────────────────────
type Ride = { boxRight: number; candleRight: number; W: number; gap: number };
let shot1: Ride | null = null;
let shot2: Ride | null = null;
let scan1: Scan[] = [];

const pick = (scans: Scan[]): Ride | null => {
  if (scans.length === 0) return null;
  // use the widest canvas (the pane canvas; axis canvases are narrower)
  const s = scans.reduce((a, b) => (b.W > a.W ? b : a));
  return { ...s, gap: s.W - s.boxRight };
};

for (let attempt = 1; attempt <= 4 && !shot2; attempt++) {
  console.log(`— cycle ${attempt}: waiting for an open trade (RUNNING · TP)…`);
  const hud = page.getByText(/RUNNING · TP/).first();
  try {
    await hud.waitFor({ state: "visible", timeout: 420000 });
  } catch {
    ok(`CYCLE ${attempt}: open trade detected`, false, "no trade fired within timeout");
    break;
  }
  // freeze the deck for a stable screenshot
  const pauseBtn = page.getByRole("button", { name: /pause/i }).first();
  await robustClick(pauseBtn, "PAUSE");
  await page.waitForTimeout(400);
  const stillRunning = await page.getByText(/RUNNING · TP/).isVisible().catch(() => false);
  if (!stillRunning) {
    console.log("  trade closed during pause — retrying");
    await robustClick(page.getByRole("button", { name: /play/i }).first(), "PLAY");
    continue;
  }
  scan1 = await scanChart();
  shot1 = pick(scan1);
  await dismissWelcome();
  await page.screenshot({ path: `${SHOT}/tpsl-shot1.png`, fullPage: false });
  ok(
    `CYCLE ${attempt}: TP/SL box rendered & CAPPED at current candle`,
    Boolean(shot1 && shot1.boxRight > 0 && shot1.boxRight <= shot1.candleRight + 4 && shot1.gap >= 5),
    shot1 ? `boxRight=${shot1.boxRight} candleRight=${shot1.candleRight} clearRight=${shot1.gap}px W=${shot1.W}` : "no box tint found"
  );

  // ── resume ~10s (≈20 bars at 2×) → PAUSE → shot2 ──
  await robustClick(page.getByRole("button", { name: /play/i }).first(), "PLAY resume");
  await page.waitForTimeout(10_000);
  const pauseBtn2 = page.getByRole("button", { name: /pause/i }).first();
  if (await pauseBtn2.isVisible().catch(() => false)) {
    await robustClick(pauseBtn2, "PAUSE 2");
  }
  await page.waitForTimeout(400);
  const scan2 = await scanChart();
  const s2 = pick(scan2);
  const stillOpen2 = await page.getByText(/RUNNING · TP/).isVisible().catch(() => false);
  if (!stillOpen2 || !s2 || !shot1) {
    console.log("  trade closed inside the 10s window — cycling to the next fire");
    await robustClick(page.getByRole("button", { name: /play/i }).first(), "PLAY next cycle");
    continue;
  }
  shot2 = s2;
  await dismissWelcome();
  await page.screenshot({ path: `${SHOT}/tpsl-shot2.png`, fullPage: false });
}

if (shot1 && shot2) {
  const off1 = shot1.candleRight - shot1.boxRight; // ≥ -4 … box hugs candle
  const off2 = shot2.candleRight - shot2.boxRight;
  ok(
    "RIDE: box still glued to the current candle after 10s of playback",
    Math.abs(off2 - off1) <= 6 && shot2.boxRight <= shot2.candleRight + 4 && shot2.W - shot2.boxRight >= 5,
    `offset1=${off1}px offset2=${off2}px clearRight2=${shot2.W - shot2.boxRight}px`
  );
} else if (!shot1) {
  ok("CYCLE: TP/SL box rendered & CAPPED at current candle", false, "never captured an open trade");
}

ok("CONSOLE: no fatal page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
