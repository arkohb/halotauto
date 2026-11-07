// News blackout · session filter · prop-firm rules · spread guard — self-test.
//   npx tsx scripts/edge-filters-prop-test.ts
// Pure functions only: no DB, no network, no broker.
import { checkEntryFilters, newsBlackout, newsCurrencies, openSessions } from "../src/lib/edge/filters";
import { evaluateProp, propAllows, propDayKey, type PropState } from "../src/lib/edge/prop";
import { clampEdge, DEFAULT_EDGE, PROP_PRESETS, type PropSettings } from "../src/lib/edge/settings";
import { evaluateSpread } from "../src/lib/price-guard";
import type { EconEvent } from "../src/lib/halo/intel";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const at = (iso: string) => Date.parse(iso);

async function main() {
  // ── defaults: everything new is OFF ──
  const d = clampEdge({});
  ok(!d.filters.newsEnabled && !d.filters.sessionEnabled && !d.prop.enabled && !d.spread.enabled, "news, session, prop and spread are all OFF by default");
  ok(clampEdge({ prop: { dailyLossPct: 999, resetHourUtc: 40, preset: "bogus" } }).prop.dailyLossPct === 50, "settings are clamped (daily loss ≤ 50%)");
  ok(clampEdge({ prop: { resetHourUtc: 40 } }).prop.resetHourUtc === 23 && clampEdge({ prop: { preset: "bogus" } }).prop.preset === "custom", "bad hour / unknown preset fall back safely");

  // ── news currencies ──
  ok(JSON.stringify(newsCurrencies("EURUSD")) === '["EUR","USD"]', "EURUSD depends on EUR + USD news");
  ok(JSON.stringify(newsCurrencies("XAUUSD")) === '["USD"]', "gold depends on USD news");
  ok(JSON.stringify(newsCurrencies("GER40")) === '["EUR"]', "GER40 depends on EUR news");
  ok(newsCurrencies("V75S").length === 0 || newsCurrencies("BOOM300").length === 0, "Deriv synthetics have no news");

  // ── news blackout window ──
  const nfp: EconEvent = { title: "Non-Farm Employment Change", currency: "USD", impact: "high", date: "2026-11-06T13:30:00.000Z", forecast: "", previous: "", actual: "" };
  const cpi: EconEvent = { ...nfp, title: "CPI m/m", currency: "EUR", impact: "medium", date: "2026-11-06T10:00:00.000Z" };
  ok(newsBlackout([nfp], ["USD"], at("2026-11-06T13:05:00Z"), 30, 30, "high")?.title === nfp.title, "25 min before NFP → blacked out");
  ok(newsBlackout([nfp], ["USD"], at("2026-11-06T13:55:00Z"), 30, 30, "high") !== null, "25 min after NFP → blacked out");
  ok(newsBlackout([nfp], ["USD"], at("2026-11-06T12:55:00Z"), 30, 30, "high") === null, "35 min before NFP → allowed");
  ok(newsBlackout([nfp], ["EUR", "JPY"], at("2026-11-06T13:30:00Z"), 30, 30, "high") === null, "USD news does not block EURJPY");
  ok(newsBlackout([cpi], ["EUR"], at("2026-11-06T10:00:00Z"), 30, 30, "high") === null, "medium event ignored on 'high only'");
  ok(newsBlackout([cpi], ["EUR"], at("2026-11-06T10:00:00Z"), 30, 30, "med_high") !== null, "medium event counts on 'medium + high'");

  // ── sessions ──
  const all = { asia: true, london: true, newYork: true };
  ok(JSON.stringify(openSessions(at("2026-11-06T08:00:00Z"), all)) === '["asia","london"]', "08:00 UTC = Asia + London overlap");
  ok(openSessions(at("2026-11-06T22:00:00Z"), all).length === 0, "22:00 UTC = no session open");
  const londonOnly = { ...DEFAULT_EDGE.filters, sessionEnabled: true, sessions: { asia: false, london: true, newYork: false } };
  ok((await checkEntryFilters("EURUSD", londonOnly, at("2026-11-06T18:00:00Z"))).allow === false, "London-only filter refuses an 18:00 UTC entry");
  ok((await checkEntryFilters("EURUSD", londonOnly, at("2026-11-06T09:00:00Z"))).allow === true, "London-only filter allows a 09:00 UTC entry");
  const none = { ...londonOnly, sessions: { asia: false, london: false, newYork: false } };
  ok((await checkEntryFilters("EURUSD", none, at("2026-11-06T09:00:00Z"))).allow === false, "session filter with nothing selected refuses (never silently open)");

  // ── prop rules ──
  const ftmo: PropSettings = { ...DEFAULT_EDGE.prop, enabled: true, ...PROP_PRESETS.ftmo.rules, initialBalance: 100_000, bufferPct: 0 };
  const t0 = at("2026-11-06T09:00:00Z");
  let ev = evaluateProp(ftmo, null, { balance: 100_000, equity: 100_000 }, "acc1", t0);
  ok(ev.dailyFloor === 95_000 && ev.totalFloor === 90_000 && ev.breach === null, "FTMO 100k: daily floor 95,000, total floor 90,000");
  ev = evaluateProp(ftmo, ev.state, { balance: 100_000, equity: 95_400 }, "acc1", t0 + 60_000);
  ok(ev.breach === null, "equity 95,400 → still inside the daily limit");
  ev = evaluateProp(ftmo, ev.state, { balance: 100_000, equity: 94_990 }, "acc1", t0 + 120_000);
  ok(ev.breach === "daily", "equity 94,990 → DAILY limit hit");
  ok(!propAllows(ftmo, ev.state, t0 + 180_000).allow, "after a daily breach new trades are refused the same day");
  const nextDay = at("2026-11-07T01:00:00Z");
  ok(propAllows(ftmo, ev.state, nextDay).allow, "next prop-firm day → trading allowed again");
  const ev2 = evaluateProp(ftmo, ev.state, { balance: 95_000, equity: 95_000 }, "acc1", nextDay);
  ok(ev2.state.dayStartBalance === 95_000 && ev2.dailyFloor === 90_000, "new day re-anchors: start 95,000 − 5% of initial → floor 90,000");
  ok(evaluateProp(ftmo, ev2.state, { balance: 95_000, equity: 89_900 }, "acc1", nextDay + 60_000).breach === "total", "equity under 90,000 → TOTAL limit hit");

  const buf: PropSettings = { ...ftmo, bufferPct: 0.5 };
  const eb = evaluateProp(buf, null, { balance: 100_000, equity: 100_000 }, "acc1", t0);
  ok(evaluateProp(buf, eb.state, { balance: 100_000, equity: 95_400 }, "acc1", t0 + 1).breach === "daily", "0.5% buffer acts at 95,500 — before the 95,000 hard limit");

  const fn: PropSettings = { ...ftmo, ...PROP_PRESETS.fundednext.rules };
  const e3 = evaluateProp(fn, null, { balance: 100_000, equity: 102_000 }, "acc1", t0);
  ok(e3.dailyFloor === 102_000 - 0.05 * 102_000, "FundedNext style: 5% of the higher of start balance/equity (102,000 → 96,900)");

  const trail: PropSettings = { ...ftmo, maxLossMode: "trailing" };
  let et = evaluateProp(trail, null, { balance: 100_000, equity: 100_000 }, "acc1", t0);
  et = evaluateProp(trail, et.state, { balance: 104_000, equity: 104_000 }, "acc1", t0 + 1);
  ok(et.totalFloor === 94_000, "trailing: peak 104,000 − 10,000 → floor 94,000");
  et = evaluateProp(trail, et.state, { balance: 130_000, equity: 130_000 }, "acc1", t0 + 2);
  ok(et.totalFloor === 100_000, "trailing floor stops at the initial balance");

  const auto = evaluateProp({ ...ftmo, initialBalance: 0 }, null, { balance: 50_000, equity: 50_000 }, "acc1", t0);
  ok(auto.state.initialBalance === 50_000 && auto.totalFloor === 45_000, "initial balance 0 → first balance seen (50,000)");
  const switched = evaluateProp(ftmo, { ...ev.state, breachTotal: true } as PropState, { balance: 100_000, equity: 100_000 }, "acc2", t0);
  ok(!switched.state.breachTotal && switched.state.accountId === "acc2", "a different broker account starts fresh");
  ok(propDayKey(at("2026-11-06T21:30:00Z"), 22) === "2026-11-05" && propDayKey(at("2026-11-06T22:30:00Z"), 22) === "2026-11-06", "day key follows the prop firm's reset hour");

  // ── spread & slippage ──
  const lim = { enabled: true, maxSpreadPips: 3, maxSpreadSlPct: 25, maxSlippagePips: 5 };
  const pip = 0.1; // gold
  ok(evaluateSpread({ entry: 4000, sl: 3990, dir: 1, quote: { bid: 4000.0, ask: 4000.2 }, pip, limits: lim }).ok, "gold spread 2 pips, SL 100 pips → allowed");
  ok(!evaluateSpread({ entry: 4000, sl: 3990, dir: 1, quote: { bid: 4000.0, ask: 4000.5 }, pip, limits: lim }).ok, "spread 5 pips > 3 pip limit → refused");
  ok(!evaluateSpread({ entry: 4000, sl: 3999, dir: 1, quote: { bid: 4000.0, ask: 4000.29 }, pip, limits: { ...lim, maxSpreadPips: 0 } }).ok, "spread 29% of a 10-pip stop → refused (limit 25%)");
  ok(!evaluateSpread({ entry: 4000, sl: 3990, dir: 1, quote: { bid: 4000.8, ask: 4001.0 }, pip, limits: lim }).ok, "BUY ask 10 pips above the order price → slippage refused");
  ok(evaluateSpread({ entry: 4000, sl: 4010, dir: -1, quote: { bid: 3999.7, ask: 3999.9 }, pip, limits: lim }).ok, "SELL bid 3 pips from the order price → allowed");
  ok(!evaluateSpread({ entry: 4000, sl: 3990, dir: 1, quote: null, pip, limits: lim }).ok, "no quote → refused");

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main();
