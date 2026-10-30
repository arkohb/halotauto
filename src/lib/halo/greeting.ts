// ════════════════════════════════════════════════════════════════════════
//  HALO GREETING ENGINE · personalized welcome scripts (pure, client-safe)
//
//  Builds time-band-aware greeting variants for display + speech.
//
//  HONESTY RULES (mirrors the assistant core):
//  • Every status clause is derived from the verified BotStateRes the
//    dashboard already polls. Nothing is claimed "healthy" unless the
//    corresponding check actually passed.
//  • Degraded feed / simulator / stale tick are disclosed, never glossed.
//  • No trade is ever announced as successful — wins come only from the
//    engine's own event log.
//  • The name is never invented: callers pass hasName=false → "Trader".
// ════════════════════════════════════════════════════════════════════════

import type { BotStateRes } from "./ui-helpers";

export type Band = "morning" | "afternoon" | "evening" | "night";

export interface GreetCtx {
  /** sanitized display name, or "Trader" when the trader hasn't set one */
  name: string;
  /** false when no preferred name is stored — callers may offer personalization */
  hasName: boolean;
  /** wake-word standby consent (changes the closing line) */
  wakeEnabled: boolean;
  /** configured wake phrase, e.g. "halo" */
  wakePhrase: string;
  /** injectable clock for tests */
  now?: Date;
}

export function bandOf(d: Date): Band {
  const h = d.getHours();
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

const BAND_WORD: Record<Band, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Working late",
};

/** Deterministic daily variation index (0..2) so copy rotates day-to-day, not render-to-render. */
export function variantOf(d: Date): number {
  const day = Math.floor(d.getTime() / 86_400_000);
  return day % 3;
}

// ── verified engine clauses ──────────────────────────────────────────────
// Returns short spoken-style sentences strictly derived from the snapshot.
function engineClauses(s: BotStateRes | null): string[] {
  if (!s) return ["I'm still linking to the engine — one moment."];
  const out: string[] = [];
  const feedNote = (s.feed.note || "").toLowerCase();
  const degraded = s.feed.source === "simulator" || /slow|error|unreachable/i.test(feedNote);

  if (degraded) {
    out.push(
      `Heads up — the market feed is currently on ${s.feed.source === "simulator" ? "the built-in simulator" : "a degraded source"}, so treat on-screen prices with care.`
    );
  }

  if (s.engine.trade) {
    out.push(`The engine is managing an open ${s.engine.trade.dir === -1 ? "SELL" : "BUY"} on ${s.symbol}.`);
  } else if (s.enabled && s.engine.levels.length > 0) {
    out.push(`The 3EL engine is armed and watching ${s.engine.levels.length} level${s.engine.levels.length > 1 ? "s" : ""} on ${s.symbol} ${s.tf}.`);
  } else if (s.enabled) {
    out.push(`The 3EL engine is scanning ${s.symbol} on the ${s.tf} chart.`);
  } else {
    out.push("The EA engine is on standby — switch it on from the header whenever you're ready.");
  }

  if (s.exec.executionMode === "live") {
    out.push(`Live order routing is armed via ${s.exec.broker?.label ?? "your broker"}.`);
  }
  return out;
}

/** Short dashboard sub-line (display only) — verified, compact. */
export function statusLine(s: BotStateRes | null): string {
  if (!s) return "Linking to the trading engine…";
  if (s.engine.trade) {
    const dir = s.engine.trade.dir === -1 ? "SELL" : "BUY";
    return `Managing an open ${dir} on ${s.symbol} · risk controls active.`;
  }
  const feedNote = (s.feed.note || "").toLowerCase();
  const degraded = s.feed.source === "simulator" || /slow|error|unreachable/i.test(feedNote);
  const feed = degraded ? ` · feed: ${s.feed.source}` : "";
  if (s.enabled && s.engine.levels.length > 0) return `Engine armed · ${s.engine.levels.length} level(s) watched on ${s.symbol} ${s.tf}${feed}.`;
  if (s.enabled) return `Engine scanning ${s.symbol} ${s.tf}${feed}.`;
  return `EA on standby · ${s.symbol} ${s.tf}${feed}.`;
}

