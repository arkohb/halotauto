import { NextResponse } from "next/server";
import { guardLicensed } from "@/lib/api-guard";
import { SYMBOLS, TIMEFRAMES, tfSec } from "@/lib/market";
import type { Candle } from "@/lib/halo/types";
import { fetchOandaCandles, oandaConfig, oandaInstrument, subscribeOandaTicks } from "@/lib/oanda-feed";

// Live OANDA practice ticks for the chart, as Server-Sent Events. Each event
// is the forming candle ({ time, open, high, low, close }) moved by the tick
// that just arrived — seeded from OANDA's own candles so open/high/low agree
// with the history. Market data only.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const tf = url.searchParams.get("tf") ?? "";
  if (!SYMBOLS.some((s) => s.id === symbol) || !(TIMEFRAMES as readonly string[]).includes(tf)) {
    return NextResponse.json({ error: "bad symbol or timeframe" }, { status: 400 });
  }
  const inst = oandaInstrument(symbol);
  if (!oandaConfig() || !inst) {
    return NextResponse.json({ error: "no OANDA stream for this symbol" }, { status: 404 });
  }
  const tfMs = tfSec(tf) * 1000;

  let seed: Candle | null = null;
  try {
    const bars = await fetchOandaCandles(symbol, tf, 2);
    seed = bars[bars.length - 1] ?? null;
  } catch {
    // no seed — the first tick opens the bar
  }

  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    unsub?.();
    unsub = null;
    if (beat) clearInterval(beat);
    beat = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctl) {
      let bar = seed ? { time: seed.time, open: seed.open, high: seed.high, low: seed.low, close: seed.close } : null;
      const send = (s: string) => {
        try {
          ctl.enqueue(enc.encode(s));
        } catch {
          stop();
        }
      };
      send("retry: 2000\n\n");
      if (bar) send(`data: ${JSON.stringify(bar)}\n\n`);
      unsub = subscribeOandaTicks(inst, (tick) => {
        const px = tick.bid; // TradingView's OANDA charts are BID
        const open = Math.floor(tick.time / tfMs) * tfMs;
        if (!bar || open > bar.time) bar = { time: open, open: px, high: px, low: px, close: px };
        else if (open < bar.time) return; // late tick from a closed bar
        else {
          bar.close = px;
          if (px > bar.high) bar.high = px;
          if (px < bar.low) bar.low = px;
        }
        send(`data: ${JSON.stringify(bar)}\n\n`);
      });
      beat = setInterval(() => send(": keep-alive\n\n"), 15_000);
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          ctl.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
