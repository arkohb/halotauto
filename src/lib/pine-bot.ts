// ════════════════════════════════════════════════════════════════════════
//  PINE AUTO-TRADE RUNTIME · the bot's second engine
//
//  When a trader activates a Pine strategy in the Strategy Studio, THIS
//  module auto-trades it on the live chart feed:
//    • evaluates the compiled Pine script bar-by-bar (confirmed bars only —
//      Pine's bar-close standard; no repaint)
//    • entry signals route through the SAME execution path as the built-in
//      3EL engine: executeFire() → PAPER book or the active CFD broker with
//      real SL/TP, sizing, and alerting — no new order logic was invented
//    • SL/TP: the script's own strategy.exit(stop=/limit=) prices when the
//      script sets them; otherwise the trader's risk overlay configured in
//      the Strategy Studio (never invented defaults on the server side)
//    • exits: strategy.close / close_all / opposite signal → market close
//      via closeBrokerPosition (live) or an honest book update (paper)
//    • obeys the EA START/STOP switch and the PAUSE NEW ENTRIES operator
//      control exactly like the built-in engine
//  Selecting a Pine strategy makes it the bot's ONLY active strategy: the
//  3EL engine stays armed for levels/charting but its fires are skipped
//  (single-strategy semantics, alerted honestly).
//
//  INDICATORS TRADE TOO: a script declared with indicator() has no
//  strategy.entry calls, so its own alertcondition() BUY / SELL alerts are
//  the signals (title or message containing BUY/LONG or SELL/SHORT), and
//  its exit / SL / TP alerts close the position.
//
//  SCANNER BOT: while a Pine strategy is attached the Scanner Bot scans with
//  it — one Pine runtime per tradable symbol × timeframe (source SCAN), same
//  signals, same SL/TP rules, same execution path and global trade lock —
//  instead of the built-in 3EL engine.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { PineRuntime, type CompiledPine } from "@/lib/pine";
import type { Candle } from "@/lib/halo/types";
import { getKlines, getSymbolMeta, tfSec } from "@/lib/market";
import { closeBrokerPosition, executeFire, loadExecSettings, resolveBroker, type ActiveBroker } from "@/lib/execution";
import { sendAlert } from "@/lib/alerts";
import {
  BUILTIN_STRATEGY_NAME,
  botProbe,
  getActiveStrategySel,
  scannerEnabled,
  setActiveStrategySel,
} from "@/lib/strategy-select";
import { getTradeLock, maybeReleaseLock } from "@/lib/trade-lock";
import { TIMEFRAMES, isSimOnlyGroup } from "@/lib/market-symbols";
import { TRADING_SYMBOLS } from "@/lib/trading-universe";
import { bookPaperCloseFromDb } from "@/lib/paper-account";

export interface PineSignalCfg {
  mode: "strategy" | "manual";
  longVar?: string;
  shortVar?: string;
  exitVar?: string;
}

interface PinePos {
  dbId: string;
  dir: 1 | -1;
  entry: number;
  sl: number | null;
  tp: number | null;
  entryTime: number;
  exec: "PAPER" | "LIVE";
  broker: ActiveBroker | null;
  entryId: string;
}

interface PineState {
  /** BOT = the chart strategy (follows the chart) · SCAN = a Scanner Bot row */
  source: "BOT" | "SCAN";
  strategyId: string;
  name: string;
  src: string;
  symbol: string;
  tf: string;
  rt: PineRuntime;
  meta: CompiledPine;
  signal: PineSignalCfg;
  risk: { useSlATR: boolean; slATRm: number; useSlPts: boolean; slPts: number; rrMult: number };
  rev: number; // strategy row updatedAt (epoch ms) — bumps on every edit/recompile
  lastConfirmedTime: number;
  lastPrice: number;
  warmed: boolean;
  pos: PinePos | null;
  atr: number | null; // independent ATR(14) tracker for the risk overlay
  atrPrevClose: number | null;
  feedSource: string;
  lastTickAt: number;
  /** side of the script's latest BUY/SELL signal (a "label moved" alert re-enters on it) */
  lastSide: 1 | -1 | 0;
}

const g = globalThis as unknown as {
  __haloPineBot?: {
    state: PineState | null;
    timer: ReturnType<typeof setInterval> | null;
    tickGen: number;
    lastTickAt: number;
    booting: Promise<void> | null;
    symbolWarned: boolean;
    /** Scanner Bot rows running the attached strategy, keyed symbol:tf */
    scan: Map<string, PineState>;
    /** positions left open by a deactivated strategy — managed until they close */
    drain: PineState[];
    scanCursor: number;
  };
};

function slot(): NonNullable<typeof g.__haloPineBot> {
  if (!g.__haloPineBot) {
    g.__haloPineBot = { state: null, timer: null, tickGen: 0, lastTickAt: 0, booting: null, symbolWarned: false, scan: new Map(), drain: [], scanCursor: 0 };
  }
  const s = g.__haloPineBot;
  // a slot created by an older build (dev hot reload) lacks the newer fields
  s.scan ??= new Map();
  s.drain ??= [];
  s.scanCursor ??= 0;
  return s;
}

