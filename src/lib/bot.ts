// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL EA BOT · server-side singleton runtime
//  • Warms the strategy engine over history on boot
//  • Polls the feed every ~2s, processes newly confirmed bars
//  • Instant mode: executes intrabar fires (trial run on engine clone,
//    committed only when a fire/exit actually happens — Pine rollback semantics)
//  • PAPER or LIVE execution: live fires route through the active CFD
//    broker adapter (OANDA / IG / MT4-MT5 / Binance / bridge) with SL+TP
//  • Every signal + fill + SL/TP fans out to Telegram / email / web push
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { HaloEngine } from "./halo/engine";
import { Candle, DEFAULT_CONFIG, EngineEvent, HaloConfig } from "./halo/types";
import { getKlines, getSymbolMeta, markPrioritySymbol, tfSec } from "./market";
import { closeBrokerPosition, clampExec, edgeInfoFor, executeFire, gradeSpeech, loadExecSettings, resolveBroker, saveExecSettings, type ActiveBroker, type ExecSettings } from "./execution";
import { sendAlert } from "./alerts";
import { registerBotProbe } from "./strategy-select";
import { maybeAnnounceRangeOpportunities } from "./range-scan";
import { ensurePineBoot, getPineBotInfo } from "./pine-bot";
import { publishBotEvent } from "./halo/event-bus";
import { decimalsOf } from "./market-symbols";
import { getTradeLock, isLockHolder, maybeReleaseLock, registerLockParticipant } from "./trade-lock";
import { getEdgeSync, liveTradeManager } from "./edge/settings";
import { getOverlay, overlayCfg, overlayManager } from "./edge/autopilot";
import { applyManageLive } from "./edge/trade-manager";
import { ensureReconciled } from "./exec-lock";
import { settleOrphanTradesOnce } from "@/lib/orphan-trades";
import type { TradeManagerCfg } from "./halo/types";

/**
 * EDGE overlay — the config the engine actually runs. A live Autopilot
 * profile for this market is layered on top of the SAVED settings at
 * runtime; bot.cfg (what is persisted) is never modified by it.
 */
function effectiveCfg(): HaloConfig {
  const bot = getBot();
  const ov = getOverlay(bot.symbol, bot.tf);
  return ov ? overlayCfg(bot.cfg, ov) : bot.cfg;
}

function effectiveTm(): TradeManagerCfg | null {
  const bot = getBot();
  const ov = getOverlay(bot.symbol, bot.tf);
  return ov ? overlayManager(getEdgeSync(), ov) : liveTradeManager();
}

/** re-apply the EDGE overlay + trade manager onto the running engine */
function syncEdge(): void {
  const bot = getBot();
  // never swap the stop/target geometry under an OPEN trade
  if (!bot.engine.snapshot().trade) bot.engine.cfg = effectiveCfg();
  bot.engine.tm = effectiveTm();
}

// register the live runtime probe for the Pine auto-trade loop (leaf module,
// avoids a circular import between bot.ts and pine-bot.ts)
registerBotProbe(() => {
  const b = getBot();
  return { enabled: b.enabled, pauseNew: b.pauseNew, symbol: b.symbol, tf: b.tf };
});

// GLOBAL TRADE LOCK participant — when a trade fires anywhere in the app the
// lock wipes this engine's armed levels too ("all armed levels are deleted")
registerLockParticipant({
  key: "bot",
  clearLevels: (time) => getBot().engine.clearArmedLevels(time),
});

export interface BotRuntime {
  cfg: HaloConfig;
  symbol: string;
  tf: string;
  engine: HaloEngine;
  enabled: boolean;
  /** AUTO-ATTACH: EA attaches itself to the chart & auto-starts on boot (no manual start) */
  autoAttach: boolean;
  /** operator PAUSE NEW ENTRIES: keep managing an open trade, block new signals when flat */
  pauseNew: boolean;
  bootstrapped: boolean;
  lastConfirmedTime: number;
  lastTickAt: number;
  feedSource: string;
  feedNote: string;
  lastPrice: number;
  openTradeDbId: string | null;
  openTradeExec: "PAPER" | "LIVE";
  openTradeDir: -1 | 1 | 0;
  liveBroker: ActiveBroker | null;
  realizedPips: number;
  timer: ReturnType<typeof setInterval> | null;
  booting: Promise<void> | null;
}

const g = globalThis as unknown as { __haloBot?: BotRuntime };

export function getBot(): BotRuntime {
  if (!g.__haloBot) {
    g.__haloBot = {
      cfg: { ...DEFAULT_CONFIG },
      symbol: "PAXGUSDT",
      tf: "5m",
      engine: new HaloEngine(DEFAULT_CONFIG, 0.01),
      enabled: false,
      autoAttach: true,
      pauseNew: false,
      bootstrapped: false,
      lastConfirmedTime: 0,
      lastTickAt: 0,
      feedSource: "—",
      feedNote: "",
      lastPrice: 0,
      openTradeDbId: null,
      openTradeExec: "PAPER",
      openTradeDir: 0,
      liveBroker: null,
      realizedPips: 0,
      timer: null,
      booting: null,
    };
  }
  return g.__haloBot;
}

