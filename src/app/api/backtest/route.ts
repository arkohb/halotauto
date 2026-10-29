// ════════════════════════════════════════════════════════════════════════
//  BACKTEST API · REAL MARKET DATA ONLY
//  Replays the exact live HALO 3EL engine (wick-line break → return entry)
//  over real OHLC history from the live feeds (Yahoo / Binance / Bybit /
//  OKX / Coinbase). Demo/simulator candles are REJECTED — the dashboard
//  only ever shows profitability measured on real market prices.
//  Costs: a spread (pips) can be charged per trade; same-bar SL+TP counts
//  as SL (conservative, matching the live engine).
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { HaloEngine } from "@/lib/halo/engine";
import { DEFAULT_CONFIG, HaloConfig } from "@/lib/halo/types";
import { getKlines, getSymbolMeta, SYMBOLS, TIMEFRAMES, tfSec } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  symbol?: string;
  tf?: string;
  bars?: number;
  spreadPips?: number;
  cfg?: Partial<HaloConfig>;
}

export interface BtTradeRow {
  dir: -1 | 1;
  entry: number;
  exit: number | null;
  sl: number;
  tp: number;
  result: "WIN" | "LOSS" | "OPEN";
  exitReason: "TP" | "SL" | null;
  pipsRaw: number; // engine pips (positive magnitude on win)
  pips: number; // signed, net of spread
  riskPips: number;
  r: number | null; // realized R multiple (net)
  openTime: number;
  closeTime: number | null;
  holdMin: number | null;
}

export interface BtSummary {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPips: number;
  grossWinPips: number;
  grossLossPips: number;
  profitFactor: number | null;
  expectancyPips: number | null;
  avgWinPips: number | null;
  avgLossPips: number | null;
  bestPips: number | null;
  worstPips: number | null;
  maxDrawdownPips: number;
  maxConsecLosses: number;
  maxConsecWins: number;
  avgHoldMin: number | null;
  burned: number;
  skipped: number;
  tooClose: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const symbol = SYMBOLS.some((s) => s.id === body.symbol) ? (body.symbol as string) : "PAXGUSDT";
    const tf = (TIMEFRAMES as readonly string[]).includes(body.tf ?? "") ? (body.tf as string) : "5m";
    const bars = Math.min(2000, Math.max(100, Math.round(Number(body.bars) || 1000)));
    const spreadPips = Math.min(100, Math.max(0, Number(body.spreadPips) || 0));
    const cfg: HaloConfig = { ...DEFAULT_CONFIG, ...(body.cfg ?? {}) };
    const meta = getSymbolMeta(symbol);

    const { candles, source } = await getKlines(symbol, tf, bars, { deep: true });

    // ── REAL DATA ONLY — the dashboard never shows demo/simulator equity ──
    if (source === "simulator" || candles.length < 50) {
      return NextResponse.json({
        ok: false,
        code: "NO_LIVE_DATA",
        error:
          "Live market data is unreachable right now — the backtest dashboard runs on REAL prices only (no simulator/demo results). Check the connection and try again.",
        symbol,
        tf,
        source,
      });
    }

    const engine = new HaloEngine(cfg, meta.mintick);
    const now = Date.now();
    const secMs = tfSec(tf) * 1000;

    const pip = meta.mintick * cfg.pipMult;
    const trades: BtTradeRow[] = [];
    let pending: BtTradeRow | null = null;

