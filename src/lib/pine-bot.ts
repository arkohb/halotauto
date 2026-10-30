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
  setActiveStrategySel,
} from "@/lib/strategy-select";

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
  strategyId: string;
  name: string;
  src: string;
  symbol: string;
  tf: string;
  rt: PineRuntime;
  meta: CompiledPine;
  signal: PineSignalCfg;
  risk: { useSlATR: boolean; slATRm: number; useSlPts: boolean; slPts: number; rrMult: number };
  lastConfirmedTime: number;
  lastPrice: number;
  warmed: boolean;
  pos: PinePos | null;
  atr: number | null; // independent ATR(14) tracker for the risk overlay
  atrPrevClose: number | null;
  feedSource: string;
}

const g = globalThis as unknown as {
  __haloPineBot?: {
    state: PineState | null;
    timer: ReturnType<typeof setInterval> | null;
    tickGen: number;
    lastTickAt: number;
    booting: Promise<void> | null;
    symbolWarned: boolean;
  };
};

function slot(): NonNullable<typeof g.__haloPineBot> {
  if (!g.__haloPineBot) {
    g.__haloPineBot = { state: null, timer: null, tickGen: 0, lastTickAt: 0, booting: null, symbolWarned: false };
  }
  return g.__haloPineBot;
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
  position: { dir: 1 | -1; entry: number; sl: number | null; tp: number | null } | null;
}

export function getPineBotInfo(): PineBotInfo {
  const st = slot().state;
  if (!st) {
    return { active: false, id: null, name: BUILTIN_STRATEGY_NAME, kind: "builtin", symbol: "", tf: "", warmed: false, position: null };
  }
  return {
    active: true,
    id: st.strategyId,
    name: st.name,
    kind: "pine",
    symbol: st.symbol,
    tf: st.tf,
    warmed: st.warmed,
    position: st.pos ? { dir: st.pos.dir, entry: st.pos.entry, sl: st.pos.sl, tp: st.pos.tp } : null,
  };
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
  const state = await buildState(row.id, row.name, row.pineSource, row.compiledJson, row.signalJson, row, probe.symbol, probe.tf);
  slot().state = state;
  setActiveStrategySel({ id: row.id, name: row.name, kind: "pine" });
  startTimer();
  void sendAlert({
    kind: "status",
    title: `STRATEGY ACTIVATED · ${row.name}`,
    body: `The bot now auto-trades the Pine strategy "${row.name}" on ${state.symbol || probe.symbol || "the chart symbol"} ${state.tf || probe.tf}. The built-in 3EL engine stays armed for levels but its fires are skipped while a Pine strategy is selected.`,
  });
  void tickPine(true).catch(() => {});
  return { ok: true };
}

export async function deactivatePineStrategy(): Promise<void> {
  const st = slot().state;
  await db.pineStrategy.updateMany({ data: { active: false } }).catch(() => {});
  stopTimer();
  slot().state = null;
  setActiveStrategySel({ id: null, name: BUILTIN_STRATEGY_NAME, kind: "builtin" });
  if (st) {
    void sendAlert({
      kind: "status",
      title: `STRATEGY DEACTIVATED · ${st.name}`,
      body: `The bot is back on the built-in ${BUILTIN_STRATEGY_NAME} engine. ${st.pos ? "The Pine strategy's open position keeps its broker SL/TP." : ""}`,
    });
  }
}

