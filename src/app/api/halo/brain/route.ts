import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { botState, startBot, stopBot, closeOpenTrade, updateBotConfig } from "@/lib/bot";
import { buildSnapshot } from "@/lib/halo/assistant-snapshot";
import { getAction, validateActionParams, ACTIONS, VIEWS } from "@/lib/halo/actions";
import { decimalsOf } from "@/lib/market-symbols";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  HALO OPERATOR BRAIN · conversational core with an allowlisted action path
//
//  Separation of responsibilities (mirrors the master spec):
//   • Conversational AI (LLM, server-side only) — understands the request
//     and selects actions from the REGISTRY. It never executes anything.
//   • This route — validates every selected action against the allowlist,
//     executes read actions deterministically from the VERIFIED snapshot,
//     and for CONSEQUENTIAL actions only stores a pending token that must
//     be explicitly confirmed before the EXISTING trusted functions
//     (startBot / stopBot / closeOpenTrade / updateBotConfig) run.
//   • The client ActionBridge — executes UI-scope actions on real app
//     state and verifies each result before HALO speaks.
//
//  HARD RULES: no discretionary order action exists; the deterministic
//  3EL engine remains the only trade-entry source; every consequential
//  execution + failure is audit-logged (ActionAudit); nothing here
//  touches risk limits, strategy config validation or broker adapters
//  beyond what the existing endpoints already allow.
// ════════════════════════════════════════════════════════════════════════

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const CONFIRM_TTL_MS = 90_000;

const gStore = globalThis as unknown as {
  __haloBrainHits?: Map<string, number[]>;
  __haloPending?: Map<string, PendingAction>;
};
const hits = (gStore.__haloBrainHits ??= new Map<string, number[]>());
const pending = (gStore.__haloPending ??= new Map<string, PendingAction>());

interface PendingAction {
  id: string;
  params: Record<string, string | boolean>;
  source: "voice" | "text";
  say: string;
  createdAt: number;
}

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

function prunePending(): void {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > CONFIRM_TTL_MS) pending.delete(k);
}

async function audit(action: string, params: Record<string, string | boolean>, source: string, outcome: string, detail: string): Promise<void> {
  try {
    await db.actionAudit.create({
      data: { action, paramsJson: JSON.stringify(params).slice(0, 400), source, outcome, detail: detail.slice(0, 400) },
    });
  } catch (e) {
    console.error("[halo-brain] audit write failed:", (e as Error).message);
  }
}

// ── deterministic, VERIFIED read-action details (spoken as-is) ───────────
type Snap = Awaited<ReturnType<typeof buildSnapshot>>;