function clampConfig(cfg: HaloConfig): HaloConfig {
  const c = { ...cfg };
  c.atrLen = Math.min(200, Math.max(1, Math.round(Number(c.atrLen) || 14)));
  c.bodyMinATR = Math.min(3, Math.max(0, Number(c.bodyMinATR) || 0));
  c.pairTolATR = Math.min(3, Math.max(0, Number(c.pairTolATR) || 0));
  c.minSepATR = Math.min(10, Math.max(0, Number(c.minSepATR) || 0));
  c.maxLevels = Math.min(10, Math.max(1, Math.round(Number(c.maxLevels) || 3)));
  c.expiryBars = Math.min(2000, Math.max(5, Math.round(Number(c.expiryBars) || 150)));
  c.levelPersist = c.levelPersist !== false; // default ON — armed levels persist until touched & fired
  c.retestBars = Math.min(1000, Math.max(1, Math.round(Number(c.retestBars) || 24)));
  c.rangeFilter = c.rangeFilter !== false; // default ON — ranging market + S/R too close → skip
  c.rangeSepATR = Math.min(20, Math.max(0.1, Number(c.rangeSepATR) || 1));
  c.focusCurrent = c.focusCurrent !== false; // default ON — one armed level per side (support + resistance live together)
  c.sigMode = c.sigMode === "barclose" ? "barclose" : "instant";
  c.breakATR = Math.min(3, Math.max(0, Number(c.breakATR) || 0));
  c.eqTolATR = Math.min(3, Math.max(0, Number(c.eqTolATR) || 0));
  c.minWickATR = Math.min(3, Math.max(0, Number(c.minWickATR) || 0));
  c.wickInside = Boolean(c.wickInside);
  c.slMode = ["points", "wick", "atr"].includes(c.slMode) ? c.slMode : "points";
  c.slPts = Math.min(10_000_000, Math.max(1, Math.round(Number(c.slPts) || 1000)));
  c.slBufPts = Math.min(1_000_000, Math.max(0, Math.round(Number(c.slBufPts) || 0)));
  c.slATRm = Math.min(20, Math.max(0.1, Number(c.slATRm) || 1.5));
  c.rrMult = Math.min(20, Math.max(0.1, Number(c.rrMult) || 3));
  c.pipMult = Math.min(10_000, Math.max(1, Math.round(Number(c.pipMult) || 10)));
  return c;
}

async function loadPersisted(): Promise<void> {
  const bot = getBot();
  try {
    const row = await db.botConfig.findUnique({ where: { id: "main" } });
    if (row) {
      bot.enabled = row.enabled;
      bot.autoAttach = row.autoAttach;
      bot.pauseNew = Boolean(row.pauseNew);
      bot.symbol = row.symbol;
      bot.tf = row.timeframe;
      bot.realizedPips = row.realizedPips;
      try {
        bot.cfg = clampConfig({ ...DEFAULT_CONFIG, ...JSON.parse(row.configJson) });
      } catch {
        bot.cfg = { ...DEFAULT_CONFIG };
      }
    } else {
      await db.botConfig.create({
        data: {
          id: "main",
          enabled: false,
          autoAttach: true,
          pauseNew: bot.pauseNew,
          symbol: bot.symbol,
          timeframe: bot.tf,
          configJson: JSON.stringify(bot.cfg),
        },
      });
    }
  } catch {
    // DB not ready — run with defaults
  }
}

async function persistBot(): Promise<void> {
  const bot = getBot();
  try {
    await db.botConfig.upsert({
      where: { id: "main" },
      create: {
        id: "main",
        enabled: bot.enabled,
        autoAttach: bot.autoAttach,
        pauseNew: bot.pauseNew,
        symbol: bot.symbol,
        timeframe: bot.tf,
        configJson: JSON.stringify(bot.cfg),
        realizedPips: bot.realizedPips,
        lastFeedSource: bot.feedSource,
      },
      update: {
        enabled: bot.enabled,
        autoAttach: bot.autoAttach,
        pauseNew: bot.pauseNew,
        symbol: bot.symbol,
        timeframe: bot.tf,
        configJson: JSON.stringify(bot.cfg),
        realizedPips: bot.realizedPips,
        lastFeedSource: bot.feedSource,
      },
    });
  } catch {
    // ignore persistence failures
  }
}

