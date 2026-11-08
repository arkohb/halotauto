// ════════════════════════════════════════════════════════════════════════
//  BACKTEST API · REAL MARKET DATA ONLY · ∞ BARS · ANY PAIR · ANY BAR SIZE
//  Replays a strategy over real OHLC history walked page-by-page from the
//  live feeds (Binance / Bybit / OKX / Yahoo). There is NO bar cap: request
//  any number of bars, any timeframe M1→W1, any symbol — or "all" to walk
//  back to the feed's very first bar. Demo/simulator candles are REJECTED —
//  the dashboard only ever shows profitability measured on real market
//  prices. Costs: a spread (pips) is charged per trade.
//
//  TWO replay engines, identical analytics:
//    • default            — the exact live HALO 3EL wick-line engine
//                           (wick-line break → return entry)
//    • cfg.strategyId     — ANY saved Pine indicator/strategy (the full
//                           library + the trader's own) replayed through the
//                           PineRuntime simulator: Pine fill model
//                           (next-bar-open entries, intrabar SL/TP checks,
//                           conservative same-bar SL-before-TP).
//  ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { guardLicensed } from "@/lib/api-guard";
import { HaloEngine } from "@/lib/halo/engine";
import { DEFAULT_CONFIG, HaloConfig } from "@/lib/halo/types";
import { getDeepHistory } from "@/lib/market-history";
import { tfSec } from "@/lib/market-symbols";
import { db } from "@/lib/db";
import { PineRuntime } from "@/lib/pine";
import { LIBRARY } from "@/lib/pine/library-sources";
import type { Candle } from "@/lib/halo/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  symbol?: string;
  tf?: string;
  /** number of bars (no cap) — or "all" / "∞" / -1 / 0 for the entire feed history */
  bars?: number | string;
  /** optional backtest window start, "YYYY-MM-DD" */
  from?: string;
  spreadPips?: number;
  cfg?: Partial<HaloConfig>;
  /** optional Pine strategy id — backtest THAT indicator instead of the wick-line engine */
  strategyId?: string;
  /** optional index into the built-in ★ best-indicators library — runs with NO DB dependency */
  builtin?: number;
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
  rangeSkipped: number;
  noReturnRemoved: number;
}

function parseBars(raw: number | string | undefined): number | null {
  if (raw === undefined || raw === null) return 1000;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "all" || s === "∞" || s === "inf" || s === "max" || s === "-1" || s === "0") return null;
    const n = Math.round(Number(s));
    return isFinite(n) && n > 0 ? n : 1000;
  }
  if (raw <= 0) return null;
  return Math.round(raw);
}

