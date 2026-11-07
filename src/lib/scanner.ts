// ════════════════════════════════════════════════════════════════════════
//  MULTI-SYMBOL SCANNER · runs the 3EL engine across a watchlist
//  • One engine per symbol+tf, warmed over history, ticked round-robin
//  • Fires → alert (Telegram/email/push) + optional auto-trade through the
//    same execution mode as the EA bot (paper or live broker)
//  • Rows live in ScannerSymbol (SQLite), engines in a global singleton
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { HaloEngine } from "./halo/engine";
import type { EngineEvent, Side } from "./halo/types";
import { getKlines, getSymbolMeta, tfSec } from "./market";
import { clampConfig } from "./bot";
import { DEFAULT_CONFIG, type HaloConfig } from "./halo/types";
import { closeBrokerPosition, executeFire, loadExecSettings, resolveBroker } from "./execution";
import { sendAlert } from "./alerts";
import { publishBotEvent } from "./halo/event-bus";
import { getTradeLock, isLockHolder, maybeReleaseLock, registerLockParticipant } from "./trade-lock";
import { liveTradeManager } from "./edge/settings";
import { applyManageLive } from "./edge/trade-manager";

export const MAX_ROWS = 12;

// GLOBAL TRADE LOCK participant — when a trade fires anywhere in the app the
// lock wipes every watchlist engine's armed levels ("all armed levels are deleted")
registerLockParticipant({
  key: "scanner",
  clearLevels: (time) => {
    let n = 0;
    for (const row of rt().rows.values()) n += row.engine.clearArmedLevels(time);
    return n;
  },
});

interface ScannerRow {
  dbId: string;
  symbol: string;
  tf: string;
  enabled: boolean;
  autoTrade: boolean;
  engine: HaloEngine;
  bootstrapped: boolean;
  busy: boolean;
  lastConfirmedTime: number;
  lastPrice: number;
  lastTickAt: number;
  lastError: string;
  source: string;
  freshSell: number;
  freshBuy: number;
  nearest: { side: Side; distAtr: number } | null;
  lastSignal: { dir: Side; kind: "fire" | "win" | "loss"; time: number } | null;
  openTradeDbId: string | null;
  liveBrokerId: string | null;
}

interface ScannerRuntime {
  rows: Map<string, ScannerRow>;
  timer: ReturnType<typeof setInterval> | null;
  syncing: boolean;
  rr: number;
  lastRun: number;
  startedAt: number;
  totalSignals: number;
  cfgHash: string;
}

const g = globalThis as unknown as { __haloScanner?: ScannerRuntime };

function rt(): ScannerRuntime {
  if (!g.__haloScanner) {
    g.__haloScanner = {
      rows: new Map(),
      timer: null,
      syncing: false,
      rr: 0,
      lastRun: 0,
      startedAt: Date.now(),
      totalSignals: 0,
      cfgHash: "",
    };
  }
  return g.__haloScanner;
}

function hashCfg(cfg: HaloConfig): string {
  return JSON.stringify(cfg);
}