async function warmEngine(): Promise<void> {
  const bot = getBot();
  const meta = getSymbolMeta(bot.symbol);
  bot.engine = new HaloEngine(effectiveCfg(), meta.mintick);
  bot.engine.tm = effectiveTm();
  bot.openTradeDbId = null;
  bot.lastConfirmedTime = 0;
  try {
    markPrioritySymbol(bot.symbol); // the bot's own market is fetched ahead of scanner traffic
    const { candles, source } = await getKlines(bot.symbol, bot.tf, 600, { deep: true });
    bot.feedSource = source;
    bot.feedNote =
      source === "simulator" ? "Live feeds unreachable — running built-in market simulator" : "";
    const now = Date.now();
    const secMs = tfSec(bot.tf) * 1000;
    let lastConfirmed = 0;
    for (const c of candles) {
      if (c.time + secMs <= now) {
        bot.engine.processBar(c, true);
        lastConfirmed = c.time;
      }
    }
    bot.lastConfirmedTime = lastConfirmed;
    const live = candles[candles.length - 1];
    if (live && live.time + secMs > now) {
      bot.lastPrice = live.close;
      liveTrial(live);
    } else if (live) {
      bot.lastPrice = live.close; // market closed (weekend): last traded close
    }
  } catch (e) {
    bot.feedNote = "Warm-up error: " + (e as Error).message;
  }
}

export async function ensureBoot(): Promise<void> {
  const bot = getBot();
  if (bot.bootstrapped) return;
  if (bot.booting) return bot.booting;
  bot.booting = (async () => {
    await loadPersisted();
    // restore the persistent execution lock (an order open or in doubt
    // before a restart keeps every engine paused until it is resolved)
    await ensureReconciled();
    // paper trades nothing manages any more (pre-lock / test fires) are
    // settled from real candles or voided, so the book never shows ghosts
    await settleOrphanTradesOnce();
    await warmEngine();
    bot.bootstrapped = true;
    // ── AUTO-ATTACH ────────────────────────────────────────────────
    // The EA attaches itself to the TradingView chart automatically:
    // unless the user explicitly detached it (STOP sets autoAttach=false),
    // the engine boots watching the chart symbol & trading it — no manual
    // "START" press, no Pine paste, no manual alert creation.
    if (!bot.enabled && bot.autoAttach) {
      bot.enabled = true;
      void persistBot();
    }
    if (bot.enabled) startTimer();
  })().finally(() => {
    bot.booting = null;
  });
  return bot.booting;
}

// timer lives on globalThis with a generation guard — HMR module reloads
// must never leave a zombie interval feeding the bot from a stale module
const gTim = globalThis as unknown as {
  __haloBotTimer?: ReturnType<typeof setInterval>;
  __haloTickGen?: number;
};

function startTimer(): void {
  const bot = getBot();
  if (gTim.__haloBotTimer) clearInterval(gTim.__haloBotTimer);
  if (bot.timer) {
    clearInterval(bot.timer);
    bot.timer = null;
  }
  const gen = (gTim.__haloTickGen = (gTim.__haloTickGen ?? 0) + 1);
  gTim.__haloBotTimer = setInterval(() => {
    if (gTim.__haloTickGen !== gen) {
      // superseded by a newer module instance — kill this zombie
      clearInterval(gTim.__haloBotTimer!);
      gTim.__haloBotTimer = undefined;
      return;
    }
    tickBot().catch(() => {});
  }, 2000);
  (gTim.__haloBotTimer as unknown as { unref?: () => void }).unref?.();
  bot.timer = gTim.__haloBotTimer;
}

/** Instant mode: trial-run the live candle on a clone; commit only on fire/exit. */
function liveTrial(live: Candle): void {
  const bot = getBot();
  // GLOBAL TRADE LOCK: while a trade runs elsewhere the bot engine is frozen
  // (no intrabar evaluation, no new levels, no fires). The lock holder keeps
  // its full lifecycle.
  if (!isLockHolder("BOT", bot.symbol, bot.tf)) return;
  // PAUSE NEW ENTRIES / PINE STRATEGY ACTIVE: while flat, new signals are not
  // evaluated at all — the engine can never emit a fire we would refuse to
  // execute. An open trade keeps its full lifecycle (win/loss detection).
  if ((bot.pauseNew || getPineBotInfo().active) && !bot.engine.snapshot().trade) return;
  if (bot.cfg.sigMode !== "instant") return;
  const clone = bot.engine.clone();
  const events = clone.processBar(live, false);
  // commit when a fire/exit HAPPENS — a range_skip also consumes the level
  // (the too-close trigger is burned) so it must persist too, or the live
  // trial would re-evaluate the same skip on every feed tick. A C3 BREAK is
  // committed as well: the trader must hear "candle 3 is breaking…" the
  // moment it happens (live, intrabar), and the level's broke flag must
  // persist so the break is never announced twice.
  const commit = events.some(
    (e) =>
      e.type === "fire" ||
      e.type === "win" ||
      e.type === "loss" ||
      e.type === "range_skip" ||
      e.type === "break"
  );
  if (commit) {
    bot.engine = clone;
    void handleEvents(events, live);
  }
}

