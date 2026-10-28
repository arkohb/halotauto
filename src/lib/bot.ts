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
import { getKlines, getSymbolMeta, tfSec } from "./market";
import { closeBrokerPosition, clampExec, executeFire, loadExecSettings, resolveBroker, saveExecSettings, type ActiveBroker, type ExecSettings } from "./execution";
import { sendAlert } from "./alerts";

export interface BotRuntime {
  cfg: HaloConfig;
  symbol: string;
  tf: string;
  engine: HaloEngine;
  enabled: boolean;
  /** AUTO-ATTACH: EA attaches itself to the chart & auto-starts on boot (no manual start) */
  autoAttach: boolean;
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
        symbol: bot.symbol,
        timeframe: bot.tf,
        configJson: JSON.stringify(bot.cfg),
        realizedPips: bot.realizedPips,
        lastFeedSource: bot.feedSource,
      },
      update: {
        enabled: bot.enabled,
        autoAttach: bot.autoAttach,
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
  bot.engine = new HaloEngine(bot.cfg, meta.mintick);
  bot.openTradeDbId = null;
  bot.lastConfirmedTime = 0;
  try {
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
  if (bot.cfg.sigMode !== "instant") return;
  const clone = bot.engine.clone();
  const events = clone.processBar(live, false);
  const commit = events.some((e) => e.type === "fire" || e.type === "win" || e.type === "loss");
  if (commit) {
    bot.engine = clone;
    void handleEvents(events, live);
  }
}

async function handleEvents(events: EngineEvent[], bar: Candle): Promise<void> {
  const bot = getBot();
  const meta = getSymbolMeta(bot.symbol);
  const symLabel = meta.label.split("·")[0].trim() || bot.symbol;
  for (const e of events) {
    if (e.type === "fire") {
      const exec = await loadExecSettings();
      const live = exec.executionMode === "live";
      const tradeId = await executeFire({
        source: "BOT",
        symbol: bot.symbol,
        tf: bot.tf,
        fire: e,
        levelTop: e.levelTop,
        levelBot: e.levelBot,
        slModeLabel: bot.cfg.slMode === "points" ? "Fixed points" : bot.cfg.slMode === "atr" ? "ATR" : "C3 wick + buffer",
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
    } else if (e.type === "win" || e.type === "loss") {
      const wasLive = bot.openTradeExec === "LIVE";
      if (wasLive && bot.liveBroker) {
        // broker-side SL/TP usually fired already; market-close as backstop
        const d = bot.openTradeDir;
        await closeBrokerPosition(bot.liveBroker, bot.symbol, d === 0 ? undefined : d).catch(() => {});
      }
      try {
        if (bot.openTradeDbId) {
          await db.trade.update({
            where: { id: bot.openTradeDbId },
            data: {
              status: e.type === "win" ? "WIN" : "LOSS",
              resultPips: e.pips,
              closedAt: new Date(e.time),
            },
          });
        }
        bot.realizedPips += e.type === "win" ? e.pips : -e.pips;
        await persistBot();
      } catch {
        // ignore
      }
      bot.openTradeDbId = null;
      bot.openTradeExec = "PAPER";
      bot.openTradeDir = 0;
      bot.liveBroker = null;
      void sendAlert({
        kind: e.type,
        title: `HALO 3EL ${e.type === "win" ? "TP HIT +" : "SL HIT −"}${e.pips.toFixed(1)} PIPS · ${symLabel}`,
        body: `${e.message}\nSymbol: ${bot.symbol} · TF ${bot.tf}\nRealized book: ${bot.realizedPips >= 0 ? "+" : "−"}${Math.abs(bot.realizedPips).toFixed(1)} pips`,
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
  try {
    const prevSource = bot.feedSource;
    const { candles, source, stale } = await getKlines(bot.symbol, bot.tf, 4, { fresh: true });
    bot.feedSource = source;
    bot.feedNote =
      source === "simulator"
        ? "Live feeds unreachable — running built-in market simulator"
        : stale
          ? "Feed slow — using cached candles"
          : "";
    // feed upgraded (simulator → real OHLC): re-anchor the engine onto the
    // real series so levels/pips track actual market prices
    if (prevSource === "simulator" && source !== "simulator" && !bot.engine.snapshot().trade) {
      await warmEngine();
      return;
    }
    const secMs = tfSec(bot.tf) * 1000;

    for (const c of candles) {
      if (c.time > bot.lastConfirmedTime && c.time + secMs <= now) {
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
  await persistBot();
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
    if (bot.engine.snapshot().trade) {
      throw new Error("Cannot switch symbol/timeframe while a trade is open.");
    }
    bot.symbol = nextSym;
    bot.tf = nextTf;
    await warmEngine();
  }
  bot.cfg = nextCfg;
  bot.engine.cfg = nextCfg;

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

export async function botState(): Promise<{
  enabled: boolean;
  autoAttach: boolean;
  symbol: string;
  tf: string;
  mintick: number;
  feed: { source: string; note: string; price: number; lastTickAt: number; realizedPips: number };
  config: HaloConfig;
  engine: ReturnType<HaloEngine["snapshot"]>;
  exec: ExecSummary;
}> {
  await ensureBoot();
  const bot = getBot();
  await tickBot().catch(() => {});
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
    engine: bot.engine.snapshot(),
    exec: {
      executionMode: exec.executionMode,
      sizingMode: exec.sizingMode,
      sizeFixed: exec.sizeFixed,
      sizePercent: exec.sizePercent,
      broker,
    },
  };
}