async function currentCfg(): Promise<HaloConfig> {
  // scanner engines share the EA bot's strategy settings
  try {
    const row = await db.botConfig.findUnique({ where: { id: "main" } });
    if (row?.configJson) {
      return clampConfig({ ...DEFAULT_CONFIG, ...JSON.parse(row.configJson) });
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

function makeRow(r: { id: string; symbol: string; tf: string; enabled: boolean; autoTrade: boolean }, cfg: HaloConfig): ScannerRow {
  return {
    dbId: r.id,
    symbol: r.symbol,
    tf: r.tf,
    enabled: r.enabled,
    autoTrade: r.autoTrade,
    engine: new HaloEngine(cfg, getSymbolMeta(r.symbol).mintick),
    bootstrapped: false,
    busy: false,
    lastConfirmedTime: 0,
    lastPrice: 0,
    lastTickAt: 0,
    lastError: "",
    source: "—",
    freshSell: 0,
    freshBuy: 0,
    nearest: null,
    lastSignal: null,
    openTradeDbId: null,
    liveBrokerId: null,
  };
}

/** Load watchlist rows, rebuild engines when settings changed, start the ticker. */
export async function ensureScanner(): Promise<ScannerRuntime> {
  const R = rt();
  if (R.syncing) return R;
  R.syncing = true;
  try {
    const cfg = await currentCfg();
    const h = hashCfg(cfg);
    const rows = await db.scannerSymbol.findMany({ orderBy: { createdAt: "asc" } });

    // drop rows removed from DB or stale cfg
    for (const [id, row] of R.rows) {
      const still = rows.find((x) => x.id === id);
      if (!still || hashCfg(row.engine.cfg) !== h) R.rows.delete(id);
    }
    // add new rows
    for (const r of rows) {
      if (!R.rows.has(r.id)) R.rows.set(r.id, makeRow(r, cfg));
    }
    // refresh toggles
    for (const r of rows) {
      const row = R.rows.get(r.id);
      if (row) {
        row.enabled = r.enabled;
        row.autoTrade = r.autoTrade;
      }
    }
    R.cfgHash = h;

    const anyEnabled = rows.some((r) => r.enabled);
    if (anyEnabled && !R.timer) {
      R.timer = setInterval(() => {
        scannerSlice().catch(() => {});
      }, 3000);
      (R.timer as unknown as { unref?: () => void }).unref?.();
    } else if (!anyEnabled && R.timer) {
      clearInterval(R.timer);
      R.timer = null;
    }
  } catch {
    // db not ready
  } finally {
    R.syncing = false;
  }
  return R;
}

/** Tick a couple of rows per slice to spread the feed load. */
async function scannerSlice(): Promise<void> {
  const R = rt();
  const enabled = [...R.rows.values()].filter((r) => r.enabled);
  if (enabled.length === 0) return;
  const batch = 2;
  for (let i = 0; i < batch; i++) {
    const row = enabled[R.rr % enabled.length];
    R.rr = (R.rr + 1) % Math.max(1, enabled.length);
    if (row && !row.busy) {
      row.busy = true;
      tickRow(row)
        .catch((e) => {
          row.lastError = (e as Error).message.slice(0, 160);
        })
        .finally(() => {
          row.busy = false;
        });
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  R.lastRun = Date.now();
}

function updateDerived(row: ScannerRow): void {
  const snap = row.engine.snapshot();
  row.freshSell = snap.levels.filter((l) => l.side === -1).length;
  row.freshBuy = snap.levels.filter((l) => l.side === 1).length;
  const atr = snap.atr;
  const price = row.lastPrice;
  if (!atr || !price) {
    row.nearest = null;
    return;
  }
  let best: { side: Side; distAtr: number } | null = null;
  for (const l of snap.levels) {
    const raw = l.side === -1 ? l.bot - price : price - l.top;
    const d = Math.max(0, raw) / atr;
    if (!best || d < best.distAtr) best = { side: l.side, distAtr: d };
  }
  row.nearest = best;
}

async function handleEvents(row: ScannerRow, events: EngineEvent[]): Promise<void> {
  const meta = getSymbolMeta(row.symbol);
  const symLabel = meta.label.split("·")[0].trim() || row.symbol;
  for (const e of events) {
    if (e.type === "fire") {
      // GLOBAL TRADE LOCK — one running trade at a time across the whole app
      const lock = getTradeLock();
      if (lock) {
        void sendAlert({
          kind: "status",
          title: `SCANNER · SIGNAL SKIPPED — TRADE ALREADY RUNNING · ${symLabel}`,
          body: `${e.dir === -1 ? "SELL" : "BUY"} @ ${e.entry} on ${row.symbol} ${row.tf} was NOT executed: a trade is already running on ${lock.symbol} ${lock.tf}. Scanning resumes when it hits TP or SL.`,
        });
        publishBotEvent({
          kind: "status",
          prio: "low",
          symbol: row.symbol,
          tf: row.tf,
          time: e.time,
          title: `SCAN SIGNAL SKIPPED · TRADE RUNNING · ${symLabel}`,
          spoken: `A ${e.dir === -1 ? "sell" : "buy"} signal appeared on ${symLabel} on the scanner, but a trade is already running on ${lock.symbol} — skipped until it closes.`,
        });
        continue;
      }
      R_signals(row);
      const exec = await loadExecSettings();
      const live = exec.executionMode === "live";
      let traded = false;
      // simulated-only feed: the price guard refuses it by design — signal only
      if (row.autoTrade && row.source !== "simulator") {
        const tradeId = await executeFire({
          source: "SCAN",
          symbol: row.symbol,
          tf: row.tf,
          fire: e,
          levelTop: e.levelTop,
          levelBot: e.levelBot,
          slModeLabel: exec.sizingMode === "percent" ? "Fixed points" : "Fixed points",
          exec,
        });
        row.openTradeDbId = tradeId;
        if (live && tradeId) {
          const broker = await resolveBroker(exec.brokerAccountId);
          row.liveBrokerId = broker?.id ?? null;
        }
        traded = Boolean(tradeId);
      }
      void sendAlert({
        kind: "scanner",
        title: `SCANNER ${e.dir === -1 ? "SELL" : "BUY"} · ${symLabel} ${row.tf.toUpperCase()}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}\n${
          row.autoTrade ? (traded ? `AUTO-TRADED (${live ? "live" : "paper"})` : "auto-trade ON but execution rejected") : "signal only — auto-trade OFF"
        }\nRisk ${e.riskPips.toFixed(1)} → reward ${e.rewardPips.toFixed(1)} pips`,
      });
    } else if (e.type === "manage") {
      // EDGE Smart Trade Manager — mirror stop moves / partials onto book + broker
      if (row.openTradeDbId) {
        const broker = row.liveBrokerId ? await resolveBroker(row.liveBrokerId) : null;
        const out = await applyManageLive(e, { tradeDbId: row.openTradeDbId, broker, symbol: row.symbol });
        void sendAlert({ kind: "status", title: `${"SCAN"} · TRADE MANAGER ${e.action.toUpperCase()} · ${symLabel}`, body: `${e.message}\n${out.note}` });
      }
    } else if (e.type === "range_skip") {
      // range filter refused the fire on this watchlist row — announce it
      void sendAlert({
        kind: "skip",
        title: `SCANNER · TRADE SKIPPED — RANGING MARKET (${e.dir === -1 ? "SELL" : "BUY"}) · ${symLabel}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}\nThe too-close level is burned — the engine keeps hunting fresh levels further from the range.`,
      });
    } else if (e.type === "win" || e.type === "loss") {
      R_signals_close(row, e.type);
      if (row.openTradeDbId) {
        try {
          await db.trade.update({
            where: { id: row.openTradeDbId },
            data: { status: e.type === "win" ? "WIN" : "LOSS", resultPips: e.pips, closedAt: new Date(e.time) },
          });
        } catch {
          // ignore
        }
        if (row.liveBrokerId) {
          const broker = await resolveBroker(row.liveBrokerId);
          if (broker) await closeBrokerPosition(broker, row.symbol).catch(() => {});
        }
        row.openTradeDbId = null;
        row.liveBrokerId = null;
      }
      // GLOBAL TRADE LOCK release — the running trade closed (TP/SL)
      maybeReleaseLock("SCAN", row.symbol, row.tf, e.type, e.pips);
      void sendAlert({
        kind: e.type,
        title: `SCANNER ${e.type === "win" ? "TP +" : "SL −"}${e.pips.toFixed(1)} PIPS · ${symLabel}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}`,
      });
    }
  }
}

function R_signals(row: ScannerRow): void {
  const snap = row.engine.snapshot();
  const t = snap.trade;
  row.lastSignal = t ? { dir: t.dir, kind: "fire", time: t.entryTime } : row.lastSignal;
  rt().totalSignals += 1;
}

function R_signals_close(row: ScannerRow, kind: "win" | "loss"): void {
  if (row.lastSignal) row.lastSignal = { ...row.lastSignal, kind };
}

async function tickRow(row: ScannerRow): Promise<void> {
  const now = Date.now();
  row.lastTickAt = now;
  const secMs = tfSec(row.tf) * 1000;

  // GLOBAL TRADE LOCK: while a trade runs elsewhere the row is FROZEN (no
  // bar feeding, no arming, no fires) — only the lock's own row keeps
  // ticking so the running trade's TP/SL are detected.
  if (!isLockHolder("SCAN", row.symbol, row.tf)) return;

  if (!row.bootstrapped) {
    const { candles, source } = await getKlines(row.symbol, row.tf, 500, { deep: true });
    row.source = source;
    let lastConfirmed = 0;
    for (const c of candles) {
      if (c.time + secMs <= now) {
        row.engine.processBar(c, true);
        lastConfirmed = c.time;
      }
    }
    row.lastConfirmedTime = lastConfirmed;
    const live = candles[candles.length - 1];
    if (live) row.lastPrice = live.close;
    row.bootstrapped = true;
    row.lastError = "";
    updateDerived(row);
    return;
  }

  const { candles, source } = await getKlines(row.symbol, row.tf, 4, { fresh: true });
  row.source = source;
  row.engine.tm = liveTradeManager(); // EDGE Smart Trade Manager (null = off)
  for (const c of candles) {
    if (c.time > row.lastConfirmedTime && c.time + secMs <= now) {
      const ev = row.engine.processBar(c, true);
      await handleEvents(row, ev);
      row.lastConfirmedTime = c.time;
      row.lastPrice = c.close;
    }
  }
  // instant-mode intrabar trial (same rollback semantics as the EA bot)
  const live = candles[candles.length - 1];
  if (live && live.time + secMs > now && live.time > row.lastConfirmedTime) {
    row.lastPrice = live.close;
    if (row.engine.cfg.sigMode === "instant") {
      const clone = row.engine.clone();
      const ev = clone.processBar(live, false);
      // a range_skip consumes the level (burned) — commit it like a fire so
      // the intrabar trial never re-evaluates the same skip every tick
      const commit = ev.some((x) => x.type === "fire" || x.type === "win" || x.type === "loss" || x.type === "range_skip");
      if (commit) {
        row.engine = clone;
        await handleEvents(row, ev);
      }
    }
  }
  row.lastError = "";
  updateDerived(row);
}

// ───────────────────────── public API ─────────────────────────

export interface ScannerRowState {
  id: string;
  symbol: string;
  symbolLabel: string;
  tf: string;
  enabled: boolean;
  autoTrade: boolean;
  status: string;
  price: number;
  atr: number | null;
  freshSell: number;
  freshBuy: number;
  nearest: { side: Side; distAtr: number } | null;
  lastSignal: { dir: Side; kind: string; time: number } | null;
  source: string;
  error: string;
  warm: boolean;
}

export async function scannerState(): Promise<{
  rows: ScannerRowState[];
  enabledCount: number;
  autoTradeCount: number;
  totalSignals: number;
  lastRun: number;
  maxRows: number;
}> {
  const R = await ensureScanner();
  const rows: ScannerRowState[] = [...R.rows.values()].map((row) => {
    const meta = getSymbolMeta(row.symbol);
    let status = "SCANNING";
    if (!row.enabled) status = "PAUSED";
    else if (row.lastError) status = "ERROR";
    else if (!row.bootstrapped) status = "WARMING";
    else if (row.engine.snapshot().trade) status = "RUNNING";
    else if (row.nearest && row.nearest.distAtr <= 0.6) status = "C3 WATCH";
    return {
      id: row.dbId,
      symbol: row.symbol,
      symbolLabel: meta.label,
      tf: row.tf,
      enabled: row.enabled,
      autoTrade: row.autoTrade,
      status,
      price: row.lastPrice,
      atr: row.engine.snapshot().atr,
      freshSell: row.freshSell,
      freshBuy: row.freshBuy,
      nearest: row.nearest,
      lastSignal: row.lastSignal,
      source: row.source,
      error: row.lastError,
      warm: row.bootstrapped,
    };
  });
  return {
    rows,
    enabledCount: rows.filter((r) => r.enabled).length,
    autoTradeCount: rows.filter((r) => r.autoTrade && r.enabled).length,
    totalSignals: R.totalSignals,
    lastRun: R.lastRun,
    maxRows: MAX_ROWS,
  };
}

export async function scannerAdd(symbol: string, tf: string, autoTrade: boolean): Promise<void> {
  const R = await ensureScanner();
  const count = await db.scannerSymbol.count();
  if (count >= MAX_ROWS) throw new Error(`Scanner is capped at ${MAX_ROWS} symbols.`);
  const dup = await db.scannerSymbol.findUnique({ where: { symbol_tf: { symbol, tf } } });
  if (dup) throw new Error("That symbol+timeframe is already on the watchlist.");
  const cfg = await currentCfg();
  const row = await db.scannerSymbol.create({ data: { symbol, tf, autoTrade } });
  R.rows.set(row.id, makeRow(row, cfg));
}

export async function scannerPatch(id: string, patch: { enabled?: boolean; autoTrade?: boolean; tf?: string }): Promise<void> {
  const R = await ensureScanner();
  await db.scannerSymbol.update({ where: { id }, data: patch });
  if (patch.tf) R.rows.delete(id); // rebuild with new timeframe on next sync
  else {
    const row = R.rows.get(id);
    if (row) {
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
      if (patch.autoTrade !== undefined) row.autoTrade = patch.autoTrade;
    }
  }
}

export async function scannerRemove(id: string): Promise<void> {
  const R = await ensureScanner();
  await db.scannerSymbol.delete({ where: { id } }).catch(() => {});
  R.rows.delete(id);
}

/** Immediately tick every enabled row (used by "SCAN NOW"). */
export async function scannerScanNow(): Promise<void> {
  const R = await ensureScanner();
  const rows = [...R.rows.values()].filter((r) => r.enabled);
  for (const row of rows) {
    if (row.busy) continue;
    row.busy = true;
    try {
      await tickRow(row);
    } catch (e) {
      row.lastError = (e as Error).message.slice(0, 160);
    } finally {
      row.busy = false;
    }
  }
  R.lastRun = Date.now();
}