async function handleEvents(events: EngineEvent[], bar: Candle): Promise<void> {
  const bot = getBot();
  const meta = getSymbolMeta(bot.symbol);
  const symLabel = meta.label.split("·")[0].trim() || bot.symbol;
  const px = (v: number): string => v.toFixed(decimalsOf(meta.mintick));
  for (const e of events) {
    if (e.type === "fire") {
      // GLOBAL TRADE LOCK — single trade at a time across the whole app: if a
      // trade is already running (scanner / all-pairs sweep), this signal is
      // honestly refused instead of silently dropped.
      const lock = getTradeLock();
      if (lock) {
        void sendAlert({
          kind: "status",
          title: "HALO 3EL · FIRE SKIPPED — TRADE ALREADY RUNNING",
          body: `${e.dir === -1 ? "SELL" : "BUY"} @ ${e.entry} on ${bot.symbol} ${bot.tf} was NOT executed: a trade is already running on ${lock.symbol} ${lock.tf}. Scanning resumes when it hits TP or SL.`,
        });
        publishBotEvent({
          kind: "status",
          prio: "low",
          symbol: bot.symbol,
          tf: bot.tf,
          time: e.time,
          title: `FIRE SKIPPED · TRADE RUNNING · ${symLabel}`,
          spoken: `A ${e.dir === -1 ? "sell" : "buy"} signal appeared on ${symLabel}, but a trade is already running on ${lock.symbol} — it was skipped. Scanning resumes when that trade closes.`,
        });
        continue;
      }
      // SINGLE ACTIVE STRATEGY — when a Pine strategy is selected in the
      // Strategy Studio, the 3EL engine stays armed for levels & charting but
      // its fires are NOT executed. Alerted honestly, never dropped silently.
      if (getPineBotInfo().active) {
        void sendAlert({
          kind: "status",
          title: "HALO 3EL · FIRE SKIPPED — PINE STRATEGY ACTIVE",
          body: `${e.dir === -1 ? "SELL" : "BUY"} @ ${e.entry} on ${bot.symbol} ${bot.tf} was NOT executed: the bot is currently trading the Pine strategy "${getPineBotInfo().name}". Deactivate it in the Strategy Studio to restore 3EL auto-trading.`,
        });
        publishBotEvent({
          kind: "status",
          prio: "low",
          symbol: bot.symbol,
          tf: bot.tf,
          time: e.time,
          title: `3EL FIRE SKIPPED · PINE ACTIVE · ${symLabel}`,
          spoken: `A ${e.dir === -1 ? "sell" : "buy"} signal appeared on ${symLabel}, but it was not executed — the Pine strategy ${getPineBotInfo().name} is trading instead.`,
        });
        continue;
      }
      const exec = await loadExecSettings();
      const live = exec.executionMode === "live";
      const tradeId = await executeFire({
        source: "BOT",
        symbol: bot.symbol,
        tf: bot.tf,
        fire: e,
        levelTop: e.levelTop,
        levelBot: e.levelBot,
        slModeLabel: bot.cfg.slMode === "points" ? "Fixed points" : bot.cfg.slMode === "atr" ? "ATR" : "Break extreme + buffer",
        exec,
      });
      bot.openTradeDbId = tradeId;
      bot.openTradeExec = live ? "LIVE" : "PAPER";
      bot.openTradeDir = e.dir;
      bot.liveBroker = live ? await resolveBroker(exec.brokerAccountId) : null;
      void sendAlert({
        kind: "fire",
        title: `HALO 3EL ${e.dir === -1 ? "SELL" : "BUY"} · ${symLabel}`,
        body: `${e.message}\nSymbol: ${bot.symbol} · TF ${bot.tf}\nMode: ${live ? `LIVE · ${bot.liveBroker?.label ?? "broker"}` : "PAPER"}\nRisk ${e.riskPips.toFixed(1)} pips → reward ${e.rewardPips.toFixed(1)} pips`,
      });
      // the trade really opened → the bot says it out loud to alert the trader
      if (tradeId) {
        publishBotEvent({
          kind: "fire",
          prio: "high",
          symbol: bot.symbol,
          tf: bot.tf,
          time: e.time,
          title: `TRADE FIRED · ${e.dir === -1 ? "SELL" : "BUY"} ${symLabel} @ ${px(e.entry)}${edgeInfoFor(tradeId)?.grade ? ` · GRADE ${edgeInfoFor(tradeId)!.grade!.letter}` : ""}`,
          spoken: `Trade fired — ${e.dir === -1 ? "sell" : "buy"} ${symLabel} at ${px(e.entry)}.${gradeSpeech(edgeInfoFor(tradeId)?.grade ?? null)} Stop loss ${px(e.sl)}, take profit ${px(e.tp)}. Risk ${e.riskPips.toFixed(1)} pips for a target of ${e.rewardPips.toFixed(1)} pips.`,
        });
      }
    } else if (e.type === "win" || e.type === "loss") {
      const hadExecuted = !!bot.openTradeDbId; // a skipped fire (Pine active) never books anything
      const wasLive = bot.openTradeExec === "LIVE";
      if (hadExecuted && wasLive && bot.liveBroker) {
        // broker-side SL/TP usually fired already; market-close as backstop
        const d = bot.openTradeDir;
        await closeBrokerPosition(bot.liveBroker, bot.symbol, d === 0 ? undefined : d).catch(() => {});
      }
      if (hadExecuted) {
        try {
          await db.trade.update({
            where: { id: bot.openTradeDbId! },
            data: {
              status: e.type === "win" ? "WIN" : "LOSS",
              resultPips: e.pips,
              closedAt: new Date(e.time),
            },
          });
          bot.realizedPips += e.type === "win" ? e.pips : -e.pips;
          await persistBot();
        } catch {
          // ignore
        }
        void sendAlert({
          kind: e.type,
          title: `HALO 3EL ${e.type === "win" ? "TP HIT +" : "SL HIT −"}${e.pips.toFixed(1)} PIPS · ${symLabel}`,
          body: `${e.message}\nSymbol: ${bot.symbol} · TF ${bot.tf}\nRealized book: ${bot.realizedPips >= 0 ? "+" : "−"}${Math.abs(bot.realizedPips).toFixed(1)} pips`,
        });
        publishBotEvent({
          kind: e.type,
          prio: "high",
          symbol: bot.symbol,
          tf: bot.tf,
          time: e.time,
          title: `${e.reason === "managed" ? "MANAGED STOP" : e.type === "win" ? "TP HIT" : "SL HIT"} ${e.type === "win" ? "+" : "−"}${e.pips.toFixed(1)} pips · ${symLabel}`,
          spoken: `${e.reason === "managed" ? "Managed stop hit" : e.type === "win" ? "Take profit hit" : "Stop loss hit"} on ${symLabel} — ${e.type === "win" ? "plus" : "minus"} ${e.pips.toFixed(1)} pips. Total is ${bot.realizedPips >= 0 ? "plus" : "minus"} ${Math.abs(bot.realizedPips).toFixed(1)} pips.`,
        });
      }
      bot.openTradeDbId = null;
      bot.openTradeExec = "PAPER";
      bot.openTradeDir = 0;
      bot.liveBroker = null;
      // GLOBAL TRADE LOCK release — scanning re-activates (announced on the bus)
      maybeReleaseLock("BOT", bot.symbol, bot.tf, e.type, e.pips);
    } else if (e.type === "manage") {
      // ── EDGE · SMART TRADE MANAGER — mirror the step onto book + broker ──
      if (!bot.openTradeDbId) continue; // refused fire (phantom engine trade) — nothing to manage
      const out = await applyManageLive(e, {
        tradeDbId: bot.openTradeDbId,
        broker: bot.openTradeExec === "LIVE" ? bot.liveBroker : null,
        symbol: bot.symbol,
      });
      const what = e.action === "breakeven" ? "Stop moved to break-even" : e.action === "trail" ? "Trailing stop raised" : `Closed ${Math.round((e.frac ?? 0) * 100)} percent early`;
      publishBotEvent({
        kind: "status",
        prio: e.action === "partial" ? "high" : "low",
        symbol: bot.symbol,
        tf: bot.tf,
        time: e.time,
        title: `TRADE MANAGER · ${e.action.toUpperCase()} · ${symLabel} · SL ${px(e.sl)}`,
        spoken: `${what} on ${symLabel}${e.action === "partial" ? ` at ${px(e.price ?? e.entry)}` : `, new stop ${px(e.sl)}`}.${out.broker === "failed" ? ` Broker update failed — ${out.note}.` : ""}`,
      });
      void sendAlert({ kind: "status", title: `HALO EDGE · ${e.action.toUpperCase()} · ${symLabel}`, body: `${e.message}\n${out.note}` });
    } else if (e.type === "range_skip") {
      // the strategy refused the trade: market RANGING, marked support &
      // resistance too close for entry — state it honestly, then look for
      // fresh levels further away from the range to arm instead
      void sendAlert({
        kind: "skip",
        title: `HALO 3EL · TRADE SKIPPED — RANGING MARKET (${e.dir === -1 ? "SELL" : "BUY"})`,
        body: `${e.message}\nSymbol: ${bot.symbol} · TF ${bot.tf}\nThe too-close level is burned — the EA keeps hunting fresh levels further from the range.`,
      });
      publishBotEvent({
        kind: "range_skip",
        prio: "low",
        symbol: bot.symbol,
        tf: bot.tf,
        time: e.time,
        title: `TRADE SKIPPED · RANGING MARKET · ${symLabel}`,
        spoken: e.message,
      });
      void maybeAnnounceRangeOpportunities({ symbol: bot.symbol, tf: bot.tf, cfg: bot.cfg }).catch(() => {});
    } else if (e.type === "level") {
      // ── LEVEL ARMED — the bot announces it with the corresponding prices ──
      // one armed support + one armed resistance stay live together; the
      // moment the pair is complete both triggers are read out.
      const lv = bot.engine.snapshot().levels;
      const sup = lv.find((l) => l.side === 1);
      const res = lv.find((l) => l.side === -1);
      const both = !!sup && !!res;
      const sideWord = e.side === -1 ? "Resistance" : "Support";
      publishBotEvent({
        kind: "armed",
        prio: "low",
        symbol: bot.symbol,
        tf: bot.tf,
        time: bar.time,
        title: both
          ? `BOTH LEVELS ARMED · ${symLabel} · R ${px(res!.ext)} / S ${px(sup!.ext)}`
          : `${sideWord.toUpperCase()} ARMED · ${symLabel} @ ${px(e.ext)}`,
        spoken: both
          ? `Both levels are armed on ${symLabel} — resistance trigger at ${px(res!.ext)}, support trigger at ${px(sup!.ext)}. Two live triggers on the board.`
          : `${sideWord} level armed on ${symLabel}, trigger line at ${px(e.ext)}. Watching for candle three to break the dotted line and return.`,
      });
    } else if (e.type === "level_removed") {
      // ── LEVEL INVALIDATED — broke the dotted line, price never came back ──
      // for entry within the re-test window: removed, and the engine hunts a
      // fresh level. The bot states the removal (and that a fresh hunt is on).
      const sideWord = e.side === -1 ? "Resistance" : "Support";
      publishBotEvent({
        kind: "status",
        prio: "low",
        symbol: bot.symbol,
        tf: bot.tf,
        time: e.time,
        title: `LEVEL REMOVED · ${sideWord.toUpperCase()} ${px(e.ext)} · ${symLabel}`,
        spoken: `${sideWord} level at ${px(e.ext)} on ${symLabel} is invalidated — the price broke the dotted line and never returned for entry, so I removed it. I am hunting a fresh level to arm instead.`,
      });
    } else if (e.type === "break") {
      // ── C3 BREAK — said LOUD (high priority): candle 3 pierced the dotted ──
      // wick trigger line; the trade fires if price returns to the line.
      publishBotEvent({
        kind: "break",
        prio: "high",
        symbol: bot.symbol,
        tf: bot.tf,
        time: e.time,
        title: `C3 BREAK · ${e.side === -1 ? "RESISTANCE" : "SUPPORT"} ${px(e.ext)} · ${symLabel}`,
        spoken: `Attention — candle three is breaking ${e.side === -1 ? "above" : "below"} the ${e.side === -1 ? "resistance" : "support"} trigger at ${px(e.ext)} on ${symLabel}. Price is beyond the dotted line — watching for the return to fire the trade.`,
      });
    }
  }
  void bar;
}

