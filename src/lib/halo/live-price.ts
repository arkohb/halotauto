"use client";

// ════════════════════════════════════════════════════════════════════════
//  LIVE PRICE STORE · venue tick price without re-rendering the page tree
//
//  The chart's real-time feed (Deriv/Binance WS) pushes ~2.5 updates/s.
//  Lifting that through React page state re-rendered the ENTIRE dashboard
//  on every push — the main cause of the app feeling slow. This tiny
//  external store lets only the components that actually display the
//  price (big tickers, pulse cards) subscribe via useSyncExternalStore;
//  everyone else never re-renders. Presentation only — no engine contact.
// ════════════════════════════════════════════════════════════════════════

import { useSyncExternalStore } from "react";

export interface LivePrice {
  sym: string;
  px: number;
}

let cur: LivePrice = { sym: "", px: 0 };
const subs = new Set<() => void>();

/** chart live feed calls this per throttled push (≈400ms) */
export function publishLivePrice(sym: string, px: number): void {
  if (!isFinite(px) || px <= 0) return;
  if (cur.sym === sym && Math.abs(cur.px - px) < 1e-12) return;
  cur = { sym, px };
  for (const fn of subs) fn();
}

function getSnapshot(): LivePrice {
  return cur;
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** react hook — re-renders ONLY the calling component when the venue price moves */
export function useLivePrice(): LivePrice {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** the price is for `sym` and live (>0)? */
export function isLiveFor(live: LivePrice, sym: string): boolean {
  return live.sym === sym && live.px > 0;
}
