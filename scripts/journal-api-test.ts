// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL API ACCURACY SMOKE (spec §14: P&L, win rate, PF, drawdown,
//  deposits vs profit, calendar, filters, export, dedup, user isolation)
//  Run: bun scripts/journal-api-test.ts  (needs dev server on :3000)
// ══════════════════════════════════════════════════════════════════════════

import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const email = (await Bun.file("scripts/.probe/email.txt").text()).trim();
const password = (await Bun.file("scripts/.probe/pass.txt").text()).trim();

let pass = 0;
let fail = 0;
const failures: string[] = [];
function eq(name: string, got: unknown, want: unknown, tol = 1e-6) {
  const ok =
    typeof want === "number" && typeof got === "number"
      ? Math.abs(got - want) <= tol
      : JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// ── login → session cookie ──
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: email, password }),
});
const login = (await loginRes.json()) as { ok: boolean };
eq("login ok", login.ok, true);
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!cookie) {
  console.log("FATAL: no session cookie — is the dev server running?");
  process.exit(1);
}
const H = { Cookie: cookie, "Content-Type": "application/json" };

// ── unauthenticated access is rejected (data privacy) ──
const anon = await fetch(`${BASE}/api/journal`);
eq("anonymous /api/journal → 401", anon.status, 401);

// ── clean slate ──
const before = (await (await fetch(`${BASE}/api/journal?pageSize=10`, { headers: H })).json()) as { total: number };
if (before.total > 0) {
  const list = (await (await fetch(`${BASE}/api/journal?pageSize=200`, { headers: H })).json()) as { trades: { id: string }[] };
  for (const t of list.trades) await fetch(`${BASE}/api/journal/trades/${t.id}`, { method: "DELETE", headers: H });
}

// ── deposit/withdrawal isolation: seed + clear demo refuses when non-empty (tested later);
//    here: manual trades with KNOWN numbers ──
//   t1 BUY  net +250 (gross 260, comm −7, swap −3)   closed Jan 10
//   t2 SELL net −120 (gross −110, comm −7, swap −3)  closed Jan 12
//   t3 BUY  net 0 (breakeven)                        closed Jan 15
//   t4 SELL net −80                                  closed Feb 03
//   month Jan: trades 3, net +130, wins 1, losses 1, BE 1, winRate 33.33%
//   grossProfit(Jan)=250, grossLoss=120, PF=2.0833, maxDD(Jan): 250→130 dip=120 → 120 (100% of peak 250? peak 250 → 120 → DD 130? recompute: cum 250, 130, 130 → peak 250, trough 130 → DD 120, pct 48%)
const mk = async (body: object) => {
  const res = await fetch(`${BASE}/api/journal`, { method: "POST", headers: H, body: JSON.stringify(body) });
  return (await res.json()) as { ok: boolean; error?: string; trade?: { id: string } };
};
const t1 = await mk({ symbol: "EURUSD", direction: "BUY", volume: 1, entryPrice: 1.1, exitPrice: 1.112, sl: 1.095, openedAt: "2026-01-10T09:00:00Z", closedAt: "2026-01-10T11:30:00Z", grossProfit: 260, commission: -7, swap: -3, currency: "USD", strategy: "Alpha", timeframe: "15m" });
eq("manual t1 created", t1.ok, true);
const t2 = await mk({ symbol: "XAUUSD", direction: "SELL", volume: 0.5, entryPrice: 2380, exitPrice: 2378.8, sl: 2382.4, openedAt: "2026-01-12T10:00:00Z", closedAt: "2026-01-12T13:00:00Z", grossProfit: -110, commission: -7, swap: -3 });
eq("manual t2 created", t2.ok, true);
const t3 = await mk({ symbol: "BTCUSD", direction: "BUY", volume: 0.1, entryPrice: 67000, exitPrice: 67000, openedAt: "2026-01-15T08:00:00Z", closedAt: "2026-01-15T09:00:00Z", grossProfit: 0 });
eq("manual t3 created", t3.ok, true);
const t4 = await mk({ symbol: "EURUSD", direction: "SELL", volume: 2, entryPrice: 1.09, exitPrice: 1.094, openedAt: "2026-02-03T10:00:00Z", closedAt: "2026-02-03T12:00:00Z", grossProfit: -80 });
eq("manual t4 created", t4.ok, true);
eq("manual validation rejects bad row", (await mk({ symbol: "", direction: "BUY", entryPrice: 1, exitPrice: 1, openedAt: "2026-01-01T00:00Z", closedAt: "2026-01-01T01:00Z" })).ok, false);

