// ════════════════════════════════════════════════════════════════════════
//  TIMEFRAME SCANNER BOT · market-wide hunting engine inside the HALO chat
//
//  "SCAN ALL AVAILABLE SUPPORTED MARKETS AND TIMEFRAMES TO FIND TRADING
//   OPPORTUNITIES THAT MEET THE EXISTING, ALREADY-IMPLEMENTED HALO TRADING
//   STRATEGY. Nothing more."
//
//  • The ONLY strategy here is the existing 3EL engine (HaloEngine) with
//    the EA bot's exact settings — every row runs the same processBar()
//    the bot / scanner / sweep / backtest run. No second engine, no new
//    rules, no indicators, no reinterpretation.
//  • Universe: every catalog symbol (SYMBOLS) × every timeframe the app
//    already supports (TIMEFRAMES). Nothing is added.
//  • FIRES ARE REAL TRADES: when the engine fires, the signal routes
//    through the SAME executeFire() execution layer as the EA bot / scanner
//    / sweep — a Trade row is written (paper or live, per the global exec
//    settings), the global trade lock engages, and the engine's own TP/SL
//    detection closes the row (WIN/LOSS + resultPips) so trade history and
//    the journal record every engine fire. No fire can stay a DB-less ghost.
//  • Trade-lock semantics stay consistent app-wide: the bot registers as a
//    lock participant (its armed levels are wiped when a trade fires
//    anywhere — "all armed levels are deleted"), it pauses scanning while a
//    trade runs and keeps ticking ONLY the row that owns the running trade
//    (so its TP/SL are detected), resuming the full universe after TP/SL.
//  • Settings persist in the SystemSetting KV ("tfScannerConfig"), same
//    infrastructure as the sweep. The ticker is kept alive server-side by
//    the same /api/bot/state keep-alive that drives the sweep.
//  • Feed-friendly pacing: round-robin slices tick a few rows every 2.5 s
//    through the shared candle cache (getKlines) — no duplicate fetching,
//    no excessive polling. A full pass over all symbol×timeframe rows
//    takes ~20 minutes; rows with armed levels ("hot") are re-checked
//    with priority so live setups are tracked tightly.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { HaloEngine } from "./halo/engine";
import type { EngineEvent, Side } from "./halo/types";
import { DEFAULT_CONFIG, type HaloConfig } from "./halo/types";
import { getKlines, getSymbolMeta, tfSec } from "./market";
import { clampConfig } from "./bot";
import { SYMBOLS, TIMEFRAMES, decimalsOf, isSimOnlyGroup } from "./market-symbols";
import { sendAlert } from "./alerts";
import { publishBotEvent } from "./halo/event-bus";
import { closeBrokerPosition, executeFire, loadExecSettings, resolveBroker } from "./execution";
import { bookPaperCloseFromDb } from "./paper-account";
import { getTradeLock, isLockHolder, maybeReleaseLock, registerLockParticipant } from "./trade-lock";

const KV_KEY = "tfScannerConfig";
const WARM_BARS = 400; // same warm-up depth as the sweep
const SLICE_MS = 2500;
// ADAPTIVE PACING — the old single ROWS_PER_SLICE=3 revisited every market
// only once per ~20 minutes, so a live setup could sit unnoticed for a third
// of an hour and the feed read as dead. Split the universe by feed cost:
// simulated-market rows (built-in simulator) cost NOTHING to tick, so they
// bootstrap and re-check several times faster; real-feed rows (Yahoo/Binance)
// stay at a rate the venues tolerate (their 8s fresh floor absorbs cache
// hits). Net effect: the simulated market is re-checked every ~2 min and the
// whole universe every ~6-8 min instead of ~20.
const BOOT_REAL_PER_SLICE = 3; // deep warm-ups against real venues (network-bound)
const BOOT_SIM_PER_SLICE = 10; // simulator warm-ups are free
const WARM_REAL_PER_SLICE = 4; // real-feed re-checks (mostly cache-friendly)
const WARM_SIM_PER_SLICE = 8; // simulated-market re-checks are free
const HOT_PER_SLICE = 2; // armed rows get extra priority re-checks
const MSG_CAP = 30;
const RECENT_CAP = 24; // found-trades list on the dashboard stays deep

export const TF_SCANNER_KEY = "tf_scan";

