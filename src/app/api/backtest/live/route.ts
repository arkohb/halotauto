// ════════════════════════════════════════════════════════════════════════
//  BACKTEST LIVE-REPLAY API · REAL MARKET DATA ONLY · ∞ BARS · ANY PAIR
//  Feeds the LIVE REPLAY deck: walks REAL OHLC history page-by-page from
//  the live feeds (Binance / Bybit / OKX / Yahoo) — the same uncapped walk
//  as the stats backtest — and ships the confirmed candles to the browser.
//  The browser then re-runs the EXACT live HaloEngine bar-by-bar at
//  user-controlled speed, drawing the indicator as it forms and firing
//  trades exactly like the EA does. Demo/simulator candles are REJECTED.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { getDeepHistory } from "@/lib/market-history";
import { tfSec } from "@/lib/market-symbols";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  symbol?: string;
  tf?: string;
  /** number of bars (no cap) — or "all" / "∞" / -1 / 0 for the entire feed history */
  bars?: number | string;
  /** optional replay window start, "YYYY-MM-DD" */
  from?: string;
}

function parseBars(raw: number | string | undefined): number | null {
  if (raw === undefined || raw === null) return 5000;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "all" || s === "∞" || s === "inf" || s === "max" || s === "-1" || s === "0") return null;
    const n = Math.round(Number(s));
    return isFinite(n) && n > 0 ? n : 5000;
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
          "Live market data is unreachable right now — the replay runs on REAL prices only (no simulator/demo candles). Check the ticker spelling or the connection and try again.",
        symbol,
        tf,
        source: "unreachable",
      });
    }

    const secMs = tfSec(tf) * 1000;
    const now = Date.now();
    // confirmed bars only — the replay must never trade on an unconfirmed bar
    const candles = deep.candles
      .filter((c) => c.time + secMs <= now)
      .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));

    if (candles.length < 50) {
      return NextResponse.json({
        ok: false,
        code: "NO_LIVE_DATA",
        error: `Only ${candles.length} confirmed bars available for ${symbol} ${tf} — load more history or pick a smaller bar size.`,
        symbol,
        tf,
        source: deep.source,
      });
    }

    return NextResponse.json({
      ok: true,
      symbol,
      symbolLabel: deep.meta.label,
      group: deep.meta.group,
      tf,
      source: deep.source,
      complete: deep.complete, // true = walk reached the feed's earliest bar
      mintick: deep.meta.mintick,
      bars: candles.length,
      requestedBars: bars === null ? "all" : bars,
      from: fromMs ? new Date(fromMs).toISOString().slice(0, 10) : null,
      span: {
        from: candles[0].time,
        to: candles[candles.length - 1].time + secMs,
      },
      candles,
    });
  } catch (e) {
    const msg = (e as Error).message ?? "live replay load failed";
    if (msg.startsWith("NO_LIVE_DATA") || msg.startsWith("Invalid symbol")) {
      return NextResponse.json({ ok: false, code: "NO_LIVE_DATA", error: msg }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