    for (const c of candles) {
      if (c.time + secMs > now) continue; // skip the live (unconfirmed) bar
      const evs = engine.processBar(c, true);
      for (const e of evs) {
        if (e.type === "fire") {
          pending = {
            dir: e.dir,
            entry: e.entry,
            exit: null,
            sl: e.sl,
            tp: e.tp,
            result: "OPEN",
            exitReason: null,
            pipsRaw: 0,
            pips: 0,
            riskPips: e.riskPips,
            r: null,
            openTime: e.time,
            closeTime: null,
            holdMin: null,
          };
          trades.push(pending);
        } else if ((e.type === "win" || e.type === "loss") && pending) {
          const win = e.type === "win";
          const raw = win ? e.pips : -e.pips;
          const net = raw - spreadPips; // spread cost per round trip
          pending.result = win ? "WIN" : "LOSS";
          pending.exitReason = win ? "TP" : "SL";
          pending.exit = win ? e.tp : e.sl;
          pending.pipsRaw = raw;
          pending.pips = net;
          pending.r = pending.riskPips > 0 ? net / pending.riskPips : null;
          pending.closeTime = e.time;
          pending.holdMin = Math.max(0, (e.time - pending.openTime) / 60000);
          pending = null;
        }
      }
    }

    // ── analytics over CLOSED trades ──
    const closed = trades.filter((t) => t.result !== "OPEN");
    const wins = closed.filter((t) => t.pips > 0);
    const losses = closed.filter((t) => t.pips <= 0);
    const grossWin = wins.reduce((a, t) => a + t.pips, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pips, 0));
    const net = grossWin - grossLoss;

    // equity curve + max drawdown
    const curve: Array<{ t: number; pips: number }> = [];
    let acc = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of closed) {
      acc += t.pips;
      peak = Math.max(peak, acc);
      maxDd = Math.max(maxDd, peak - acc);
      curve.push({ t: t.closeTime ?? t.openTime, pips: acc });
    }

    // streaks
    let cL = 0;
    let cW = 0;
    let maxCL = 0;
    let maxCW = 0;
    for (const t of closed) {
      if (t.pips > 0) {
        cW += 1;
        cL = 0;
      } else {
        cL += 1;
        cW = 0;
      }
      maxCL = Math.max(maxCL, cL);
      maxCW = Math.max(maxCW, cW);
    }

    const holdVals = closed.map((t) => t.holdMin ?? 0).filter((v) => v > 0);
    const stats: BtSummary = {
      closed: closed.length,
      open: trades.length - closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? (wins.length * 100) / closed.length : null,
      netPips: net,
      grossWinPips: grossWin,
      grossLossPips: grossLoss,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
      expectancyPips: closed.length > 0 ? net / closed.length : null,
      avgWinPips: wins.length > 0 ? grossWin / wins.length : null,
      avgLossPips: losses.length > 0 ? grossLoss / losses.length : null,
      bestPips: closed.length > 0 ? Math.max(...closed.map((t) => t.pips)) : null,
      worstPips: closed.length > 0 ? Math.min(...closed.map((t) => t.pips)) : null,
      maxDrawdownPips: maxDd,
      maxConsecLosses: maxCL,
      maxConsecWins: maxCW,
      avgHoldMin: holdVals.length > 0 ? holdVals.reduce((a, v) => a + v, 0) / holdVals.length : null,
      burned: engine.snapshot().stats.burned,
      skipped: engine.snapshot().stats.skipped,
      tooClose: engine.snapshot().stats.tooClose,
    };

    const confirmed = candles.filter((c) => c.time + secMs <= now);

    return NextResponse.json({
      ok: true,
      symbol,
      tf,
      bars: confirmed.length,
      requestedBars: bars,
      source,
      mintick: meta.mintick,
      spreadPips,
      span: {
        from: confirmed.length > 0 ? confirmed[0].time : 0,
        to: confirmed.length > 0 ? confirmed[confirmed.length - 1].time + secMs : 0,
      },
      cfgEcho: {
        sigMode: cfg.sigMode,
        slMode: cfg.slMode,
        rrMult: cfg.rrMult,
        breakATR: cfg.breakATR,
        eqTolATR: cfg.eqTolATR,
      },
      stats,
      equity: { final: acc, maxDrawdown: maxDd },
      curve,
      trades: trades.slice(-120).reverse(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
