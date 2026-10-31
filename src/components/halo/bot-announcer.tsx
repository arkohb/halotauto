"use client";

// ════════════════════════════════════════════════════════════════════════
//  BOT ANNOUNCER · the bot SPEAKS its strategy events as they happen
//
//  Subscribes to the server's bot-event stream (SSE /api/bot/events) and
//  speaks every live 3EL moment out loud, at any time, whatever else the
//  assistant is doing:
//    • ARMED   — "Both levels are armed on GOLD — resistance trigger at
//                3312.45, support trigger at 3298.10."
//    • C3 BREAK— "Attention — candle three is breaking above the
//                resistance trigger at 3312.45…"  (said LOUD — high prio)
//    • FIRED   — "Trade fired — sell GOLD at 3312.45. Stop loss …, take
//                profit …"  (high prio — always alerts the trader)
//    • TP/SL   — "Take profit hit on GOLD — plus 168.2 pips."
//    • RANGE   — the honest skip statement (ranging market, S/R too close)
//
//  Delivery rules:
//  • HIGH-priority events (fire / break / TP / SL) interrupt polite chatter;
//    LOW-priority events (armed / skip / status) queue and play in order so
//    rapid announcements never cut each other off mid-sentence.
//  • A watchdog drains the queue when an outside speak() (operator
//    conversation, welcome) cancels the current line without onend.
//  • Muted session / autoplay-blocked → speak() finishes silently, the
//    queue keeps flowing, and the toast still shows what happened.
//  • Replayed history after a reconnect (>15 s old) is never spoken.
//  Presentation only — never mutates engine state or routes orders.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { useHaloVoice } from "@/components/halo/voice-provider";
import { useToast } from "@/hooks/use-toast";

interface Envelope {
  seq: number;
  kind: string;
  prio: "high" | "low";
  symbol: string;
  tf: string;
  time: number;
  title: string;
  spoken: string;
}

const STALE_MS = 15_000; // replayed history after a reconnect → toast only, no voice
const QUEUE_CAP = 4; // polite queue never grows unbounded
const LINE_WATCHDOG_MS = 25_000; // a stuck line must never wedge the queue
const DRAIN_GAP_MS = 350; // small breath between spoken lines

export function BotAnnouncer(): null {
  const { speak } = useHaloVoice();
  const { toast } = useToast();

  const qRef = useRef<Envelope[]>([]);
  const busyRef = useRef(false);
  const curKindRef = useRef<string>("");
  const lastSeqRef = useRef(0);
  const wdRef = useRef<number | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;

    const clearWatchdog = (): void => {
      if (wdRef.current !== null) {
        window.clearTimeout(wdRef.current);
        wdRef.current = null;
      }
    };

    const drain = (): void => {
      if (busyRef.current) return;
      const next = qRef.current.shift();
      if (!next) return;
      busyRef.current = true;
      curKindRef.current = next.kind;
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearWatchdog();
        busyRef.current = false;
        curKindRef.current = "";
        window.setTimeout(drain, DRAIN_GAP_MS);
      };
      // watchdog: an outside speak() (conversation, welcome) cancels this
      // line without firing onend — the queue must never wedge
      wdRef.current = window.setTimeout(finish, LINE_WATCHDOG_MS);
      speak(next.spoken, { onend: finish });
    };

    const announce = (e: Envelope): void => {
      if (e.seq <= lastSeqRef.current) return;
      lastSeqRef.current = e.seq;
      // every event is also visible as a toast — voice is additive, not the
      // only channel (muted sessions, autoplay blocks, noisy rooms)
      try {
        toast({ title: e.title, description: e.spoken });
      } catch {
        // toasts must never break announcing
      }
      if (Date.now() - e.time > STALE_MS) return; // replayed history — silent
      if (e.prio === "high") {
        // a truly urgent moment: if a fire/break line is already playing,
        // jump the queue instead of talking over it; otherwise interrupt now
        if (busyRef.current && (curKindRef.current === "fire" || curKindRef.current === "break")) {
          qRef.current.unshift(e);
          if (qRef.current.length > QUEUE_CAP) qRef.current.length = QUEUE_CAP;
          return;
        }
        qRef.current = [];
        if (!busyRef.current) {
          busyRef.current = true;
          curKindRef.current = e.kind;
          let done = false;
          const finish = (): void => {
            if (done) return;
            done = true;
            clearWatchdog();
            busyRef.current = false;
            curKindRef.current = "";
            window.setTimeout(drain, DRAIN_GAP_MS);
          };
          wdRef.current = window.setTimeout(finish, LINE_WATCHDOG_MS);
          speak(e.spoken, { onend: finish });
        } else {
          qRef.current.unshift(e);
        }
        return;
      }
      // polite events: queue, then play in order
      qRef.current.push(e);
      if (qRef.current.length > QUEUE_CAP) qRef.current.splice(0, qRef.current.length - QUEUE_CAP);
      drain();
    };

    try {
      es = new EventSource("/api/bot/events");
      es.addEventListener("bot", (m) => {
        try {
          announce(JSON.parse((m as MessageEvent).data) as Envelope);
        } catch {
          // malformed frame — ignore
        }
      });
      es.onerror = () => {
        // EventSource reconnects on its own (with Last-Event-ID); a 401
        // after logout keeps failing silently until the page navigates
      };
    } catch {
      // SSE unsupported — toasts from the state poll still inform the trader
    }

    return () => {
      es?.close();
      clearWatchdog();
      qRef.current = [];
      busyRef.current = false;
      curKindRef.current = "";
    };
  }, [speak, toast]);

  return null;
}