interface ScanRow {
  symbol: string;
  tf: string;
  engine: HaloEngine;
  bootstrapped: boolean;
  busy: boolean;
  lastConfirmedTime: number;
  lastPrice: number;
  lastTickAt: number;
  lastError: string;
  source: string;
  armed: number; // fresh armed levels on this row (strategy snapshot)
  // the DB trade this row's fire opened (executeFire) — the win/loss
  // handler closes it (status + resultPips + closedAt) so trade history
  // and the journal always record the engine's fires
  openTradeDbId: string | null;
  openTradeExec: "PAPER" | "LIVE";
  openTradeDir: -1 | 0 | 1;
  liveBrokerId: string | null;
}

export interface ScannerOpportunity {
  symbol: string;
  symbolLabel: string;
  tf: string;
  dir: Side; // -1 SELL · 1 BUY (strategy output)
  entry: number; // the dotted wick trigger — strategy-calculated
  sl: number; // strategy-calculated
  tp: number; // strategy-calculated
  riskPips: number;
  rewardPips: number;
  rr: string; // reward:risk as computed by the strategy (e.g. "1:3.0")
  time: number; // bar time of the fire
  sigMode: string; // Instant (intrabar) | Bar close — strategy confirmation mode
  status: string; // "ENTRY FIRED" → "TP HIT" / "SL HIT" (engine trade outcome)
}

export interface ScannerMsg {
  at: number;
  kind: "info" | "opportunity" | "pause" | "resume";
  text: string;
}

interface TfScannerRuntime {
  enabled: boolean;
  hasStarted: boolean;
  cfgLoadedAt: number;
  cfgHash: string;
  rows: Map<string, ScanRow>;
  order: string[];
  orderSim: string[]; // simulated-market rows (free to tick)
  orderReal: string[]; // real-venue rows (Yahoo/Binance, rate-aware)
  cursorSim: number;
  cursorReal: number;
  timer: ReturnType<typeof setInterval> | null;
  syncing: boolean;
  slicing: boolean; // OVERLAP GUARD — never run two scan slices concurrently
  startedAt: number;
  lastRun: number;
  lastPassAt: number;
  passes: number;
  scannedRows: number;
  currentKey: string;
  msgs: ScannerMsg[];
  opportunity: ScannerOpportunity | null;
  recent: ScannerOpportunity[];
  opportunitiesFound: number;
  rangeSkips: number;
  lockPausedAt: number;
}

const g = globalThis as unknown as { __haloTfScanner?: TfScannerRuntime };

function rt(): TfScannerRuntime {
  if (!g.__haloTfScanner) {
    g.__haloTfScanner = {
      enabled: false,
      hasStarted: false,
      cfgLoadedAt: 0,
      cfgHash: "",
      rows: new Map(),
      order: [],
      orderSim: [],
      orderReal: [],
      cursorSim: 0,
      cursorReal: 0,
      timer: null,
      syncing: false,
      slicing: false,
      startedAt: 0,
      lastRun: 0,
      lastPassAt: 0,
      passes: 0,
      scannedRows: 0,
      currentKey: "",
      msgs: [],
      opportunity: null,
      recent: [],
      opportunitiesFound: 0,
      rangeSkips: 0,
      lockPausedAt: 0,
    };
  }
  return g.__haloTfScanner;
}

// TRADE-LOCK participant — when a trade fires anywhere in the app, this
// runtime's armed levels are wiped too ("all armed levels are deleted") and
// scanSlice() pauses until the lock releases.
registerLockParticipant({
  key: "tf-scanner",
  clearLevels: (time) => {
    let n = 0;
    for (const row of rt().rows.values()) n += row.engine.clearArmedLevels(time);
    return n;
  },
});

function pushMsg(kind: ScannerMsg["kind"], text: string): void {
  const R = rt();
  R.msgs.push({ at: Date.now(), kind, text });
  if (R.msgs.length > MSG_CAP) R.msgs.splice(0, R.msgs.length - MSG_CAP);
  // the chat transcript (existing HALO chat) receives the line through the
  // live event stream — the announcer routes tf_scan events into the chat
  publishBotEvent({
    kind: "tf_scan",
    prio: "low",
    symbol: "",
    tf: "",
    time: Date.now(),
    title: text,
    spoken: "", // chat-only line — the scanner bot never speaks over the EA
  });
}

async function loadConfig(): Promise<boolean> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key: KV_KEY } });
    if (row) {
      const j = JSON.parse(row.valueJson) as { enabled?: boolean };
      return j.enabled === true;
    }
  } catch {
    // db not ready — default off until the user starts the bot
  }
  return false;
}

