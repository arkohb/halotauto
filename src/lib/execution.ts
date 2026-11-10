// ════════════════════════════════════════════════════════════════════════
//  EXECUTION LAYER · turns engine fire events into PAPER or LIVE orders
//  PAPER → SQLite record (simulated fill)
//  LIVE  → real market order via the active CFD broker adapter
//          (OANDA / IG / MT4-MT5 / Binance / bridge), SL + TP attached.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import type { FireEvent } from "./halo/types";
import { sendAlert } from "./alerts";
import { getAdapter, parseCreds } from "./brokers";
import type { BrokerKind } from "./brokers/types";
import { publishBotEvent } from "./halo/event-bus";
import { decimalsOf, getSymbolMeta } from "./market-symbols";
import { engageTradeLock, entriesPaused, getTradeLock, type TradeLockSource } from "./trade-lock";
import { gateOrder } from "./edge/gate";
import type { SignalGrade } from "./edge/quality";
import { getEdgeSync } from "./edge/settings";
import { verifyOrderPrice } from "./price-guard";
import { isTradableSymbol, tradingUniverseLabel } from "./trading-universe";
import { beginIntent, ensureReconciled, markOpen, markRejected, markSubmitting, markUncertain } from "./exec-lock";

/** errors after which the broker MAY have executed the order (no reliable answer) */
export function isUncertainBrokerError(msg: string): boolean {
  return /time ?out|timed out|abort|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|HTTP 5\d\d|502|503|504/i.test(msg);
}

/** EDGE info per opened trade id — read by the bot to speak the grade. */
const gExec = globalThis as unknown as { __haloEdgeExec?: Map<string, { grade: SignalGrade | null; sizeMult: number }> };
export function edgeInfoFor(tradeId: string): { grade: SignalGrade | null; sizeMult: number } | null {
  return gExec.__haloEdgeExec?.get(tradeId) ?? null;
}
function rememberEdge(tradeId: string, grade: SignalGrade | null, sizeMult: number): void {
  const m = (gExec.__haloEdgeExec ??= new Map());
  m.set(tradeId, { grade, sizeMult });
  if (m.size > 200) m.delete(m.keys().next().value as string);
}

export interface ExecSettings {
  executionMode: "paper" | "live";
  brokerAccountId: string;
  sizingMode: "fixed" | "percent";
  sizeFixed: number;
  sizePercent: number;
}

export const DEFAULT_EXEC: ExecSettings = {
  executionMode: "paper",
  brokerAccountId: "",
  sizingMode: "fixed",
  sizeFixed: 0.01,
  sizePercent: 1.0,
};

export function clampExec(e: Partial<ExecSettings>): ExecSettings {
  const out = { ...DEFAULT_EXEC, ...e };
  out.executionMode = out.executionMode === "live" ? "live" : "paper";
  out.sizingMode = out.sizingMode === "percent" ? "percent" : "fixed";
  out.sizeFixed = Math.min(1_000_000, Math.max(0.01, Number(out.sizeFixed) || 0.01));
  out.sizePercent = Math.min(100, Math.max(0.1, Number(out.sizePercent) || 1));
  return out;
}

export async function loadExecSettings(): Promise<ExecSettings> {
  try {
    const row = await db.botConfig.findUnique({ where: { id: "main" } });
    if (!row) return { ...DEFAULT_EXEC };
    return clampExec({
      executionMode: row.executionMode as ExecSettings["executionMode"],
      brokerAccountId: row.brokerAccountId,
      sizingMode: row.sizingMode as ExecSettings["sizingMode"],
      sizeFixed: row.sizeFixed,
      sizePercent: row.sizePercent,
    });
  } catch {
    return { ...DEFAULT_EXEC };
  }
}

export async function saveExecSettings(e: ExecSettings): Promise<void> {
  await db.botConfig.upsert({
    where: { id: "main" },
    create: { id: "main", ...e },
    update: { ...e },
  });
}