export async function tickBot(force = false): Promise<void> {
  const bot = getBot();
  const now = Date.now();
  if (!force && now - bot.lastTickAt < 1500) return;
  bot.lastTickAt = now;
  if (!bot.bootstrapped) {
    await ensureBoot();
    if (!bot.bootstrapped) return;
  }
  // GLOBAL TRADE LOCK: while a trade runs elsewhere (scanner / all-pairs
  // sweep) the bot engine is FROZEN — no bar feeding, no arming, no fires.
  // Only the price book stays fresh; scanning resumes when TP/SL releases
  // the lock. When the BOT itself holds the trade it keeps ticking below.
  const frozen = !isLockHolder("BOT", bot.symbol, bot.tf);
  try {
    const prevSource = bot.feedSource;
    markPrioritySymbol(bot.symbol);
    const { candles, source, stale } = await getKlines(bot.symbol, bot.tf, 4, { fresh: true });
    bot.feedSource = source;
    bot.feedNote =
      source === "simulator"
        ? "Live feeds unreachable — running built-in market simulator"
        : stale
          ? "Feed slow — using cached candles"
          : "";
    if (frozen) {
      const frozenLive = candles[candles.length - 1];
      if (frozenLive) bot.lastPrice = frozenLive.close;
      return;
    }
    // feed upgraded (simulator → real OHLC): re-anchor the engine onto the
    // real series so levels/pips track actual market prices
    if (prevSource === "simulator" && source !== "simulator" && !bot.engine.snapshot().trade) {
      await warmEngine();
      return;
    }
    const secMs = tfSec(bot.tf) * 1000;
    syncEdge();

    for (const c of candles) {
      if (c.time > bot.lastConfirmedTime && c.time + secMs <= now) {
        // PAUSE NEW ENTRIES / PINE STRATEGY ACTIVE: when flat, keep the bar
        // cursor moving (price book stays fresh) but do NOT feed the engine —
        // no new C1/C2 evaluation, so it can never emit a fire that would be
        // refused (or a phantom internal trade) while another strategy trades.
        // When a trade is open the engine keeps processing (SL/TP detection).
        if ((bot.pauseNew || getPineBotInfo().active) && !bot.engine.snapshot().trade) {
          bot.lastConfirmedTime = c.time;
          bot.lastPrice = c.close;
          continue;
        }
        const ev = bot.engine.processBar(c, true);
        await handleEvents(ev, c);
        bot.lastConfirmedTime = c.time;
        bot.lastPrice = c.close;
      }
    }

    const live = candles[candles.length - 1];
    if (live && live.time + secMs > now && live.time > bot.lastConfirmedTime) {
      bot.lastPrice = live.close;
      liveTrial(live);
    }
  } catch (e) {
    bot.feedNote = "Feed error: " + (e as Error).message;
  }
}

