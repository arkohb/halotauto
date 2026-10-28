// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL EA BOT · server-side singleton runtime
//  • Warms the strategy engine over history on boot
//  • Polls the feed every ~2s, processes newly confirmed bars
//  • Instant mode: executes intrabar fires (trial run on engine clone,
//    committed only when a fire/exit actually happens — Pine rollback semantics)
//  • Persists every paper trade to SQLite via Prisma
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { HaloEngine } from "./halo/engine";
import { Candle, DEFAULT_CONFIG, EngineEvent, HaloConfig } from "./halo/types";
import { getKlines, getSymbolMeta, tfSec } from "./market";

export interface BotRuntime {
  cfg: HaloConfig;
  symbol: string;
  tf: string;
  engine: HaloEngine;
  enabled: boolean;
  bootstrapped: boolean;
  lastConfirmedTime: number;
  lastTickAt: number;
  feedSource: string;
  feedNote: string;
  lastPrice: number;
  openTradeDbId: string | null;
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
      bootstrapped: false,
      lastConfirmedTime: 0,
      lastTickAt: 0,
      feedSource: "—",
      feedNote: "",
      lastPrice: 0,
      openTradeDbId: null,
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
        symbol: bot.symbol,
        timeframe: bot.tf,
        configJson: JSON.stringify(bot.cfg),
        realizedPips: bot.realizedPips,
        lastFeedSource: bot.feedSource,
      },
      update: {
        enabled: bot.enabled,
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
    if (bot.enabled) startTimer();
  })().finally(() => {
    bot.booting = null;
  });
  return bot.booting;
}

function startTimer(): void {
  const bot = getBot();
  if (bot.timer) clearInterval(bot.timer);
  bot.timer = setInterval(() => {
    tickBot().catch(() => {});
  }, 2000);
  (bot.timer as unknown as { unref?: () => void }).unref?.();
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
  for (const e of events) {
    if (e.type === "fire") {
      try {
        const tr = await db.trade.create({
          data: {
            mode: "BOT",
            symbol: bot.symbol,
            timeframe: bot.tf,
            direction: e.dir,
            entry: e.entry,
            sl: e.sl,
            tp: e.tp,
            riskPips: e.riskPips,
            rewardPips: e.rewardPips,
            status: "OPEN",
            levelTop: e.levelTop,
            levelBot: e.levelBot,
            slMode: bot.cfg.slMode,
            openedAt: new Date(e.time),
          },
        });
        bot.openTradeDbId = tr.id;
      } catch {
        // persistence failure shouldn't kill the bot
      }
    } else if (e.type === "win" || e.type === "loss") {
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
    const { candles, source, stale } = await getKlines(bot.symbol, bot.tf, 4, { fresh: true });
    bot.feedSource = source;
    bot.feedNote =
      source === "simulator"
        ? "Live feeds unreachable — running built-in market simulator"
        : stale
          ? "Feed slow — using cached candles"
          : "";
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

export async function startBot(): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  // if the bot was idle for a long stretch, re-warm so state stays coherent
  const secMs = tfSec(bot.tf) * 1000;
  if (bot.lastConfirmedTime && Date.now() - bot.lastConfirmedTime > secMs * 10) {
    await warmEngine();
  }
  bot.enabled = true;
  startTimer();
  await persistBot();
  tickBot(true).catch(() => {});
}

export async function stopBot(): Promise<void> {
  const bot = getBot();
  await ensureBoot();
  bot.enabled = false;
  if (bot.timer) {
    clearInterval(bot.timer);
    bot.timer = null;
  }
  await persistBot();
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

export interface ConfigPatch {
  cfg?: Partial<HaloConfig>;
  symbol?: string;
  tf?: string;
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
  await persistBot();
}

export async function botState(): Promise<{
  enabled: boolean;
  symbol: string;
  tf: string;
  mintick: number;
  feed: { source: string; note: string; price: number; lastTickAt: number; realizedPips: number };
  config: HaloConfig;
  engine: ReturnType<HaloEngine["snapshot"]>;
}> {
  await ensureBoot();
  const bot = getBot();
  await tickBot().catch(() => {});
  const meta = getSymbolMeta(bot.symbol);
  return {
    enabled: bot.enabled,
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
  };
}