function pipSize(symbol: string): number {
  return getSymbolMeta(symbol).mintick * 10;
}

// ── public info (read by botState / the UI) ──────────────────────────────
export interface PineBotInfo {
  active: boolean;
  id: string | null;
  name: string;
  kind: "builtin" | "pine";
  symbol: string;
  tf: string;
  warmed: boolean;
  rev: number; // row updatedAt — the chart watches this to redraw the indicator the moment it changes
  position: { dir: 1 | -1; entry: number; sl: number | null; tp: number | null; entryTime: number } | null;
  /** how the script produces signals: strategy.entry calls, an indicator's BUY/SELL alerts, or mapped variables */
  signals: "strategy" | "alerts" | "manual" | null;
  /** Scanner Bot rows scanning with this strategy (symbol × timeframe) */
  scan: { rows: number; warmed: number; tfs: string[] };
}

export function getPineBotInfo(): PineBotInfo {
  const st = slot().state;
  if (!st) {
    return { active: false, id: null, name: BUILTIN_STRATEGY_NAME, kind: "builtin", symbol: "", tf: "", warmed: false, rev: 0, position: null, signals: null, scan: { rows: 0, warmed: 0, tfs: [] } };
  }
  return {
    active: true,
    id: st.strategyId,
    name: st.name,
    kind: "pine",
    symbol: st.symbol,
    tf: st.tf,
    warmed: st.warmed,
    rev: st.rev,
    position: st.pos ? { dir: st.pos.dir, entry: st.pos.entry, sl: st.pos.sl, tp: st.pos.tp, entryTime: st.pos.entryTime } : null,
    signals: signalSource(st),
    scan: {
      rows: slot().scan.size,
      warmed: [...slot().scan.values()].filter((x) => x.warmed).length,
      tfs: [...slot().scan.values()].map((x) => x.tf),
    },
  };
}

/** where this script's trade signals come from */
function signalSource(st: PineState): "strategy" | "alerts" | "manual" {
  if (st.signal.mode === "manual") return "manual";
  return st.meta.kind === "indicator" ? "alerts" : "strategy";
}

export function selectedStrategyInfo(): { id: string | null; name: string; kind: "builtin" | "pine" } {
  const sel = getActiveStrategySel();
  return { id: sel.id, name: sel.name, kind: sel.kind };
}

// ── lifecycle ────────────────────────────────────────────────────────────
export async function activatePineStrategy(id: string): Promise<{ ok: boolean; error?: string }> {
  const row = await db.pineStrategy.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Strategy not found." };
  if (row.status !== "compiled") return { ok: false, error: `Compile the script first — current status: ${row.status}.` };

  // single-active semantics at the DB level
  await db.pineStrategy.updateMany({ data: { active: false } });
  await db.pineStrategy.update({ where: { id }, data: { active: true, lastTradedAt: new Date() } });

  const probe = botProbe();
  retireStates(); // a previous strategy's open positions keep being managed
  const state = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, probe.symbol, probe.tf);
  slot().state = state;
  setActiveStrategySel({ id: row.id, name: row.name, kind: "pine" });
  startTimer();
  void sendAlert({
    kind: "status",
    title: `STRATEGY ACTIVATED · ${row.name}`,
    body: `The bot now auto-trades the Pine ${state.meta.kind === "indicator" ? "indicator" : "strategy"} "${row.name}" on ${state.symbol || probe.symbol || "the chart symbol"} ${state.tf || probe.tf}${state.meta.kind === "indicator" ? " — its own BUY / SELL alerts are the entry signals" : ""}. The Scanner Bot scans every ${TRADING_SYMBOLS.join(", ")} timeframe with it too. The built-in 3EL engine stays armed for levels but no 3EL trade is placed while a Pine strategy is attached.`,
  });
  void tickPine(true).catch(() => {});
  return { ok: true };
}

export async function deactivatePineStrategy(): Promise<void> {
  const st = slot().state;
  await db.pineStrategy.updateMany({ data: { active: false } }).catch(() => {});
  retireStates();
  slot().state = null;
  if (slot().drain.length === 0) stopTimer();
  setActiveStrategySel({ id: null, name: BUILTIN_STRATEGY_NAME, kind: "builtin" });
  if (st) {
    void sendAlert({
      kind: "status",
      title: `STRATEGY DEACTIVATED · ${st.name}`,
      body: `The bot is back on the built-in ${BUILTIN_STRATEGY_NAME} engine. ${st.pos ? "The Pine strategy's open position keeps its broker SL/TP." : ""}`,
    });
  }
}

/**
 * Move every runtime that holds an open position to the drain list (it is
 * still managed — SL/TP and exit signals — until it closes, but takes no new
 * entries) and forget the flat Scanner Bot rows.
 */
function retireStates(): void {
  const s = slot();
  const all = [s.state, ...s.scan.values()].filter((x): x is PineState => !!x);
  for (const st of all) if (st.pos && !s.drain.includes(st)) s.drain.push(st);
  s.scan.clear();
}