export { clampConfig };

export async function startBot(): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  // if the bot was idle for a long stretch, re-warm so state stays coherent
  const secMs = tfSec(bot.tf) * 1000;
  if (bot.lastConfirmedTime && Date.now() - bot.lastConfirmedTime > secMs * 10) {
    await warmEngine();
  }
  bot.enabled = true;
  bot.autoAttach = true; // re-attaching (re)arms the auto-attach behaviour
  startTimer();
  await persistBot();
  void sendAlert({
    kind: "status",
    title: "HALO 3EL · EA BOT STARTED",
    body: `${bot.symbol} ${bot.tf} · ${bot.cfg.sigMode === "instant" ? "Instant" : "Bar close"} mode — scanning for C1/C2 equal levels.`,
  });
  tickBot(true).catch(() => {});
}

export async function stopBot(): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  bot.enabled = false;
  bot.autoAttach = false; // explicit detach — survives reboots
  if (gTim.__haloBotTimer) {
    clearInterval(gTim.__haloBotTimer);
    gTim.__haloBotTimer = undefined;
  }
  if (bot.timer) {
    clearInterval(bot.timer);
    bot.timer = null;
  }
  await persistBot();
  void sendAlert({
    kind: "status",
    title: "HALO 3EL · EA BOT STOPPED",
    body: `${bot.symbol} ${bot.tf} — no new executions. Open positions stay managed by broker SL/TP.`,
  });
}

