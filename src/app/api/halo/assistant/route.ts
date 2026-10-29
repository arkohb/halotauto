import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { botState } from "@/lib/bot";
import { statusOf } from "@/lib/halo/ui-helpers";
import { getAdapter, isBrokerKind, parseCreds } from "@/lib/brokers";
import { getSymbolMeta } from "@/lib/market-symbols";

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
//  • Light in-memory rate limiting (12 req/min per IP) + payload caps.
// ════════════════════════════════════════════════════════════════════════

const RATE_LIMIT = 12;
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

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

interface Snapshot {
  now: string;
  engineStatus: string;
  eaEnabled: boolean;
  symbol: string;
  symbolLabel: string;
  tf: string;
  feed: { source: string; note: string; price: number; ageSeconds: number | null };
  realizedPips: number;
  atr: number | null;
  armedLevels: { side: string; ext: number; state: string }[];
  openTrade: {
    dir: string;
    entry: number;
    sl: number;
    tp: number;
    riskPips: number;
    rewardPips: number;
    openedAt: string;
  } | null;
  stats: { wins: number; losses: number; burned: number; skipped: number };
  strategy: { signalMode: string; slMode: string; rrMult: number; expiryBars: number; breakATR: number; eqTolATR: number };
  execution: {
    mode: string;
    broker: { label: string; kind: string; status: string } | null;
    sizing: string;
  };
  liveAccount: { connected: boolean; broker?: string; currency?: string; balance?: number; equity?: number; marginLevel?: number; error?: string } | null;
  recentTrades: {
    symbol: string;
    dir: string;
    status: string;
    resultPips: number | null;
    execMode: string;
    mode: string;
    openedAt: string;
    closedAt: string | null;
    note: string;
  }[];
  recentBrokerIssues: { kind: string; title: string; error: string; at: string }[];
}

