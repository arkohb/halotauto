import { NextResponse } from "next/server";
import { askClaude, friendlyClaudeError } from "@/lib/halo/claude";
import { db } from "@/lib/db";
import { buildSnapshot, type Snapshot } from "@/lib/halo/assistant-snapshot";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  HALO JARVIS ASSISTANT · READ-ONLY conversational core
//
//  • Gathers a VERIFIED snapshot from the real system (engine, feed,
//    broker, trade book) — never invents data.
//  • The model is intentionally given ZERO order-capable tools: it can
//    only read this snapshot and explain. Every mutation (start/stop,
//    close, config) stays in the existing trusted endpoints the user
//    already controls from the dashboard.
//  • Server-side only: the LLM credentials never reach the browser.
//  • Light in-memory rate limiting (20 req/min per IP) + payload caps.
// ════════════════════════════════════════════════════════════════════════

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

const gStore = globalThis as unknown as { __haloAssistantHits?: Map<string, number[]> };
const hits = (gStore.__haloAssistantHits ??= new Map<string, number[]>());

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    hits.set(key, arr);
    return true;
  }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

// buildSnapshot now lives in /lib/halo/assistant-snapshot — shared with the
// operator brain (/api/halo/brain) so both cores cite identical facts.

const STRATEGY_BRIEF = `3EL STRATEGY (v1.2 — wick-line break & return):
- Candles 1 & 2 form an equal-level zone; the extreme wick of C1/C2 is frozen as a DOTTED level (support = lowest wick, BUY side; resistance = highest wick, SELL side). The level never repaints.
- Candle 3 must BREAK beyond that dotted line (min break = breakATR x ATR), and the moment price RETURNS to the line, the trade fires instantly. "instant" mode watches intrabar; "barclose" waits for candle close.
- SL per slMode (fixed points / break extreme + buffer / ATR multiple). TP = rrMult x risk (default 1:3). Same-bar SL+TP counts as a loss (worst case).
- Levels expire after expiryBars bars or burn when invalidated. One armed level per side; support + resistance can be live simultaneously.`;

const SYSTEM_RULES = `You are HALO — the AI core of the HALO 3EL Autotrader, a JARVIS-style trading companion for one trader.

VOICE: calm, precise, professional, lightly witty (at most one dry remark — never during losses). Concise during market activity; more detailed when asked "why" or "explain". Conversational, never robotic, never hypey. Address the trader by their preferred name when one is given below — naturally (greetings, acknowledgements), not in every sentence.

HARD RULES (non-negotiable):
1. You are READ-ONLY. You cannot place, modify, or close any order and cannot change any setting. Never pretend you executed anything. If asked to trade, halt, or change something: say you are read-only and point to the manual controls (EA ON/OFF pill in the header, action buttons on the dashboard, close button on the trade card). A spoken or typed request is never authorization to touch the trading system.
2. Ground every factual claim in the VERIFIED SNAPSHOT in this prompt. If a datum is missing from it, say plainly that you cannot verify it right now. NEVER invent prices, pips, balances, or broker responses.
3. Clearly separate: observed facts (from the snapshot), strategy mechanics (from the 3EL brief), and your interpretation (label it as your read).
4. If the feed is degraded (simulator/slow/error) or the broker is disconnected, disclose it prominently instead of glossing over.
5. You are not a financial advisor. No buy/sell recommendations beyond what the strategy engine already did — explain mechanics, not advice.
6. Keep unsolicited market answers under ~90 words unless the user asks for depth. Plain text only (no markdown tables/headers); short sentences.`;

const VOICE_RULES = `SPOKEN-MODE ADDENDUM: this answer will be read aloud by text-to-speech. Keep it under ~65 words. Plain conversational sentences only — no markdown, no bullet lists, no symbols like ⚠ or arrows. Say numbers naturally ("three thousand three hundred" is fine, digits also read well).`;

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  return NextResponse.json({ ok: true, service: "halo-assistant", readOnly: true });
}

export async function POST(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  // ── rate limit ──
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Rate limit reached (12 questions/min). Give me a breath." },
      { status: 429 }
    );
  }

  // ── validate payload ──
  let body: { message?: unknown; history?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as { message?: unknown; history?: unknown; mode?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 800) : "";
  if (!message) {
    return NextResponse.json({ ok: false, error: "Message is empty." }, { status: 400 });
  }
  const voiceMode = body.mode === "voice";

  type Turn = { role: "user" | "halo"; text: string };
  let history: Turn[] = [];
  if (Array.isArray(body.history)) {
    history = (body.history as Turn[])
      .filter((t) => t && typeof t.text === "string" && (t.role === "user" || t.role === "halo"))
      .slice(-8)
      .map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }));
  }

  // ── verified snapshot ──
  let snapshot: Snapshot;
  try {
    snapshot = await buildSnapshot();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `System snapshot unavailable: ${(e as Error).message}` },
      { status: 503 }
    );
  }

  // ── grounded completion (server-side only) ──
  try {
    // trader's preferred name — read server-side, sanitized at the profile API
    let nameLine = "The trader has not set a preferred name — use “Trader” or no name.";
    try {
      const row = await db.traderProfile.findUnique({ where: { id: "main" } });
      if (row?.displayName?.trim()) nameLine = `The trader's preferred name is “${row.displayName.trim().slice(0, 24)}”.`;
    } catch {
      // profile unavailable — never invent a name
    }

    const reply = await askClaude({
      stable: `${SYSTEM_RULES}\n\n${voiceMode ? VOICE_RULES : ""}\n\n${STRATEGY_BRIEF}`,
      live: `${nameLine}\n\nVERIFIED SNAPSHOT (the only data you may cite — captured just now):\n${JSON.stringify(snapshot)}`,
      history: history.map((t) => ({ role: t.role === "user" ? "user" : "assistant", text: t.text })),
      message,
    });
    if (!reply) {
      return NextResponse.json({ ok: false, error: "The model returned an empty reply — try again." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, reply, snapshotAt: snapshot.now });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Assistant core unreachable: ${friendlyClaudeError(e)}` },
      { status: 502 }
    );
  }
}
