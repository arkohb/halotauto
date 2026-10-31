// ════════════════════════════════════════════════════════════════════════
//  RANGE-SCAN · fresh levels further away from a ranging market
//
//  Called by the EA bot right after a RANGE SKIP (the strategy skipped a
//  trade because the market is ranging and the marked support & resistance
//  are too close for entry). Instead of sitting idle on the chop, the bot
//  scans for symbols whose strategy-marked levels are FRESH and far enough
//  from the range:
//    • Scanner watchlist rows first (their engines are already warm), then
//    • a curated pool of liquid majors (FX · metals · indices · crypto).
//  A candidate is RANGE-SAFE when either
//    • only one side is armed and the level sits ≥ 1×ATR from price, or
//    • support & resistance are both armed and their midpoint gap is
//      ≥ rangeSepATR × ATR (the same threshold the engine skips on).
//  The results are announced as ARMED trading opportunities (alert log +
//  Telegram/email/push); Scanner rows with AUTO-TRADE will take the
//  break→return fire on those symbols through the normal execution path.
//
//  Throttled to one scan per RANGE_SCAN_MIN_MS so a choppy session cannot
//  spam the feed or the alert channels.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { HaloEngine } from "./halo/engine";
import type { Candle, HaloConfig } from "./halo/types";
import { DEFAULT_CONFIG } from "./halo/types";
import { getKlines } from "./market";
import { getSymbolMeta, tfSec, decimalsOf } from "./market-symbols";
import { sendAlert } from "./alerts";

/** curated fallback pool — liquid symbols across every asset group */
const RANGE_SCAN_POOL = [
  "XAUUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "US30",
  "NAS100",
  "GER40",
  "USOIL",
  "BTCUSDT",
  "ETHUSDT",
];

/** hard cap on symbols probed per scan (feed-friendly) */
const MAX_PROBES = 12;
/** bars of recent history evaluated per candidate */
const WARM_BARS = 220;
/** single-side levels must sit at least this far (×ATR) from price to count as "further away" */
const MIN_ONE_SIDE_DIST_ATR = 1.0;
/** minimum time between opportunity scans */
const RANGE_SCAN_MIN_MS = 180_000;

export interface RangeCandidate {
  symbol: string;
  label: string;
  tf: string;
  freshBuy: number;
  freshSell: number;
  /** tightest support↔resistance midpoint gap (×ATR); null when only one side is armed */
  gapAtr: number | null;
  /** distance of the closest armed level from price (×ATR) */
  nearestAtr: number | null;
  supportPx: number | null;
  resistancePx: number | null;
  pxDec: number;
  source: string;
  /** true = fresh levels comfortably away from any ranging box */
  passes: boolean;
}

const mid = (l: { top: number; bot: number }): number => (l.top + l.bot) / 2;

/** Warm the 3EL engine over recent bars of one symbol and read its armed levels. */
async function evalSymbol(sym: string, tf: string, cfg: HaloConfig, rangeSepATR: number): Promise<RangeCandidate | null> {
  try {
    const meta = getSymbolMeta(sym);
    if (meta.id !== sym) return null; // unknown ticker — skip (getSymbolMeta falls back to SYMBOLS[0])
    const { candles, source } = await getKlines(sym, tf, WARM_BARS);
    if (candles.length < 60) return null;
    const engine = new HaloEngine({ ...DEFAULT_CONFIG, ...cfg }, meta.mintick);
    const secMs = tfSec(tf) * 1000;
    const now = Date.now();
    let lastPrice = 0;
    const confirmed: Candle[] = [];
    for (const c of candles) {
      if (c.time + secMs <= now) {
        engine.processBar(c, true);
        confirmed.push(c);
      }
    }
    lastPrice = confirmed.length > 0 ? confirmed[confirmed.length - 1].close : 0;
    const snap = engine.snapshot();
    const sup = snap.levels.filter((l) => l.side === 1);
    const res = snap.levels.filter((l) => l.side === -1);
    if (snap.levels.length === 0 || !snap.atr || snap.atr <= 0 || !lastPrice) return null;

    // tightest cross-side gap (the box the engine would refuse to trade inside)
    let gapAtr: number | null = null;
    if (sup.length > 0 && res.length > 0) {
      let g = Infinity;
      for (const s of sup) for (const r of res) g = Math.min(g, Math.abs(mid(r) - mid(s)));
      gapAtr = g / snap.atr;
    }
    let nearestAtr: number | null = null;
    for (const l of snap.levels) {
      const raw = l.side === -1 ? l.bot - lastPrice : lastPrice - l.top;
      const d = Math.max(0, raw) / snap.atr;
      if (nearestAtr === null || d < nearestAtr) nearestAtr = d;
    }

    const passes =
      gapAtr === null
        ? (nearestAtr ?? 0) >= MIN_ONE_SIDE_DIST_ATR // single side armed, comfortably away from price
        : gapAtr >= rangeSepATR; // two-sided box that is NOT too close

    return {
      symbol: sym,
      label: meta.label,
      tf,
      freshBuy: sup.length,
      freshSell: res.length,
      gapAtr,
      nearestAtr,
      supportPx: sup.length > 0 ? sup[0].ext : null,
      resistancePx: res.length > 0 ? res[0].ext : null,
      pxDec: decimalsOf(meta.mintick),
      source,
      passes,
    };
  } catch {
    return null;
  }
}