// ── stats accuracy: January only ──
const sJan = (await (await fetch(`${BASE}/api/journal/stats?period=custom&from=2026-01-01T00:00:00Z&to=2026-01-31T23:59:59Z&year=2026&month=0`, { headers: H })).json()) as {
  ok: boolean; core: Record<string, number>; calendar: { weeks: { day: string; net: number | null; trades: number }[][] };
};
eq("Jan trades", sJan.core.totalTrades, 3);
eq("Jan net", sJan.core.netPnl, 130);
eq("Jan wins", sJan.core.wins, 1);
eq("Jan losses", sJan.core.losses, 1);
eq("Jan breakeven", sJan.core.breakeven, 1);
eq("Jan winRate", sJan.core.winRatePct, 100 / 3, 1e-4);
eq("Jan grossProfit", sJan.core.grossProfit, 250);
eq("Jan grossLoss", sJan.core.grossLoss, 120);
eq("Jan PF", sJan.core.profitFactor, 250 / 120, 1e-6);
eq("Jan maxDD", sJan.core.maxDrawdown, 120);
eq("Jan maxDD%", sJan.core.maxDrawdownPct, 48, 1e-6);
eq("Jan costs", sJan.core.totalCosts, 20);
eq("Jan avgWin", sJan.core.avgWin, 250);
eq("Jan avgLoss", sJan.core.avgLoss, 120);
eq("Jan R count (2 trades with SL)", sJan.core.rCount, 2);
// calendar Jan 10 net 250
const jan10 = sJan.calendar.weeks.flat().find((c) => c.day === "2026-01-10");
eq("calendar Jan 10 net", jan10?.net ?? null, 250);
eq("calendar Jan 10 trades", jan10?.trades ?? 0, 1);

// ── R-multiple accuracy (price-based) ──
// t1: entry 1.1 sl 1.095 → risk 0.005; exit 1.112 → move +0.012 → R = 2.4
const list = (await (await fetch(`${BASE}/api/journal?pageSize=10`, { headers: H })).json()) as { trades: { id: string; symbol: string; rMultiple: number | null; netPnl: number; durationMin: number }[] };
const t1rec = list.trades.find((t) => t.symbol === "EURUSD" && t.durationMin === 150);
eq("t1 R-multiple 2.4", t1rec?.rMultiple ?? null, 2.4, 1e-6);
eq("t1 duration 150min", t1rec?.durationMin ?? 0, 150);

// ── filters ──
eq("filter EURUSD", ((await (await fetch(`${BASE}/api/journal?symbol=EURUSD`, { headers: H })).json()) as { total: number }).total, 2);
eq("filter winners", ((await (await fetch(`${BASE}/api/journal?outcome=win`, { headers: H })).json()) as { total: number }).total, 1);
eq("filter SELL", ((await (await fetch(`${BASE}/api/journal?direction=SELL`, { headers: H })).json()) as { total: number }).total, 2);
eq("filter strategy Alpha", ((await (await fetch(`${BASE}/api/journal?strategy=Alpha`, { headers: H })).json()) as { total: number }).total, 1);
eq("search notes-free symbol", ((await (await fetch(`${BASE}/api/journal?q=xau`, { headers: H })).json()) as { total: number }).total, 1);

// ── CSV export matches displayed records ──
const csvRes = await fetch(`${BASE}/api/journal/export?symbol=EURUSD`, { headers: H });
const csvText = await csvRes.text();
eq("export header", csvText.split("\n")[0].startsWith("Symbol,Direction"), true);
eq("export rows (2 EURUSD)", csvText.trim().split("\n").length - 1, 2);
eq("export contains net", csvText.includes("250"), true);