// ── display greeting (banner headline + sub) ─────────────────────────────
export function displayGreeting(s: BotStateRes | null, ctx: GreetCtx): { headline: string; sub: string } {
  const now = ctx.now ?? new Date();
  const band = bandOf(now);
  const v = variantOf(now);
  const name = ctx.name || "Trader";

  const openers = [
    `${BAND_WORD[band]}, ${name}.`,
    `${BAND_WORD[band]}, ${name} — welcome back.`,
    `${BAND_WORD[band]}, ${name}. Good to see you.`,
  ];
  const subs = [
    "Welcome back to HALO 3EL Autotrader.",
    "Your trading co-pilot is online and ready.",
    "Let's review the market, your risk exposure, and today's opportunities.",
  ];

  return { headline: openers[v], sub: subs[v] };
}

// ── spoken welcome script ────────────────────────────────────────────────
// Natural, brief, professional. Structure:
//   1. time-band greeting + name
//   2. what HALO is doing (verified clauses)
//   3. how to talk to HALO (wake phrase if enabled, else tap/type)
export function welcomeScript(s: BotStateRes | null, ctx: GreetCtx): string {
  const now = ctx.now ?? new Date();
  const band = bandOf(now);
  const v = variantOf(now);
  const name = ctx.name || "Trader";
  const phrases = engineClauses(s);

  const openings: Record<Band, string[]> = {
    morning: [
      `Good morning, ${name}. Welcome back to HALO 3EL Autotrader.`,
      `Good morning, ${name}. Your AI trading co-pilot is online.`,
      `Good morning, ${name}. HALO is up and running.`,
    ],
    afternoon: [
      `Good afternoon, ${name}. Welcome back to HALO 3EL Autotrader.`,
      `Good afternoon, ${name}. Your AI trading co-pilot is online.`,
      `Good afternoon, ${name}. HALO is up and running.`,
    ],
    evening: [
      `Good evening, ${name}. Welcome back to HALO 3EL Autotrader.`,
      `Good evening, ${name}. Your AI trading co-pilot is online.`,
      `Good evening, ${name}. HALO is up and running.`,
    ],
    night: [
      `Working late, ${name}? HALO has the watch.`,
      `It's late, ${name}. Welcome back to HALO 3EL Autotrader.`,
      `Good evening, ${name}. The night session is yours — HALO is online.`,
    ],
  };

  const closers = ctx.wakeEnabled
    ? [
        `Say ${ctx.wakePhrase} anytime you want to talk.`,
        `Just say ${ctx.wakePhrase} whenever you need me.`,
        `I'm listening for ${ctx.wakePhrase} — call me anytime.`,
      ]
    : [
        "Tap the mic or type whenever you want to talk.",
        "Open the console and ask me anything.",
        "Tap the mic whenever you need me.",
      ];

  return `${openings[band][v]} ${phrases.join(" ")} I'm monitoring the market and your risk status, and I'll alert you when important conditions arise. ${closers[v]}`;
}

/** Short spoken ack after wake-word activation — "Yes, Bismark? I'm listening." */
export function wakeAck(ctx: GreetCtx, v = 0): string {
  const name = ctx.name || "";
  const variants = name
    ? [`Yes, ${name}? I'm listening.`, `I'm here, ${name}. Go ahead.`, `Listening, ${name}. What do you need?`]
    : ["Yes? I'm listening.", "I'm here. Go ahead.", "Listening. What do you need?"];
  return variants[v % variants.length];
}

/** Spoken line when the conversation window closes (silence or exit phrase). */
export function standbyLine(ctx: GreetCtx): string {
  return ctx.wakeEnabled
    ? `Going back to standby. Say ${ctx.wakePhrase} when you need me again.`
    : "Going back to standby. Tap the mic when you need me again.";
}

/**
 * Short spoken ack when the screen comes back on (phone unlocked / tab returned).
 * HONESTY: only claims HALO's own state (still on watch / listening) — never
 * market, broker, or account health. Rotates so repeats don't sound robotic.
 */
export function welcomeBackLine(ctx: GreetCtx, v = 0): string {
  const name = ctx.name || "";
  const variants = name
    ? [
        `Welcome back, ${name}. I kept the watch — what do you need?`,
        `You're back, ${name}. HALO is still live — go ahead.`,
        `Good to see you again, ${name}. I'm here and listening.`,
      ]
    : [
        "Welcome back. I kept the watch — what do you need?",
        "You're back. HALO is still live — go ahead.",
        "Good to see you again. I'm here and listening.",
      ];
  return variants[v % variants.length];
}