export async function resetBot(): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  if (bot.engine.snapshot().trade) {
    throw new Error("Cannot reset while a trade is open — wait for SL/TP.");
  }
  await warmEngine();
  // a rebuild re-arms levels from history — during a trade lock the board
  // must stay empty until the running trade closes
  if (getTradeLock()) bot.engine.clearArmedLevels(Date.now());
  await persistBot();
}

/** Operator PAUSE NEW ENTRIES — open trade keeps being managed, no new signals while flat. */
export async function setPauseNew(paused: boolean): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  if (bot.pauseNew === paused) return;
  bot.pauseNew = paused;
  await persistBot();
  void sendAlert({
    kind: "status",
    title: `HALO 3EL · NEW ENTRIES ${paused ? "PAUSED" : "RESUMED"}`,
    body: paused
      ? `${bot.symbol} ${bot.tf} — no new positions while flat. An open trade (if any) stays fully managed by the engine + broker SL/TP.`
      : `${bot.symbol} ${bot.tf} — the EA accepts new C3 fires again.`,
  });
}

/** Manual market close of the open trade at the last known price. */
export async function closeOpenTrade(): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  const openTrade = bot.engine.snapshot().trade;
  if (!openTrade) throw new Error("No open trade to close.");
  const price = bot.lastPrice || openTrade.entry;
  const events = bot.engine.forceClose(price, Date.now());
  await handleEvents(events, { time: Date.now(), open: price, high: price, low: price, close: price });
}

export interface ConfigPatch {
  cfg?: Partial<HaloConfig>;
  symbol?: string;
  tf?: string;
  exec?: Partial<ExecSettings>;
}

export async function updateBotConfig(patch: ConfigPatch): Promise<void> {
  await ensureBoot();
  const bot = getBot();
  const nextSym = patch.symbol ?? bot.symbol;
  const nextTf = patch.tf ?? bot.tf;
  const nextCfg = clampConfig({ ...bot.cfg, ...(patch.cfg ?? {}) });

  if (nextSym !== bot.symbol || nextTf !== bot.tf) {
    const openTrade = bot.engine.snapshot().trade;
    if (openTrade) {
      // Paper trade → auto-close at the last known price so chart pair
      // selection always works (the trade is simulated; the book keeps the
      // record and the alert log stays transparent).
      // LIVE trade → never abandon a real broker position (MT5 protection
      // iron rule): the switch stays blocked until the user closes it.
      const exec = await loadExecSettings();
      if (exec.executionMode === "live") {
        throw new Error("Cannot switch symbol/timeframe while a LIVE trade is open — close it first on the Trade card.");
      }
      const price = bot.lastPrice || openTrade.entry;
      const events = bot.engine.forceClose(price, Date.now());
      await handleEvents(events, { time: Date.now(), open: price, high: price, low: price, close: price });
      void sendAlert({
        kind: "status",
        title: "HALO 3EL · PAPER TRADE AUTO-CLOSED",
        body: `${bot.symbol} ${bot.tf} — the open paper trade was closed at market to switch the chart to ${nextSym} ${nextTf}.`,
      });
    }
    bot.symbol = nextSym;
    bot.tf = nextTf;
    await warmEngine();
    // a rebuild re-arms levels from history — during a trade lock the board
    // must stay empty until the running trade closes
    if (getTradeLock()) bot.engine.clearArmedLevels(Date.now());
  }
  bot.cfg = nextCfg;
  syncEdge();

  if (patch.exec) {
    // merge onto CURRENT settings so partial patches (mode toggle, GO LIVE…)
    // never reset sizing fields back to defaults
    const cur = await loadExecSettings();
    const nextExec = clampExec({ ...cur, ...patch.exec });
    if (nextExec.executionMode === "live") {
      const broker = await resolveBroker(nextExec.brokerAccountId);
      if (!broker) throw new Error("Pick an active broker account before switching to LIVE execution.");
    }
    await saveExecSettings(nextExec);
    // mirror into the persisted BotConfig row
    try {
      await db.botConfig.upsert({
        where: { id: "main" },
        create: { id: "main", ...nextExec },
        update: nextExec,
      });
    } catch {
      // ignore
    }
  }

  await persistBot();
}

