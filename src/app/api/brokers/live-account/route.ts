import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdapter, isBrokerKind, parseCreds } from "@/lib/brokers";
import type { AccountInfo } from "@/lib/brokers/types";
import { mtCancelOrder, mtModifyPosition } from "@/lib/brokers/metaapi-core";
import { ensureBoot, getBot, closeOpenTrade } from "@/lib/bot";
import { amendRunningTrade, closeRunningTrade, forceCloseRunningTrades, getTradeLock, listRunningPositions } from "@/lib/trade-lock";
import { loadExecSettings } from "@/lib/execution";
import { getSymbolMeta } from "@/lib/market-symbols";
import { guardTrading } from "@/lib/api-guard";
import { getPaperAccount, paperVolumeOf, resetPaperAccount, syncPaperBookings, PAPER_STARTING_BALANCE, PIP_VALUE_PER_LOT } from "@/lib/paper-account";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  LIVE MT ACCOUNT FEED · powers the MT5 mobile-style panel on the dashboard
//  GET  → account details (balance/equity/margin/free margin/level/leverage)
//         + running trades with live P/L + recent closed history
//  POST → close one running position (live broker id or the paper EA trade)
//  Paper mode synthesizes the account from the EA engine + simulator balance.
// ════════════════════════════════════════════════════════════════════════

interface LivePos {
  id: string;
  symbol: string;
  side: -1 | 1;
  volume: number;
  entryPrice: number | null;
  currentPrice: number | null;
  sl: number | null;
  tp: number | null;
  pnl: number;
  swap: number;
  commission: number | null;
  openTime: number | null;
  comment: string | null;
  ea: boolean;
  paper: boolean;
  pips: number | null;
}

interface LiveAcct {
  login: string;
  broker: string;
  server: string;
  platform: string;
  currency: string;
  leverage: number | null;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
}

export interface LiveHistoryRow {
  id: string;
  symbol: string;
  direction: number;
  resultPips: number | null;
  execMode: string;
  mode: string;
  status: string;
  closedAt: string | null;
}

interface LiveOrder {
  id: string;
  symbol: string;
  type: string;
  side: -1 | 1;
  volume: number;
  entryPrice: number | null;
  currentPrice: number | null;
  sl: number | null;
  tp: number | null;
  placedAt: number | null;
  status: string;
  comment: string | null;
  ea: boolean;
  paper: boolean;
}

interface Payload {
  ok: boolean;
  live: boolean;
  degraded: string | null;
  kind: string;
  brokerLabel: string;
  account: LiveAcct | null;
  positions: LivePos[];
  orders: LiveOrder[];
  eaOpen: boolean;
  history: LiveHistoryRow[];
  updatedAt: number;
}

// the demo balance is persistent (lib/paper-account.ts): every closed PAPER
// trade books its realized P&L exactly once
const PAPER_BALANCE = PAPER_STARTING_BALANCE; // fallback only, when the DB is unreachable

// tiny server cache + in-flight dedupe (dashboard polls every ~2.5s)
let cache: { at: number; data: Payload } | null = null;
let inflight: Promise<Payload> | null = null;

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

function paperAccount(equity: number, margin: number, balance: number = PAPER_BALANCE): LiveAcct {
  return {
    login: "HALO-EA",
    broker: "HALO 3EL Simulator",
    server: "HALO-PAPER",
    platform: "MT5",
    currency: "USD",
    leverage: 500,
    balance,
    equity,
    margin,
    freeMargin: Math.max(0, equity - margin),
    marginLevel: margin > 0 ? Math.round((equity / margin) * 100) : 0,
  };
}

async function loadHistory(): Promise<LiveHistoryRow[]> {
  try {
    const rows = await db.trade.findMany({
      where: { status: { in: ["WIN", "LOSS"] } },
      orderBy: { closedAt: "desc" },
      take: 25,
    });
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      resultPips: r.resultPips,
      execMode: r.execMode,
      mode: r.mode,
      status: r.status,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    }));
  } catch {
    return [];
  }
}