async function buildState(
  id: string,
  name: string,
  source: string,
  compiledJson: string,
  signalJson: string,
  row: { useSlATR: boolean; slATRm: number; useSlPts: boolean; slPts: number; rrMult: number },
  symbol: string,
  tf: string
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
    strategyId: id,
    name,
    src: source,
    symbol: symbol || "XAUUSD",
    tf: tf || "5m",
    rt: new PineRuntime(source, { mintick: getSymbolMeta(symbol || "XAUUSD").mintick, ticker: symbol, tf: tf || "5m", pipMult: 10 }),
    meta: meta ?? ({ ok: true, kind: "strategy", name, overlay: true, processOrdersOnClose: false, pyramiding: 0, inputs: [], plots: [], shapes: [], hlines: [], entryIds: [], hasLong: true, hasShort: false, hasExitSLTP: false, hasClose: false, signalCandidates: [], notes: [], diagnostics: [] } as CompiledPine),
    signal,
    risk: { useSlATR: row.useSlATR, slATRm: row.slATRm, useSlPts: row.useSlPts, slPts: row.slPts, rrMult: row.rrMult },
    lastConfirmedTime: 0,
    lastPrice: 0,
    warmed: false,
    pos: null,
    atr: null,
    atrPrevClose: null,
    feedSource: "—",
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
    void tickPine().catch(() => {});
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

// ── bar processing ───────────────────────────────────────────────────────
interface BarSignals {
  long: boolean;
  short: boolean;
  closeAll: boolean;
  closeIds: string[];
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
  for (const en of st.rt.plan.entries) {
    if (en.dir === 1) out.long = true;
    else out.short = true;
  }
  out.closeAll = st.rt.plan.closeAll;
  out.closeIds = [...st.rt.plan.closes];
  return out;
}

async function processConfirmedBar(st: PineState, c: Candle): Promise<void> {
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

  // 3 · new entries (PAUSE NEW ENTRIES blocks entries while flat, like 3EL)
  const wantLong = sig.long && (!st.pos || st.pos.dir === -1);
  const wantShort = sig.short && (!st.pos || st.pos.dir === 1);
  if ((wantLong || wantShort) && !st.pos) {
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
    source: "BOT",
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
      message: `Pine strategy "${st.name}" ${dir === -1 ? "SELL" : "BUY"} signal (confirmed bar close).`,
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
    title: `PINE ${dir === -1 ? "SELL" : "BUY"} · ${st.name} · ${st.symbol}`,
    body: `Entry ${entry}\nSL ${sl ?? "—"} · TP ${tp ?? "—"}\nRisk ${riskPips.toFixed(1)} pips → reward ${rewardPips.toFixed(1)} pips\nMode: ${live ? `LIVE · ${st.pos.broker?.label ?? "broker"}` : "PAPER"}\nTF ${st.tf} · confirmed-bar signal`,
  });
}

async function closePineTrade(st: PineState, px: number, reason: "sl" | "tp" | "signal"): Promise<void> {
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
      data: { status, resultPips: pips, closedAt: new Date(), note: reason === "signal" ? "Pine exit signal" : reason === "sl" ? "Pine SL hit" : "Pine TP hit" },
    });
  } catch {
    // book already closed (broker-side SL/TP) — keep going
  }
  void sendAlert({
    kind: status === "WIN" ? "win" : "loss",
    title: `PINE ${status === "WIN" ? "CLOSE +" : "CLOSE −"}${Math.abs(pips).toFixed(1)} PIPS · ${st.name}`,
    body: `${st.symbol} · ${reason === "signal" ? "exit signal" : reason === "sl" ? "stop-loss hit" : "take-profit hit"} @ ${px}\nEntry was ${pos.entry} · Mode ${pos.exec}`,
  });
  st.pos = null;
}

/** DB-backed count for the studio header — honest, no in-memory fiction */
export async function pineBookSummary(): Promise<{ wins: number; losses: number; netPips: number }> {
  try {
    const trades = await db.trade.findMany({
      where: { mode: "BOT", slMode: { startsWith: "Pine" }, status: { in: ["WIN", "LOSS"] } },
      select: { status: true, resultPips: true },
    });
    const wins = trades.filter((t) => t.status === "WIN").length;
    const losses = trades.filter((t) => t.status === "LOSS").length;
    const netPips = trades.reduce((a, t) => a + (t.resultPips ?? 0), 0);
    return { wins, losses, netPips };
  } catch {
    return { wins: 0, losses: 0, netPips: 0 };
  }
}
