// ════════════════════════════════════════════════════════════════════════
//  BOT EVENT BUS · live strategy events fanned out to the dashboard
//
//  The EA bot publishes every audible moment of the 3EL strategy here:
//    armed      — a support / resistance level is ARMED (with its prices)
//    break      — candle 3 BREAKS beyond the dotted wick trigger line
//    fire       — a trade FIRES (instant entry at the dotted line)
//    win / loss — TP / SL closes the trade
//    range_skip — the strategy refused the trade (ranging market, the
//                 marked support & resistance are too close for entry)
//    status     — honest state notes (e.g. fire skipped: Pine active)
//
//  /api/bot/events streams this bus to the browser over Server-Sent
//  Events; the dashboard announcer speaks each event out loud. The bus
//  keeps a small ring buffer so an SSE client that reconnects with
//  Last-Event-ID can resume exactly where it left off.
// ════════════════════════════════════════════════════════════════════════

export type BotEventKind = "armed" | "break" | "fire" | "win" | "loss" | "range_skip" | "status";

export interface BotEventEnvelope {
  seq: number; // monotonic — doubles as the SSE event id
  kind: BotEventKind;
  /** high = interrupt whatever is being said (fire / break / SL-TP) */
  prio: "high" | "low";
  symbol: string;
  tf: string;
  time: number; // ms epoch of the bar / decision
  title: string; // short toast/log headline
  spoken: string; // natural line the bot says out loud
}

const RING_CAP = 200;

interface BusState {
  seq: number;
  ring: BotEventEnvelope[];
  subs: Set<(e: BotEventEnvelope) => void>;
}

const g = globalThis as unknown as { __haloBotBus?: BusState };

function bus(): BusState {
  if (!g.__haloBotBus) g.__haloBotBus = { seq: 0, ring: [], subs: new Set() };
  return g.__haloBotBus;
}

/** Publish a live strategy event to every connected dashboard. */
export function publishBotEvent(e: Omit<BotEventEnvelope, "seq">): void {
  const b = bus();
  b.seq += 1;
  const env: BotEventEnvelope = { ...e, seq: b.seq };
  b.ring.push(env);
  if (b.ring.length > RING_CAP) b.ring.splice(0, b.ring.length - RING_CAP);
  for (const fn of b.subs) {
    try {
      fn(env);
    } catch {
      // a broken subscriber never blocks the trading loop
    }
  }
}

/** Subscribe to live events. Returns the unsubscribe function. */
export function subscribeBotEvents(fn: (e: BotEventEnvelope) => void): () => void {
  const b = bus();
  b.subs.add(fn);
  return () => {
    b.subs.delete(fn);
  };
}

/** Events with seq > `afterSeq` (SSE replay after a reconnect). */
export function botEventsSince(afterSeq: number): BotEventEnvelope[] {
  return bus().ring.filter((e) => e.seq > afterSeq);
}
