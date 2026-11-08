import { NextResponse } from "next/server";
import { guardLicensed } from "@/lib/api-guard";
import { SYMBOLS, TIMEFRAMES, tfSec } from "@/lib/market";
import type { Candle } from "@/lib/halo/types";
import { fetchOandaCandles, oandaConfig, oandaInstrument, subscribeOandaTicks } from "@/lib/oanda-feed";
import { brokerCandles, brokerFeedSource, subscribeBrokerQuotes } from "@/lib/exness-feed";

// Live ticks for the chart, as Server-Sent Events — from your broker's MT5
// via the HALO Bridge EA when it is online (first event: "source: exness"),
// otherwise from OANDA practice when configured. Each event
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
  const broker = await brokerFeedSource(symbol);
  const source: "exness" | "oanda" | null = broker ? "exness" : oandaConfig() && inst ? "oanda" : null;
  if (!source) {
    return NextResponse.json({ error: "no live stream for this symbol (broker EA offline, OANDA not configured)" }, { status: 404 });
  }
  const tfMs = tfSec(tf) * 1000;

  let seed: Candle | null = null;
  try {
    const bars = source === "exness" ? await brokerCandles(symbol, tf, 2) : await fetchOandaCandles(symbol, tf, 2);
    seed = bars[bars.length - 1] ?? null;
  } catch {
    // no seed — the first tick opens the bar
  }

  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
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
      send(`event: source\ndata: ${source}\n\n`);
      if (bar) send(`data: ${JSON.stringify(bar)}\n\n`);
      const onTick = (tick: { time: number; bid: number }) => {
        const px = tick.bid; // charts are BID (MT5 and TradingView's OANDA charts)
        const open = Math.floor(tick.time / tfMs) * tfMs;
        if (!bar || open > bar.time) bar = { time: open, open: px, high: px, low: px, close: px };
        else if (open < bar.time) return; // late tick from a closed bar
        else {
          bar.close = px;
          if (px > bar.high) bar.high = px;
          if (px < bar.low) bar.low = px;
        }
        send(`data: ${JSON.stringify(bar)}\n\n`);
      };
      if (source === "exness") {
        void subscribeBrokerQuotes(symbol, (q) => onTick({ time: q.time, bid: q.bid })).then((u) => {
          if (stopped) u?.(); // viewer left before the subscription was ready
          else unsub = u;
        });
      } else {
        unsub = subscribeOandaTicks(inst!, onTick);
      }
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
