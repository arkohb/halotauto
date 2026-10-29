"use client";

// ════════════════════════════════════════════════════════════════════════
//  TV WEB SIGNAL OVERLAY · approximate price ladder over the free embed
//
//  The free TradingView Advanced Chart is a cross-origin iframe — custom
//  drawings can never run inside it. This overlay draws the CURRENT SIGNAL
//  (C1/C2 equal level, wick extreme, and the open trade's ENTRY/SL/TP) as
//  an absolutely-positioned layer on top, mapped through an ESTIMATED
//  price scale:
//    · the widget auto-fits roughly the last bars on load, so the estimate
//      takes the same engine candle window (width ÷ ~8.5px per bar)
//    · a faint ladder on the left edge lets the eye check alignment
//    · because TV's own zoom can drift from the estimate, ANY line can be
//      dragged vertically to re-align the whole ladder (offset persisted
//      per symbol+timeframe); double-click a line to reset.
//
//  Old signals are never rendered — same clean chart contract as the 3EL
//  view. Presentation only: the live EA is untouched.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle, LevelSnapshot, TradeSnapshot } from "@/lib/halo/types";
import { fmtPx } from "@/lib/halo/ui-helpers";

interface Props {
  candles: Candle[]; // engine window — same symbol/timeframe as the widget
  levels: LevelSnapshot[]; // fresh levels only (the current signal)
  trade: TradeSnapshot | null;
  mintick: number;
  symbol: string;
  tf: string;
}

const GOLD = "#D4AF37";
const RED = "242,54,69";
const GREEN = "8,153,129";

function sideRgb(side: number): string {
  return side === -1 ? RED : GREEN;
}

/** nice round step for ladder ticks (1/2/2.5/5 × 10^n) */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * mag) return m * mag;
  }
  return 10 * mag;
}

interface LineSpec {
  key: string;
  price: number;
  color: string;
  width: number;
  dash: boolean;
  dotted: boolean;
  label: string;
}

