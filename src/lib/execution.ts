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
  source: "BOT" | "SCAN";
  symbol: string;
  tf: string;
  fire: FireEvent;
  levelTop: number;
  levelBot: number;
  slModeLabel: string;
  exec: ExecSettings;
}

/** Execute a fire: returns the created Trade id, or null when nothing was opened. */
export async function executeFire(job: FireJob): Promise<string | null> {
  const { fire } = job;
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
  };

  // Scanner / auto-trade fires say it out loud too (the 3EL bot announces
  // its own fires in bot.ts — source BOT must not announce twice here).
  const announce = (tradeId: string): void => {
    if (job.source !== "SCAN") return;
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
        title: `TRADE FIRED · ${fire.dir === -1 ? "SELL" : "BUY"} ${label} @ ${px(fire.entry)}`,
        spoken: `Trade fired — ${fire.dir === -1 ? "sell" : "buy"} ${label} at ${px(fire.entry)}. Stop loss ${px(fire.sl)}, take profit ${px(fire.tp)}. Risk ${fire.riskPips.toFixed(1)} pips for a target of ${fire.rewardPips.toFixed(1)} pips.`,
      });
    } catch {
      // announcement must never break execution
    }
  };

  // ── PAPER ──
  if (job.exec.executionMode === "paper") {
    try {
      const tr = await db.trade.create({ data: { ...base, execMode: "PAPER", status: "OPEN" } });
      announce(tr.id);
      return tr.id;
    } catch {
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
    return null;
  }

  const adapter = getAdapter(broker.kind);
  const creds = parseCreds(broker.credsJson);
  const res = await adapter.marketOrder(creds, {
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
  });

  if (!res.ok) {
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
        note: res.error ? `fill ok; note: ${res.error}`.slice(0, 250) : "",
      },
    });
    announce(tr.id);
    return tr.id;
  } catch {
    return null;
  }
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