function fmtPips(p: number): string {
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)} pips`;
}

/** mintick-accurate price for spoken details — never more precision than the feed has */
function fmtPrice(px: number, mintick: number): string {
  if (!isFinite(px)) return "unknown";
  const d = decimalsOf(mintick);
  return px.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function detailFor(id: string, s: Snap): string {
  switch (id) {
    case "get_account_summary": {
      const parts: string[] = [];
      parts.push(`Engine book: ${s.stats.wins} wins, ${s.stats.losses} losses, realized book ${fmtPips(s.realizedPips)}.`);
      parts.push(`This month: ${s.monthlyStats.trades} trades, ${s.monthlyStats.wins} wins, ${s.monthlyStats.losses} losses, net ${fmtPips(s.monthlyStats.netPips)}.`);
      parts.push(`Execution: ${s.execution.mode.toUpperCase()}${s.execution.broker ? ` on ${s.execution.broker.label}` : ""}, ${s.execution.sizing}.`);
      if (s.execution.mode === "live") {
        if (s.liveAccount?.connected) {
          parts.push(`Live account: balance ${s.liveAccount.balance} ${s.liveAccount.currency}, equity ${s.liveAccount.equity} ${s.liveAccount.currency}, margin level ${s.liveAccount.marginLevel}.`);
        } else {
          parts.push(`Live account is not reachable right now${s.liveAccount?.error ? ` — ${s.liveAccount.error}` : ""}.`);
        }
      } else {
        parts.push("Paper mode — no real account is attached.");
      }
      return parts.join(" ");
    }
    case "get_strategy_status": {
      const n = s.armedLevels.length;
      const sides = s.armedLevels.map((l) => l.side.split(" ")[0]).join(" + ");
      const feed = s.feed.note ? `${s.feed.source} feed with a caveat: ${s.feed.note}` : `${s.feed.source} feed, fresh`;
      return `The EA is ${s.eaEnabled ? "armed" : "detached (new entries paused)"}. Status: ${s.engineStatus}. ${n > 0 ? `${n} armed level${n > 1 ? "s" : ""} (${sides}).` : "No armed levels — scanning for a C1/C2 formation."} ATR ${s.atr != null ? fmtPrice(s.atr, s.mintick) : "unavailable"}. ${feed}. Timeframe ${s.tf} on ${s.symbolLabel}.`;
    }
    case "get_daily_signals": {
      const parts: string[] = [];
      parts.push(`Today: ${s.dailyStats.trades} trade${s.dailyStats.trades === 1 ? "" : "s"}, ${s.dailyStats.wins} win${s.dailyStats.wins === 1 ? "" : "s"}, ${s.dailyStats.losses} loss${s.dailyStats.losses === 1 ? "" : "es"}, net ${fmtPips(s.dailyStats.netPips)}.`);
      const fires = s.engineLog.filter((l) => l.kind === "fire");
      if (fires.length > 0) {
        const last = fires[fires.length - 1];
        parts.push(`Most recent fire: ${last.dir} near ${fmtPrice(last.entry, s.mintick)}.`);
      }
      if (s.armedLevels.length > 0) parts.push(`${s.armedLevels.length} level${s.armedLevels.length > 1 ? "s are" : " is"} armed right now, waiting for the C3 break.`);
      else parts.push("No levels armed at the moment — the engine is watching for a fresh C1/C2 pair.");
      return parts.join(" ");
    }
    case "get_open_positions": {
      if (!s.openTrade) return "Flat — no open position from the strategy. Note: I can only verify the strategy's own position; positions held directly on the broker are not listable from here.";
      const t = s.openTrade;
      return `One open ${t.dir} from ${t.openedAt}: entry ${fmtPrice(t.entry, s.mintick)}, stop ${fmtPrice(t.sl, s.mintick)}, target ${fmtPrice(t.tp, s.mintick)} — risk ${t.riskPips.toFixed(1)} pips against reward ${t.rewardPips.toFixed(1)} pips.`;
    }
    case "get_mt5_connection_status": {
      if (s.execution.mode !== "live") return `Execution is in PAPER mode — simulated fills, no broker connection in use.${s.execution.broker ? ` A ${s.execution.broker.kind} account (${s.execution.broker.label}) is configured with status ${s.execution.broker.status}.` : ""}`;
      if (!s.execution.broker) return "LIVE mode is set but no broker account is selected — that is inconsistent, check the Brokers panel.";
      const health = s.execution.broker.status === "ok" ? "healthy" : `in state ${s.execution.broker.status}`;
      const acct = s.liveAccount?.connected ? ` Account reads back: balance ${s.liveAccount.balance} ${s.liveAccount.currency}.` : s.liveAccount?.error ? ` Account read failed: ${s.liveAccount.error}.` : "";
      return `Execution is LIVE on ${s.execution.broker.label} (${s.execution.broker.kind}) — connection ${health}.${acct}`;
    }
    case "explain_last_rejection": {
      const st = s.stats;
      const last = s.engineLog.length > 0 ? s.engineLog[s.engineLog.length - 1] : null;
      const parts: string[] = [];
      parts.push(`Formation quality counters: ${st.burned} burned levels, ${st.skipped} skipped setups this session.`);
      parts.push(`A level burns when price invalidates the equal-zone before C3 breaks; a setup is skipped when it fails quality gates. Levels expire after ${s.strategy.expiryBars} bars.`);
      if (last) parts.push(`Last engine event: ${last.kind.toUpperCase()} ${last.dir} at ${fmtPrice(last.entry, s.mintick)}${last.kind !== "fire" ? `, ${fmtPips(last.pips)}` : ""}.`);
      if (s.armedLevels.length > 0) parts.push(`Right now ${s.armedLevels.length} level${s.armedLevels.length > 1 ? "s are" : " is"} armed — the engine is not rejecting, it is waiting for the break-and-return.`);
      else parts.push("No levels are armed at the moment — the engine is scanning for a fresh C1/C2 equal formation.");
      parts.push("That is the mechanism as observed from engine state — my read, not a guarantee.");
      return parts.join(" ");
    }
    default:
      return "";
  }
}

// ── consequential execution via the EXISTING trusted functions ───────────
async function executeConsequential(p: PendingAction): Promise<{ ok: boolean; detail: string }> {
  const id = p.id;
  try {
    if (id === "pause_new_entries" || id === "emergency_stop") {
      const before = await botState();
      if (!before.enabled) {
        return { ok: true, detail: "New entries were already paused — the EA is detached. Open positions keep their broker SL/TP." };
      }
      await stopBot();
      const st = await botState();
      return { ok: !st.enabled, detail: st.enabled ? "Stop command did not verify — the engine still reports armed. Check the dashboard." : "Confirmed: new entries are paused. The EA is detached; any open position keeps its broker SL/TP." };
    }
    if (id === "resume_new_entries") {
      const before = await botState();
      if (before.enabled) {
        return { ok: true, detail: "The EA is already running — scanning for C1/C2 equal levels." };
      }
      await startBot();
      const st = await botState();
      return { ok: st.enabled, detail: st.enabled ? "Confirmed: the EA is live again, scanning for C1/C2 equal levels with the existing risk settings." : "Start did not verify — the engine still reports detached." };
    }
    if (id === "close_open_trade") {
      const before = await botState();
      if (!before.engine.trade) {
        return { ok: true, detail: "There is no open trade to close — the book is flat." };
      }
      await closeOpenTrade();
      const st = await botState();
      return { ok: !st.engine.trade, detail: st.engine.trade ? "Close did not verify — the trade still shows open. Check the dashboard." : "Confirmed: the position was closed at market and the result booked." };
    }
    if (id === "set_execution_mode") {
      const mode = p.params.mode === "live" ? "live" : "paper";
      await updateBotConfig({ exec: { executionMode: mode } });
      const st = await botState();
      const verified = st.exec.executionMode === mode;
      return {
        ok: verified,
        detail: verified
          ? mode === "live"
            ? `Confirmed: order routing is now LIVE${st.exec.broker ? ` on ${st.exec.broker.label}` : ""} — every C3 fire goes to the broker with real SL/TP.`
            : "Confirmed: order routing is back in PAPER mode — all fills simulated."
          : `Mode switch did not verify — still ${st.exec.executionMode}. ${st.exec.executionMode === "paper" && mode === "live" ? "A live broker account may be missing or unhealthy." : ""}`.trim(),
      };
    }
    return { ok: false, detail: "That action is not executable." };
  } catch (e) {
    return { ok: false, detail: `Execution failed: ${(e as Error).message.slice(0, 160)}` };
  }
}

// ── LLM protocol ─────────────────────────────────────────────────────────
const STRATEGY_BRIEF = `3EL STRATEGY (v1.2 — wick-line break & return):
- Candles 1 & 2 form an equal-level zone; the extreme wick of C1/C2 is frozen as a DOTTED level (support = lowest wick, BUY side; resistance = highest wick, SELL side). The level never repaints.
- Candle 3 must BREAK beyond that dotted line, and the moment price RETURNS to the line, the trade fires instantly.
- One armed level per side max (support + resistance can coexist). Levels expire or burn when invalidated.`;

const REGISTRY_BRIEF = ACTIONS.map((a) => {
  const params = Object.entries(a.params)
    .map(([k, v]) => `${k}:${v.type}${v.oneOf ? `(${v.oneOf.join("|")})` : ""}`)
    .join(", ") || "none";
  const risk = a.risk === "consequential" ? " [CONFIRM-REQUIRED]" : a.risk === "read" ? " [read-only]" : "";
  return `- ${a.id} (${params})${risk} — ${a.description}`;
}).join("\n");

const VIEWS_BRIEF = VIEWS.map((v) => `${v.id} (${v.label.toLowerCase()}; also answers to: ${v.aliases.join(", ")})`).join("; ");

const SYSTEM_RULES = `You are HALO — the AI OPERATOR core of the HALO 3EL Autotrader. You understand the trader's request and EITHER answer from the verified snapshot OR select actions from the Action Registry. You speak like a calm, precise JARVIS-style operator, lightly witty at most once, never during losses.