export function TvSignalOverlay({ candles, levels, trade, mintick, symbol, tf }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const offKey = `halo3el.tvoverlay.off.${symbol}|${tf}`;
  const [off, setOff] = useState(0);
  const dragRef = useRef<{ y: number; base: number } | null>(null);

  // restore + persist the alignment offset per symbol|timeframe
  // (deferred — never setState synchronously inside an effect)
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const v = parseFloat(localStorage.getItem(offKey) ?? "0");
        setOff(isFinite(v) ? v : 0);
      } catch {
        setOff(0);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [offKey]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const persist = useCallback(
    (v: number) => {
      setOff(v);
      try {
        localStorage.setItem(offKey, String(Math.round(v * 100) / 100));
      } catch {
        // ignore
      }
    },
    [offKey]
  );

  // ── estimated price window (what the widget roughly auto-fits) ────────
  const scale = useMemo(() => {
    if (size.h < 80 || candles.length === 0) return null;
    const bars = Math.min(candles.length, Math.max(60, Math.min(220, Math.floor(size.w / 8.5))));
    const win = candles.slice(-bars);
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of win) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    // never clip the signal / trade lines — fold them into the window
    const fold = (p: number) => {
      if (!isFinite(p)) return;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    };
    for (const d of levels) {
      fold(d.top);
      fold(d.bot);
      fold(d.ext);
    }
    if (trade) {
      fold(trade.entry);
      fold(trade.sl);
      fold(trade.tp);
    }
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return null;
    const pad = (hi - lo) * 0.12;
    return { pLo: lo - pad, pHi: hi + pad };
  }, [candles, levels, trade, size.w, size.h]);

  // ── lines to draw: BOTH armed levels + open trade only ─────────────────
  const lines = useMemo<LineSpec[]>(() => {
    if (!scale) return [];
    const out: LineSpec[] = [];
    // EVERY armed level — the armed SUPPORT (BUY) and the armed RESISTANCE
    // (SELL) — one line each, exactly how the script draws it: the
    // equal-level MID price (Pine line.new(bar_index-1, nMid, extend.right)),
    // plus the quieter wick-extreme guide. Prices are pinned at creation —
    // the ladder lines never move, they only extend right on the chart.
    const armed = [...levels].sort((a, b) => a.b2Time - b.b2Time); // oldest first, newest draws on top
    for (const d of armed) {
      const rgb = sideRgb(d.side);
      const arrow = d.side === -1 ? "▼" : "▲";
      const mid = (d.top + d.bot) / 2;
      out.push({
        key: `lvl${d.id}`,
        price: mid,
        color: `rgba(${rgb},0.95)`,
        width: 2,
        dash: false,
        dotted: false,
        label: `3EL ${d.side === -1 ? "RES" : "SUP"} ${arrow} ${fmtPx(mid, mintick)}`,
      });
      out.push({
        key: `wk${d.id}`,
        price: d.ext,
        color: `rgba(${rgb},0.45)`,
        width: 1,
        dash: true,
        dotted: true,
        label: `WICK ${fmtPx(d.ext, mintick)}`,
      });
    }
    if (trade) {
      out.push({
        key: "entry",
        price: trade.entry,
        color: GOLD,
        width: 2,
        dash: false,
        dotted: false,
        label: `ENTRY ${fmtPx(trade.entry, mintick)}`,
      });
      out.push({
        key: "sl",
        price: trade.sl,
        color: `rgba(${RED},0.95)`,
        width: 1,
        dash: true,
        dotted: false,
        label: `SL ${fmtPx(trade.sl, mintick)}`,
      });
      out.push({
        key: "tp",
        price: trade.tp,
        color: `rgba(${GREEN},0.95)`,
        width: 1,
        dash: true,
        dotted: false,
        label: `TP ${fmtPx(trade.tp, mintick)}`,
      });
    }
    return out;
  }, [scale, levels, trade, mintick]);

  const onDown = (e: React.PointerEvent) => {
    dragRef.current = { y: e.clientY, base: off };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    persist(d.base + (e.clientY - d.y));
  };
  const onUp = () => {
    dragRef.current = null;
  };

  if (!scale || lines.length === 0 || size.h < 80) {
    return <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[12]" aria-hidden />;
  }

  const padT = size.h * 0.04;
  const innerH = size.h - padT * 2;
  const yOfRaw = (p: number) => padT + ((scale.pHi - p) / (scale.pHi - scale.pLo)) * innerH;
  const yOf = (p: number) => yOfRaw(p) + off;

  // chips never stack: when lines sit within ~11px (equal-level bands are
  // razor-thin), the higher-priority line keeps its price chip and the
  // others are skipped (ENTRY > SL > TP > armed RES/SUP > wicks)
  // (plain pass — ≤8 lines, and hooks must stay above the early return)
  const prio = new Map<string, number>();
  for (const l of lines) {
    // ENTRY > SL > TP keep fixed priority; armed levels + wicks rank after
    prio.set(l.key, l.key === "entry" ? 0 : l.key === "sl" ? 1 : l.key === "tp" ? 2 : 3 + prio.size);
  }
  const planned = lines
    .map((l) => ({ key: l.key, y: yOfRaw(l.price), prio: prio.get(l.key) ?? 9 }))
    .sort((a, b) => a.prio - b.prio);
  const showChip = new Map<string, boolean>(planned.map((p) => [p.key, true]));
  for (const a of planned) {
    for (const b of planned) {
      if (a.key !== b.key && Math.abs(a.y - b.y) < 11 && b.prio < a.prio) showChip.set(a.key, false);
    }
  }

  // faint left-edge ladder — anchors the estimate against TV's own axis
  const span = scale.pHi - scale.pLo;
  const step = niceStep(span / 4.5);
  const ticks: number[] = [];
  for (let p = Math.ceil(scale.pLo / step) * step; p <= scale.pHi; p += step) ticks.push(p);

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-[12]" aria-label="3EL signal overlay on TradingView">
      {/* left-edge ladder (ours — faint, so it never fights TV's axis) */}
      {ticks.map((p) => {
        const y = yOf(p);
        if (y < 14 || y > size.h - 6) return null;
        return (
          <div key={`tk${p}`} className="absolute flex items-center gap-1" style={{ left: 6, top: y - 6 }}>
            <span className="text-[8px] font-bold tabular-nums tracking-wider" style={{ color: "rgba(140,152,174,0.55)" }}>
              {fmtPx(p, mintick)}
            </span>
            <span className="h-px w-2" style={{ background: "rgba(140,152,174,0.35)" }} />
          </div>
        );
      })}

      {/* signal lines — thin strips are the only pointer-catcher */}
      {lines.map((l) => {
        const y = yOf(l.price);
        if (y < 8 || y > size.h - 8) return null;
        return (
          <div key={l.key} className="absolute inset-x-0" style={{ top: y - 7, height: 14 }}>
            <div
              role="slider"
              aria-label={`Align ${l.label} line with the TradingView chart`}
              aria-valuenow={Math.round(off)}
              tabIndex={0}
              className="pointer-events-auto relative h-full w-full cursor-ns-resize"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onDoubleClick={() => persist(0)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  persist(off - 2);
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  persist(off + 2);
                }
              }}
            >
              {/* the line */}
              <span
                className="absolute inset-x-0"
                style={{
                  top: 6,
                  height: l.width,
                  background: l.dotted
                    ? `repeating-linear-gradient(90deg, ${l.color} 0 3px, transparent 3px 7px)`
                    : l.dash
                      ? `repeating-linear-gradient(90deg, ${l.color} 0 7px, transparent 7px 12px)`
                      : l.color,
                  opacity: 0.9,
                }}
              />
              {/* right-edge price chip (hidden when a higher-priority chip
                  sits within 11px — chips never stack) */}
              {showChip.get(l.key) !== false && (
                <span
                  className="rounded border px-1 py-px text-[8.5px] font-extrabold tabular-nums tracking-wide"
                  style={{
                    position: "absolute",
                    right: 4,
                    top: "50%",
                    transform: "translateY(-50%)",
                    borderColor: l.color,
                    color: l.color,
                    background: "rgba(7,13,27,0.88)",
                  }}
                >
                  {l.label}
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* alignment hint */}
      <div
        className="rounded border px-1.5 py-0.5 text-[7.5px] font-bold tracking-[0.14em]"
        style={{
          position: "absolute",
          right: 6,
          bottom: 6,
          borderColor: "rgba(28,42,71,0.9)",
          background: "rgba(7,13,27,0.8)",
          color: "rgba(140,152,174,0.85)",
        }}
      >
        3EL LADDER · DRAG A LINE TO ALIGN · 2× CLICK RESETS
      </div>
    </div>
  );
}