/**
 * RESYNC the active strategy after an edit/recompile (PATCH): rebuild the
 * runtime from the fresh row so the ENGINE trades the new code and the
 * CHART redraws the new plots immediately — not on the next 60 s preview
 * poll, not after a manual deactivate/reactivate. The open position (if
 * any) survives: its entry/SL/TP are absolute prices that stay valid
 * across a re-warm.
 */
export async function resyncActivePineRow(row: {
  id: string;
  name: string;
  pineSource: string;
  compiledJson: string;
  signalJson: string;
  useSlATR: boolean;
  slATRm: number;
  useSlPts: boolean;
  slPts: number;
  rrMult: number;
  updatedAt?: Date | string;
}): Promise<void> {
  const s = slot();
  const old = s.state;
  if (!old || old.strategyId !== row.id) return; // not the active strategy — nothing to resync
  const probe = botProbe();
  // keep trading the SAME instrument the state is on — a chart symbol
  // switch mid-edit must not orphan an open position
  const state = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, old.symbol || probe.symbol, old.tf || probe.tf);
  if (old.pos) state.pos = old.pos;
  s.state = state;
  // Scanner Bot rows: a row with an open position is rebuilt on the new code
  // carrying its position; flat rows are dropped and re-warm lazily
  for (const [key, sc] of [...s.scan]) {
    if (!sc.pos) {
      s.scan.delete(key);
      continue;
    }
    const next = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, sc.symbol, sc.tf, "SCAN");
    next.pos = sc.pos;
    s.scan.set(key, next);
  }
  setActiveStrategySel({ id: row.id, name: row.name, kind: "pine" });
  startTimer();
  void tickPine(true).catch(() => {});
}

async function buildState(
  id: string,
  name: string,
  source: string,
  compiledJson: string,
  signalJson: string,
  row: { useSlATR: boolean; slATRm: number; useSlPts: boolean; slPts: number; rrMult: number; updatedAt?: Date | string },
  symbol: string,
  tf: string,
  origin: "BOT" | "SCAN" = "BOT"
): Promise<PineState> {
  let meta: CompiledPine | null = null;
  try {
    meta = JSON.parse(compiledJson) as CompiledPine;
  } catch {
    meta = null;
  }
  let signal: PineSignalCfg = { mode: "strategy" };
  try {
    const sj = JSON.parse(signalJson || "{}") as PineSignalCfg;
    if (sj.mode === "manual" && sj.longVar) signal = sj;
  } catch {
    // default: strategy mode
  }
  const st: PineState = {
    source: origin,
    strategyId: id,
    name,
    src: source,
    symbol: symbol || "XAUUSD",
    tf: tf || "5m",
    rt: new PineRuntime(source, { mintick: getSymbolMeta(symbol || "XAUUSD").mintick, ticker: symbol, tf: tf || "5m", pipMult: 10 }),
    meta: meta ?? ({ ok: true, kind: "strategy", name, overlay: true, processOrdersOnClose: false, pyramiding: 0, inputs: [], plots: [], shapes: [], hlines: [], entryIds: [], hasLong: true, hasShort: false, hasExitSLTP: false, hasClose: false, signalCandidates: [], notes: [], diagnostics: [] } as CompiledPine),
    signal,
    risk: { useSlATR: row.useSlATR, slATRm: row.slATRm, useSlPts: row.useSlPts, slPts: row.slPts, rrMult: row.rrMult },
    rev: row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now(),
    lastConfirmedTime: 0,
    lastPrice: 0,
    warmed: false,
    pos: null,
    atr: null,
    atrPrevClose: null,
    feedSource: "—",
    lastTickAt: 0,
    lastSide: 0,
  };
  await warmPine(st);
  return st;
}

async function warmPine(st: PineState): Promise<void> {
  st.rt = new PineRuntime(st.src, { mintick: getSymbolMeta(st.symbol).mintick, ticker: st.symbol, tf: st.tf, pipMult: 10 });
  if (st.signal.mode === "manual") {
    st.rt.captureBools([st.signal.longVar!, st.signal.shortVar!, st.signal.exitVar!].filter(Boolean) as string[]);
  }
  st.lastConfirmedTime = 0;
  // NOTE: st.pos is deliberately preserved — entry/SL/TP are absolute prices
  // that stay valid across a re-warm; clearing it here would orphan the book
  st.atr = null;
  st.atrPrevClose = null;
  try {
    const { candles, source } = await getKlines(st.symbol, st.tf, 600, { deep: true });
    st.feedSource = source;
    const now = Date.now();
    const secMs = tfSec(st.tf) * 1000;
    let lastConfirmed = 0;
    for (const c of candles) {
      if (c.time + secMs <= now) {
        stepAtr(st, c);
        st.rt.externalPos = st.pos ? { dir: st.pos.dir, entry: st.pos.entry } : { dir: 0, entry: 0 };
        st.rt.processBar(c);
        noteSide(st, collectSignals(st));
        st.lastConfirmedTime = c.time;
        lastConfirmed = c.time;
      }
    }
    st.lastConfirmedTime = lastConfirmed;
    const live = candles[candles.length - 1];
    if (live) st.lastPrice = live.close;
    st.warmed = true;
  } catch (e) {
    st.warmed = false;
    console.error(`[pine-bot] warm failed for ${st.name}:`, (e as Error).message);
  }
}