// ════════════════════════════════════════════════════════════════════════
//  PERSONALIZED JARVIS WELCOME · the full welcome experience scripts
//
//  • welcomeTimeGreeting — morning / afternoon / evening strictly from the
//    trader's LOCAL clock (the browser's clock, never the server's).
//  • welcomeFullDisplay — the full welcome script, VERBATIM, for on-screen
//    display (paragraphs stay in sync with the spoken segments).
//  • welcomeFullSpoken — the same beats condensed to ~105 words so the
//    spoken welcome lands naturally inside 30–40 s. The creator
//    attribution sentence is spoken VERBATIM, exactly as specified.
//  • welcomeBackMessage — the short welcome-back for subsequent sessions.
//
//  The name is NEVER invented: empty profile → "Trader" everywhere.
// ════════════════════════════════════════════════════════════════════════

/** Morning / afternoon / evening from the trader's local clock. */
export function welcomeTimeGreeting(d: Date): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The full welcome — exact on-screen script (spec §1), name substituted. */
export function welcomeFullDisplay(ctx: GreetCtx): string[] {
  const name = ctx.name || "Trader";
  const g = welcomeTimeGreeting(ctx.now ?? new Date());
  return [
    `${g}, ${name}. Welcome to HALO 3EL Autotrader. It's great to have you here!`,
    "Take a breath, relax and make yourself comfortable. The markets will always have opportunities, so there's no need to rush or chase every move. We'll approach each trading session with patience, discipline and confidence.",
    "I'm HALO, your personal AI trading assistant. I'm here to keep you informed, monitor the markets, help you understand trading opportunities, watch over your risk and make your trading experience smoother.",
    "Remember, protecting your capital is just as important as making a profit. We focus on quality setups, smart decisions and consistency.",
    "HALO 3EL Autotrader was created by Bismark Arko-Ofori. All rights reserved.",
    "Your trading command centre is ready. The systems are standing by, and I'm here whenever you need me.",
    "So, how can I assist you today?",
    "Welcome aboard. Let's trade smart, stay disciplined and make every decision count!",
  ];
}

/**
 * The full welcome, spoken — every beat of the display script condensed to
 * ~105 words (≈35 s at the default natural rate). Segments map 1:1 onto the
 * display paragraphs so the overlay can highlight what is being said.
 * One honest engine clause is appended ONLY when the feed is degraded.
 */
export function welcomeFullSpoken(ctx: GreetCtx, s: BotStateRes | null = null): string[] {
  const name = ctx.name || "Trader";
  const g = welcomeTimeGreeting(ctx.now ?? new Date());
  const segs = [
    `${g}, ${name}. Welcome to HALO 3EL Autotrader — it's great to have you here.`,
    "Take a breath, relax and get comfortable. The markets will always have opportunities, so there's no need to rush.",
    "I'm HALO, your personal AI trading assistant — I keep you informed, monitor the markets and watch over your risk.",
    "Remember, protecting your capital is just as important as making a profit.",
    "HALO 3EL Autotrader was created by Bismark Arko-Ofori. All rights reserved.",
    "Your command centre is ready — I'm here whenever you need me.",
    "So, how can I assist you today? Welcome aboard — let's trade smart, stay disciplined and make every decision count.",
  ];
  const feedNote = (s?.feed.note || "").toLowerCase();
  if (s && (s.feed.source === "simulator" || /slow|error|unreachable/i.test(feedNote))) {
    segs.splice(5, 0, "One heads-up — the market feed is degraded right now, so please treat on-screen prices with care.");
  }
  return segs;
}

/** Short welcome-back for subsequent sessions (spec §4) — spoken + shown. */
export function welcomeBackMessage(ctx: GreetCtx): string {
  const name = ctx.name || "Trader";
  return `Welcome back, ${name}. It's good to have you here again. I hope you're feeling refreshed. I've got everything ready for you. Let's stay focused, remain disciplined and take the market one opportunity at a time. How can I assist you today?`;
}