export async function POST(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const body = (await req.json()) as Body;
    const symbol = (body.symbol ?? "").toUpperCase().trim() || "PAXGUSDT";
    const tf = body.tf ?? "5m";
    const bars = parseBars(body.bars);
    const spreadPips = Math.min(100, Math.max(0, Number(body.spreadPips) || 0));
    const cfg: HaloConfig = { ...DEFAULT_CONFIG, ...(body.cfg ?? {}) };

    // ── optional Pine strategy: backtest ANY indicator ──
    //    • strategyId — a saved Pine strategy/indicator from the trader's DB
    //    • builtin    — an index into the shipped ★ best-indicators library
    //                   (compiled on the fly, zero DB dependency — the lab
    //                   selector always offers these, even offline)
    const stratId = typeof body.strategyId === "string" ? body.strategyId.trim() : "";
    const stratRow = stratId ? await db.pineStrategy.findUnique({ where: { id: stratId } }) : null;
    if (stratId && !stratRow) {
      return NextResponse.json({ ok: false, error: "Strategy not found — it may have been deleted. Pick another indicator." }, { status: 404 });
    }
    const bi = Number.isInteger(body.builtin) ? (body.builtin as number) : -1;
    const libEntry = !stratRow && bi >= 0 && bi < LIBRARY.length ? LIBRARY[bi] : null;
    const pineSource = stratRow?.pineSource ?? libEntry?.source ?? null;
    const pineName = stratRow?.name ?? libEntry?.name ?? null;
    const pineDesc = stratRow?.description ?? libEntry?.description ?? null;
    const pineKey = stratRow ? stratRow.id : libEntry ? `builtin:${bi}` : null;

    // optional FROM date ("YYYY-MM-DD" → UTC midnight epoch-ms floor)
    let fromMs: number | null = null;
    if (body.from && /^\d{4}-\d{2}-\d{2}$/.test(body.from)) {
      const t = Date.parse(`${body.from}T00:00:00Z`);
      if (isFinite(t)) fromMs = t;
    }

    // ── deep history walk: paginated, uncapped, REAL feeds only ──
    const deep = await getDeepHistory({ symbol, tf, bars, fromMs });

    if (deep.candles.length < 50) {
      return NextResponse.json({
        ok: false,
        code: "NO_LIVE_DATA",
        error:
          "Live market data is unreachable right now — the backtest dashboard runs on REAL prices only (no simulator/demo results). Check the connection and try again.",
        symbol,
        tf,
        source: "unreachable",
      });
    }

    const meta = deep.meta;
    const secMs = tfSec(tf) * 1000;
    const now = Date.now();
    const confirmed: Candle[] = deep.candles.filter((c) => c.time + secMs <= now); // skip the live (unconfirmed) bar

    const pip = meta.mintick * cfg.pipMult;
    const trades: BtTradeRow[] = [];

    // ── engine-filter counters (wick-line only; zeroed for Pine runs) ──
    let eBurned = 0, eSkipped = 0, eTooClose = 0, eRangeSkipped = 0, eNoReturn = 0;

    if (pineSource) {
      // ════════════════════════════════════════════════════════════════
      //  PINE REPLAY — the chosen indicator over the SAME real history.
      //  Identical fill model to live pine trading: entries fill on the
      //  NEXT bar's open (Pine next-bar-open), stop/limit checked
      //  intrabar with conservative SL-before-TP on ambiguous bars.
      // ════════════════════════════════════════════════════════════════
      let rt: PineRuntime;
      try {
        rt = new PineRuntime(pineSource, {
          mintick: meta.mintick,
          ticker: symbol,
          tf,
          pipMult: cfg.pipMult,
        });
      } catch (e) {
        return NextResponse.json(
          { ok: false, error: `This indicator could not be compiled for backtesting: ${(e as Error).message}` },
          { status: 400 }
        );
      }
      try {
        for (const c of confirmed) {
          // mirror the simulated position so position_size reads truth
          rt.externalPos = rt.simPos ? { dir: rt.simPos.dir, entry: rt.simPos.entry } : { dir: 0, entry: 0 };
          rt.processBar(c);
        }
      } catch (e) {
        const line = (e as { line?: number }).line;
        return NextResponse.json(
          {
            ok: false,
            error: `The indicator hit a runtime error on this market data${line ? ` (line ${line})` : ""}: ${(e as Error).message}`,
          },
          { status: 400 }
        );
      }

      for (const t of rt.simTrades) {
        const rawPips = t.exit !== null ? ((t.exit - t.entry) * t.dir) / pip : 0;
        const net = t.exit !== null ? rawPips - spreadPips : 0; // spread cost per round trip
        const riskPips = t.sl !== null ? Math.abs(t.entry - t.sl) / pip : 0;
        trades.push({
          dir: t.dir === 1 ? 1 : -1,
          entry: t.entry,
          exit: t.exit,
          // close/reverse exits carry no SL/TP — entry sentinel keeps the
          // row shape while riskPips 0 honestly yields R "—"
          sl: t.sl ?? t.entry,
          tp: t.tp ?? t.exit ?? t.entry,
          result: t.exit === null ? "OPEN" : net > 0 ? "WIN" : "LOSS",
          exitReason: t.reason === "sl" ? "SL" : t.reason === "tp" ? "TP" : null,
          pipsRaw: rawPips,
          pips: net,
          riskPips,
          r: riskPips > 0 && t.exit !== null ? net / riskPips : null,
          openTime: t.entryTime,
          closeTime: t.exitTime,
          holdMin: t.exitTime !== null ? Math.max(0, (t.exitTime - t.entryTime) / 60000) : null,
        });
      }
    } else {
      // ════════════════════════════════════════════════════════════════
      //  WICK-LINE ENGINE — the exact live HALO 3EL strategy
      // ════════════════════════════════════════════════════════════════
      const engine = new HaloEngine(cfg, meta.mintick);
      let pending: BtTradeRow | null = null;

      for (const c of confirmed) {
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
      const snap = engine.snapshot().stats;
      eBurned = snap.burned;
      eSkipped = snap.skipped;
      eTooClose = snap.tooClose;
      eRangeSkipped = snap.rangeSkipped;
      eNoReturn = snap.noReturnRemoved;
    }

    // ── analytics over CLOSED trades (shared by both engines) ──
    const closed = trades.filter((t) => t.result !== "OPEN");
    const wins = closed.filter((t) => t.pips > 0);
    const losses = closed.filter((t) => t.pips <= 0);
    const grossWin = wins.reduce((a, t) => a + t.pips, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pips, 0));
    const net = grossWin - grossLoss;

    // equity curve + max drawdown
    const fullCurve: Array<{ t: number; pips: number }> = [];
    let acc = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of closed) {
      acc += t.pips;
      peak = Math.max(peak, acc);
      maxDd = Math.max(maxDd, peak - acc);
      fullCurve.push({ t: t.closeTime ?? t.openTime, pips: acc });
    }
    // downsample the plotted curve (stats stay exact) so multi-100k runs stay light
    const MAX_PTS = 1500;
    let curve = fullCurve;
    if (fullCurve.length > MAX_PTS) {
      const step = Math.ceil(fullCurve.length / MAX_PTS);
      curve = fullCurve.filter((_, i) => i % step === 0);
      if (curve[curve.length - 1] !== fullCurve[fullCurve.length - 1]) {
        curve.push(fullCurve[fullCurve.length - 1]);
      }
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
      burned: eBurned,
      skipped: eSkipped,
      tooClose: eTooClose,
      rangeSkipped: eRangeSkipped,
      noReturnRemoved: eNoReturn,
    };

    return NextResponse.json({
      ok: true,
      engine: pineSource ? "pine" : "wickline",
      strategy: pineSource
        ? {
            id: pineKey,
            name: pineName,
            description: pineDesc,
          }
        : null,
      symbol,
      symbolLabel: meta.label,
      group: meta.group,
      tf,
      bars: confirmed.length,
      requestedBars: bars === null ? "all" : bars,
      from: fromMs ? new Date(fromMs).toISOString().slice(0, 10) : null,
      source: deep.source,
      complete: deep.complete, // true = walk reached the feed's earliest bar
      mintick: meta.mintick,
      pip: pip,
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
        rangeFilter: cfg.rangeFilter,
        rangeSepATR: cfg.rangeSepATR,
      },
      stats,
      equity: { final: acc, maxDrawdown: maxDd },
      curve,
      tradesTotal: trades.length,
      trades: trades.slice(-300).reverse(),
    });
  } catch (e) {
    const msg = (e as Error).message ?? "backtest failed";
    if (msg.startsWith("NO_LIVE_DATA") || msg.startsWith("Invalid symbol")) {
      return NextResponse.json({ ok: false, code: "NO_LIVE_DATA", error: msg }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