export interface ActiveBroker {
  id: string;
  kind: BrokerKind;
  label: string;
  credsJson: string;
}

export async function resolveBroker(accountId: string): Promise<ActiveBroker | null> {
  if (!accountId) return null;
  try {
    const row = await db.brokerAccount.findUnique({ where: { id: accountId } });
    if (!row) return null;
    return { id: row.id, kind: row.kind as BrokerKind, label: row.label, credsJson: row.credsJson };
  } catch {
    return null;
  }
}

export interface FireJob {
  source: TradeLockSource;
  symbol: string;
  tf: string;
  fire: FireEvent;
  levelTop: number;
  levelBot: number;
  slModeLabel: string;
  exec: ExecSettings;
}

/**
 * Execute a fire: returns the created Trade id, or null when nothing was opened.
 * A successful open engages the GLOBAL TRADE LOCK — every armed level in the
 * app is deleted and scanning pauses until the running trade hits TP or SL.
 */
export async function executeFire(job: FireJob): Promise<string | null> {
  const { fire } = job;
  // ── TRADING UNIVERSE: for now HALO trades gold only — every source (bot,
  // scanners, sweep, Pine, TradingView) is refused here on anything else ──
  if (!isTradableSymbol(job.symbol)) {
    void sendAlert({
      kind: "status",
      title: `HALO 3EL · ORDER REFUSED — ${job.symbol} NOT TRADED YET`,
      body: `${job.source} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry} on ${job.symbol} ${job.tf} was NOT executed: HALO currently trades only ${tradingUniverseLabel()}.`,
    });
    return null;
  }
  // ── OPERATOR PAUSE (Quick Actions → PAUSE NEW ENTRIES) — every source ──
  if (entriesPaused()) {
    void sendAlert({
      kind: "status",
      title: "HALO 3EL · FIRE SKIPPED — NEW ENTRIES PAUSED",
      body: `${job.source} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry} on ${job.symbol} ${job.tf} was NOT executed: new entries are paused. Resume from Quick Actions.`,
    });
    return null;
  }
  if (getTradeLock()) {
    // defensive: single-trade rule — the callers gate too, this is the backstop
    void sendAlert({
      kind: "status",
      title: "HALO 3EL · FIRE REFUSED — TRADE ALREADY RUNNING",
      body: `${job.symbol} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry} was NOT executed: a trade is already running on ${getTradeLock()!.symbol} ${getTradeLock()!.tf}. Scanning resumes when it hits TP or SL.`,
    });
    return null;
  }

  // ── PRICE GUARD (Decision B): never open a position on simulated,
  // stale, missing or unverifiable prices. Entry-only — open positions,
  // stops and closes are never affected. ──
  const isLive = job.exec.executionMode === "live";
  const priceOk = await verifyOrderPrice({
    symbol: job.symbol,
    tf: job.tf,
    entry: fire.entry,
    sl: fire.sl,
    dir: fire.dir,
    live: isLive,
    broker: isLive ? await resolveBroker(job.exec.brokerAccountId) : null,
  });
  if (!priceOk.ok) {
    await recordPriceGuardRejection({ source: job.source, symbol: job.symbol, tf: job.tf, dir: fire.dir, entry: fire.entry, sl: fire.sl, tp: fire.tp, riskPips: fire.riskPips, rewardPips: fire.rewardPips, levelTop: job.levelTop, levelBot: job.levelBot, slMode: job.slModeLabel, live: isLive, reason: priceOk.reason });
    return null;
  }

  // ── EDGE gate: Signal Quality Score + Capital Guardian (every source) ──
  const gate = await gateOrder(job.symbol, job.tf, fire);
  if (!gate.allow) {
    const meta = getSymbolMeta(job.symbol);
    const label = meta.label.split("·")[0].trim() || job.symbol;
    void sendAlert({
      kind: "status",
      title: `HALO EDGE · ORDER BLOCKED · ${label}`,
      body: `${job.source} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry} on ${job.symbol} ${job.tf} was NOT executed — ${gate.reason}.`,
    });
    publishBotEvent({
      kind: "status",
      prio: "low",
      symbol: job.symbol,
      tf: job.tf,
      time: fire.time,
      title: `EDGE BLOCKED · ${label}`,
      spoken: `A ${fire.dir === -1 ? "sell" : "buy"} signal on ${label} was not traded. ${gate.reason}.`,
    });
    return null;
  }
  const mult = gate.sizeMult;
  job = {
    ...job,
    exec: {
      ...job.exec,
      sizeFixed: Math.max(0.01, Math.round(job.exec.sizeFixed * mult * 100) / 100),
      sizePercent: Math.max(0.01, job.exec.sizePercent * mult),
    },
  };
  const edgeFields = { grade: gate.grade?.score ?? null, gradeLetter: gate.grade?.letter ?? "", sizeMult: mult };

  const base = {
    mode: job.source,
    symbol: job.symbol,
    timeframe: job.tf,
    direction: fire.dir,
    entry: fire.entry,
    sl: fire.sl,
    tp: fire.tp,
    riskPips: fire.riskPips,
    rewardPips: fire.rewardPips,
    levelTop: job.levelTop,
    levelBot: job.levelBot,
    slMode: job.slModeLabel,
    openedAt: new Date(fire.time),
    ...edgeFields,
  };

  // Scanner / all-pairs sweep fires say it out loud too (the 3EL bot announces
  // its own fires in bot.ts — source BOT must not announce twice here).
  const announce = (tradeId: string): void => {
    rememberEdge(tradeId, gate.grade, mult);
    if (job.source === "BOT") return;
    try {
      const meta = getSymbolMeta(job.symbol);
      const label = meta.label.split("·")[0].trim() || job.symbol;
      const px = (v: number): string => v.toFixed(decimalsOf(meta.mintick));
      publishBotEvent({
        kind: "fire",
        prio: "high",
        symbol: job.symbol,
        tf: job.tf,
        time: fire.time,
        title: `TRADE FIRED · ${fire.dir === -1 ? "SELL" : "BUY"} ${label} @ ${px(fire.entry)}${gate.grade ? ` · GRADE ${gate.grade.letter}` : ""}`,
        spoken: `Trade fired — ${fire.dir === -1 ? "sell" : "buy"} ${label} at ${px(fire.entry)}.${gradeSpeech(gate.grade)} Stop loss ${px(fire.sl)}, take profit ${px(fire.tp)}. Risk ${fire.riskPips.toFixed(1)} pips for a target of ${fire.rewardPips.toFixed(1)} pips.`,
      });
    } catch {
      // announcement must never break execution
    }
  };

  // ── PERSISTENT EXECUTION LOCK — one new order at a time, survives restarts ──
  await ensureReconciled();
  const intent = await beginIntent({
    source: job.source,
    symbol: job.symbol,
    tf: job.tf,
    dir: fire.dir,
    entry: fire.entry,
    sl: fire.sl,
    tp: fire.tp,
    live: job.exec.executionMode === "live",
    brokerAccountId: job.exec.executionMode === "live" ? job.exec.brokerAccountId : "",
  });
  if (!intent) {
    void sendAlert({
      kind: "status",
      title: "HALO 3EL · ORDER REFUSED — EXECUTION LOCK HELD",
      body: `${job.symbol} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry} was NOT executed: another order is open or awaiting reconciliation.`,
    });
    return null;
  }

  // ── PAPER ──
  if (job.exec.executionMode === "paper") {
    try {
      await markSubmitting(intent.id);
      const tr = await db.trade.create({ data: { ...base, execMode: "PAPER", status: "OPEN", brokerOrderId: intent.clientOrderId } });
      await markOpen(intent.id, tr.id);
      announce(tr.id);
      engageTradeLock({
        source: job.source,
        symbol: job.symbol,
        tf: job.tf,
        dir: fire.dir,
        entry: fire.entry,
        sl: fire.sl,
        tp: fire.tp,
        tradeDbId: tr.id,
        openedAt: Date.now(),
      });
      return tr.id;
    } catch (e) {
      await markRejected(intent.id, `paper trade not recorded: ${(e as Error).message}`).catch(() => {});
      return null;
    }
  }

  // ── LIVE ──
  const broker = await resolveBroker(job.exec.brokerAccountId);
  if (!broker) {
    void sendAlert({
      kind: "broker",
      title: "HALO 3EL · LIVE ORDER SKIPPED",
      body: `No active broker account — set one in BROKERS. Signal dropped: ${job.symbol} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry}`,
    });
    try {
      const tr = await db.trade.create({
        data: { ...base, execMode: "LIVE", status: "REJECTED", note: "no active broker" },
      });
      void tr;
    } catch {
      // ignore
    }
    await markRejected(intent.id, "no active broker");
    return null;
  }

  const adapter = getAdapter(broker.kind);
  const creds = parseCreds(broker.credsJson);
  await markSubmitting(intent.id);
  let res: Awaited<ReturnType<typeof adapter.marketOrder>>;
  try {
    res = await adapter.marketOrder(creds, {
    symbol: job.symbol,
    side: fire.dir,
    entry: fire.entry,
    sl: fire.sl,
    tp: fire.tp,
    riskDistance: Math.abs(fire.entry - fire.sl),
    riskPips: fire.riskPips,
    sizing:
      job.exec.sizingMode === "percent"
        ? { mode: "percent", percent: job.exec.sizePercent, size: 0 }
        : { mode: "fixed", size: job.exec.sizeFixed, percent: 0 },
    comment: `HALO3EL ${job.source}`,
    clientOrderId: intent.clientOrderId,
  });
  } catch (e) {
    // no answer from the broker — the order may or may not exist: keep the lock
    await markUncertain(intent.id, `broker call failed: ${(e as Error).message}`);
    return null;
  }

  if (!res.ok && isUncertainBrokerError(res.error ?? "")) {
    await markUncertain(intent.id, `no reliable broker answer: ${res.error ?? ""}`);
    return null;
  }

  if (!res.ok) {
    await markRejected(intent.id, res.error ?? "broker rejected the order");
    void sendAlert({
      kind: "broker",
      title: `HALO 3EL · ${broker.label} ORDER REJECTED`,
      body: `${job.symbol} ${fire.dir === -1 ? "SELL" : "BUY"} @ ${fire.entry} — ${res.error ?? "unknown error"}`,
    });
    try {
      await db.trade.create({
        data: { ...base, execMode: "LIVE", brokerKind: broker.kind, status: "REJECTED", note: (res.error ?? "").slice(0, 250) },
      });
    } catch {
      // ignore
    }
    return null;
  }

  try {
    const tr = await db.trade.create({
      data: {
        ...base,
        execMode: "LIVE",
        brokerKind: broker.kind,
        brokerOrderId: (res.brokerOrderId ?? "").slice(0, 120),
        status: "OPEN",
        note: [res.error ? `fill ok; note: ${res.error}` : "", fillSlipNote(job.symbol, fire.entry, res.fillPrice)].filter(Boolean).join(" | ").slice(0, 250),
      },
    });
    await markOpen(intent.id, tr.id, (res.brokerOrderId ?? "").slice(0, 120));
    announce(tr.id);
    engageTradeLock({
      source: job.source,
      symbol: job.symbol,
      tf: job.tf,
      dir: fire.dir,
      entry: fire.entry,
      sl: fire.sl,
      tp: fire.tp,
      tradeDbId: tr.id,
      openedAt: Date.now(),
    });
    return tr.id;
  } catch (e) {
    // the broker filled but the record failed — the position exists: keep the lock
    await markUncertain(intent.id, `filled at the broker but not recorded: ${(e as Error).message}`).catch(() => {});
    return null;
  }
}