// ── CSV import round-trip + dedup ──
const importRes = await fetch(`${BASE}/api/journal/import`, {
  method: "POST",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ csv: "Symbol,Direction,Lots,Entry,Exit,Opened (UTC),Closed (UTC),Gross P&L,Commission\nGBPUSD,BUY,1,1.27,1.28,2026-03-02T08:00:00Z,2026-03-02T10:00:00Z,100,-3" }),
});
const imp = (await importRes.json()) as { ok: boolean; created: number };
eq("csv import ok", imp.ok, true);
eq("csv import created 1", imp.created, 1);
const importRes2 = await fetch(`${BASE}/api/journal/import`, {
  method: "POST",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ csv: "Symbol,Direction,Lots,Entry,Exit,Opened (UTC),Closed (UTC),Gross P&L,Commission\nGBPUSD,BUY,1,1.27,1.28,2026-03-02T08:00:00Z,2026-03-02T10:00:00Z,100,-3" }),
});
const imp2 = (await importRes2.json()) as { ok: boolean; created: number; skippedExisting: number };
eq("re-import deduped (0 created)", imp2.created, 0);
eq("re-import skippedExisting 1", imp2.skippedExisting, 1);

// ── demo data: refused while records exist (never mixed) ──
const demoRefused = await (await fetch(`${BASE}/api/journal/demo`, { method: "POST", headers: H, body: JSON.stringify({ action: "seed" }) })).json() as { ok: boolean };
eq("demo seed refused on non-empty journal", demoRefused.ok, false);

// ── user isolation: second account sees nothing ──
const regRes = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: `journal-iso-${Date.now()}@halotest.local`, password: "Isolation#2026x", fullName: "ISO Test", acceptTerms: true, acceptLicense: true }),
});
const reg = (await regRes.json()) as { ok: boolean };
eq("isolation account registered", reg.ok, true);
// auto-verify + activate session for the ISO user directly in DB
const db = new PrismaClient();
const isoUser = await db.user.findFirst({ where: { email: { startsWith: "journal-iso-" } }, orderBy: { createdAt: "desc" } });
await db.user.update({ where: { id: isoUser.id }, data: { emailVerifiedAt: new Date(), status: "ACTIVE" } });
await db.$disconnect();
const isoLogin = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: isoUser.email, password: "Isolation#2026x" }),
});
const isoCookie = isoLogin.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const isoList = (await (await fetch(`${BASE}/api/journal`, { headers: { Cookie: isoCookie } })).json()) as { total: number };
eq("other user sees ZERO journal rows", isoList.total, 0);

// ── review update (PATCH) ──
const patchRes = await fetch(`${BASE}/api/journal/trades/${t1.trade!.id}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({ notes: "clean breakout", tags: ["followed_plan", "disciplined"], review: { rating: 5, reasonEntry: "3EL break" } }),
});
const patched = (await patchRes.json()) as { ok: boolean; trade?: { tags: string[]; review: { rating?: number } } };
eq("patch ok", patched.ok, true);
eq("patch tags saved", patched.trade?.tags, ["followed_plan", "disciplined"]);
eq("patch rating saved", patched.trade?.review.rating, 5);

// ── sync status endpoint (honest pre-sync state) ──
const syncGet = (await (await fetch(`${BASE}/api/journal/sync`, { headers: H })).json()) as { ok: boolean; accounts: unknown[] };
eq("sync status ok", syncGet.ok, true);
eq("sync lists metaapi accounts", (syncGet.accounts as unknown[]).length >= 1, true);

// ── MT5 sync POST: runs against the real configured account; the assertion
//    is that it answers honestly (ok OR a real error), never fabricates ──
const syncPost = await fetch(`${BASE}/api/journal/sync`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ lookbackDays: 7 }),
});
const syncBody = (await syncPost.json()) as { ok: boolean; error?: string; result?: { tradesCreated: number; dealsSeen: number } };
console.log(`MT5 sync probe → ok=${syncBody.ok} status=${syncPost.status}${syncBody.error ? ` error="${syncBody.error.slice(0, 140)}"` : ` created=${syncBody.result?.tradesCreated} deals=${syncBody.result?.dealsSeen}`}`);
eq("sync answers with ok or explicit error", syncBody.ok === true || typeof syncBody.error === "string", true);

console.log(`\n═══ JOURNAL API TESTS: ${pass} passed · ${fail} failed ═══`);
if (fail > 0) {
  console.log("FAILURES:\n" + failures.map((f) => `  ✗ ${f}`).join("\n"));
  process.exit(1);
}
console.log("ALL API TESTS GREEN ✓");
