// ════════════════════════════════════════════════════════════════════════
//  ALL-PAIRS SWEEP · the bot scans EVERY catalog pair for a trade
//
//  "…allow the bot to scan all pairs for trade, and if found and a trade
//   fire, all armed levels are deleted until a running trade hit TP or SL,
//   then scanning activates. Scanning should only be done from a 1h time
//   frame to a 4h time frame on all pairs."
//
//  • Universe: every symbol in the market catalog (SYMBOLS) on the 1H and
//    4H timeframes ONLY — the scan window is 1h → 4h, nothing faster.
//  • One 3EL engine per symbol+tf, warmed lazily over history and ticked
//    round-robin, one row per 3s slice (feed-friendly: a full pass over
//    the whole catalog takes ~15 minutes — ample for 1h/4h bars).
//  • A sweep fire executes through the SAME execution layer as the EA bot
//    and the Scanner (paper or live broker). The moment it executes, the
//    GLOBAL TRADE LOCK engages (execution.ts): every armed level in the
//    app is deleted and all scanning freezes until the running trade hits
//    TP or SL — then the sweep resumes automatically.
//  • Sweep settings persist in the SystemSetting KV (key "sweepConfig").
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { HaloEngine } from "./halo/engine";
import type { EngineEvent, Side } from "./halo/types";
import { DEFAULT_CONFIG, type HaloConfig } from "./halo/types";
import { getKlines, getSymbolMeta, tfSec } from "./market";
import { clampConfig } from "./bot";
import { SYMBOLS, decimalsOf } from "./market-symbols";
import { executeFire, loadExecSettings, resolveBroker, closeBrokerPosition } from "./execution";
import { sendAlert } from "./alerts";
import { publishBotEvent } from "./halo/event-bus";
import { getTradeLock, isLockHolder, maybeReleaseLock, registerLockParticipant, type TradeLockState } from "./trade-lock";
import { liveTradeManager } from "./edge/settings";
import { applyManageLive } from "./edge/trade-manager";

export const SWEEP_TFS = ["1h", "4h"] as const;
const KV_KEY = "sweepConfig";
const WARM_BARS = 400;
const SLICE_MS = 3000;
const SETUP_CAP = 24;

interface SweepRow {
  symbol: string;
  tf: string;
  engine: HaloEngine;
  cfgHash: string;
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

interface SweepRuntime {
  enabled: boolean;
  autoTrade: boolean;
  cfgLoadedAt: number;
  cfgHash: string;
  rows: Map<string, SweepRow>;
  order: string[];
  cursor: number;
  timer: ReturnType<typeof setInterval> | null;
  syncing: boolean;
  slicing?: boolean; // OVERLAP GUARD — never run two sweep slices concurrently
  startedAt: number;
  fires: number;
  lastRun: number;
  lastFire: { symbol: string; tf: string; dir: Side; entry: number; time: number; traded: boolean } | null;
}

const g = globalThis as unknown as { __haloSweep?: SweepRuntime };

function rt(): SweepRuntime {
  if (!g.__haloSweep) {
    g.__haloSweep = {
      enabled: true,
      autoTrade: true,
      cfgLoadedAt: 0,
      cfgHash: "",
      rows: new Map(),
      order: [],
      cursor: 0,
      timer: null,
      syncing: false,
      startedAt: Date.now(),
      fires: 0,
      lastRun: 0,
      lastFire: null,
    };
  }
  return g.__haloSweep;
}

// GLOBAL TRADE LOCK participant — when a trade fires anywhere in the app the
// lock wipes every sweep engine's armed levels ("all armed levels are deleted")
registerLockParticipant({
  key: "sweep",
  clearLevels: (time) => {
    let n = 0;
    for (const row of rt().rows.values()) n += row.engine.clearArmedLevels(time);
    return n;
  },
  forceClose: async () => {
    let closed = false;
    for (const row of rt().rows.values()) {
      if (!row.openTradeDbId || !row.engine.snapshot().trade) continue;
      const px = row.lastPrice || row.engine.snapshot().trade!.entry;
      await handleEvents(row, row.engine.forceClose(px, Date.now()));
      closed = true;
    }
    return closed;
  },
});

async function loadSweepConfig(): Promise<{ enabled: boolean; autoTrade: boolean }> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key: KV_KEY } });
    if (row) {
      const j = JSON.parse(row.valueJson) as { enabled?: boolean; autoTrade?: boolean };
      return { enabled: j.enabled !== false, autoTrade: j.autoTrade !== false };
    }
  } catch {
    // db not ready — defaults
  }
  return { enabled: true, autoTrade: true };
}

