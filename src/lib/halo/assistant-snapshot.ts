// ════════════════════════════════════════════════════════════════════════
//  HALO VERIFIED SNAPSHOT · shared server-side system read-out
//
//  One honest read of the REAL runtime (engine, feed, broker, trade book,
//  audit-worthy counters). Imported by /api/halo/assistant (grounded Q&A)
//  and /api/halo/brain (operator actions) so both cores cite the same
//  verified facts. Never invents data — unavailable fields stay absent.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { botState } from "@/lib/bot";
import { statusOf } from "@/lib/halo/ui-helpers";
import { getAdapter, isBrokerKind, parseCreds } from "@/lib/brokers";
import { getSymbolMeta, SYMBOLS, TIMEFRAMES, decimalsOf } from "@/lib/market-symbols";

export interface Snapshot {
  now: string;
  mintick: number;
  engineStatus: string;
  eaEnabled: boolean;
  symbol: string;
  symbolLabel: string;
  tf: string;
  feed: { source: string; note: string; price: number; ageSeconds: number | null };
  realizedPips: number;
  atr: number | null;
  armedLevels: { side: string; ext: number; state: string }[];
  openTrade: {
    dir: string;
    entry: number;
    sl: number;
    tp: number;
    riskPips: number;
    rewardPips: number;
    openedAt: string;
  } | null;
  stats: { wins: number; losses: number; burned: number; skipped: number };
  strategy: { signalMode: string; slMode: string; rrMult: number; expiryBars: number; breakATR: number; eqTolATR: number };
  execution: {
    mode: string;
    broker: { label: string; kind: string; status: string } | null;
    sizing: string;
  };
  liveAccount: { connected: boolean; broker?: string; currency?: string; balance?: number; equity?: number; marginLevel?: number; error?: string } | null;
  recentTrades: {
    symbol: string;
    dir: string;
    status: string;
    resultPips: number | null;
    execMode: string;
    mode: string;
    openedAt: string;
    closedAt: string | null;
    note: string;
  }[];
  recentBrokerIssues: { kind: string; title: string; error: string; at: string }[];
  engineLog: { kind: string; dir: string; pips: number; entry: number; at: string }[];
  dailyStats: { trades: number; wins: number; losses: number; netPips: number; open: number };
  monthlyStats: { trades: number; wins: number; losses: number; netPips: number };
  scanner: { enabledSymbols: number };
  catalog: { symbols: string[]; timeframes: string[]; views: string[] };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

export async function buildSnapshot(): Promise<Snapshot> {
  const st = await botState(); // ensures boot + a feed tick (read-only)
  const meta = getSymbolMeta(st.symbol);
  const status = statusOf(st);

  const snap: Snapshot = {
    now: new Date().toISOString(),
    mintick: st.mintick,
    engineStatus: status.text,
    eaEnabled: st.enabled,
    symbol: st.symbol,
    symbolLabel: meta.label.split("·")[0].trim() || st.symbol,
    tf: st.tf,
    feed: {
      source: st.feed.source,
      note: st.feed.note,
      price: st.feed.price,
      ageSeconds: st.feed.lastTickAt ? Math.round((Date.now() - st.feed.lastTickAt) / 1000) : null,
    },
    realizedPips: st.feed.realizedPips,
    atr: st.engine.atr,
    armedLevels: st.engine.levels.map((l) => ({
      side: l.side === -1 ? "resistance (SELL side)" : "support (BUY side)",
      ext: l.ext,
      state: l.state,
    })),
    openTrade: st.engine.trade
      ? {
          dir: st.engine.trade.dir === -1 ? "SELL" : "BUY",
          entry: st.engine.trade.entry,
          sl: st.engine.trade.sl,
          tp: st.engine.trade.tp,
          riskPips: st.engine.trade.riskPips,
          rewardPips: st.engine.trade.rewardPips,
          openedAt: new Date(st.engine.trade.entryTime).toISOString(),
        }
      : null,
    stats: {
      wins: st.engine.stats.wins,
      losses: st.engine.stats.losses,
      burned: st.engine.stats.burned,
      skipped: st.engine.stats.skipped,
    },
    strategy: {
      signalMode: st.config.sigMode,
      slMode: st.config.slMode,
      rrMult: st.config.rrMult,
      expiryBars: st.config.expiryBars,
      breakATR: st.config.breakATR,
      eqTolATR: st.config.eqTolATR,
    },
    execution: {
      mode: st.exec.executionMode,
      broker: st.exec.broker ? { label: st.exec.broker.label, kind: st.exec.broker.kind, status: st.exec.broker.status } : null,
      sizing: st.exec.sizingMode === "fixed" ? `fixed ${st.exec.sizeFixed} lots` : `${st.exec.sizePercent}% risk-based`,
    },
    liveAccount: null,
    recentTrades: [],
    recentBrokerIssues: [],
    engineLog: st.engine.log.slice(-6).map((l) => ({
      kind: l.kind,
      dir: l.dir === -1 ? "SELL" : "BUY",
      pips: l.pips,
      entry: l.entry,
      at: new Date(l.time).toISOString(),
    })),
    dailyStats: { trades: 0, wins: 0, losses: 0, netPips: 0, open: 0 },
    monthlyStats: { trades: 0, wins: 0, losses: 0, netPips: 0 },
    scanner: { enabledSymbols: 0 },
    catalog: {
      symbols: SYMBOLS.map((s) => s.id),
      timeframes: [...TIMEFRAMES],
      views: ["terminal", "scanner", "activity", "risk", "backtest", "performance", "brokers", "alerts", "settings"],
    },
  };

  // trade book (last 10, all modes) — read-only
  try {
    const rows = await db.trade.findMany({ orderBy: { openedAt: "desc" }, take: 10 });
    snap.recentTrades = rows.map((r) => ({
      symbol: r.symbol,
      dir: r.direction === -1 ? "SELL" : "BUY",
      status: r.status,
      resultPips: r.resultPips,
      execMode: r.execMode,
      mode: r.mode,
      openedAt: r.openedAt.toISOString(),
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      note: r.note,
    }));
  } catch {
    // db unavailable — snapshot stays honest by omission
  }

  // daily / monthly performance from the real trade book (UTC day/month)
  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const recent = await db.trade.findMany({
      where: { openedAt: { gte: monthStart }, mode: { in: ["BOT", "TV", "SCAN", "MANUAL"] } },
      orderBy: { openedAt: "desc" },
      take: 500,
    });
    for (const r of recent) {
      const pips = r.resultPips ?? 0;
      if (r.openedAt >= monthStart) {
        snap.monthlyStats.trades += 1;
        if (r.status === "WIN") snap.monthlyStats.wins += 1;
        if (r.status === "LOSS") snap.monthlyStats.losses += 1;
        if (r.status !== "OPEN") snap.monthlyStats.netPips += r.resultPips ?? 0;
        else snap.monthlyStats.netPips += 0;
      }
      if (r.openedAt >= dayStart) {
        snap.dailyStats.trades += 1;
        if (r.status === "WIN") snap.dailyStats.wins += 1;
        if (r.status === "LOSS") snap.dailyStats.losses += 1;
        if (r.status === "OPEN") snap.dailyStats.open += 1;
        else snap.dailyStats.netPips += pips;
      }
    }
    snap.monthlyStats.netPips = Math.round(snap.monthlyStats.netPips * 10) / 10;
    snap.dailyStats.netPips = Math.round(snap.dailyStats.netPips * 10) / 10;
  } catch {
    // ignore — counters stay at zero only if the book is truly unreadable
  }

