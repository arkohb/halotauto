// EDGE self-test — pure logic, no DB, no network.
//   npx tsx scripts/edge-selftest.ts
// Checks: trade-manager off = identical results to the classic engine,
// break-even / partial / trail behave, grades stay in range, guardian rules
// fire, Monte Carlo is deterministic, the 486-grid is the right size.
import { HaloEngine } from "@/lib/halo/engine";
import { DEFAULT_CONFIG, DEFAULT_TRADE_MANAGER, type Candle, type TradeSnapshot } from "@/lib/halo/types";
import { buildQualitySeries, gradeFire } from "@/lib/edge/quality";
import { guardianCheck, monteCarlo } from "@/lib/edge/guardian";
import { runSim, summarize, gradeTable } from "@/lib/edge/simulate";
import { gridCombos } from "@/lib/edge/autopilot";
import { DEFAULT_EDGE } from "@/lib/edge/settings";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};

// deterministic random-walk candles (5m)
function candles(n: number, seed = 7): Candle[] {
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const out: Candle[] = [];
  let px = 2000;
  const t0 = Date.UTC(2025, 0, 6, 0, 0);
  for (let i = 0; i < n; i++) {
    const o = px;
    const drift = Math.sin(i / 150) * 0.6;
    const c = o + (rnd() - 0.5 + drift * 0.05) * 6;
    const h = Math.max(o, c) + rnd() * 3;
    const l = Math.min(o, c) - rnd() * 3;
    out.push({ time: t0 + i * 300_000, open: o, high: h, low: l, close: c });
    px = c;
  }
  return out;
}

const cs = candles(6000);
const series = buildQualitySeries(cs, 300_000);
const cfg = { ...DEFAULT_CONFIG, slMode: "atr" as const, slATRm: 1.5, rrMult: 2 };

// 1 · TM off reproduces the classic engine exactly
{
  const e = new HaloEngine(cfg, 0.01);
  let wins = 0;
  let losses = 0;
  for (const c of cs)
    for (const ev of e.processBar(c, true)) {
      if (ev.type === "win") wins++;
      else if (ev.type === "loss") losses++;
    }
  const sim = summarize(runSim(series, { cfg, mintick: 0.01 })).summary;
  ok(sim.trades === wins + losses && sim.wins === wins, `baseline sim matches engine (${wins}W/${losses}L, sim ${sim.wins}W/${sim.losses}L)`);
  ok(sim.trades > 20, `enough trades to test (${sim.trades})`);
}

// 2 · trade manager steps
{
  const e = new HaloEngine(cfg, 0.01);
  e.tm = { ...DEFAULT_TRADE_MANAGER, enabled: true, beAtR: 1, partialAtR: 1.5, partialPct: 50, trailStartR: 1.8, trailATR: 1 };
  const t: TradeSnapshot = { dir: 1, entry: 100, sl: 90, tp: 120, risk: 10, riskPips: 100, rewardPips: 200, entryTime: 0, ext: 89, levelTop: 101, levelBot: 99, trigger: 100, slModeLabel: "ATR" };
  e.state.trade = t;
  e.state.atr = 2;
  e.state.barIndex = 10;
  const bar = (time: number, high: number, low: number): Candle => ({ time, open: low, high, low, close: high });
  let ev = e.processBar(bar(1, 111, 101), true);
  ok(ev.some((x) => x.type === "manage" && x.action === "breakeven") && e.state.trade!.sl > 100, `break-even after 1R (sl ${e.state.trade?.sl.toFixed(2)})`);
  ev = e.processBar(bar(2, 119, 108), true);
  ok(ev.some((x) => x.type === "manage" && x.action === "partial") && e.state.trade!.partialDone === true, "partial close at 1.5R");
  ok(ev.some((x) => x.type === "manage" && x.action === "trail"), `trailing engaged (sl ${e.state.trade?.sl.toFixed(2)})`);
  const slNow = e.state.trade!.sl;
  ev = e.processBar(bar(3, 115, slNow - 0.5), true);
  const close = ev.find((x) => x.type === "win" || x.type === "loss");
  ok(!!close && close.type === "win" && close.reason === "managed", `managed stop books a WIN (${close && "pips" in close ? close.pips.toFixed(1) : "?"} pips)`);
  ok(e.state.trade === null, "trade closed");
}

