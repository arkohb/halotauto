import { NextResponse } from "next/server";
import { HaloEngine } from "@/lib/halo/engine";
import { DEFAULT_CONFIG, HaloConfig } from "@/lib/halo/types";
import { getKlines, getSymbolMeta, SYMBOLS, TIMEFRAMES, tfSec } from "@/lib/market";

export const dynamic = "force-dynamic";

interface Body {
  symbol?: string;
  tf?: string;
  bars?: number;
  cfg?: Partial<HaloConfig>;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const symbol = SYMBOLS.some((s) => s.id === body.symbol) ? (body.symbol as string) : "PAXGUSDT";
    const tf = (TIMEFRAMES as readonly string[]).includes(body.tf ?? "")
      ? (body.tf as string)
      : "5m";
    const bars = Math.min(1000, Math.max(100, Math.round(Number(body.bars) || 500)));
    const cfg: HaloConfig = { ...DEFAULT_CONFIG, ...(body.cfg ?? {}) };
    const meta = getSymbolMeta(symbol);

    const { candles, source } = await getKlines(symbol, tf, bars, { deep: true });
    const engine = new HaloEngine(cfg, meta.mintick);
    const now = Date.now();
    const secMs = tfSec(tf) * 1000;

    interface BtTrade {
      dir: number;
      entry: number;
      sl: number;
      tp: number;
      result: "WIN" | "LOSS" | "OPEN";
      pips: number;
      openTime: number;
      closeTime: number | null;
    }
    const trades: BtTrade[] = [];
    let pending: BtTrade | null = null;

    for (const c of candles) {
      if (c.time + secMs > now) continue;
      const evs = engine.processBar(c, true);
      for (const e of evs) {
        if (e.type === "fire") {
          pending = {
            dir: e.dir,
            entry: e.entry,
            sl: e.sl,
            tp: e.tp,
            result: "OPEN",
            pips: 0,
            openTime: e.time,
            closeTime: null,
          };
          trades.push(pending);
        } else if ((e.type === "win" || e.type === "loss") && pending) {
          pending.result = e.type === "win" ? "WIN" : "LOSS";
          pending.pips = e.type === "win" ? e.pips : -e.pips;
          pending.closeTime = e.time;
          pending = null;
        }
      }
    }

    const snap = engine.snapshot();
    const curve: Array<{ t: number; pips: number }> = [];
    let acc = 0;
    for (const t of trades) {
      if (t.result !== "OPEN") {
        acc += t.pips;
        curve.push({ t: t.closeTime ?? t.openTime, pips: acc });
      }
    }

    return NextResponse.json({
      ok: true,
      symbol,
      tf,
      bars: candles.length,
      source,
      mintick: meta.mintick,
      stats: snap.stats,
      openTrade: snap.trade,
      trades: trades.slice(-60).reverse(),
      curve,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