OUTPUT FORMAT — your ENTIRE reply must be ONE JSON object, nothing else:
{"say": "<what HALO says out loud>", "actions": [{"id": "<registry id>", "params": {}}]}

OPERATING RULES (non-negotiable):
1. "say" is ALWAYS required, plain spoken text, max ~60 words in voice mode. No markdown, no emoji, no symbols.
2. "actions" is an ordered array, max 3. Use [] for pure questions/conversation.
3. ONLY use ids from the Action Registry below. Never invent actions or parameters. If the request needs something the registry lacks, set actions to [] and say honestly that it is not something you can do, pointing to the dashboard control if one exists.
4. For combined requests ("open X, select Y, show Z") order the actions sensibly. If one step can't be supported, still perform the supported ones and say which part you couldn't do.
5. Symbol names: resolve natural names to registry symbol ids when obvious (gold → XAUUSD, EUR/USD → EURUSD, bitcoin → BTCUSDT). The server re-validates and re-resolves.
6. Timeframes: map "hourly" → 1h, "daily" → 1d, "15 minute" → 15m, etc.
7. CONSEQUENTIAL actions (marked CONFIRM-REQUIRED): select them, but your "say" must make clear what you are about to do and that you need an explicit "confirm" — e.g. "That pauses new entries. Say confirm to proceed, or cancel." Never imply it already happened.
8. Questions about prices, balances, trades, risk, engine state: answer ONLY from the VERIFIED SNAPSHOT. If a datum is missing or the feed is degraded, say so plainly. NEVER invent prices, balances, order statuses or broker responses.
9. Never give financial advice beyond explaining what the strategy engine already did. Never offer to disable SL/TP, alter risk limits, or bypass the strategy — decline such requests.
10. Manual discretionary orders ("buy gold now", "close half my position") are NOT supported — the deterministic strategy is the only entry source. Say so and decline.
11. Navigation: current app sections are ${VIEWS_BRIEF}. "Go back" = go_back.
12. Distinguish observed facts (snapshot), strategy mechanics (brief), and your interpretation (label it as your read).`;

const VOICE_RULES = `SPOKEN-MODE ADDENDUM: "say" will be read aloud by text-to-speech. Keep it under ~60 words. Plain conversational sentences only — no markdown, no bullet lists, no symbols like ⚠ or arrows. Numbers read naturally.`;

interface LlmDecision {
  say: string;
  actions: { id: string; params: Record<string, unknown> }[];
}

function parseDecision(raw: string): LlmDecision | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const j = JSON.parse(raw.slice(start, end + 1)) as { say?: unknown; actions?: unknown };
    const say = typeof j.say === "string" ? j.say.trim().slice(0, 600) : "";
    const actions = Array.isArray(j.actions)
      ? (j.actions as { id?: unknown; params?: unknown }[])
          .filter((a) => a && typeof a.id === "string")
          .slice(0, 3)
          .map((a) => ({ id: a.id as string, params: (a.params && typeof a.params === "object" ? a.params : {}) as Record<string, unknown> }))
      : [];
    if (!say && actions.length === 0) return null;
    return { say, actions };
  } catch {
    return null;
  }
}

const ACTION_COUNT = ACTIONS.length;

export async function GET() {
  return NextResponse.json({ ok: true, service: "halo-brain", registry: ACTION_COUNT, confirmTtlMs: CONFIRM_TTL_MS });
}

export async function POST(req: Request) {
  // ── rate limit ──
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "Rate limit reached — give me a breath and try again." }, { status: 429 });
  }

  // ── validate payload ──
  let body: { message?: unknown; history?: unknown; mode?: unknown; source?: unknown; confirmToken?: unknown; approve?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const source = body.source === "voice" ? "voice" : "text";

  // ══════ CONFIRMATION PATH — explicit approval of a pending action ══════
  if (typeof body.confirmToken === "string" && body.confirmToken) {
    prunePending();
    const p = pending.get(body.confirmToken);
    pending.delete(body.confirmToken);
    if (!p) {
      return NextResponse.json({ ok: false, error: "That confirmation window expired — ask me again and confirm promptly." });
    }
    if (body.approve !== true) {
      void audit(p.id, p.params, p.source, "rejected", "Trader declined the confirmation.");
      return NextResponse.json({ ok: true, say: "Cancelled — nothing was changed.", declined: true, action: p.id });
    }
    const res = await executeConsequential(p);
    await audit(p.id, p.params, p.source, res.ok ? "executed" : "failed", res.detail);
    return NextResponse.json({
      ok: res.ok,
      say: res.ok ? res.detail : `I could not complete it. ${res.detail}`,
      detail: res.detail,
      action: p.id,
      source: p.source,
    });
  }

  // ══════ NORMAL PATH — understand + select ══════
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
  let snapshot: Snap;
  try {
    snapshot = await buildSnapshot();
  } catch (e) {
    return NextResponse.json({ ok: false, error: `System snapshot unavailable: ${(e as Error).message}` }, { status: 503 });
  }

  // ── grounded completion (server-side only) ──
  try {
    let nameLine = "The trader has not set a preferred name — use “Trader” or no name.";
    try {
      const row = await db.traderProfile.findUnique({ where: { id: "main" } });
      if (row?.displayName?.trim()) nameLine = `The trader's preferred name is “${row.displayName.trim().slice(0, 24)}”.`;
    } catch {
      // profile unavailable — never invent a name
    }

    const zai = await ZAI.create();
    const systemPrompt = `${SYSTEM_RULES}\n\n${voiceMode ? VOICE_RULES : ""}\n\n${nameLine}\n\n${STRATEGY_BRIEF}\n\nACTION REGISTRY (the only executable operations):\n${REGISTRY_BRIEF}\n\nVERIFIED SNAPSHOT (the only data you may cite — captured just now):\n${JSON.stringify(snapshot)}`;

    const msgs: { role: "assistant" | "user"; content: string }[] = [
      { role: "assistant", content: systemPrompt },
      ...history.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.text })),
      { role: "user", content: message },
    ];

    const completion = await zai.chat.completions.create({
      messages: msgs,
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const decision = parseDecision(raw);
    if (!decision) {
      return NextResponse.json({ ok: false, error: "The operator core returned an unreadable reply — try again." }, { status: 502 });
    }

    // ── validate every selected action against the allowlist ──
    const valid: { id: string; params: Record<string, string | boolean>; def: NonNullable<ReturnType<typeof getAction>> }[] = [];
    const invalid: string[] = [];
    for (const a of decision.actions) {
      const v = validateActionParams(a.id, a.params);
      const def = getAction(a.id);
      if (v.ok && def) valid.push({ id: a.id, params: v.params, def });
      else invalid.push(v.ok ? a.id : v.error);
    }

    // ═══ consequential → hold for explicit confirmation, execute nothing ═══
    const consequential = valid.find((a) => a.def.risk === "consequential");
    if (consequential) {
      prunePending();
      const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      pending.set(token, { id: consequential.id, params: consequential.params, source, say: decision.say, createdAt: Date.now() });
      return NextResponse.json({
        ok: true,
        say: decision.say || `Ready to ${consequential.id.replace(/_/g, " ")}.`,
        verifiedAt: snapshot.now,
        confirmation: {
          token,
          action: consequential.id,
          question: consequential.def.confirmQuestion ?? "Confirm this operation?",
          effect: consequential.def.confirmEffect ?? "",
        },
      });
    }

    // ═══ server read actions → deterministic verified details ═══
    const readResults = valid
      .filter((a) => a.def.scope === "server" && a.def.risk === "read")
      .map((a) => ({ id: a.id, ok: true, detail: detailFor(a.id, snapshot) }));

    // ═══ client UI actions → returned for verified client execution ═══
    const clientActions = valid
      .filter((a) => a.def.scope === "client")
      .map((a) => ({ id: a.id, params: a.params, description: a.def.description }));

    if (valid.length === 0 && decision.actions.length > 0) {
      // the model picked only unsupported things — stay honest
      return NextResponse.json({
        ok: true,
        say: `I can't do that safely from here. ${invalid[0]?.slice(0, 160) ?? "That operation is not in my allowlist."}`,
        verifiedAt: snapshot.now,
      });
    }

    // if a read action executed, prefer its verified detail as the spoken core
    let say = decision.say;
    if (readResults.length > 0) say = readResults.map((r) => r.detail).join(" ");
    if (!say) say = "Done.";

    return NextResponse.json({
      ok: true,
      say,
      verifiedAt: snapshot.now,
      ...(clientActions.length > 0 ? { actions: clientActions } : {}),
      ...(readResults.length > 0 ? { readResults } : {}),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Operator core unreachable: ${(e as Error).message.slice(0, 160)}` }, { status: 502 });
  }
}