/** post-fill slippage vs the order price — recorded on the trade and alerted
 *  when it exceeds the EDGE slippage limit (the fill already happened) */
function fillSlipNote(symbol: string, entry: number, fill: number | undefined): string {
  if (!fill || !Number.isFinite(fill)) return "";
  const pips = Math.abs(fill - entry) / ((getSymbolMeta(symbol).mintick || 0.01) * 10);
  const limit = getEdgeSync().spread;
  if (limit.enabled && limit.maxSlippagePips > 0 && pips > limit.maxSlippagePips) {
    void sendAlert({
      kind: "broker",
      title: `HALO · FILL SLIPPAGE ${pips.toFixed(1)} PIPS · ${symbol}`,
      body: `Filled at ${fill} vs order price ${entry} — over the ${limit.maxSlippagePips} pip slippage limit. The position is open; review it in the platform.`,
    });
  }
  return `fill ${fill} (slippage ${pips.toFixed(1)} pips)`;
}

/** Close the live broker position backing a trade (engine says SL/TP hit). */
export async function closeBrokerPosition(
  broker: ActiveBroker,
  symbol: string,
  side?: -1 | 1
): Promise<{ ok: boolean; error?: string }> {
  const adapter = getAdapter(broker.kind);
  const creds = parseCreds(broker.credsJson);
  const res = await adapter.closePosition(creds, symbol, side);
  if (!res.ok) {
    void sendAlert({
      kind: "broker",
      title: `HALO 3EL · ${broker.label} CLOSE FAILED`,
      body: `${symbol} — ${res.error ?? "unknown error"}. The broker-side SL/TP usually closes it anyway.`,
    });
  }
  return { ok: res.ok, error: res.error };
}