/** Rank: range-safe first; not-ranging (single side / widest box) above tight boxes. */
function sortKey(c: RangeCandidate): number {
  if (!c.passes) return -1;
  if (c.gapAtr === null) return 1000 + (c.nearestAtr ?? 0); // no box at all → best
  return c.gapAtr;
}

export async function findRangeSafeOpportunities(opts: {
  tf: string;
  rangeSepATR: number;
  excludeSymbol?: string;
  cfg?: Partial<HaloConfig>;
}): Promise<RangeCandidate[]> {
  const cfg: HaloConfig = { ...DEFAULT_CONFIG, ...(opts.cfg ?? {}) };
  const exclude = (opts.excludeSymbol ?? "").toUpperCase();
  const seen = new Set<string>([exclude]);
  const jobs: Array<{ symbol: string; tf: string }> = [];

  // 1) scanner watchlist rows — already-warm engines, same strategy settings
  try {
    const rows = await db.scannerSymbol.findMany({
      where: { enabled: true },
      orderBy: { createdAt: "asc" },
      select: { symbol: true, tf: true },
    });
    for (const r of rows) {
      const k = r.symbol.toUpperCase();
      if (!seen.has(k) && jobs.length < MAX_PROBES) {
        seen.add(k);
        jobs.push({ symbol: r.symbol, tf: r.tf });
      }
    }
  } catch {
    // db not ready — pool-only scan
  }

  // 2) curated liquid majors on the bot's timeframe
  for (const s of RANGE_SCAN_POOL) {
    if (!seen.has(s) && jobs.length < MAX_PROBES) {
      seen.add(s);
      jobs.push({ symbol: s, tf: opts.tf });
    }
  }

  const out: RangeCandidate[] = [];
  // small stagger keeps the concurrent fetch burst gentle on the feeds
  for (const job of jobs) {
    const c = await evalSymbol(job.symbol, job.tf, cfg, opts.rangeSepATR);
    if (c) out.push(c);
  }
  out.sort((a, b) => sortKey(b) - sortKey(a));
  return out;
}

const gScan = globalThis as unknown as { __haloRangeScanAt?: number };

/**
 * Fire-and-forget follow-up after a RANGE SKIP: scan once per throttle
 * window and announce the fresh, range-safe armed levels (or say plainly
 * that none were found). Never throws into the bot's event loop.
 */
export async function maybeAnnounceRangeOpportunities(opts: {
  symbol: string;
  tf: string;
  cfg: HaloConfig;
}): Promise<boolean> {
  const now = Date.now();
  if (gScan.__haloRangeScanAt && now - gScan.__haloRangeScanAt < RANGE_SCAN_MIN_MS) return false;
  gScan.__haloRangeScanAt = now;

  const cands = await findRangeSafeOpportunities({
    tf: opts.tf,
    rangeSepATR: opts.cfg.rangeSepATR,
    excludeSymbol: opts.symbol,
    cfg: opts.cfg,
  });
  const good = cands.filter((c) => c.passes).slice(0, 3);
  const px = (v: number | null, d: number): string => (v === null ? "—" : v.toFixed(d));
  const sep = (c: RangeCandidate): string => {
    const parts: string[] = [];
    if (c.freshSell > 0) parts.push(`R ${px(c.resistancePx, c.pxDec)}`);
    if (c.freshBuy > 0) parts.push(`S ${px(c.supportPx, c.pxDec)}`);
    return parts.join(" · ");
  };
  const gapTxt = (c: RangeCandidate): string =>
    c.gapAtr === null ? `no opposite box · level ${ (c.nearestAtr ?? 0).toFixed(1) }×ATR from price` : `S/R gap ${c.gapAtr.toFixed(1)}×ATR (min ${opts.cfg.rangeSepATR.toFixed(1)}×ATR)`;

  const body =
    good.length === 0
      ? `Skipped ${opts.symbol} ${opts.tf} — ranging market, support & resistance too close for entry.\nOpportunity scan found NO fresh range-safe levels right now (${cands.length} symbols checked). Add symbols to the Scanner watchlist to widen the search, or wait for a fresh C1/C2 further from the range — the EA arms it automatically.`
      : `Skipped ${opts.symbol} ${opts.tf} — ranging market, support & resistance too close for entry.\nFresh levels further from the range, now ARMED and watched:\n${good
          .map((c) => `• ${c.symbol} ${c.tf.toUpperCase()} — ${sep(c)} · ${gapTxt(c)}${c.source === "simulator" ? " · sim feed" : ""}`)
          .join("\n")}\nScanner rows with AUTO-TRADE take the break→return on those levels automatically.`;

  await sendAlert({
    kind: "skip",
    title: "HALO 3EL · RANGE SKIP → FRESH OPPORTUNITIES",
    body,
  });
  return true;
}