// ── timer (generation-guarded like the 3EL runtime) ─────────────────────
/** independent ATR(14) — Wilder RMA — for the risk overlay when the script sets no SL/TP */
function stepAtr(st: PineState, c: Candle): void {
  const prevClose = st.atrPrevClose;
  st.atrPrevClose = c.close;
  const tr = prevClose === null ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  if (st.atr === null) {
    st.atr = tr; // seed; converges like an RMA over the warm window
  } else {
    st.atr = (st.atr * 13 + tr) / 14;
  }
}

// ── timer (generation-guarded like the 3EL runtime) ─────────────────────
const gTim = globalThis as unknown as {
  __haloPineTimer?: ReturnType<typeof setInterval>;
  __haloPineGen?: number;
  __haloPineTicking?: boolean;
};

function startTimer(): void {
  stopTimer();
  const s = slot();
  const gen = (gTim.__haloPineGen = (gTim.__haloPineGen ?? 0) + 1);
  s.tickGen = gen;
  gTim.__haloPineTimer = setInterval(() => {
    if (gTim.__haloPineGen !== gen) {
      clearInterval(gTim.__haloPineTimer!);
      gTim.__haloPineTimer = undefined;
      return;
    }
    // OVERLAP GUARD — a hanging feed request must never pile up ticks
    if (gTim.__haloPineTicking) return;
    gTim.__haloPineTicking = true;
    tickPine()
      .catch(() => {})
      .finally(() => {
        gTim.__haloPineTicking = false;
      });
  }, 2500);
  (gTim.__haloPineTimer as unknown as { unref?: () => void }).unref?.();
  s.timer = gTim.__haloPineTimer;
}

function stopTimer(): void {
  if (gTim.__haloPineTimer) {
    clearInterval(gTim.__haloPineTimer);
    gTim.__haloPineTimer = undefined;
  }
  const s = slot();
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
}

/** Re-arm after a server restart: the DB row carries the selection. */
export async function ensurePineBoot(): Promise<void> {
  const s = slot();
  if (s.state || s.booting) return;
  s.booting = (async () => {
    try {
      const row = await db.pineStrategy.findFirst({ where: { active: true } });
      if (row && row.status === "compiled") {
        const probe = botProbe();
        s.state = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, probe.symbol, probe.tf);
        // recover an open position after a server restart — identified by the
        // Pine slMode label the execution path stamped on the trade row
        try {
          const open = await db.trade.findFirst({
            where: { status: "OPEN", mode: "BOT", slMode: { startsWith: "Pine" } },
            orderBy: { openedAt: "desc" },
          });
          if (open) {
            s.state.pos = {
              dbId: open.id,
              dir: open.direction === -1 ? -1 : 1,
              entry: open.entry,
              sl: open.sl,
              tp: open.tp,
              entryTime: open.openedAt.getTime(),
              exec: open.execMode === "LIVE" ? "LIVE" : "PAPER",
              broker: open.execMode === "LIVE" ? await resolveBroker((await loadExecSettings()).brokerAccountId) : null,
              entryId: "PINE",
            };
          }
        } catch {
          // recovery is best-effort; broker-side SL/TP protects live positions regardless
        }
        // Scanner Bot rows that were holding a Pine position before the restart
        try {
          const scanOpen = await db.trade.findMany({ where: { status: "OPEN", mode: "SCAN", slMode: { startsWith: "Pine" } } });
          const exec = scanOpen.length > 0 ? await loadExecSettings() : null;
          for (const t of scanOpen) {
            const st = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, t.symbol, t.timeframe, "SCAN");
            st.pos = {
              dbId: t.id,
              dir: t.direction === -1 ? -1 : 1,
              entry: t.entry,
              sl: t.sl,
              tp: t.tp,
              entryTime: t.openedAt.getTime(),
              exec: t.execMode === "LIVE" ? "LIVE" : "PAPER",
              broker: t.execMode === "LIVE" && exec ? await resolveBroker(exec.brokerAccountId) : null,
              entryId: "PINE",
            };
            s.scan.set(`${t.symbol}:${t.timeframe}`, st);
          }
        } catch {
          // best-effort, like the chart strategy's recovery above
        }
        setActiveStrategySel({ id: row.id, name: row.name, kind: "pine" });
        startTimer();
      } else if (row) {
        // stale activation on a strategy that no longer compiles — reset
        await db.pineStrategy.update({ where: { id: row.id }, data: { active: false } }).catch(() => {});
      }
    } catch {
      // DB not ready — retried on the next botState poll
    }
  })().finally(() => {
    s.booting = null;
  });
  return s.booting;
}

// ── the tick ─────────────────────────────────────────────────────────────
export async function tickPine(force = false): Promise<void> {
  await tickDrain();
  if (!slot().state) return;
  await tickMain(force);
  await tickScanRows();
}