async function buildPayload(): Promise<Payload> {
  await ensureBoot();
  const bot = getBot();
  const exec = await loadExecSettings();
  const snap = bot.engine.snapshot();
  // only a BOOKED trade is an open position — a signal the engine replayed
  // from history (traded === false, no trade row) is not money at risk
  const booked = snap.trade && snap.trade.traded !== false && bot.openTradeDbId ? snap.trade : null;
  const meta = getSymbolMeta(bot.symbol);

  const activeRow = await db.brokerAccount
    .findFirst({ where: { active: true } })
    .catch(() => null);
  const liveWanted =
    exec.executionMode === "live" &&
    Boolean(activeRow) &&
    isBrokerKind(String(activeRow?.kind ?? "")) &&
    activeRow?.kind !== "paper" &&
    activeRow?.status === "ok";

  const base: Payload = {
    ok: true,
    live: false,
    degraded: null,
    kind: liveWanted ? String(activeRow?.kind) : "paper",
    brokerLabel: liveWanted ? String(activeRow?.label) : "Paper EA",
    account: null,
    positions: [],
    orders: [],
    eaOpen: Boolean(booked) && bot.openTradeExec === "PAPER",
    history: [],
    updatedAt: Date.now(),
  };

  // ── LIVE broker account ────────────────────────────────────────────────
  if (liveWanted && activeRow) {
    const kind = activeRow.kind as "metaapi" | (string & {});
    const adapter = getAdapter(isBrokerKind(activeRow.kind) ? activeRow.kind : "paper");
    const creds = parseCreds(activeRow.credsJson);
    const acct = await withTimeout<AccountInfo>(
      adapter.getAccount(creds),
      9000,
      { ok: false, error: "broker timeout" }
    );

    if (!acct.ok) {
      // broker link down — fall back to the EA engine view, flag degraded
      base.degraded = (acct.error ?? "broker unreachable").slice(0, 200);
      const demo = await getPaperAccount();
      base.account = paperAccount(demo.balance, 0, demo.balance);
      base.eaOpen = Boolean(booked);
      base.history = await loadHistory();
      return base;
    }

    const raw = await withTimeout(adapter.getPositions(creds), 9000, []);
    const positions: LivePos[] = raw.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      volume: p.volume,
      entryPrice: p.entryPrice ?? null,
      currentPrice: p.currentPrice ?? null,
      sl: p.sl ?? null,
      tp: p.tp ?? null,
      pnl: p.unrealizedPnl ?? 0,
      swap: p.swap ?? 0,
      commission: p.commission ?? null,
      openTime: p.openTime ?? null,
      comment: p.comment ?? null,
      ea: Boolean(p.ea),
      paper: false,
      pips: null,
    }));

    // resting pending orders (adapters without order reads return [])
    const rawOrders =
      adapter.getOrders != null
        ? await withTimeout(adapter.getOrders(creds), 9000, [])
        : [];
    const orders: LiveOrder[] = rawOrders.map((o) => ({
      id: o.id,
      symbol: o.symbol,
      type: o.type,
      side: o.side,
      volume: o.volume,
      entryPrice: o.entryPrice ?? null,
      currentPrice: o.currentPrice ?? null,
      sl: o.sl ?? null,
      tp: o.tp ?? null,
      placedAt: o.placedAt ?? null,
      status: o.status ?? "PENDING",
      comment: o.comment ?? null,
      ea: Boolean(o.ea),
      paper: false,
    }));

    base.live = true;
    base.kind = String(kind);
    base.account = {
      login: (acct.login ?? String(creds.login ?? "")) || "—",
      broker: acct.brokerName ?? activeRow.label,
      server: acct.server ?? "—",
      platform: acct.platform ?? "MT5",
      currency: acct.currency ?? "USD",
      leverage: acct.leverage ?? null,
      balance: acct.balance ?? 0,
      equity: acct.equity ?? acct.balance ?? 0,
      margin: acct.margin ?? 0,
      freeMargin: acct.freeMargin ?? acct.equity ?? 0,
      marginLevel: acct.marginLevel ?? 0,
    };
    base.positions = positions;
    base.orders = orders;
    base.eaOpen = positions.some((p) => p.ea);
    base.history = await loadHistory();
    return base;
  }

  // ── PAPER account (engine-synthesized, mirrors the EA in real time) ────
  // EVERY running trade is listed — the chart bot's, the Scanner Bot's, the
  // Market Scanner's and the sweep's (each runtime reports through the
  // trade-lock registry) — plus a TradingView / Pine trade known only to
  // the global trade lock. Floating P&L uses the same volume formula the
  // close booking uses (paperVolumeOf × the trade's EDGE size multiplier).
  await syncPaperBookings(); // book any trade that closed since the last poll
  const demoBalance = (await getPaperAccount()).balance;
  const pipMult = (bot.cfg.pipMult ?? 10) || 10;
  const running = listRunningPositions().filter((r) => r.exec === "PAPER");
  const lock = getTradeLock();
  if (lock?.tradeDbId && !running.some((r) => r.dbId === lock.tradeDbId)) {
    running.push({
      dbId: lock.tradeDbId,
      source: lock.source,
      symbol: lock.symbol,
      tf: lock.tf,
      dir: lock.dir,
      entry: lock.entry,
      sl: lock.sl,
      tp: lock.tp,
      price: lock.symbol === bot.symbol ? bot.lastPrice || 0 : 0,
      riskPips: 0,
      rewardPips: 0,
      entryTime: lock.openedAt,
      slModeLabel: `${lock.source} trade`,
      exec: "PAPER",
    });
  }
  const rows = running.length
    ? await db.trade.findMany({ where: { id: { in: running.map((r) => r.dbId) } }, select: { id: true, sizeMult: true, riskPips: true, execMode: true, status: true } })
    : [];
  const rowOf = new Map(rows.map((r) => [r.id, r]));

  let floating = 0;
  let marginSum = 0;
  const positions: LivePos[] = [];
  for (const r of running) {
    const row = rowOf.get(r.dbId);
    if (!row || row.execMode !== "PAPER" || row.status !== "OPEN") continue;
    const m = getSymbolMeta(r.symbol);
    const pip = (m.mintick ?? 0.01) * pipMult;
    // the chart bot's price is tick-fresh when it watches the same symbol
    const price = r.symbol === bot.symbol && bot.lastPrice > 0 ? bot.lastPrice : r.price;
    const volume = Math.round(paperVolumeOf(exec, row.riskPips || r.riskPips || 50, demoBalance) * (row.sizeMult > 0 ? row.sizeMult : 1) * 100) / 100;
    const pips = price > 0 ? ((price - r.entry) * r.dir) / (pip || 1) : 0;
    const pnl = pips * PIP_VALUE_PER_LOT * volume;
    floating += pnl;
    if (price > 0) marginSum += (price * volume * 100_000) / 500;
    const who = r.source === "BOT" ? "EA bot" : r.source === "SCAN" ? "Scanner Bot" : r.source === "SWEEP" ? "Sweep" : "TradingView";
    positions.push({
      id: `ea-${r.dbId}`,
      symbol: m.label.split("·")[0].trim() || r.symbol,
      side: r.dir,
      volume,
      entryPrice: r.entry,
      currentPrice: price > 0 ? price : null,
      sl: r.sl,
      tp: r.tp,
      pnl: Math.round(pnl * 100) / 100,
      swap: 0,
      commission: 0,
      openTime: r.entryTime,
      comment: `HALO 3EL · ${who} · ${r.tf} · ${r.slModeLabel}`,
      ea: true,
      paper: true,
      pips: price > 0 ? Math.round(pips * 10) / 10 : null,
    });
  }

  const margin = Math.round(marginSum * 100) / 100;

  base.kind = "paper";
  base.brokerLabel = "Paper EA";
  base.account = paperAccount(Math.round((demoBalance + floating) * 100) / 100, margin, demoBalance);
  base.positions = positions;
  base.eaOpen = positions.length > 0;
  base.history = await loadHistory();
  return base;
}

