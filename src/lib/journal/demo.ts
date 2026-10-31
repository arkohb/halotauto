// ══════════════════════════════════════════════════════════════════════════
//  HALO PERFORMANCE JOURNAL · DEMO data seeder
//
//  Generates a realistic, DETERMINISTIC (seeded PRNG) set of demo trades so
//  the journal can be evaluated and tested without a live MT5 account.
//
//  HARD RULES (spec §14):
//    · every row is source="DEMO" and brokerLabel "DEMO DATA" — the UI
//      badges them on every screen;
//    · seeding is REFUSED while the journal already contains ANY record, so
//      demo rows can never mix with real MT5/CSV/manual history;
//    · clearing removes ONLY the DEMO rows — real records always survive.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { db } from "@/lib/db";

// xorshift32 — deterministic across runs
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

const INSTRUMENTS: { symbol: string; px: number; pip: number; vol: [number, number] }[] = [
  { symbol: "EURUSD", px: 1.085, pip: 0.0001, vol: [0.1, 1.0] },
  { symbol: "GBPUSD", px: 1.268, pip: 0.0001, vol: [0.1, 0.8] },
  { symbol: "XAUUSD", px: 2385, pip: 0.1, vol: [0.01, 0.3] },
  { symbol: "USDJPY", px: 152.4, pip: 0.01, vol: [0.1, 0.8] },
  { symbol: "BTCUSD", px: 67250, pip: 1, vol: [0.01, 0.15] },
  { symbol: "GBPJPY", px: 193.2, pip: 0.01, vol: [0.1, 0.5] },
  { symbol: "US30", px: 39250, pip: 1, vol: [0.1, 1.0] },
];

const STRATEGIES = ["3EL Breakout", "3EL Level Reversal", "London Open Range", ""];
const TIMEFRAMES = ["5m", "15m", "1H", ""];
const TAG_POOL = [
  "followed_plan", "disciplined", "followed_plan", "late_entry", "early_exit",
  "emotional", "overtrading", "missed_opportunity", "sl_adjustment", "disciplined",
];

export interface DemoSeedResult {
  ok: true;
  created: number;
  from: string;
  to: string;
}

