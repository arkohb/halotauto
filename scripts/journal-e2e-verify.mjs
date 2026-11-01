// ══════════════════════════════════════════════════════════════════════════
//  Independent recomputation of the journal stats payload — verifies the
//  server's numbers from the RAW trade list without reusing stats.ts.
//  Usage: node journal-e2e-verify.mjs <cookie-jar-path>
// ══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const jarPath = process.argv[2] ?? "/tmp/halo-e2e-cookies.txt";
const cookie = fs
  .readFileSync(jarPath, "utf8")
  .split("\n")
  .filter((l) => l.includes("halo_session"))
  .map((l) => l.split("\t")[6]?.trim())
  .filter(Boolean)
  .map((v) => `halo_session=${v}`)
  .join("; ");

const g = async (u) => (await fetch(u, { headers: { cookie }, cache: "no-store" })).json();
const list = await g("http://localhost:3000/api/journal?period=all&pageSize=200&page=1");
const stats = await g("http://localhost:3000/api/journal/stats?period=all");
const rows = list.trades ?? [];

// ── independent math ──────────────────────────────────────────────────────
const r2 = (v) => Math.round(v * 100) / 100;
const wins = rows.filter((t) => t.netPnl > 0);
const losses = rows.filter((t) => t.netPnl < 0);
const net = r2(rows.reduce((a, t) => a + t.netPnl, 0));
const gp = r2(wins.reduce((a, t) => a + t.netPnl, 0));
const gl = r2(Math.abs(losses.reduce((a, t) => a + t.netPnl, 0)));
const pf = gl > 0 ? gp / gl : gp > 0 ? Infinity : 0;
const ordered = [...rows].sort((a, b) => +new Date(a.closedAt) - +new Date(b.closedAt));
let cum = 0, peak = 0, dd = 0;
for (const t of ordered) { cum += t.netPnl; if (cum > peak) peak = cum; dd = Math.max(dd, peak - cum); }
const rVals = rows.map((t) => t.rMultiple).filter((v) => v !== null && isFinite(v));
const avgR = rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : null;

const c = stats.core;
const near = (a, b, tol = 0.02) => (isFinite(a) && isFinite(b) ? Math.abs(a - b) <= tol : a === b);
const pfSrv = c.profitFactor === null ? null : isFinite(c.profitFactor) ? c.profitFactor : Infinity;

const checks = [
  ["totalTrades", rows.length, c.totalTrades, (a, b) => a === b],
  ["wins", wins.length, c.wins, (a, b) => a === b],
  ["losses", losses.length, c.losses, (a, b) => a === b],
  ["netPnl", net, c.netPnl, near],
  ["grossProfit", gp, c.grossProfit, near],
  ["grossLoss", gl, c.grossLoss, near],
  ["profitFactor", pf, pfSrv, near],
  ["maxDrawdown", r2(dd), c.maxDrawdown, near],
  ["avgR", avgR === null ? null : r2(avgR), c.avgR, (a, b) => (a === null && b === null) || near(a, b, 0.01)],
  ["rCount", rVals.length, c.rCount, (a, b) => a === b],
];

// breakdown sums must add back to the total (every symbol is listed)
const bySymSum = r2(stats.bySymbol.reduce((a, r) => a + r.net, 0));
checks.push(["bySymbol Σ net = netPnl", net, bySymSum, near]);

// daily buckets must add back to the total
const dailySum = r2(stats.daily.reduce((a, d) => a + d.net, 0));
checks.push(["daily Σ net = netPnl", net, dailySum, near]);

// calendar grid cells must add back to THAT month's daily bucket sums
// (the grid shows the selected month — not the whole filtered range)
let calSum = 0, calTrades = 0;
for (const w of stats.calendar.weeks) for (const d of w) if (d.inMonth && d.net !== null) { calSum += d.net; calTrades += d.trades; }
const cmPrefix = `${stats.calendar.year}-${String(stats.calendar.month0 + 1).padStart(2, "0")}`;
const monthDaily = stats.daily.filter((d) => d.day.startsWith(cmPrefix));
const monthDailyNet = r2(monthDaily.reduce((a, d) => a + d.net, 0));
const monthDailyTrades = monthDaily.reduce((a, d) => a + d.trades, 0);
checks.push(["calendar Σ net = that month's daily Σ", monthDailyNet, r2(calSum), near]);
checks.push(["calendar Σ trades = that month's daily trades", monthDailyTrades, calTrades, (a, b) => a === b]);

// exercise the grid against a month that certainly HAS trades (latest closedAt),
// verifying month navigation feeds the server the right year/month
const latestMonth = ordered.length ? ordered[ordered.length - 1].closedAt.slice(0, 7) : cmPrefix;
const [yy, mm] = latestMonth.split("-").map(Number);
const statsM = await g(`http://localhost:3000/api/journal/stats?period=all&year=${yy}&month=${mm - 1}`);
let calSumM = 0, calTradesM = 0;
for (const w of statsM.calendar.weeks) for (const d of w) if (d.inMonth && d.net !== null) { calSumM += d.net; calTradesM += d.trades; }
const mDaily = statsM.daily.filter((d) => d.day.startsWith(latestMonth));
checks.push(["latest-month grid Σ net = daily Σ", r2(mDaily.reduce((a, d) => a + d.net, 0)), r2(calSumM), near]);
checks.push(["latest-month grid Σ trades = daily trades", mDaily.reduce((a, d) => a + d.trades, 0), calTradesM, (a, b) => a === b]);
checks.push(["latest-month grid has trades", true, calTradesM > 0, (a, b) => a === b]);
// when the ENTIRE dataset falls inside the displayed month, grid Σ must equal netPnl
if (rows.every((t) => t.closedAt.slice(0, 7) === latestMonth)) {
  checks.push(["single-month dataset: grid Σ = netPnl", net, r2(calSumM), near]);
}

// win rate
checks.push(["winRatePct", r2((wins.length / rows.length) * 100), r2(c.winRatePct), near]);

let pass = 0, fail = 0;
for (const [name, mine, srv, cmp] of checks) {
  const okv = cmp(mine, srv);
  if (okv) { pass++; console.log(`  ✓ ${name}: ${typeof mine === "number" ? r2(mine) : mine}`); }
  else { fail++; console.log(`  ✗ ${name}: independent=${mine} server=${srv}`); }
}
console.log(`  math verification: ${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