/** the chart strategy (source BOT) — runs while the EA is ON */
async function tickMain(force: boolean): Promise<void> {
  const s = slot();
  const st = s.state;
  if (!st) return;
  const probe = botProbe();
  if (!probe.enabled) return; // EA stopped → no pine processing (same as 3EL)
  if (!force && Date.now() - s.lastTickAt < 2000) return;
  s.lastTickAt = Date.now();
  try {
    // follow the chart symbol/timeframe like the 3EL engine does — but never
    // while a Pine position is open (its SL/TP prices belong to that symbol)
    if (!st.warmed || (st.symbol !== probe.symbol || st.tf !== probe.tf)) {
      if (st.pos) {
        if (st.symbol !== probe.symbol && !s.symbolWarned) {
          s.symbolWarned = true;
          void sendAlert({
            kind: "status",
            title: `PINE · ${st.name} · SYMBOL SWITCH BLOCKED`,
            body: `A Pine position is open on ${st.symbol} — the strategy keeps trading it until the position closes. The chart switch to ${probe.symbol} takes effect for the Pine engine afterwards.`,
          });
        }
      } else if (probe.symbol) {
        s.symbolWarned = false;
        st.symbol = probe.symbol;
        st.tf = probe.tf;
        await warmPine(st);
        if (!st.warmed) return;
      } else return;
    }
    const prevSource = st.feedSource;
    const { candles, source } = await getKlines(st.symbol, st.tf, 4, { fresh: true });
    st.feedSource = source;
    if (prevSource === "simulator" && source !== "simulator" && !st.pos) {
      await warmPine(st);
      return;
    }
    const now = Date.now();
    const secMs = tfSec(st.tf) * 1000;
    for (const c of candles) {
      if (c.time > st.lastConfirmedTime && c.time + secMs <= now) {
        await processConfirmedBar(st, c);
        st.lastConfirmedTime = c.time;
        st.lastPrice = c.close;
      }
    }
    const live = candles[candles.length - 1];
    if (live) st.lastPrice = live.close;
  } catch (e) {
    console.error("[pine-bot] tick error:", (e as Error).message);
  }
}

// ── Scanner Bot rows · the attached strategy on every tradable timeframe ──
const SCAN_ROW_MIN_MS = 15_000; // a 1m row is re-checked every 15 s
const SCAN_ROW_MAX_MS = 300_000; // a 1d row every 5 min
const SCAN_ROWS_PER_TICK = 3;

function scanInterval(tf: string): number {
  return Math.min(SCAN_ROW_MAX_MS, Math.max(SCAN_ROW_MIN_MS, (tfSec(tf) * 1000) / 4));
}

/**
 * Keep one Pine runtime per tradable symbol × timeframe while the Scanner
 * Bot is started, and feed each its confirmed bars. A row on the chart's own
 * symbol + timeframe keeps processing bars but takes no entries (the chart
 * strategy trades that one — never twice). Rows holding a position are always
 * managed, even with the Scanner Bot paused.
 */
async function tickScanRows(): Promise<void> {
  const s = slot();
  const main = s.state;
  if (!main) return;
  const on = scannerEnabled();
  if (on) {
    // warm at most ONE new row per tick (a deep fetch + full replay)
    outer: for (const sym of TRADING_SYMBOLS) {
      for (const tf of TIMEFRAMES) {
        const key = `${sym}:${tf}`;
        if (s.scan.has(key)) continue;
        const row = await db.pineStrategy.findUnique({ where: { id: main.strategyId } }).catch(() => null);
        if (!row || row.status !== "compiled" || slot().state?.strategyId !== main.strategyId) return;
        const st = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, sym, tf, "SCAN");
        // a strategy switch while warming must not leave a stale row behind
        if (slot().state?.strategyId === main.strategyId) s.scan.set(key, st);
        break outer;
      }
    }
  }
  const rows = [...s.scan.values()];
  if (rows.length === 0) return;
  const now = Date.now();
  let done = 0;
  for (let i = 0; i < rows.length && done < SCAN_ROWS_PER_TICK; i++) {
    const st = rows[(s.scanCursor + i) % rows.length];
    if (!on && !st.pos) continue; // paused: only open positions are managed
    if (now - st.lastTickAt < scanInterval(st.tf)) continue;
    st.lastTickAt = now;
    done++;
    const chartRow = st.symbol === main.symbol && st.tf === main.tf;
    await tickPineRow(st, on && !chartRow).catch((e) => console.error(`[pine-bot] scan ${st.symbol} ${st.tf}:`, (e as Error).message));
  }
  s.scanCursor = (s.scanCursor + 1) % Math.max(1, rows.length);
}

/** positions left by a deactivated / replaced strategy: manage until closed */
async function tickDrain(): Promise<void> {
  const s = slot();
  if (s.drain.length === 0) return;
  const now = Date.now();
  for (const st of [...s.drain]) {
    if (st.pos && now - st.lastTickAt >= SCAN_ROW_MIN_MS) {
      st.lastTickAt = now;
      await tickPineRow(st, false).catch(() => {});
    }
    if (!st.pos) s.drain.splice(s.drain.indexOf(st), 1);
  }
  if (s.drain.length === 0 && !s.state) stopTimer();
}

