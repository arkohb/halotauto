import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdapter, isBrokerKind, parseCreds } from "@/lib/brokers";
import type { AccountInfo } from "@/lib/brokers/types";
import { mtClosePosition } from "@/lib/brokers/metaapi-core";
import { ensureBoot, getBot, closeOpenTrade } from "@/lib/bot";
import { loadExecSettings } from "@/lib/execution";
import { getSymbolMeta } from "@/lib/market-symbols";

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

interface Payload {
  ok: boolean;
  live: boolean;
  degraded: string | null;
  kind: string;
  brokerLabel: string;
  account: LiveAcct | null;
  positions: LivePos[];
  eaOpen: boolean;
  history: LiveHistoryRow[];
  updatedAt: number;
}

const PAPER_BALANCE = 100_000;
const PIP_VALUE_PER_LOT = 10; // display convention for the simulator account

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

function paperAccount(equity: number, margin: number): LiveAcct {
  return {
    login: "HALO-EA",
    broker: "HALO 3EL Simulator",
    server: "HALO-PAPER",
    platform: "MT5",
    currency: "USD",
    leverage: 500,
    balance: PAPER_BALANCE,
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
    eaOpen: Boolean(snap.trade) && bot.openTradeExec === "PAPER",
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
      base.account = paperAccount(PAPER_BALANCE, 0);
      base.eaOpen = Boolean(snap.trade);
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
    base.eaOpen = positions.some((p) => p.ea);
    base.history = await loadHistory();
    return base;
  }

  // ── PAPER account (engine-synthesized, mirrors the EA in real time) ────
  const price = bot.lastPrice || 0;
  const t = snap.trade;
  const pip = (meta.mintick ?? 0.01) * ((bot.cfg.pipMult ?? 10) || 10);

  const volume =
    exec.sizingMode === "fixed"
      ? Math.max(0.01, Math.round(exec.sizeFixed * 100) / 100)
      : Math.max(
          0.01,
          Math.round(
            ((PAPER_BALANCE * exec.sizePercent) / 100 /
              Math.max(1, (t ? t.riskPips : 50) * PIP_VALUE_PER_LOT)) *
              100
          ) / 100
        );

  let floating = 0;
  const positions: LivePos[] = [];
  if (t && bot.openTradeExec === "PAPER" && price > 0) {
    const pips = ((price - t.entry) * t.dir) / (pip || 1);
    floating = pips * PIP_VALUE_PER_LOT * volume;
    positions.push({
      id: `ea-${bot.openTradeDbId ?? "paper"}`,
      symbol: meta.label.split("·")[0].trim() || bot.symbol,
      side: t.dir,
      volume,
      entryPrice: t.entry,
      currentPrice: price,
      sl: t.sl,
      tp: t.tp,
      pnl: Math.round(floating * 100) / 100,
      swap: 0,
      commission: 0,
      openTime: t.entryTime,
      comment: `HALO 3EL · C3 fire · ${t.slModeLabel}`,
      ea: true,
      paper: true,
      pips: Math.round(pips * 10) / 10,
    });
  }

  const margin =
    positions.length > 0 && price > 0
      ? Math.round(((price * volume * 100_000) / 500) * 100) / 100
      : 0;

  base.kind = "paper";
  base.brokerLabel = "Paper EA";
  base.account = paperAccount(Math.round((PAPER_BALANCE + floating) * 100) / 100, margin);
  base.positions = positions;
  base.eaOpen = positions.length > 0;
  base.history = await loadHistory();
  return base;
}

export async function GET(req: Request) {
  const now = Date.now();
  const demo = new URL(req.url).searchParams.get("demo") === "1"; // TEMP probe
  if (cache && now - cache.at < 2000 && !demo) {
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
  // TEMP probe: preview the panel with a synthetic running trade
  if (demo) {
    const demoPos: LivePos = {
      id: "ea-demo-probe",
      symbol: "XAUUSD",
      side: -1,
      volume: 0.05,
      entryPrice: 4061.2,
      currentPrice: 4048.1,
      sl: 4073.8,
      tp: 4022.9,
      pnl: 64.55,
      swap: -0.42,
      commission: -0.25,
      openTime: Date.now() - 5 * 3600_000,
      comment: "HALO 3EL · C3 fire · C3 wick + buffer",
      ea: true,
      paper: true,
      pips: 129.1,
    };
    return NextResponse.json({
      ...data,
      positions: [demoPos],
      eaOpen: true,
      account: data.account ? { ...data.account, equity: data.account.equity + demoPos.pnl, margin: 404.81, freeMargin: data.account.equity - 404.81, marginLevel: 1240 } : data.account,
    });
  }
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string;
      positionId?: string;
      symbol?: string;
      side?: number;
    };
    if (body.action !== "close") {
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
    cache = null; // force a fresh read after the mutation

    // paper EA trade → finalize through the engine
    if (!body.positionId || body.positionId.startsWith("ea-")) {
      await closeOpenTrade();
      return NextResponse.json({ ok: true, paper: true });
    }

    // live broker position
    const activeRow = await db.brokerAccount.findFirst({ where: { active: true } });
    if (!activeRow || !isBrokerKind(activeRow.kind) || activeRow.kind === "paper") {
      return NextResponse.json({ ok: false, error: "no live broker account" }, { status: 400 });
    }
    const creds = parseCreds(activeRow.credsJson);

    if (activeRow.kind === "metaapi") {
      const res = await withTimeout(
        mtClosePosition(
          encodeURIComponent(String(creds.accountId ?? "")),
          String(creds.region ?? "new-york"),
          body.positionId
        ),
        15000,
        { errorCode: "timeout", description: "close timed out" }
      );
      if (res.errorCode || res.description) {
        return NextResponse.json(
          { ok: false, error: `${res.errorCode ?? ""} ${res.description ?? ""}`.trim() },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    // other adapters close by symbol+side
    const adapter = getAdapter(activeRow.kind);
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
