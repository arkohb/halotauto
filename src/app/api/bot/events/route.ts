// ════════════════════════════════════════════════════════════════════════
//  BOT EVENT STREAM · Server-Sent Events (SSE)
//
//  Streams the live strategy events of the bot event bus (levels ARMED
//  with their prices, candle-3 BREAKS of the dotted trigger line, fired
//  trades, TP/SL closes, ranging-market skips) to the dashboard, where
//  the announcer speaks them out loud the moment they happen.
//
//  The login gate in middleware.ts protects this route like every other
//  /api endpoint; the browser EventSource sends the session cookie
//  automatically. Reconnects resume via Last-Event-ID.
// ════════════════════════════════════════════════════════════════════════

import type { NextRequest } from "next/server";
import { botEventsSince, subscribeBotEvents, type BotEventEnvelope } from "@/lib/halo/event-bus";
import { guardLicensed } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const deny = await guardLicensed();
  if (deny) return deny;
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let hb: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(enc.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const send = (e: BotEventEnvelope): void => {
        write(`id: ${e.seq}\nevent: bot\ndata: ${JSON.stringify(e)}\n\n`);
      };

      // resume after a reconnect — the browser sends Last-Event-ID
      const lastId = Number(req.headers.get("last-event-id") ?? "0");
      if (Number.isFinite(lastId) && lastId > 0) {
        for (const e of botEventsSince(lastId)) send(e);
      }
      write("retry: 3000\n\n");

      unsub = subscribeBotEvents(send);
      hb = setInterval(() => write(`: ping ${Date.now()}\n\n`), 20_000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        if (unsub) {
          unsub();
          unsub = null;
        }
        if (hb) {
          clearInterval(hb);
          hb = null;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (hb) {
        clearInterval(hb);
        hb = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