/** feed one runtime its new confirmed bars (re-warm across a gap) */
async function tickPineRow(st: PineState, allowEntries: boolean): Promise<void> {
  const { candles, source } = await getKlines(st.symbol, st.tf, 4, { fresh: true });
  // a real market's simulated bars must never feed the strategy
  if (source === "simulator" && !isSimOnlyGroup(getSymbolMeta(st.symbol).group)) return;
  const prevSource = st.feedSource;
  st.feedSource = source;
  const now = Date.now();
  const secMs = tfSec(st.tf) * 1000;
  const firstNew = candles.find((c) => c.time > st.lastConfirmedTime);
  const gap = !st.warmed || prevSource === "simulator" || (firstNew !== undefined && st.lastConfirmedTime > 0 && firstNew.time > st.lastConfirmedTime + secMs);
  if (gap && !st.pos) {
    await warmPine(st);
    return;
  }
  for (const c of candles) {
    if (c.time > st.lastConfirmedTime && c.time + secMs <= now) {
      await processConfirmedBar(st, c, allowEntries);
      st.lastConfirmedTime = c.time;
      st.lastPrice = c.close;
    }
  }
  const live = candles[candles.length - 1];
  if (live) st.lastPrice = live.close;
}

// ── bar processing ───────────────────────────────────────────────────────
interface BarSignals {
  long: boolean;
  short: boolean;
  closeAll: boolean;
  closeIds: string[];
  /** a "label moved to a new extreme" alert (no side named) — re-enter on the latest signal's side */
  move?: boolean;
}

/** remember the side of the script's latest BUY/SELL signal */
function noteSide(st: PineState, sig: BarSignals): void {
  st.lastSide ??= 0;
  if (sig.long && !sig.short) st.lastSide = 1;
  else if (sig.short && !sig.long) st.lastSide = -1;
}

function collectSignals(st: PineState): BarSignals {
  const out: BarSignals = { long: false, short: false, closeAll: false, closeIds: [] };
  if (st.signal.mode === "manual") {
    const read = (name?: string): boolean | undefined => {
      if (!name) return undefined;
      const arr = st.rt.capturedBool.get(name);
      if (!arr || arr.length === 0) return undefined;
      return arr[arr.length - 1];
    };
    const lng = read(st.signal.longVar);
    const shrt = read(st.signal.shortVar);
    const ex = read(st.signal.exitVar);
    out.long = lng === true;
    out.short = shrt === true;
    out.closeAll = ex === true;
    return out;
  }
  if (signalSource(st) === "alerts") return alertSignals(st.rt.barAlertConds);
  for (const en of st.rt.plan.entries) {
    if (en.dir === 1) out.long = true;
    else out.short = true;
  }
  out.closeAll = st.rt.plan.closeAll;
  out.closeIds = [...st.rt.plan.closes];
  return out;
}

const RX_LONG = /\b(buy|long|bull(ish)?)\b/i;
const RX_SHORT = /\b(sell|short|bear(ish)?)\b/i;
const RX_EXIT = /\b(exit|close|sl|tp|stop(ped)?|take[\s-]?profit|target)\b/i;
// "label moved / add-on" style alerts (English + Russian): the signal label
// jumped to a new extreme. No side is named; the latest BUY/SELL decides it.
const RX_MOVE = /(\bmoved?\b|\brelocat|\bre-?anchor|new extreme|переезд|переехал|новый экстремум|долив)/i;

/**
 * An INDICATOR's signals = its alertcondition() calls that are true on this
 * bar. Each alert is read by its title first (what TradingView shows in the
 * alert dialog), then its message: BUY / LONG → long entry, SELL / SHORT →
 * short entry, EXIT / CLOSE / SL / TP / STOP → close. An alert naming both a
 * side and an exit (e.g. "SL hit on BUY") is an exit, never an entry.
 */
export function alertSignals(conds: { title: string; message: string }[]): BarSignals {
  const out: BarSignals = { long: false, short: false, closeAll: false, closeIds: [] };
  for (const a of conds) {
    const text = a.title.trim() || a.message;
    const exit = RX_EXIT.test(text);
    const lng = RX_LONG.test(text);
    const shrt = RX_SHORT.test(text);
    if (exit) out.closeAll = true;
    else if (lng && !shrt) out.long = true;
    else if (shrt && !lng) out.short = true;
    else if (!lng && !shrt && (RX_MOVE.test(a.title) || RX_MOVE.test(a.message))) out.move = true;
  }
  // both sides on one bar is no signal at all
  if (out.long && out.short) {
    out.long = false;
    out.short = false;
  }
  return out;
}