export async function seedDemoJournal(userId: string, count = 78): Promise<DemoSeedResult> {
  const existing = await db.journalTrade.count({ where: { userId } });
  if (existing > 0) {
    throw new Error("Journal already contains records — demo data is never mixed with real history. Clear the journal or use a fresh account.");
  }
  const rng = makeRng(20261101);
  const n = Math.min(300, Math.max(10, Math.round(count)));
  const now = Date.now();
  const rows: {
    userId: string;
    extKey: string;
    source: string;
    brokerLabel: string;
    symbol: string;
    direction: string;
    volume: number;
    volumeExit: number;
    entryPrice: number;
    exitPrice: number;
    sl: number | null;
    tp: number | null;
    openedAt: Date;
    closedAt: Date;
    durationMin: number;
    grossProfit: number;
    commission: number;
    swap: number;
    fees: number;
    netPnl: number;
    currency: string;
    riskPrice: number | null;
    rMultiple: number | null;
    strategy: string;
    timeframe: string;
    session: string;
    status: string;
    notes: string;
    tagsJson: string;
    reviewJson: string;
  }[] = [];

  for (let i = 0; i < n; i++) {
    const inst = INSTRUMENTS[Math.floor(rng() * INSTRUMENTS.length)];
    const direction = rng() < 0.52 ? "BUY" : "SELL";
    const dir = direction === "BUY" ? 1 : -1;
    const volume = Math.round((inst.vol[0] + rng() * (inst.vol[1] - inst.vol[0])) * 100) / 100;
    // open time spread over the last ~100 days, business hours-ish
    const openAt = now - Math.floor(rng() * 100 * 24 * 3600_000) - Math.floor(rng() * 8 * 3600_000);
    const holdMin = Math.floor(8 + rng() * 700); // 8 min … ~12 h
    const closedTs = openAt + holdMin * 60_000;
    // risk 20–80 pips; R outcome clustered like a 54% system
    const riskPips = 20 + Math.floor(rng() * 60);
    const roll = rng();
    const rMultiple = roll < 0.54 ? 0.8 + rng() * 2.2 : roll < 0.58 ? 0 : -(0.7 + rng() * 0.5);
    const riskPx = riskPips * inst.pip;
    const move = riskPx * rMultiple * dir;
    const entry = Math.round(inst.px * (1 + (rng() - 0.5) * 0.02) * 1e5) / 1e5;
    const exit = entry + move;
    const sl = entry - riskPx * dir;
    const tp = entry + riskPx * (1.5 + rng() * 1.5) * dir;
    // demo economics: P&L derives from R × risk amount, the way a real
    // account would (riskAmount = lots × riskPips × $10 pip value per lot)
    const riskAmount = volume * riskPips * 10;
    const gross = Math.round(rMultiple * riskAmount * 100) / 100;
    const commission = -Math.round(volume * 7 * 100) / 100; // ≈ $7/lot round turn
    const swap = rng() < 0.3 ? Math.round((rng() * 2 - 1.4) * volume * 100) / 100 : 0;
    const net = gross + commission + swap;
    const strategy = STRATEGIES[Math.floor(rng() * STRATEGIES.length)];
    const timeframe = TIMEFRAMES[Math.floor(rng() * TIMEFRAMES.length)];
    const tags: string[] = [];
    const tagRoll = rng();
    if (tagRoll < 0.62) {
      tags.push(TAG_POOL[Math.floor(rng() * TAG_POOL.length)]);
      if (rng() < 0.2) tags.push(TAG_POOL[Math.floor(rng() * TAG_POOL.length)]);
    }
    const rating = 1 + Math.floor(rng() * 5);
    const openedIso = new Date(openAt);
    const hour = openedIso.getUTCHours();
    const session = hour < 7 ? "Asia" : hour < 13 ? "London" : hour < 21 ? "New York" : "Sydney";
    rows.push({
      userId,
      extKey: `demo:${crypto.createHash("sha256").update(String(i)).digest("hex").slice(0, 20)}`,
      source: "DEMO",
      brokerLabel: "DEMO DATA",
      symbol: inst.symbol,
      direction,
      volume,
      volumeExit: volume,
      entryPrice: entry,
      exitPrice: Math.round(exit * 1e5) / 1e5,
      sl: Math.round(sl * 1e5) / 1e5,
      tp: Math.round(tp * 1e5) / 1e5,
      openedAt: openedIso,
      closedAt: new Date(closedTs),
      durationMin: holdMin,
      grossProfit: gross,
      commission,
      swap,
      fees: 0,
      netPnl: net,
      currency: "USD",
      riskPrice: riskPx,
      rMultiple: Math.round(rMultiple * 100) / 100,
      strategy,
      timeframe,
      session,
      status: "CLOSED",
      notes: "[DEMO] Seeded sample trade for evaluating the Performance Journal.",
      tagsJson: JSON.stringify([...new Set(tags)]),
      reviewJson: JSON.stringify({
        reasonEntry: "[DEMO] sample entry reason",
        reasonExit: "[DEMO] sample exit reason",
        rating,
      }),
    });
  }

  await db.journalTrade.createMany({ data: rows });
  const sorted = [...rows].sort((a, b) => +a.closedAt - +b.closedAt);
  return {
    ok: true,
    created: rows.length,
    from: sorted[0]?.closedAt.toISOString() ?? "",
    to: sorted[rows.length - 1]?.closedAt.toISOString() ?? "",
  };
}

export async function clearDemoJournal(userId: string): Promise<{ ok: true; deleted: number }> {
  const res = await db.journalTrade.deleteMany({ where: { userId, source: "DEMO" } });
  return { ok: true, deleted: res.count };
}