  // scanner watchlist size — read-only
  try {
    snap.scanner.enabledSymbols = await db.scannerSymbol.count({ where: { enabled: true } });
  } catch {
    // ignore
  }

  // recent broker/order issues — read-only
  try {
    const issues = await db.alertLog.findMany({
      where: { ok: false, kind: { in: ["broker", "fire"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    snap.recentBrokerIssues = issues.map((i) => ({
      kind: i.kind,
      title: i.title,
      error: i.error || i.body.slice(0, 160),
      at: i.createdAt.toISOString(),
    }));
  } catch {
    // ignore
  }

  // live MT account balance (read-only, only when LIVE mode + healthy broker)
  if (st.exec.executionMode === "live" && st.exec.broker) {
    try {
      const row = await db.brokerAccount.findFirst({ where: { active: true } });
      if (row && isBrokerKind(row.kind) && row.kind !== "paper" && row.status === "ok") {
        const adapter = getAdapter(row.kind);
        const creds = parseCreds(row.credsJson);
        const acct = await withTimeout(adapter.getAccount(creds), 6000, { ok: false, error: "broker timeout" });
        snap.liveAccount = acct.ok
          ? {
              connected: true,
              broker: acct.brokerName ?? row.label,
              currency: acct.currency ?? "USD",
              balance: acct.balance ?? 0,
              equity: acct.equity ?? acct.balance ?? 0,
              marginLevel: acct.marginLevel ?? 0,
            }
          : { connected: false, error: acct.error ?? "broker unreachable" };
      } else {
        snap.liveAccount = { connected: false, error: "no healthy live broker connected" };
      }
    } catch (e) {
      snap.liveAccount = { connected: false, error: (e as Error).message.slice(0, 160) };
    }
  }

  return snap;
}