async function saveSweepConfig(cfg: { enabled: boolean; autoTrade: boolean }): Promise<void> {
  try {
    await db.systemSetting.upsert({
      where: { key: KV_KEY },
      create: { key: KV_KEY, valueJson: JSON.stringify(cfg) },
      update: { valueJson: JSON.stringify(cfg) },
    });
  } catch {
    // ignore persistence failures
  }
}

async function currentCfg(): Promise<HaloConfig> {
  // sweep engines share the EA bot's strategy settings (same as the Scanner)
  try {
    const row = await db.botConfig.findUnique({ where: { id: "main" } });
    if (row?.configJson) return clampConfig({ ...DEFAULT_CONFIG, ...JSON.parse(row.configJson) });
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

function rowKey(symbol: string, tf: string): string {
  return `${symbol}:${tf}`;
}

function makeRow(symbol: string, tf: string, cfg: HaloConfig, hash: string): SweepRow {
  return {
    symbol,
    tf,
    engine: new HaloEngine(cfg, getSymbolMeta(symbol).mintick),
    cfgHash: hash,
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

function buildOrder(): string[] {
  const out: string[] = [];
  for (const s of SYMBOLS) {
    for (const tf of SWEEP_TFS) out.push(rowKey(s.id, tf));
  }
  return out;
}

function getOrCreateRow(key: string, cfg: HaloConfig, hash: string): SweepRow | null {
  const R = rt();
  const [symbol, tf] = key.split(":");
  const meta = getSymbolMeta(symbol);
  if (meta.id !== symbol) return null; // unknown ticker — never scan it
  let row = R.rows.get(key);
  if (!row) {
    row = makeRow(symbol, tf, cfg, hash);
    R.rows.set(key, row);
  }
  return row;
}

/** Load config + catalog, (re)build engines when settings changed, arm the ticker. */
export async function ensureSweep(): Promise<SweepRuntime> {
  const R = rt();
  if (R.syncing) return R;
  R.syncing = true;
  try {
    if (Date.now() - R.cfgLoadedAt > 10_000) {
      const cfg = await loadSweepConfig();
      R.enabled = cfg.enabled;
      R.autoTrade = cfg.autoTrade;
      R.cfgLoadedAt = Date.now();
    }
    if (R.order.length === 0) R.order = buildOrder();
    const cfg = await currentCfg();
    const h = JSON.stringify(cfg);
    if (h !== R.cfgHash) {
      // strategy settings changed → rebuild every sweep engine lazily
      R.cfgHash = h;
      R.rows.clear();
    }
    if (R.enabled && !R.timer) {
      R.timer = setInterval(() => {
        sweepSlice().catch(() => {});
      }, SLICE_MS);
      (R.timer as unknown as { unref?: () => void }).unref?.();
    } else if (!R.enabled && R.timer) {
      clearInterval(R.timer);
      R.timer = null;
    }
  } catch {
    // db not ready — retry on the next call
  } finally {
    R.syncing = false;
  }
  return R;
}

function updateDerived(row: SweepRow): void {
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

async function handleEvents(row: SweepRow, events: EngineEvent[]): Promise<void> {
  const R = rt();
  const meta = getSymbolMeta(row.symbol);
  const symLabel = meta.label.split("·")[0].trim() || row.symbol;
  const px = (v: number): string => v.toFixed(decimalsOf(meta.mintick));
  for (const e of events) {
    if (e.type === "fire") {
      row.lastSignal = { dir: e.dir, kind: "fire", time: e.time };
      R.fires += 1;
      R.lastFire = { symbol: row.symbol, tf: row.tf, dir: e.dir, entry: e.entry, time: e.time, traded: false };
      // GLOBAL TRADE LOCK — one running trade at a time across the whole app
      const lock = getTradeLock();
      if (lock) {
        void sendAlert({
          kind: "status",
          title: `SWEEP · SIGNAL SKIPPED — TRADE ALREADY RUNNING · ${symLabel}`,
          body: `${e.dir === -1 ? "SELL" : "BUY"} @ ${e.entry} on ${row.symbol} ${row.tf} was NOT executed: a trade is already running on ${lock.symbol} ${lock.tf}. Scanning resumes when it hits TP or SL.`,
        });
        continue;
      }
      let traded = false;
      // simulated-only feed (e.g. Deriv synthetics while Deriv is unreachable):
      // the price guard refuses these orders by design (Decision B), so the
      // sweep reports a signal instead of booking a rejected trade every time
      const simulated = row.source === "simulator";
      if (R.autoTrade && !simulated) {
        const exec = await loadExecSettings();
        const live = exec.executionMode === "live";
        const tradeId = await executeFire({
          source: "SWEEP",
          symbol: row.symbol,
          tf: row.tf,
          fire: e,
          levelTop: e.levelTop,
          levelBot: e.levelBot,
          slModeLabel: "Fixed points",
          exec,
        });
        row.openTradeDbId = tradeId;
        if (live && tradeId) {
          const broker = await resolveBroker(exec.brokerAccountId);
          row.liveBrokerId = broker?.id ?? null;
        }
        traded = Boolean(tradeId);
        if (R.lastFire) R.lastFire.traded = traded;
      }
      if (!traded) {
        // signal-only (auto-trade off, or execution refused): the sweep says
        // it once — no execution, no trade lock
        publishBotEvent({
          kind: "status",
          prio: "low",
          symbol: row.symbol,
          tf: row.tf,
          time: e.time,
          title: `SWEEP SIGNAL · ${e.dir === -1 ? "SELL" : "BUY"} ${symLabel} @ ${px(e.entry)}`,
          spoken: `The all-pairs sweep found a ${e.dir === -1 ? "sell" : "buy"} break and return on ${symLabel} at ${px(e.entry)}. Signal only — no trade was opened${simulated ? " (simulated prices, no live feed for this market)" : ""}.`,
        });
      }
      void sendAlert({
        kind: "scanner",
        title: `SWEEP ${e.dir === -1 ? "SELL" : "BUY"} · ${symLabel} ${row.tf.toUpperCase()}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}\n${
          traded ? "AUTO-TRADED via the all-pairs sweep" : simulated ? "signal only — simulated prices, no live feed for this market" : R.autoTrade ? "auto-trade ON but execution rejected" : "signal only — sweep auto-trade OFF"
        }\nRisk ${e.riskPips.toFixed(1)} → reward ${e.rewardPips.toFixed(1)} pips`,
      });
    } else if (e.type === "manage") {
      // EDGE Smart Trade Manager — mirror stop moves / partials onto book + broker
      if (row.openTradeDbId) {
        const broker = row.liveBrokerId ? await resolveBroker(row.liveBrokerId) : null;
        const out = await applyManageLive(e, { tradeDbId: row.openTradeDbId, broker, symbol: row.symbol });
        void sendAlert({ kind: "status", title: `${"SWEEP"} · TRADE MANAGER ${e.action.toUpperCase()} · ${symLabel}`, body: `${e.message}\n${out.note}` });
      }
    } else if (e.type === "range_skip") {
      // range filter refused the fire on this sweep row — log it honestly
      void sendAlert({
        kind: "skip",
        title: `SWEEP · TRADE SKIPPED — RANGING MARKET (${e.dir === -1 ? "SELL" : "BUY"}) · ${symLabel}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}\nThe too-close level is burned — the engine keeps hunting fresh levels further from the range.`,
      });
    } else if (e.type === "win" || e.type === "loss") {
      if (row.lastSignal) row.lastSignal = { ...row.lastSignal, kind: e.type };
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
      maybeReleaseLock("SWEEP", row.symbol, row.tf, e.type, e.pips);
      void sendAlert({
        kind: e.type,
        title: `SWEEP ${e.type === "win" ? "TP +" : "SL −"}${e.pips.toFixed(1)} PIPS · ${symLabel}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}`,
      });
    }
  }
}

async function tickRow(row: SweepRow): Promise<void> {
  const now = Date.now();
  row.lastTickAt = now;
  const secMs = tfSec(row.tf) * 1000;

  // GLOBAL TRADE LOCK: only the row holding the running trade keeps ticking
  if (!isLockHolder("SWEEP", row.symbol, row.tf)) return;

  if (!row.bootstrapped) {
    const { candles, source } = await getKlines(row.symbol, row.tf, WARM_BARS, { deep: true });
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

/** One round-robin step: warm/tick a single symbol+tf row. */
async function sweepSlice(): Promise<void> {
  const R = rt();
  // OVERLAP GUARD — the ticker fires every beat whether or not the previous
  // slice finished. When a live-feed request hangs, slices would pile up and
  // starve the event loop (slow app, silent bots). Skip the beat instead —
  // the same discipline the 3EL bot runtime applies.
  if (R.slicing) return;
  if (!R.enabled || R.order.length === 0) return;
  R.slicing = true;
  try {
    await sweepSliceBody(R);
  } finally {
    R.slicing = false;
  }
}

async function sweepSliceBody(R: SweepRuntime): Promise<void> {
  R.lastRun = Date.now();
  const lock = getTradeLock();
  if (lock && lock.source === "SWEEP") {
    // this runtime holds the running trade — keep ONLY that row ticking so
    // its TP/SL are detected; everything else stays frozen
    const row = R.rows.get(rowKey(lock.symbol, lock.tf));
    if (row && !row.busy) {
      row.busy = true;
      try {
        await tickRow(row);
      } catch (e) {
        row.lastError = (e as Error).message.slice(0, 160);
      } finally {
        row.busy = false;
      }
    }
    return;
  }
  if (lock) return; // scanning paused — a trade is running on another runtime
  const cfg = await currentCfg();
  const hash = JSON.stringify(cfg);
  const key = R.order[R.cursor % R.order.length];
  R.cursor = (R.cursor + 1) % R.order.length;
  const row = getOrCreateRow(key, cfg, hash);
  if (!row || row.busy) return;
  row.busy = true;
  try {
    await tickRow(row);
  } catch (e) {
    row.lastError = (e as Error).message.slice(0, 160);
  } finally {
    row.busy = false;
  }
}

// ───────────────────────── public API ─────────────────────────

export interface SweepRowState {
  symbol: string;
  symbolLabel: string;
  tf: string;
  status: string;
  price: number;
  freshSell: number;
  freshBuy: number;
  nearest: { side: Side; distAtr: number } | null;
  lastSignal: { dir: Side; kind: string; time: number } | null;
  source: string;
  error: string;
  warm: boolean;
}

export interface SweepState {
  enabled: boolean;
  autoTrade: boolean;
  tfWindow: string[];
  pairsTotal: number;
  pairsWarm: number;
  cursor: number;
  fires: number;
  lastRun: number;
  lastFire: SweepRuntime["lastFire"];
  lock: TradeLockState | null;
  setups: SweepRowState[];
}

function rowState(row: SweepRow): SweepRowState {
  const meta = getSymbolMeta(row.symbol);
  let status = "SCANNING";
  if (row.lastError) status = "ERROR";
  else if (!row.bootstrapped) status = "WARMING";
  else if (row.engine.snapshot().trade) status = "RUNNING";
  else if (row.nearest && row.nearest.distAtr <= 0.6) status = "C3 WATCH";
  return {
    symbol: row.symbol,
    symbolLabel: meta.label,
    tf: row.tf,
    status,
    price: row.lastPrice,
    freshSell: row.freshSell,
    freshBuy: row.freshBuy,
    nearest: row.nearest,
    lastSignal: row.lastSignal,
    source: row.source,
    error: row.lastError,
    warm: row.bootstrapped,
  };
}

export async function sweepState(): Promise<SweepState> {
  const R = await ensureSweep();
  const withSetups = [...R.rows.values()]
    .filter((r) => r.freshBuy + r.freshSell > 0 || r.lastSignal !== null)
    .sort((a, b) => b.freshBuy + b.freshSell - (a.freshBuy + a.freshSell))
    .slice(0, SETUP_CAP);
  return {
    enabled: R.enabled,
    autoTrade: R.autoTrade,
    tfWindow: [...SWEEP_TFS],
    pairsTotal: R.order.length,
    pairsWarm: R.rows.size,
    cursor: R.cursor,
    fires: R.fires,
    lastRun: R.lastRun,
    lastFire: R.lastFire,
    lock: getTradeLock(),
    setups: withSetups.map(rowState),
  };
}

/** Toggle the all-pairs sweep (Scanner panel switches). */
export async function configSweep(patch: { enabled?: boolean; autoTrade?: boolean }): Promise<void> {
  const R = await ensureSweep();
  if (patch.enabled !== undefined) R.enabled = patch.enabled;
  if (patch.autoTrade !== undefined) R.autoTrade = patch.autoTrade;
  R.cfgLoadedAt = Date.now();
  await saveSweepConfig({ enabled: R.enabled, autoTrade: R.autoTrade });
  if (R.enabled && !R.timer) {
    R.timer = setInterval(() => {
      sweepSlice().catch(() => {});
    }, SLICE_MS);
    (R.timer as unknown as { unref?: () => void }).unref?.();
  } else if (!R.enabled && R.timer) {
    clearInterval(R.timer);
    R.timer = null;
  }
}

/** Tick the next batch of rows from the cursor (used by "SWEEP NOW"). */
export async function sweepNow(): Promise<number> {
  const R = await ensureSweep();
  const lock = getTradeLock();
  if (lock) return 0; // scanning paused
  const cfg = await currentCfg();
  const hash = JSON.stringify(cfg);
  const BATCH = 48; // one manual pass = a slice of the catalog, not a 322-row marathon
  let n = 0;
  for (let i = 0; i < R.order.length && n < BATCH; i++) {
    const key = R.order[R.cursor % R.order.length];
    R.cursor = (R.cursor + 1) % R.order.length;
    const row = getOrCreateRow(key, cfg, hash);
    if (!row || row.busy) continue;
    row.busy = true;
    try {
      await tickRow(row);
      n += 1;
    } catch (e) {
      row.lastError = (e as Error).message.slice(0, 160);
    } finally {
      row.busy = false;
    }
  }
  R.lastRun = Date.now();
  return n;
}
