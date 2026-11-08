// ════════════════════════════════════════════════════════════════════════
//  TIMEFRAME SCANNER BOT · signal-only assistant inside the HALO chat
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
//  • SIGNAL-ONLY: a fire is reported to the chat and the alert log — this
//    module NEVER calls executeFire, never opens / closes / modifies a
//    trade, never touches MT5 or the EA controls.
//  • Trade-lock semantics stay consistent app-wide: the bot registers as a
//    lock participant (its armed levels are wiped when a trade fires
//    anywhere — "all armed levels are deleted") and it pauses scanning
//    while a trade runs, resuming after TP/SL.
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
import { SYMBOLS, TIMEFRAMES, decimalsOf } from "./market-symbols";
import { sendAlert } from "./alerts";
import { publishBotEvent } from "./halo/event-bus";
import { getTradeLock, registerLockParticipant } from "./trade-lock";

const KV_KEY = "tfScannerConfig";
const WARM_BARS = 400; // same warm-up depth as the sweep
const SLICE_MS = 2500;
const ROWS_PER_SLICE = 3; // full pass ≈ 20 min over SYMBOLS × TIMEFRAMES
const HOT_PER_SLICE = 2; // armed rows get extra priority re-checks
const MSG_CAP = 30;
const RECENT_CAP = 8;

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
  cursor: number;
  timer: ReturnType<typeof setInterval> | null;
  syncing: boolean;
  slicing?: boolean; // OVERLAP GUARD — never run two scan slices concurrently
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
      cursor: 0,
      timer: null,
      syncing: false,
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
      pushMsg(
        "opportunity",
        `A trading opportunity meeting the existing HALO strategy has been detected on ${label}, ${row.tf.toUpperCase()} — ${side} at ${opp.entry}. View the details below.`,
      );
      // alert log + push channels — same infrastructure the Scanner uses;
      // strictly a signal: the scanner never executes anything
      void sendAlert({
        kind: "scanner",
        title: `SCANNER BOT ${side} · ${label} ${row.tf.toUpperCase()}`,
        body: `${e.message}\nSymbol: ${row.symbol} · TF ${row.tf}\nEntry ${e.entry} · SL ${e.sl} · TP ${e.tp}\nRisk ${e.riskPips.toFixed(1)} → reward ${e.rewardPips.toFixed(1)} pips\nSignal only — the Timeframe Scanner Bot never executes trades.`,
      });
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

/** One round-robin step: a few catalog rows + priority re-checks of hot rows. */
async function scanSlice(): Promise<void> {
  const R = rt();
  // OVERLAP GUARD — the ticker fires every beat whether or not the previous
  // slice finished. When a live-feed request hangs, slices would pile up and
  // starve the event loop (slow app, silent bots). Skip the beat instead —
  // the same discipline the 3EL bot runtime applies.
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

  for (let i = 0; i < ROWS_PER_SLICE; i++) {
    const key = R.order[R.cursor];
    R.cursor += 1;
    if (R.cursor >= R.order.length) {
      R.cursor = 0;
      R.passes += 1;
      R.lastPassAt = Date.now();
      const found = R.opportunitiesFound;
      pushMsg(
        "info",
        found > 0
          ? `Full scan pass complete — every supported market and timeframe was checked against the existing HALO strategy. ${found} qualifying opportunit${found === 1 ? "y" : "ies"} so far. The next pass is starting.`
          : "Scanning completed. No trading opportunity currently meets the existing HALO strategy conditions. I'll continue scanning.",
      );
    }
    R.scannedRows += 1;
    R.currentKey = key;
    await tickKey(key, cfg);
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
    if (R.order.length === 0) R.order = buildOrder();
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
}

export async function tfScannerState(): Promise<TfScannerState> {
  const R = await ensureTfScanner();
  const lock = getTradeLock();
  let setups = 0;
  let warm = 0;
  let source = "—";
  for (const row of R.rows.values()) {
    if (row.bootstrapped) {
      warm += 1;
      if (row.armed > 0) setups += 1;
      if (row.source !== "—" && source === "—") source = row.source;
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