// 3 · grades
{
  const e = new HaloEngine(cfg, 0.01);
  const scores: number[] = [];
  cs.forEach((c, i) => {
    for (const ev of e.processBar(c, true)) if (ev.type === "fire") scores.push(gradeFire(series, i, ev).score);
  });
  ok(scores.length > 0 && scores.every((s) => s >= 0 && s <= 100), `grades in 0..100 (n=${scores.length}, min ${Math.min(...scores)}, max ${Math.max(...scores)})`);
  const gated = summarize(runSim(series, { cfg, mintick: 0.01, quality: { minScore: 60, gradeSizing: false, sizeByGrade: DEFAULT_EDGE.quality.sizeByGrade } })).summary;
  ok(gated.skipped === scores.filter((s) => s < 60).length, `min-score gate skips exactly the weak fires (${gated.skipped})`);
  const tbl = gradeTable(runSim(series, { cfg, mintick: 0.01 }));
  ok(tbl.reduce((a, r) => a + r.trades, 0) > 0, "grade table populated");
}

// 4 · guardian
{
  const now = Date.UTC(2025, 5, 2, 15);
  const g = { ...DEFAULT_EDGE.guardian, dailyLossR: 2, dailyTradeCap: 3, streakLosses: 3, streakPauseMin: 60 };
  const day = Date.UTC(2025, 5, 2, 9);
  const loss = (k: number) => ({ openedAt: day + k * 60_000, closedAt: day + k * 60_000 + 30_000, r: -1 });
  ok(guardianCheck([loss(0), loss(1)], now, g).allow === false, "daily loss limit blocks at −2R");
  ok(/cap/.test(guardianCheck([{ ...loss(0), r: 1 }, { ...loss(1), r: 1 }, { ...loss(2), r: 1 }], now, g).reason), "daily trade cap blocks the 4th order");
  const y = Date.UTC(2025, 5, 1, 23);
  const streak = [0, 1, 2].map((k) => ({ openedAt: y + k * 60_000, closedAt: now - 10 * 60_000 + k, r: -0.5 }));
  ok(/paused/.test(guardianCheck(streak, now, { ...g, dailyLossR: 0 }).reason), "3-loss streak pauses");
  const dd = Array.from({ length: 8 }, (_, k) => ({ openedAt: y - k * 1e7, closedAt: y - k * 1e7 + 1, r: -1 }));
  ok(guardianCheck(dd, now, { ...g, streakLosses: 0 }).sizeMult === g.ddCut1Mult, "drawdown cuts size");
  const a = monteCarlo([1, -1, 2, -1, -1, 3, -1], { ruinR: 10 });
  const b = monteCarlo([1, -1, 2, -1, -1, 3, -1], { ruinR: 10 });
  ok(!!a && a.ruinProb === b!.ruinProb && a.bands.length > 10, `Monte Carlo deterministic (ruin ${(a!.ruinProb * 100).toFixed(1)}%)`);
}

// 5 · autopilot grid
ok(gridCombos().length === 486, `autopilot grid = ${gridCombos().length} combinations`);
{
  const t0 = Date.now();
  for (const p of gridCombos().slice(0, 20)) runSim(series, { cfg: { ...cfg, rrMult: p.rrMult, slATRm: p.slATRm }, mintick: 0.01 });
  const ms = (Date.now() - t0) / 20;
  ok(ms < 400, `one combination replays 6000 bars in ${ms.toFixed(0)} ms (486 ≈ ${((ms * 486) / 1000).toFixed(1)} s)`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
