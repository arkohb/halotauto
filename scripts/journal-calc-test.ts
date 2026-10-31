// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL CALCULATION ACCURACY TESTS (spec §14 items 5-13)
//  Run: bun scripts/journal-calc-test.ts   → exits 1 on any failure
// ══════════════════════════════════════════════════════════════════════════

import {
  coreStats,
  calendarMonth,
  dailyPnl,
  weeklyPnl,
  monthlyPnl,
  cumulativeCurve,
  disciplineStats,
  sessionOfUtc,
  weekKeyUtc,
  type JournalRec,
} from "../src/lib/journal/stats";
import { legsOfPosition } from "../src/lib/journal/mt5-sync";
import { parseTradesCsv, tradesToCsv } from "../src/lib/journal/csv";
import type { MtHistoryDeal } from "../src/lib/brokers/metaapi-core";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function eq(name: string, got: unknown, want: unknown, tol = 1e-6) {
  const ok =
    typeof want === "number" && typeof got === "number"
      ? Math.abs(got - want) <= tol
      : JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function rec(p: Partial<JournalRec>): JournalRec {
  return {
    id: p.id ?? "r",
    source: p.source ?? "MANUAL",
    brokerLabel: "",
    symbol: p.symbol ?? "EURUSD",
    direction: p.direction ?? "BUY",
    volume: p.volume ?? 0.1,
    volumeExit: p.volumeExit ?? p.volume ?? 0.1,
    entryPrice: p.entryPrice ?? 1.1,
    exitPrice: p.exitPrice ?? 1.2,
    sl: p.sl ?? null,
    tp: p.tp ?? null,
    openedAt: p.openedAt ?? "2026-01-01T10:00:00Z",
    closedAt: p.closedAt ?? "2026-01-01T11:00:00Z",
    durationMin: p.durationMin ?? 60,
    grossProfit: p.grossProfit ?? 0,
    commission: p.commission ?? 0,
    swap: p.swap ?? 0,
    fees: p.fees ?? 0,
    netPnl: p.netPnl ?? 0,
    currency: p.currency ?? "USD",
    riskPrice: p.riskPrice ?? null,
    rMultiple: p.rMultiple ?? null,
    strategy: p.strategy ?? "",
    timeframe: p.timeframe ?? "",
    session: p.session ?? "",
    notes: p.notes ?? "",
    tags: p.tags ?? [],
    review: p.review ?? {},
    isDemo: p.isDemo ?? false,
  };
}

// ── 1. core stats: known small book ─────────────────────────────────────
// trades: +100, −40, +60, 0, −30  → net +90
const book = [
  rec({ id: "a", netPnl: 100, grossProfit: 102, commission: -2, rMultiple: 2, riskPrice: 0.001 }),
  rec({ id: "b", netPnl: -40, rMultiple: -1, riskPrice: 0.001 }),
  rec({ id: "c", netPnl: 60, rMultiple: 1.2, riskPrice: 0.001 }),
  rec({ id: "d", netPnl: 0 }), // breakeven
  rec({ id: "e", netPnl: -30, rMultiple: -0.8, riskPrice: 0.001 }),
];
const s = coreStats(book);
eq("totalTrades", s.totalTrades, 5);
eq("wins", s.wins, 2);
eq("losses", s.losses, 2);
eq("breakeven counted separately", s.breakeven, 1);
eq("winRate 2/5", s.winRatePct, 40);
eq("lossRate 2/5", s.lossRatePct, 40);
eq("net", s.netPnl, 90);
eq("grossProfit", s.grossProfit, 160);
eq("grossLoss", s.grossLoss, 70);
eq("profitFactor 160/70", s.profitFactor!, 160 / 70, 1e-9);
eq("avgWin", s.avgWin!, 80);
eq("avgLoss", s.avgLoss!, 35);
eq("expectancy", s.expectancy!, 18);
eq("avgR", s.avgR!, (2 - 1 + 1.2 - 0.8) / 4, 1e-9);
eq("consecutiveWins (a,c separated by loss → best run 1)", s.consecutiveWins, 1);
eq("consecutiveLosses", s.consecutiveLosses, 1);
eq("largestWin", s.largestWin!, 100);
eq("largestLoss", s.largestLoss!, -40);
// max DD: cumulative 100,60,120,120,90 → dips: 100→60 (DD 40), 120→90 (DD 30) → max 40
eq("maxDrawdown", s.maxDrawdown, 40);
eq("maxDrawdownPct", s.maxDrawdownPct!, 40, 1e-9);

// profit factor edge cases
eq("PF infinite (only wins)", coreStats([rec({ netPnl: 10 }), rec({ netPnl: 5 })]).profitFactorLabel, "∞");
eq("PF zero (only losses)", coreStats([rec({ netPnl: -5 })]).profitFactorLabel, "0.00");
eq("PF em dash (empty)", coreStats([]).profitFactorLabel, "—");
eq("empty stats", coreStats([]).totalTrades, 0);

// costs: commission −2, swap +1, fees −0.5 → costs = 2 − 1 + 0.5 = 1.5
const costBook = [
  rec({ netPnl: 5, commission: -2, swap: 1, fees: -0.5 }),
  rec({ netPnl: -1, commission: -3, swap: -1, fees: 0 }),
];
eq("totalCosts", coreStats(costBook).totalCosts, 5.5, 1e-9);

// ── 2. drawdown across a deeper curve ───────────────────────────────
// trades +10,+25,−20,+15,+20,−25 → cum 10,35,15,30,50,25 → peak 50 trough 25
const dd = coreStats([10, 25, -20, 15, 20, -25].map((n) => rec({ netPnl: n })));
eq("deep DD", dd.maxDrawdown, 25);
eq("deep DD %", dd.maxDrawdownPct!, 50, 1e-9);
eq("streak of 2 wins", dd.consecutiveWins, 2);
eq("losses never consecutive", dd.consecutiveLosses, 1);

// ── 3. calendar figures match underlying trades (spec §14 item 10) ──────
const jan: JournalRec[] = [
  rec({ id: "1", closedAt: "2026-01-02T15:00:00Z", netPnl: 50 }),
  rec({ id: "2", closedAt: "2026-01-02T16:00:00Z", netPnl: -20 }),
  rec({ id: "3", closedAt: "2026-01-05T09:00:00Z", netPnl: 10 }),
  rec({ id: "4", closedAt: "2026-02-01T09:00:00Z", netPnl: 999 }), // other month, must be excluded by the grid
];
const janWeeks = calendarMonth(2026, 0, jan);
const janFlat = janWeeks.flat();
eq("grid covers 2026-01 fully", janFlat.filter((c) => c.inMonth).length, 31);
const jan2 = janFlat.find((c) => c.day === "2026-01-02")!;
eq("Jan 2 net = 50−20", jan2.net!, 30);
eq("Jan 2 trades", jan2.trades, 2);
eq("Jan 2 wins/losses", [jan2.wins, jan2.losses], [1, 1]);
const jan5 = janFlat.find((c) => c.day === "2026-01-05")!;
eq("Jan 5 net", jan5.net!, 10);
eq("Feb spill NOT inside Jan grid", janFlat.find((c) => c.day === "2026-02-01"), undefined);
const janNoTrade = janFlat.find((c) => c.day === "2026-01-03")!;
eq("no-trade day is neutral", janNoTrade.net, null);
// sum of grid cells = sum of trades for the month
const gridNet = janFlat.reduce((a, b) => a + (b.net ?? 0), 0);
eq("calendar month total matches records", gridNet, 40);
eq("Monday-first: 2026-01-01 is Thursday", janFlat[0].day === "" && janFlat[3].day === "2026-01-01", true);

// ── 4. daily / weekly / monthly aggregation keys ────────────────────────
eq("daily buckets", dailyPnl(jan).map((d) => d.day), ["2026-01-02", "2026-01-05", "2026-02-01"]);
eq("weekly key Jan 2 2026", weekKeyUtc("2026-01-02T12:00:00Z"), "2026-W01");
eq("monthly buckets", monthlyPnl(jan).map((m) => [m.day, m.net]), [["2026-01", 40], ["2026-02", 999]]);
const cum = cumulativeCurve(jan);
eq("cumulative curve", cum.map((p) => p.net), [50, 30, 40, 1039]);

// ── 5. sessions derived from UTC ────────────────────────────────────────
eq("Asia 02:00", sessionOfUtc("2026-01-05T02:00:00Z"), "Asia");
eq("London 08:00", sessionOfUtc("2026-01-05T08:00:00Z"), "London");
eq("New York 15:00", sessionOfUtc("2026-01-05T15:00:00Z"), "New York");
eq("Sydney 23:00", sessionOfUtc("2026-01-05T23:00:00Z"), "Sydney");

// ── 6. discipline stats — only from tags, nothing assumed ───────────────
const disc = disciplineStats([
  rec({ tags: ["followed_plan"] }),
  rec({ tags: ["emotional", "late_entry"] }),
  rec({ tags: [] }),
  rec({ tags: ["disciplined"] }),
]);
eq("taggedTrades", disc.taggedTrades, 3);
eq("positiveTags", disc.positiveTags, 2);
eq("negativeTags", disc.negativeTags, 2);
eq("adherence 2/3", disc.adherencePct!, 66.6666667, 1e-4);
eq("top mistake is emotional/late (count 1 each)", disc.topMistakes.length, 2);

// ── 7. MT5 legs: partial closes → ONE trade ─────────────────────────────
const d = (over: Partial<MtHistoryDeal>): MtHistoryDeal => ({
  id: over.id ?? "d",
  type: over.type,
  entry: over.entry,
  symbol: over.symbol ?? "EURUSD",
  volume: over.volume,
  positionId: over.positionId,
  profit: over.profit,
  swap: over.swap,
  commission: over.commission,
  fee: over.fee,
  time: over.time,
  price: over.price,
  sl: over.sl,
  tp: over.tp,
});
const partial: MtHistoryDeal[] = [
  d({ id: "1", entry: "DEAL_ENTRY_IN", type: "DEAL_TYPE_BUY", volume: 1, price: 100, time: "2026-03-01T10:00:00Z", sl: 99, profit: 0, commission: -3.5 }),
  d({ id: "2", entry: "DEAL_ENTRY_OUT", type: "DEAL_TYPE_SELL", volume: 0.4, price: 101, time: "2026-03-01T11:00:00Z", profit: 40 }),
  d({ id: "3", entry: "DEAL_ENTRY_OUT", type: "DEAL_TYPE_SELL", volume: 0.6, price: 102, time: "2026-03-01T12:00:00Z", profit: 80, swap: -1 }),
];
const legRes = legsOfPosition(partial);
eq("partial closes → 1 leg", legRes.legs.length, 1);
eq("no open remains", legRes.openRemains, false);
const L = legRes.legs[0];
eq("partial entry VWAP", L.inNotional / L.inVol, 100);
eq("partial exit VWAP", L.outNotional / L.outVol, 101.6, 1e-9);
eq("partial profit sum", L.profit, 120);
eq("partial commission", L.commission, -3.5);
eq("partial swap", L.swap, -1);
eq("partial SL kept", L.sl, 99);
eq("partial direction", L.direction, "BUY");
eq("partial duration min", Math.round((+L.lastTime - +L.firstTime) / 60000), 120);

// ── 8. netting reversal (INOUT) → two legs on ONE positionId ────────────
const reversal: MtHistoryDeal[] = [
  d({ id: "1", entry: "DEAL_ENTRY_IN", type: "DEAL_TYPE_BUY", volume: 1, price: 100, time: "2026-03-01T10:00:00Z", profit: 0 }),
  d({ id: "2", entry: "DEAL_ENTRY_INOUT", type: "DEAL_TYPE_SELL", volume: 2, price: 98, time: "2026-03-01T11:00:00Z", profit: -100 }),
  d({ id: "3", entry: "DEAL_ENTRY_OUT", type: "DEAL_TYPE_BUY", volume: 2, price: 96, time: "2026-03-01T13:00:00Z", profit: 300 }),
];
const rev = legsOfPosition(reversal);
eq("reversal → 2 legs", rev.legs.length, 2);
eq("leg0 closed", rev.legs[0].outVol, 1);
eq("leg0 direction BUY", rev.legs[0].direction, "BUY");
eq("leg0 profit", rev.legs[0].profit, -100);
eq("leg1 direction SELL", rev.legs[1].direction, "SELL");
eq("leg1 profit", rev.legs[1].profit, 300);
eq("leg1 inVol", rev.legs[1].inVol, 2);
eq("reversal fully closed", rev.openRemains, false);

// ── 9. still-open position is NOT journaled ─────────────────────────────
const openPos: MtHistoryDeal[] = [
  d({ id: "1", entry: "DEAL_ENTRY_IN", type: "DEAL_TYPE_BUY", volume: 1, price: 100, time: "2026-03-01T10:00:00Z" }),
  d({ id: "2", entry: "DEAL_ENTRY_OUT", type: "DEAL_TYPE_SELL", volume: 0.3, price: 101, time: "2026-03-01T11:00:00Z", profit: 10 }),
];
const op = legsOfPosition(openPos);
eq("open position produces no leg", op.legs.length, 0);
eq("open position flagged", op.openRemains, true);

// ── 10. scale-IN then full close ────────────────────────────────────────
const scaleIn: MtHistoryDeal[] = [
  d({ id: "1", entry: "DEAL_ENTRY_IN", type: "DEAL_TYPE_SELL", volume: 0.5, price: 200, time: "2026-03-01T10:00:00Z" }),
  d({ id: "2", entry: "DEAL_ENTRY_IN", type: "DEAL_TYPE_SELL", volume: 0.5, price: 202, time: "2026-03-01T10:30:00Z" }),
  d({ id: "3", entry: "DEAL_ENTRY_OUT", type: "DEAL_TYPE_BUY", volume: 1.0, price: 198, time: "2026-03-01T12:00:00Z", profit: 300 }),
];
const si = legsOfPosition(scaleIn);
eq("scale-in → 1 leg", si.legs.length, 1);
eq("scale-in VWAP entry", si.legs[0].inNotional / si.legs[0].inVol, 201);
eq("scale-in SELL direction", si.legs[0].direction, "SELL");

// ── 11. CSV import: synonyms, quoting, content-hash dedup ───────────────
const csv = [
  '"Instrument","Side","Lots","Open Price","Close Price","Open Time","Close Time","Profit","Commission","Swap","Currency","Strategy","Notes"',
  '"EURUSD","buy","0.5","1.1000","1.1050","2026-03-02 08:30","2026-03-02 10:15","250","-3.5","-1","USD","3EL Breakout","core winner, held plan"',
  '"XAUUSD","SELL","0.1","2380","2370","2026-03-03 13:00","2026-03-03 14:00","100,5","-7","0","USD","",""',
].join("\n");
const parsed = parseTradesCsv(csv);
eq("csv rows", parsed.rows.length, 2);
eq("csv errors", parsed.errors.length, 0);
eq("csv symbol", parsed.rows[0].symbol, "EURUSD");
eq("csv direction BUY", parsed.rows[0].direction, "BUY");
eq("csv XAU direction SELL", parsed.rows[1].direction, "SELL");
eq("csv net = profit+comm+swap", parsed.rows[0].netPnl, 245.5, 1e-9);
eq("csv thousands separator stripped", parsed.rows[1].grossProfit, 100.5, 1e-9);
eq("csv quoted comma note kept", parsed.rows[0].notes, "core winner, held plan");
eq("csv strategy mapped", parsed.rows[0].strategy, "3EL Breakout");
eq("csv stable hash", parsed.rows[0].extKey.startsWith("csv:"), true);
const reparsed = parseTradesCsv(csv);
eq("re-import same file → same keys (no dup)", reparsed.rows[0].extKey === parsed.rows[0].extKey, true);
eq("csv missing required col reported", parseTradesCsv("foo,bar\n1,2\n").errors.length > 0, true);

// ── 12. export round-trip: exported CSV re-imports without duplicates ───
const exportBook = [
  rec({ id: "x1", symbol: "EURUSD", direction: "BUY", netPnl: 123.45, commission: -2, tags: ["followed_plan"], notes: "note, with comma" }),
];
const exported = tradesToCsv(exportBook);
const roundTrip = parseTradesCsv(exported);
eq("round-trip rows", roundTrip.rows.length, 1);
eq("round-trip symbol", roundTrip.rows[0].symbol, "EURUSD");
eq("round-trip net", roundTrip.rows[0].netPnl, 123.45, 1e-9);
eq("round-trip note comma survived", roundTrip.rows[0].notes, "note, with comma");

console.log(`\n═══ JOURNAL CALC TESTS: ${pass} passed · ${fail} failed ═══`);
if (fail > 0) {
  console.log("FAILURES:\n" + failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
console.log("ALL CALCULATION TESTS GREEN ✓");