async function buildSnapshot(): Promise<Snapshot> {
  const st = await botState(); // ensures boot + a feed tick (read-only)
  const meta = getSymbolMeta(st.symbol);
  const status = statusOf(st);

  const snap: Snapshot = {
    now: new Date().toISOString(),
    engineStatus: status.text,
    eaEnabled: st.enabled,
    symbol: st.symbol,
    symbolLabel: meta.label.split("·")[0].trim() || st.symbol,
    tf: st.tf,
    feed: {
      source: st.feed.source,
      note: st.feed.note,
      price: st.feed.price,
      ageSeconds: st.feed.lastTickAt ? Math.round((Date.now() - st.feed.lastTickAt) / 1000) : null,
    },
    realizedPips: st.feed.realizedPips,
    atr: st.engine.atr,
    armedLevels: st.engine.levels.map((l) => ({
      side: l.side === -1 ? "resistance (SELL side)" : "support (BUY side)",
      ext: l.ext,
      state: l.state,
    })),
    openTrade: st.engine.trade
      ? {
          dir: st.engine.trade.dir === -1 ? "SELL" : "BUY",
          entry: st.engine.trade.entry,
          sl: st.engine.trade.sl,
          tp: st.engine.trade.tp,
          riskPips: st.engine.trade.riskPips,
          rewardPips: st.engine.trade.rewardPips,
          openedAt: new Date(st.engine.trade.entryTime).toISOString(),
        }
      : null,
    stats: {
      wins: st.engine.stats.wins,
      losses: st.engine.stats.losses,
      burned: st.engine.stats.burned,
      skipped: st.engine.stats.skipped,
    },
    strategy: {
      signalMode: st.config.sigMode,
      slMode: st.config.slMode,
      rrMult: st.config.rrMult,
      expiryBars: st.config.expiryBars,
      breakATR: st.config.breakATR,
      eqTolATR: st.config.eqTolATR,
    },
    execution: {
      mode: st.exec.executionMode,
      broker: st.exec.broker ? { label: st.exec.broker.label, kind: st.exec.broker.kind, status: st.exec.broker.status } : null,
      sizing: st.exec.sizingMode === "fixed" ? `fixed ${st.exec.sizeFixed} lots` : `${st.exec.sizePercent}% risk-based`,
    },
    liveAccount: null,
    recentTrades: [],
    recentBrokerIssues: [],
  };

  // trade book (last 10, all modes) — read-only
  try {
    const rows = await db.trade.findMany({ orderBy: { openedAt: "desc" }, take: 10 });
    snap.recentTrades = rows.map((r) => ({
      symbol: r.symbol,
      dir: r.direction === -1 ? "SELL" : "BUY",
      status: r.status,
      resultPips: r.resultPips,
      execMode: r.execMode,
      mode: r.mode,
      openedAt: r.openedAt.toISOString(),
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      note: r.note,
    }));
  } catch {
    // db unavailable — snapshot stays honest by omission
  }

  // recent broker/order issues — read-only
  try {
    const issues = await db.alertLog.findMany({
      where: { ok: false, kind: { in: ["broker", "fire"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    snap.recentBrokerIssues = issues.map((i) => ({
      kind: i.kind,
      title: i.title,
      error: i.error || i.body.slice(0, 160),
      at: i.createdAt.toISOString(),
    }));
  } catch {
    // ignore
  }

  // live MT account balance (read-only, only when LIVE mode + healthy broker)
  if (st.exec.executionMode === "live" && st.exec.broker) {
    try {
      const row = await db.brokerAccount.findFirst({ where: { active: true } });
      if (row && isBrokerKind(row.kind) && row.kind !== "paper" && row.status === "ok") {
        const adapter = getAdapter(row.kind);
        const creds = parseCreds(row.credsJson);
        const acct = await withTimeout(adapter.getAccount(creds), 6000, { ok: false, error: "broker timeout" });
        snap.liveAccount = acct.ok
          ? {
              connected: true,
              broker: acct.brokerName ?? row.label,
              currency: acct.currency ?? "USD",
              balance: acct.balance ?? 0,
              equity: acct.equity ?? acct.balance ?? 0,
              marginLevel: acct.marginLevel ?? 0,
            }
          : { connected: false, error: acct.error ?? "broker unreachable" };
      } else {
        snap.liveAccount = { connected: false, error: "no healthy live broker connected" };
      }
    } catch (e) {
      snap.liveAccount = { connected: false, error: (e as Error).message.slice(0, 160) };
    }
  }

  return snap;
}

const STRATEGY_BRIEF = `3EL STRATEGY (v1.2 — wick-line break & return):
- Candles 1 & 2 form an equal-level zone; the extreme wick of C1/C2 is frozen as a DOTTED level (support = lowest wick, BUY side; resistance = highest wick, SELL side). The level never repaints.
- Candle 3 must BREAK beyond that dotted line (min break = breakATR x ATR), and the moment price RETURNS to the line, the trade fires instantly. "instant" mode watches intrabar; "barclose" waits for candle close.
- SL per slMode (fixed points / break extreme + buffer / ATR multiple). TP = rrMult x risk (default 1:3). Same-bar SL+TP counts as a loss (worst case).
- Levels expire after expiryBars bars or burn when invalidated. One armed level per side; support + resistance can be live simultaneously.`;

const SYSTEM_RULES = `You are HALO — the AI core of the HALO 3EL Autotrader, a JARVIS-style trading companion for one trader.

VOICE: calm, precise, professional, lightly witty (at most one dry remark — never during losses). Concise during market activity; more detailed when asked "why" or "explain". Conversational, never robotic, never hypey.

HARD RULES (non-negotiable):
1. You are READ-ONLY. You cannot place, modify, or close any order and cannot change any setting. Never pretend you executed anything. If asked to trade, halt, or change something: say you are read-only and point to the manual controls (EA ON/OFF pill in the header, action buttons on the dashboard, close button on the trade card). A spoken or typed request is never authorization to touch the trading system.
2. Ground every factual claim in the VERIFIED SNAPSHOT in this prompt. If a datum is missing from it, say plainly that you cannot verify it right now. NEVER invent prices, pips, balances, or broker responses.
3. Clearly separate: observed facts (from the snapshot), strategy mechanics (from the 3EL brief), and your interpretation (label it as your read).
4. If the feed is degraded (simulator/slow/error) or the broker is disconnected, disclose it prominently instead of glossing over.
5. You are not a financial advisor. No buy/sell recommendations beyond what the strategy engine already did — explain mechanics, not advice.
6. Keep unsolicited market answers under ~90 words unless the user asks for depth. Plain text only (no markdown tables/headers); short sentences.`;

export async function GET() {
  return NextResponse.json({ ok: true, service: "halo-assistant", readOnly: true });
}

export async function POST(req: Request) {
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
  let body: { message?: unknown; history?: unknown };
  try {
    body = (await req.json()) as { message?: unknown; history?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 800) : "";
  if (!message) {
    return NextResponse.json({ ok: false, error: "Message is empty." }, { status: 400 });
  }

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
    const zai = await ZAI.create();
    const systemPrompt = `${SYSTEM_RULES}\n\n${STRATEGY_BRIEF}\n\nVERIFIED SNAPSHOT (the only data you may cite — captured just now):\n${JSON.stringify(snapshot)}`;

    const msgs: { role: "assistant" | "user"; content: string }[] = [
      { role: "assistant", content: systemPrompt },
      ...history.map((t) => ({ role: t.role === "user" ? ("user" as const) : ("assistant" as const), content: t.text })),
      { role: "user", content: message },
    ];

    const completion = await zai.chat.completions.create({
      messages: msgs,
      thinking: { type: "disabled" },
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!reply) {
      return NextResponse.json({ ok: false, error: "The model returned an empty reply — try again." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, reply, snapshotAt: snapshot.now });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Assistant core unreachable: ${(e as Error).message.slice(0, 160)}` },
      { status: 502 }
    );
  }
}