/** " Signal grade A plus, score 87." — empty when ungraded or announcing is off. */
export function gradeSpeech(g: SignalGrade | null): string {
  if (!g || !getEdgeSync().quality.announce) return "";
  return ` Signal grade ${g.letter.replace("+", " plus")}, score ${g.score}.`;
}

/** price-guard refusal: REJECTED trade row (with the reason) + alert + voice */
export async function recordPriceGuardRejection(r: {
  source: string;
  symbol: string;
  tf: string;
  dir: -1 | 1;
  entry: number;
  sl: number;
  tp: number;
  riskPips: number;
  rewardPips: number;
  levelTop: number;
  levelBot: number;
  slMode: string;
  live: boolean;
  reason: string;
}): Promise<void> {
  try {
    await db.trade.create({
      data: {
        mode: r.source,
        execMode: r.live ? "LIVE" : "PAPER",
        symbol: r.symbol,
        timeframe: r.tf,
        direction: r.dir,
        entry: r.entry,
        sl: r.sl,
        tp: r.tp,
        riskPips: r.riskPips,
        rewardPips: r.rewardPips,
        levelTop: r.levelTop,
        levelBot: r.levelBot,
        slMode: r.slMode,
        status: "REJECTED",
        note: `price guard: ${r.reason}`.slice(0, 250),
        openedAt: new Date(),
      },
    });
  } catch {
    // the alert below still reports it
  }
  const meta = getSymbolMeta(r.symbol);
  const label = meta.label.split("·")[0].trim() || r.symbol;
  void sendAlert({
    kind: "status",
    title: `HALO · ORDER REFUSED — PRICE GUARD · ${label}`,
    body: `${r.source} ${r.dir === -1 ? "SELL" : "BUY"} @ ${r.entry} on ${r.symbol} ${r.tf} was NOT executed — ${r.reason}.`,
  });
  publishBotEvent({
    kind: "status",
    prio: "low",
    symbol: r.symbol,
    tf: r.tf,
    time: Date.now(),
    title: `PRICE GUARD · ORDER REFUSED · ${label}`,
    spoken: `A ${r.dir === -1 ? "sell" : "buy"} signal on ${label} was not traded: ${r.reason}.`,
  });
}