export async function GET() {
  const deny = await guardTrading();
  if (deny) return deny;
  const now = Date.now();
  if (cache && now - cache.at < 2000) {
    return NextResponse.json({ ...cache.data, cached: true });
  }
  if (!inflight) {
    inflight = buildPayload()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .catch((e) => {
        const fallback: Payload = {
          ok: false,
          live: false,
          degraded: (e as Error).message.slice(0, 200),
          kind: "paper",
          brokerLabel: "Paper EA",
          account: paperAccount(PAPER_BALANCE, 0),
          positions: [],
          orders: [],
          eaOpen: false,
          history: [],
          updatedAt: Date.now(),
        };
        return fallback;
      })
      .finally(() => {
        inflight = null;
      });
  }
  const data = await inflight;
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const body = (await req.json()) as {
      action?: string;
      positionId?: string;
      orderId?: string;
      symbol?: string;
      side?: number;
      sl?: number | null;
      tp?: number | null;
    };
    if (!body.action || !["close", "close-all", "cancel-order", "modify", "reset-paper"].includes(body.action)) {
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
    cache = null; // force a fresh read after the mutation

    // ── demo reset: simulator balance back to its starting amount ──
    if (body.action === "reset-paper") {
      const acct = await resetPaperAccount();
      return NextResponse.json({ ok: true, paper: true, balance: acct.balance });
    }

    // paper EA trade → finalize through the runtime that holds it (chart
    // bot, Scanner Bot, Market Scanner or sweep)
    if (body.action === "close" && (!body.positionId || body.positionId.startsWith("ea-"))) {
      const dbId = body.positionId ? body.positionId.slice(3) : "";
      if (dbId && (await closeRunningTrade(dbId))) return NextResponse.json({ ok: true, paper: true });
      if (getBot().engine.snapshot().trade) {
        await closeOpenTrade();
        return NextResponse.json({ ok: true, paper: true });
      }
      return NextResponse.json({ ok: false, error: "That trade is no longer running." }, { status: 404 });
    }

    // paper EA trade SL/TP amendment → the holding runtime moves its stops
    // (engine + trade book + global lock; the chart boxes follow)
    if (body.action === "modify" && body.positionId?.startsWith("ea-")) {
      const sl = body.sl != null && isFinite(body.sl) && body.sl > 0 ? body.sl : null;
      const tp = body.tp != null && isFinite(body.tp) && body.tp > 0 ? body.tp : null;
      if (sl === null && tp === null) return NextResponse.json({ ok: false, error: "provide a valid SL and/or TP" }, { status: 400 });
      const r = await amendRunningTrade(body.positionId.slice(3), sl, tp);
      return NextResponse.json({ ok: r.ok, paper: true, error: r.error ?? null, broker: r.broker ?? null }, { status: r.ok ? 200 : 400 });
    }

    const activeRow = await db.brokerAccount.findFirst({ where: { active: true } });

    // ── paper-mode close-all: the only open position is the EA trade ──
    if (body.action === "close-all" && (!activeRow || !isBrokerKind(activeRow.kind) || activeRow.kind === "paper")) {
      // every runtime's running trade (bot, Scanner Bot, scanner, sweep)
      const n = await forceCloseRunningTrades();
      if (getBot().engine.snapshot().trade) await closeOpenTrade(); // an unbooked chart-bot trade
      return NextResponse.json({ ok: true, paper: true, closed: n });
    }

    if (!activeRow || !isBrokerKind(activeRow.kind) || activeRow.kind === "paper") {
      return NextResponse.json({ ok: false, error: "no live broker account" }, { status: 400 });
    }
    const creds = parseCreds(activeRow.credsJson);

    // ── MetaApi direct REST paths (same as the panel's close button) ──
    if (activeRow.kind === "metaapi") {
      if (body.action === "close-all") {
        const adapter = getAdapter("metaapi");
        const res = await withTimeout(adapter.closePosition(creds), 25000, { ok: false, error: "close-all timed out" });
        return NextResponse.json({ ok: res.ok, error: res.error ?? null }, { status: res.ok ? 200 : 502 });
      }
      if (body.action === "cancel-order") {
        if (!body.orderId) return NextResponse.json({ ok: false, error: "orderId missing" }, { status: 400 });
        const res = await withTimeout(
          mtCancelOrder(encodeURIComponent(String(creds.accountId ?? "")), String(creds.region ?? "new-york"), body.orderId),
          15000,
          { errorCode: "timeout", description: "cancel timed out" }
        );
        if (res.errorCode || res.description) {
          return NextResponse.json({ ok: false, error: `${res.errorCode ?? ""} ${res.description ?? ""}`.trim() }, { status: 502 });
        }
        return NextResponse.json({ ok: true });
      }
      if (body.action === "modify") {
        if (!body.positionId) return NextResponse.json({ ok: false, error: "positionId missing" }, { status: 400 });
        if ((body.sl == null || !isFinite(body.sl) || body.sl <= 0) && (body.tp == null || !isFinite(body.tp) || body.tp <= 0)) {
          return NextResponse.json({ ok: false, error: "provide a valid SL and/or TP" }, { status: 400 });
        }
        const res = await withTimeout(
          mtModifyPosition(
            encodeURIComponent(String(creds.accountId ?? "")),
            String(creds.region ?? "new-york"),
            body.positionId,
            { sl: body.sl ?? undefined, tp: body.tp ?? undefined }
          ),
          15000,
          { errorCode: "timeout", description: "modify timed out" }
        );
        if (res.errorCode || res.description) {
          return NextResponse.json({ ok: false, error: `${res.errorCode ?? ""} ${res.description ?? ""}`.trim() }, { status: 502 });
        }
        return NextResponse.json({ ok: true });
      }
    }

    // ── generic adapter paths (OANDA / IG / Binance / bridge …) ──
    const adapter = getAdapter(activeRow.kind);

    if (body.action === "close-all") {
      // close every open position (closePosition with no symbol closes ALL where supported)
      const res = await withTimeout(
        Promise.resolve(adapter.closePosition(creds)),
        30000,
        { ok: false, error: "close-all timed out" }
      );
      return NextResponse.json({ ok: res.ok, error: res.error ?? null }, { status: res.ok ? 200 : 502 });
    }

    if (body.action === "cancel-order") {
      if (!adapter.cancelOrder) return NextResponse.json({ ok: false, error: "this broker does not support order cancellation" }, { status: 501 });
      if (!body.orderId) return NextResponse.json({ ok: false, error: "orderId missing" }, { status: 400 });
      const res = await withTimeout(adapter.cancelOrder(creds, body.orderId), 15000, { ok: false, error: "cancel timed out" });
      return NextResponse.json({ ok: res.ok, error: res.error ?? null }, { status: res.ok ? 200 : 502 });
    }

    if (body.action === "modify") {
      if (!adapter.modifyPosition) return NextResponse.json({ ok: false, error: "this broker does not support SL/TP modification" }, { status: 501 });
      if (!body.positionId) return NextResponse.json({ ok: false, error: "positionId missing" }, { status: 400 });
      if ((body.sl == null || !isFinite(body.sl) || body.sl <= 0) && (body.tp == null || !isFinite(body.tp) || body.tp <= 0)) {
        return NextResponse.json({ ok: false, error: "provide a valid SL and/or TP" }, { status: 400 });
      }
      const res = await withTimeout(
        adapter.modifyPosition(creds, body.positionId, { sl: body.sl ?? undefined, tp: body.tp ?? undefined }),
        15000,
        { ok: false, error: "modify timed out" }
      );
      return NextResponse.json({ ok: res.ok, error: res.error ?? null }, { status: res.ok ? 200 : 502 });
    }

    // body.action === "close" for a live broker position
    const res = await withTimeout(
      adapter.closePosition(creds, body.symbol ?? "", body.side === -1 ? -1 : body.side === 1 ? 1 : undefined),
      15000,
      { ok: false, error: "close timed out" }
    );
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error ?? "close failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