async function saveConfig(enabled: boolean): Promise<void> {
  try {
    await db.systemSetting.upsert({
      where: { key: KV_KEY },
      create: { key: KV_KEY, valueJson: JSON.stringify({ enabled }) },
      update: { valueJson: JSON.stringify({ enabled }) },
    });
  } catch {
    // ignore persistence failures
  }
}

async function currentCfg(): Promise<HaloConfig> {
  // the scanner shares the EA bot's strategy settings — the EXISTING
  // strategy exactly as configured, byte-for-byte
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

function buildOrder(): string[] {
  const out: string[] = [];
  for (const s of SYMBOLS) {
    for (const tf of TIMEFRAMES) out.push(rowKey(s.id, tf));
  }
  return out;
}

/** split the universe by feed cost — simulated-market rows tick for free */
function buildSimRealOrders(order: string[]): { sim: string[]; real: string[] } {
  const sim: string[] = [];
  const real: string[] = [];
  for (const key of order) {
    const sym = key.split(":")[0];
    if (isSimOnlyGroup(getSymbolMeta(sym).group)) sim.push(key);
    else real.push(key);
  }
  return { sim, real };
}

function makeRow(symbol: string, tf: string, cfg: HaloConfig): ScanRow {
  return {
    symbol,
    tf,
    engine: new HaloEngine(cfg, getSymbolMeta(symbol).mintick),
    bootstrapped: false,
    busy: false,
    lastConfirmedTime: 0,
    lastPrice: 0,
    lastTickAt: 0,
    lastError: "",
    source: "—",
    armed: 0,
    openTradeDbId: null,
    openTradeExec: "PAPER",
    openTradeDir: 0,
    liveBrokerId: null,
  };
}

/** Strategy-provided opportunity record — every value comes from the engine. */
function opportunityOf(row: ScanRow, e: Extract<EngineEvent, { type: "fire" }>): ScannerOpportunity {
  const meta = getSymbolMeta(row.symbol);
  return {
    symbol: row.symbol,
    symbolLabel: meta.label,
    tf: row.tf,
    dir: e.dir,
    entry: e.entry,
    sl: e.sl,
    tp: e.tp,
    riskPips: e.riskPips,
    rewardPips: e.rewardPips,
    rr: e.riskPips > 0 ? `1:${(e.rewardPips / e.riskPips).toFixed(1)}` : "—",
    time: e.time,
    sigMode: row.engine.cfg.sigMode === "instant" ? "Instant (intrabar)" : "Bar close",
    status: "ENTRY FIRED",
  };
}

function handleEvents(row: ScanRow, events: EngineEvent[]): void {
  const R = rt();
  for (const e of events) {
    if (e.type === "fire") {
      const opp = opportunityOf(row, e);
      R.opportunitiesFound += 1;
      R.opportunity = opp;
      R.recent.unshift(opp);
      if (R.recent.length > RECENT_CAP) R.recent.length = RECENT_CAP;
      const side = e.dir === -1 ? "SELL" : "BUY";
      const label = opp.symbolLabel.split("·")[0].trim() || row.symbol;
      // prices with the symbol's strategy precision — raw floats never reach
      // the chat bubble or the alert channels
      const entryPx = scannerPx(e.entry, row.symbol);
      const slPx = scannerPx(e.sl, row.symbol);
      const tpPx = scannerPx(e.tp, row.symbol);
      pushMsg(
        "opportunity",
        `A trading opportunity meeting the existing HALO strategy has been detected on ${label}, ${row.tf.toUpperCase()} — ${side} at ${entryPx}. View the details below.`,
      );
      // GLOBAL TRADE LOCK — one running trade at a time across the whole app:
      // while a trade runs anywhere the scanner's fire is honestly refused,
      // never silently dropped (the engine's virtual trade still tracks the
      // setup on the dashboard list until its own TP/SL).
      const lock = getTradeLock();
      if (lock) {
        void sendAlert({
          kind: "status",
          title: `SCANNER BOT · SIGNAL SKIPPED — TRADE ALREADY RUNNING · ${label}`,
          body: `${side} @ ${entryPx} on ${row.symbol} ${row.tf} was NOT executed: a trade is already running on ${lock.symbol} ${lock.tf}. Scanning resumes when it hits TP or SL.`,
        });
        continue;
      }
      // THE FIRE IS A REAL TRADE — the same execution layer the EA bot /
      // scanner / sweep use: a Trade row is written (paper or live, per the
      // global exec settings), the global trade lock engages and the
      // trade shows on the chart, in trade history and in the journal.
      void (async () => {
        try {
          const exec = await loadExecSettings();
          const live = exec.executionMode === "live";
          const tradeId = await executeFire({
            source: "SCAN",
            symbol: row.symbol,
            tf: row.tf,
            fire: e,
            levelTop: e.levelTop,
            levelBot: e.levelBot,
            slModeLabel: "Break extreme + buffer",
            exec,
          });
          row.openTradeDbId = tradeId;
          row.openTradeExec = live ? "LIVE" : "PAPER";
          row.openTradeDir = e.dir;
          row.liveBrokerId = live && tradeId ? (await resolveBroker(exec.brokerAccountId))?.id ?? null : null;
          if (tradeId) {
            void sendAlert({
              kind: "scanner",
              title: `SCANNER BOT ${side} · ${label} ${row.tf.toUpperCase()}`,
              body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}\nEntry ${entryPx} · SL ${slPx} · TP ${tpPx}\nRisk ${e.riskPips.toFixed(1)} → reward ${e.rewardPips.toFixed(1)} pips\nMode: ${live ? "LIVE · broker" : "PAPER"} — the trade is recorded in trade history and the journal.`,
            });
          } else {
            // execution refused/failed — executeFire already alerted honestly;
            // keep the dashboard list honest too
            opp.status = "NOT EXECUTED";
            if (R.opportunity === opp) R.opportunity = null;
          }
        } catch (err) {
          console.error("[tf-scanner] fire execution failed:", (err as Error).message);
          opp.status = "NOT EXECUTED";
        }
      })();
    } else if (e.type === "win" || e.type === "loss") {
      // the engine's own virtual trade management closed the opportunity —
      // report the outcome honestly against the recorded opportunity
      const hit = R.recent.find(
        (o) => o.symbol === row.symbol && o.tf === row.tf && o.status === "ENTRY FIRED",
      );
      if (hit) {
        hit.status = e.type === "win" ? `TP HIT (+${e.pips.toFixed(1)} pips)` : `SL HIT (−${e.pips.toFixed(1)} pips)`;
        if (R.opportunity === hit) {
          const label = hit.symbolLabel.split("·")[0].trim() || hit.symbol;
          pushMsg(
            "info",
            `The ${hit.tf.toUpperCase()} opportunity on ${label} has completed — ${e.type === "win" ? "take profit" : "stop loss"} hit (${e.pips.toFixed(1)} pips). Scanning continues.`,
          );
        }
      }
      // close the DB trade this fire opened — trade history + journal + the
      // simulator balance all book the engine's outcome (same as bot.ts)
      // only the row that OWNS the locked trade may release the lock — a
      // virtual (never-executed) result must never free a trade another
      // executor holds on the same pair+timeframe (the Market Scanner also
      // trades under the SCAN source)
      const ownsLock = row.openTradeDbId != null && getTradeLock()?.tradeDbId === row.openTradeDbId;
      if (row.openTradeDbId) {
        const dbId = row.openTradeDbId;
        const wasLive = row.openTradeExec === "LIVE";
        const brokerId = row.liveBrokerId;
        const tradeDir = row.openTradeDir === -1 ? -1 : row.openTradeDir === 1 ? 1 : undefined;
        void (async () => {
          try {
            if (wasLive && brokerId) {
              const broker = await resolveBroker(brokerId);
              if (broker) await closeBrokerPosition(broker, row.symbol, tradeDir).catch(() => {});
            }
            await db.trade.update({
              where: { id: dbId },
              data: {
                status: e.type === "win" ? "WIN" : "LOSS",
                resultPips: e.type === "win" ? e.pips : -e.pips,
                closedAt: new Date(e.time),
              },
            });
            // paper close → persistent simulator balance (no-op for LIVE)
            void bookPaperCloseFromDb(dbId);
          } catch (err) {
            console.error("[tf-scanner] trade close bookkeeping failed:", (err as Error).message);
          }
        })();
        row.openTradeDbId = null;
        row.openTradeExec = "PAPER";
        row.openTradeDir = 0;
        row.liveBrokerId = null;
      }
      // GLOBAL TRADE LOCK release — the running trade closed (TP/SL),
      // scanning re-activates app-wide (announced on the bus)
      if (ownsLock) maybeReleaseLock("SCAN", row.symbol, row.tf, e.type, e.pips);
    } else if (e.type === "range_skip") {
      // the strategy refused the trade (ranging market, S/R too close) —
      // that is NOT an opportunity; count it honestly, stay silent
      R.rangeSkips += 1;
    }
  }
}

async function tickRow(row: ScanRow): Promise<void> {
  const now = Date.now();
  row.lastTickAt = now;
  const secMs = tfSec(row.tf) * 1000;

  // GLOBAL TRADE LOCK: while a trade runs elsewhere the row is FROZEN (no
  // bar feeding, no arming, no fires) — only the row that owns the running
  // trade keeps ticking so its TP/SL are detected (same discipline as the
  // watchlist scanner). The lock holder is identified by source+symbol+tf.
  if (!isLockHolder("SCAN", row.symbol, row.tf)) return;

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
    row.armed = row.engine.snapshot().levels.length;
    return;
  }

  const { candles, source } = await getKlines(row.symbol, row.tf, 4, { fresh: true });
  row.source = source;
  for (const c of candles) {
    if (c.time > row.lastConfirmedTime && c.time + secMs <= now) {
      const ev = row.engine.processBar(c, true);
      handleEvents(row, ev);
      row.lastConfirmedTime = c.time;
      row.lastPrice = c.close;
    }
  }
  // instant-mode intrabar trial — same rollback semantics as the EA bot
  const live = candles[candles.length - 1];
  if (live && live.time + secMs > now && live.time > row.lastConfirmedTime) {
    row.lastPrice = live.close;
    if (row.engine.cfg.sigMode === "instant") {
      const clone = row.engine.clone();
      const ev = clone.processBar(live, false);
      const commit = ev.some((x) => x.type === "fire" || x.type === "win" || x.type === "loss" || x.type === "range_skip");
      if (commit) {
        row.engine = clone;
        handleEvents(row, ev);
      }
    }
  }
  row.lastError = "";
  row.armed = row.engine.snapshot().levels.length;
}

async function tickKey(key: string, cfg: HaloConfig): Promise<void> {
  const R = rt();
  const [symbol, tf] = key.split(":");
  const meta = getSymbolMeta(symbol);
  if (meta.id !== symbol) return; // unknown ticker — never scanned
  let row = R.rows.get(key);
  if (!row) {
    row = makeRow(symbol, tf, cfg);
    R.rows.set(key, row);
  }
  if (row.busy) return;
  row.busy = true;
  try {
    await tickRow(row);
  } catch (e) {
    row.lastError = (e as Error).message.slice(0, 160);
  } finally {
    row.busy = false;
  }
}

/**
 * Tick one round-robin lane within a budget. `what` selects the counters:
 * boot rows (deep warm-up) and warmed re-check rows are counted separately
 * so a slow venue never eats the simulated market's budget (or vice versa).
 * Returns how many rows were actually ticked.
 */
async function runLane(
  R: TfScannerRuntime,
  lane: string[],
  cursorKey: "cursorSim" | "cursorReal",
  bootBudget: number,
  warmBudget: number,
  cfg: HaloConfig,
): Promise<number> {
  if (lane.length === 0) return 0;
  let boot = 0;
  let warm = 0;
  let ticked = 0;
  let cursor = R[cursorKey];
  // walk at most one full lap — budgets bound the work per slice
  for (let i = 0; i < lane.length && (boot < bootBudget || warm < warmBudget); i++) {
    const key = lane[cursor];
    cursor = (cursor + 1) % lane.length;
    const row = R.rows.get(key);
    // unknown ticker — skip forever; busy row — try again next slice
    const [symbol] = key.split(":");
    if (getSymbolMeta(symbol).id !== symbol) continue;
    if (row?.busy) continue;
    if (row?.bootstrapped) {
      if (warm >= warmBudget) continue;
      warm += 1;
    } else {
      if (boot >= bootBudget) continue;
      boot += 1;
    }
    ticked += 1;
    R.currentKey = key;
    await tickKey(key, cfg);
  }
  // the lap wrapped past index 0 → one full pass over this lane completed
  if (cursor === 0 && ticked > 0) {
    R.passes += 1;
    R.lastPassAt = Date.now();
  }
  R[cursorKey] = cursor;
  return ticked;
}

/** One round-robin step: hot rows, then boot/warm lanes split by feed cost. */
async function scanSlice(): Promise<void> {
  const R = rt();
  // OVERLAP GUARD — the ticker fires every SLICE_MS regardless of whether the
  // previous slice finished. On a degraded deployed network one live-feed
  // attempt can hang for seconds; without this guard slices pile up
  // unboundedly and starve the event loop (slow app, silent bots, the
  // dashboard's "Scanner feed unreachable" banner). Skip the beat instead —
  // exactly the overlap discipline the 3EL bot runtime already applies.
  if (R.slicing) return;
  if (!R.enabled || R.order.length === 0) return;
  R.slicing = true;
  try {
    await scanSliceBody(R);
  } finally {
    R.slicing = false;
  }
}

async function scanSliceBody(R: TfScannerRuntime): Promise<void> {
  if (!R.enabled || R.order.length === 0) return;
  R.lastRun = Date.now();

  const lock = getTradeLock();
  if (lock) {
    // scanning paused app-wide while a trade runs — say it once in the chat
    if (!R.lockPausedAt) {
      R.lockPausedAt = Date.now();
      pushMsg(
        "pause",
        `Timeframe Scanner Bot is currently paused — a trade is running on ${lock.symbol} ${lock.tf}. Scanning resumes when it hits TP or SL.`,
      );
    }
    // the row that owns the running trade keeps ticking — its engine must
    // still detect TP/SL so the DB trade closes and the lock releases
    // (a frozen holder would leave the trade open until the watchdog).
    if (lock.source === "SCAN") {
      const key = rowKey(lock.symbol, lock.tf);
      const held = R.rows.get(key);
      if (held && held.bootstrapped && !held.busy) {
        const cfg = await currentCfg();
        await tickKey(key, cfg);
      }
    }
    return;
  }
  if (R.lockPausedAt) {
    R.lockPausedAt = 0;
    pushMsg("resume", "The running trade has closed — Timeframe Scanner Bot has resumed scanning all supported markets and timeframes.");
  }

  const cfg = await currentCfg();
  const h = JSON.stringify(cfg);
  if (h !== R.cfgHash) {
    // strategy settings changed → rebuild every scanner engine lazily
    R.cfgHash = h;
    R.rows.clear();
  }

  // hot rows first — armed setups are re-checked with priority
  let hot = 0;
  for (const row of R.rows.values()) {
    if (hot >= HOT_PER_SLICE) break;
    if (row.armed > 0 && !row.busy && row.bootstrapped) {
      hot += 1;
      await tickKey(rowKey(row.symbol, row.tf), cfg);
    }
  }

  // two lanes: the simulated market (free ticks — fast lane) and real venues
  // (rate-aware slow lane). Each lane keeps its own cursor and budgets, so a
  // full pass completes minutes earlier and every setup is picked up while
  // it is still live.
  const before = R.passes;
  const simTicked = await runLane(R, R.orderSim, "cursorSim", BOOT_SIM_PER_SLICE, WARM_SIM_PER_SLICE, cfg);
  const realTicked = await runLane(R, R.orderReal, "cursorReal", BOOT_REAL_PER_SLICE, WARM_REAL_PER_SLICE, cfg);
  R.scannedRows += simTicked + realTicked;
  if (R.passes > before) {
    const found = R.opportunitiesFound;
    pushMsg(
      "info",
      found > 0
        ? `Full scan pass complete — every supported market and timeframe was checked against the existing HALO strategy. ${found} qualifying opportunit${found === 1 ? "y" : "ies"} so far. The next pass is starting.`
        : "Scanning completed. No trading opportunity currently meets the existing HALO strategy conditions. I'll continue scanning.",
    );
  }
}

function armTimer(): void {
  const R = rt();
  if (R.enabled && !R.timer) {
    R.timer = setInterval(() => {
      scanSlice().catch(() => {});
    }, SLICE_MS);
    (R.timer as unknown as { unref?: () => void }).unref?.();
  } else if (!R.enabled && R.timer) {
    clearInterval(R.timer);
    R.timer = null;
  }
}

/** Load settings + catalog and arm the ticker (keep-alive pattern as the sweep). */
export async function ensureTfScanner(): Promise<TfScannerRuntime> {
  const R = rt();
  if (R.syncing) return R;
  R.syncing = true;
  try {
    if (Date.now() - R.cfgLoadedAt > 10_000) {
      R.enabled = await loadConfig();
      if (R.enabled) R.hasStarted = true;
      R.cfgLoadedAt = Date.now();
    }
    if (R.order.length === 0) {
      R.order = buildOrder();
      const { sim, real } = buildSimRealOrders(R.order);
      R.orderSim = sim;
      R.orderReal = real;
    }
    armTimer();
  } catch {
    // db not ready — retry on the next call
  } finally {
    R.syncing = false;
  }
  return R;
}

// ───────────────────────── public API ─────────────────────────

export interface TfScannerState {
  enabled: boolean;
  status: "idle" | "scanning" | "paused" | "trade_lock";
  tfs: string[];
  marketsTotal: number;
  marketsAnalysed: number;
  currentSymbol: string;
  currentTf: string;
  lastScanAt: number;
  lastPassAt: number;
  passes: number;
  scannedRows: number;
  setupsWatched: number;
  opportunitiesFound: number;
  rangeSkips: number;
  startedAt: number;
  opportunity: ScannerOpportunity | null;
  recent: ScannerOpportunity[];
  msgs: ScannerMsg[];
  lock: { symbol: string; tf: string } | null;
  source: string;
  /** warmed rows per feed source — proves which feeds are live right now */
  sources: Record<string, number>;
  /** most recent row tick — the live-feed heartbeat on the dashboard */
  lastTickAt: number;
}

export async function tfScannerState(): Promise<TfScannerState> {
  const R = await ensureTfScanner();
  const lock = getTradeLock();
  let setups = 0;
  let warm = 0;
  let source = "—";
  let lastTickAt = 0;
  const sources: Record<string, number> = {};
  for (const row of R.rows.values()) {
    if (row.lastTickAt > lastTickAt) lastTickAt = row.lastTickAt;
    if (row.bootstrapped) {
      warm += 1;
      if (row.armed > 0) setups += 1;
      if (row.source !== "—") {
        sources[row.source] = (sources[row.source] ?? 0) + 1;
        if (source === "—") source = row.source;
      }
    }
  }
  const [curSym, curTf] = R.currentKey ? R.currentKey.split(":") : ["", ""];
  const status: TfScannerState["status"] = !R.enabled
    ? R.hasStarted
      ? "paused"
      : "idle"
    : lock
      ? "trade_lock"
      : "scanning";
  const current = R.currentKey ? getSymbolMeta(curSym) : null;
  return {
    enabled: R.enabled,
    status,
    tfs: [...TIMEFRAMES],
    marketsTotal: R.order.length,
    marketsAnalysed: warm,
    currentSymbol: current ? current.label.split("·")[0].trim() || curSym : curSym,
    currentTf: curTf,
    lastScanAt: R.lastRun,
    lastPassAt: R.lastPassAt,
    passes: R.passes,
    scannedRows: R.scannedRows,
    setupsWatched: setups,
    opportunitiesFound: R.opportunitiesFound,
    rangeSkips: R.rangeSkips,
    startedAt: R.startedAt,
    opportunity: R.opportunity,
    recent: [...R.recent],
    msgs: [...R.msgs],
    lock: lock ? { symbol: lock.symbol, tf: lock.tf } : null,
    source,
    sources,
    lastTickAt,
  };
}

/** Start / pause / resume — the ONLY controls the scanner bot exposes. */
export async function configTfScanner(action: "start" | "pause" | "resume"): Promise<void> {
  const R = await ensureTfScanner();
  if (action === "pause") {
    if (!R.enabled) return;
    R.enabled = false;
    R.cfgLoadedAt = Date.now();
    await saveConfig(false);
    armTimer();
    pushMsg("pause", "Timeframe Scanner Bot is currently paused.");
    return;
  }
  // start / resume both re-activate scanning
  if (R.enabled) return;
  const first = !R.hasStarted;
  R.enabled = true;
  R.hasStarted = true;
  R.startedAt = Date.now();
  R.cfgLoadedAt = Date.now();
  await saveConfig(true);
  armTimer();
  pushMsg(
    "info",
    first
      ? "Timeframe Scanner Bot is now scanning all supported markets and timeframes using the existing HALO trading strategy."
      : "Timeframe Scanner Bot has resumed scanning all supported markets and timeframes using the existing HALO trading strategy.",
  );
}

/** Format a price with the symbol's strategy precision (shared by the card). */
export function scannerPx(v: number, symbol: string): string {
  const meta = getSymbolMeta(symbol);
  return v.toFixed(decimalsOf(meta.mintick));
}