async function processConfirmedBar(st: PineState, c: Candle, allowEntries = true): Promise<void> {
  const probe = botProbe();
  stepAtr(st, c);
  st.rt.externalPos = st.pos ? { dir: st.pos.dir, entry: st.pos.entry } : { dir: 0, entry: 0 };
  st.rt.processBar(c);

  // 1 · manage the open position: SL/TP intrabar (bar already confirmed)
  if (st.pos) {
    const hit = stopTargetHit(st.pos, c);
    if (hit) {
      await closePineTrade(st, hit.px, hit.kind);
      st.pos = null;
    }
  }

  // 2 · signals from this bar
  const sig = collectSignals(st);
  noteSide(st, sig);
  const wantsClose =
    st.pos &&
    (sig.closeAll ||
      (st.signal.mode === "strategy" && (sig.closeIds.includes(st.pos.entryId) || sig.closeIds.includes("")) ||
        (sig.long && st.pos.dir === -1) ||
        (sig.short && st.pos.dir === 1)));
  if (wantsClose && st.pos) {
    await closePineTrade(st, c.close, "signal");
    st.pos = null;
  }

  // 2b · LABEL MOVED: the script re-anchored its latest signal at a new
  // extreme → close the trade on that side and re-enter at the new level
  // (or enter, when flat). Only where entries are allowed — a manage-only
  // row never closes a trade it could not re-open.
  let moveDir: 1 | -1 | 0 = 0;
  if (sig.move && !sig.long && !sig.short && !sig.closeAll && st.lastSide && allowEntries && !probe.pauseNew) {
    moveDir = st.lastSide;
    if (st.pos && st.pos.dir === moveDir) {
      const closedId = st.pos.dbId;
      await closePineTrade(st, c.close, "move");
      st.pos = null;
      // the re-entry follows at once: free the persistent execution lock
      // now instead of waiting for the background release
      await import("./exec-lock").then((m) => m.releaseForTrade(closedId, "label moved — re-entering")).catch(() => {});
    } else if (st.pos) {
      moveDir = 0; // holding the other side — the move is not ours
    }
  }

  // 3 · new entries (PAUSE NEW ENTRIES blocks entries while flat, like 3EL)
  const wantLong = (sig.long || moveDir === 1) && (!st.pos || st.pos.dir === -1);
  const wantShort = (sig.short || moveDir === -1) && (!st.pos || st.pos.dir === 1);
  if ((wantLong || wantShort) && !st.pos) {
    if (!allowEntries) return; // manage-only (draining / the chart strategy owns this timeframe)
    if (probe.pauseNew) return; // engine keeps watching; no entry while flat
    await openPineTrade(st, wantLong ? 1 : -1, c);
  }
}

function stopTargetHit(pos: PinePos, c: Candle): { kind: "sl" | "tp"; px: number } | null {
  const isLong = pos.dir === 1;
  if (pos.sl !== null && ((isLong && c.low <= pos.sl) || (!isLong && c.high >= pos.sl))) {
    return { kind: "sl", px: isLong ? Math.min(c.open, pos.sl) : Math.max(c.open, pos.sl) };
  }
  if (pos.tp !== null && ((isLong && c.high >= pos.tp) || (!isLong && c.low <= pos.tp))) {
    return { kind: "tp", px: isLong ? Math.max(c.open, pos.tp) : Math.min(c.open, pos.tp) };
  }
  return null;
}

// ── execution (reuses the 3EL execution path verbatim) ───────────────────
async function openPineTrade(st: PineState, dir: 1 | -1, bar: Candle): Promise<void> {
  // one trade at a time: a Scanner Bot row stays quiet while another trade
  // runs (the chart strategy keeps the honest "refused" alert below)
  if (st.source === "SCAN" && getTradeLock()) return;
  const entry = st.lastPrice || bar.close;
  const entryId = st.rt.plan.entries.find((e) => e.dir === dir)?.id ?? "PINE";
  // SL/TP: the script's own strategy.exit prices for this entry…
  const scripted =
    [...st.rt.plan.exits].reverse().find((x) => x.fromEntry === entryId || x.fromEntry === "") ??
    st.rt.exitOrders.get(entryId) ??
    st.rt.exitOrders.get("") ??
    null;
  let sl: number | null = scripted?.stop ?? null;
  let tp: number | null = scripted?.limit ?? null;
  let slModeLabel = "Pine SL/TP";
  // …otherwise the trader's risk overlay (Strategy Studio fields)
  if (sl === null && tp === null) {
    const risk =
      st.risk.useSlPts && !st.risk.useSlATR
        ? st.risk.slPts * getSymbolMeta(st.symbol).mintick
        : st.risk.useSlATR && st.atr
          ? st.risk.slATRm * st.atr
          : null;
    if (risk === null) {
      void sendAlert({
        kind: "status",
        title: `PINE · ${st.name} · ENTRY SKIPPED`,
        body: `${st.symbol} ${dir === -1 ? "SELL" : "BUY"} signal had no SL/TP: the script sets no strategy.exit prices and the risk overlay has no source (set ATR overlay or fixed points in the Strategy Studio).`,
      });
      return;
    }
    sl = entry - dir * risk;
    tp = entry + dir * st.risk.rrMult * risk;
    slModeLabel = st.risk.useSlPts && !st.risk.useSlATR ? "Pine + fixed-points overlay" : "Pine + ATR overlay";
  }
  const pip = pipSize(st.symbol);
  const riskPips = sl !== null ? Math.abs(entry - sl) / pip : 0;
  const rewardPips = tp !== null ? Math.abs(tp - entry) / pip : 0;
  const exec = await loadExecSettings();
  const tradeId = await executeFire({
    source: st.source,
    strategy: "pine",
    symbol: st.symbol,
    tf: st.tf,
    fire: {
      type: "fire",
      dir,
      entry,
      sl: sl ?? entry,
      tp: tp ?? entry,
      risk: sl !== null ? Math.abs(entry - sl) : 0,
      riskPips,
      rewardPips,
      levelTop: entry,
      levelBot: entry,
      ext: entry,
      time: bar.time,
      message: `Pine ${st.meta.kind === "indicator" ? "indicator" : "strategy"} "${st.name}" ${dir === -1 ? "SELL" : "BUY"} signal${st.source === "SCAN" ? " (Scanner Bot)" : ""} (confirmed bar close).`,
    },
    levelTop: entry,
    levelBot: entry,
    slModeLabel,
    exec,
  });
  const live = exec.executionMode === "live";
  if (!tradeId) {
    void sendAlert({
      kind: "broker",
      title: `PINE · ${st.name} · ORDER NOT PLACED`,
      body: `${st.symbol} ${dir === -1 ? "SELL" : "BUY"} @ ${entry} — ${live ? "the broker rejected or no active account" : "the paper book rejected the fill"}.`,
    });
    return;
  }
  st.pos = { dbId: tradeId, dir, entry, sl, tp, entryTime: bar.time, exec: live ? "LIVE" : "PAPER", broker: live ? await resolveBroker(exec.brokerAccountId) : null, entryId };
  void sendAlert({
    kind: "fire",
    title: `PINE ${dir === -1 ? "SELL" : "BUY"} · ${st.name} · ${st.symbol} ${st.tf}${st.source === "SCAN" ? " · SCANNER" : ""}`,
    body: `Entry ${entry}\nSL ${sl ?? "—"} · TP ${tp ?? "—"}\nRisk ${riskPips.toFixed(1)} pips → reward ${rewardPips.toFixed(1)} pips\nMode: ${live ? `LIVE · ${st.pos.broker?.label ?? "broker"}` : "PAPER"}\nTF ${st.tf} · confirmed-bar signal`,
  });
}