export interface ExecSummary {
  executionMode: "paper" | "live";
  sizingMode: "fixed" | "percent";
  sizeFixed: number;
  sizePercent: number;
  broker: { id: string; label: string; kind: string; status: string; statusMsg: string } | null;
}

/** mark which engine fires / results were really traded (booked as a Trade) —
 *  the start-up history replay and paused signals produce fires that never
 *  became trades, and the chart must not present them as taken */
async function annotateTraded(
  snap: ReturnType<HaloEngine["snapshot"]>,
  symbol: string,
  tf: string,
  openTradeDbId: string | null
): Promise<ReturnType<HaloEngine["snapshot"]>> {
  const fires = snap.log.filter((e) => e.kind === "fire");
  let booked = new Set<number>();
  if (fires.length > 0) {
    try {
      const rows = await db.trade.findMany({
        where: { mode: "BOT", symbol, timeframe: tf, openedAt: { in: fires.map((f) => new Date(f.time)) } },
        select: { openedAt: true },
      });
      booked = new Set(rows.map((r) => r.openedAt.getTime()));
    } catch {
      // unknown → treat as untraded (never over-claim)
    }
  }
  let lastFireTraded = false;
  const log = snap.log.map((e) => {
    if (e.kind === "fire") {
      lastFireTraded = booked.has(e.time);
      return { ...e, traded: lastFireTraded };
    }
    if (e.kind === "win" || e.kind === "loss") return { ...e, traded: lastFireTraded };
    return e;
  });
  // only a BOOKED position is reported as the running trade
  if (snap.trade && !openTradeDbId) return { ...snap, log, trade: null, signalTrade: { ...snap.trade, traded: false } };
  return { ...snap, log, trade: snap.trade ? { ...snap.trade, traded: true } : null, signalTrade: null };
}

export async function botState(): Promise<{
  enabled: boolean;
  autoAttach: boolean;
  pauseNew: boolean;
  symbol: string;
  tf: string;
  mintick: number;
  feed: { source: string; note: string; price: number; lastTickAt: number; realizedPips: number };
  config: HaloConfig;
  engine: ReturnType<HaloEngine["snapshot"]>;
  exec: ExecSummary;
  strategy: ReturnType<typeof getPineBotInfo> & { selected: { id: string | null; name: string; kind: "builtin" | "pine" } };
  scanLock: import("./trade-lock").TradeLockState | null;
}> {
  await ensureBoot();
  const bot = getBot();
  await tickBot().catch(() => {});
  void ensurePineBoot().catch(() => {}); // re-arm the Pine auto-trader after restarts
  const meta = getSymbolMeta(bot.symbol);
  const exec = await loadExecSettings();
  let broker: ExecSummary["broker"] = null;
  if (exec.executionMode === "live") {
    const row = await resolveBroker(exec.brokerAccountId);
    if (row) {
      try {
        const acct = await db.brokerAccount.findUnique({ where: { id: row.id } });
        if (acct) broker = { id: acct.id, label: acct.label, kind: acct.kind, status: acct.status, statusMsg: acct.statusMsg };
      } catch {
        // ignore
      }
    }
  }
  return {
    enabled: bot.enabled,
    autoAttach: bot.autoAttach,
    pauseNew: bot.pauseNew,
    symbol: bot.symbol,
    tf: bot.tf,
    mintick: meta.mintick,
    feed: {
      source: bot.feedSource,
      note: bot.feedNote,
      price: bot.lastPrice,
      lastTickAt: bot.lastTickAt,
      realizedPips: bot.realizedPips,
    },
    config: bot.cfg,
    engine: await annotateTraded(bot.engine.snapshot(), bot.symbol, bot.tf, bot.openTradeDbId),
    exec: {
      executionMode: exec.executionMode,
      sizingMode: exec.sizingMode,
      sizeFixed: exec.sizeFixed,
      sizePercent: exec.sizePercent,
      broker,
    },
    strategy: { ...getPineBotInfo(), selected: getPineBotInfo().active ? { id: getPineBotInfo().id, name: getPineBotInfo().name, kind: "pine" } : { id: null, name: "HALO 3EL v1.2", kind: "builtin" } },
    scanLock: getTradeLock(),
  };
}