async function closePineTrade(st: PineState, px: number, reason: "sl" | "tp" | "signal" | "move"): Promise<void> {
  const pos = st.pos;
  if (!pos) return;
  const pip = pipSize(st.symbol);
  const pips = ((px - pos.entry) * pos.dir) / pip;
  const status = reason === "sl" ? "LOSS" : pips >= 0 ? "WIN" : "LOSS";
  if (pos.exec === "LIVE" && pos.broker) {
    await closeBrokerPosition(pos.broker, st.symbol, pos.dir).catch(() => {});
  }
  try {
    await db.trade.update({
      where: { id: pos.dbId },
      data: { status, resultPips: pips, closedAt: new Date(), note: reason === "signal" ? "Pine exit signal" : reason === "move" ? "Pine label moved — re-entered at the new extreme" : reason === "sl" ? "Pine SL hit" : "Pine TP hit" },
    });
  } catch {
    // book already closed (broker-side SL/TP) — keep going
  }
  // paper close → persistent demo balance (exactly once; no-op for LIVE)
  void bookPaperCloseFromDb(pos.dbId);
  // GLOBAL TRADE LOCK — the fire engaged it under source BOT; the 3EL engine
  // that normally releases BOT locks is idle while Pine trades, so the Pine
  // close must release it or every scanner/sweep/bot fire stays refused.
  // Only when this position owns the lock.
  if (getTradeLock()?.tradeDbId === pos.dbId) {
    maybeReleaseLock(st.source, st.symbol, st.tf, status === "WIN" ? "win" : "loss", Math.abs(pips));
  }
  void sendAlert({
    kind: status === "WIN" ? "win" : "loss",
    title: `PINE ${status === "WIN" ? "CLOSE +" : "CLOSE −"}${Math.abs(pips).toFixed(1)} PIPS · ${st.name}`,
    body: `${st.symbol} · ${reason === "signal" ? "exit signal" : reason === "move" ? "label moved — re-entering at the new extreme" : reason === "sl" ? "stop-loss hit" : "take-profit hit"} @ ${px}\nEntry was ${pos.entry} · Mode ${pos.exec}`,
  });
  st.pos = null;
}

/** DB-backed count for the studio header — honest, no in-memory fiction */
export async function pineBookSummary(): Promise<{ wins: number; losses: number; netPips: number }> {
  try {
    const trades = await db.trade.findMany({
      where: { mode: { in: ["BOT", "SCAN"] }, slMode: { startsWith: "Pine" }, status: { in: ["WIN", "LOSS"] } },
      select: { status: true, resultPips: true },
    });
    const wins = trades.filter((t) => t.status === "WIN").length;
    const losses = trades.filter((t) => t.status === "LOSS").length;
    const netPips = trades.reduce((a, t) => a + (t.status === "WIN" ? 1 : -1) * Math.abs(t.resultPips ?? 0), 0); // sign from status
    return { wins, losses, netPips };
  } catch {
    return { wins: 0, losses: 0, netPips: 0 };
  }
}
