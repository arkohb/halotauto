// Trading Activity / Quick Actions / Control Deck wiring — end-to-end on a
// THROWAWAY COPY of the database (paper only, alerts off, never a live order).
//   1. a Scanner Bot trade is listed as a running position
//   2. MODIFY SL/TP: wrong-side levels refused; valid levels move engine +
//      trade book + global lock
//   3. CLOSE (one trade) closes it through the scanner, books it, unlocks
//   4. PAUSE NEW ENTRIES refuses a fire from the scanner (not just the bot)
//   5. CONTROL DECK CLOSE (closeAnyRunningTrade) reaches a scanner trade
//   6. a trade restored after a RESTART is listed, amendable and closable
//   npx tsx scripts/activity-e2e-test.ts
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "halo-activity-"));
const dbFile = path.join(dir, "test.db");
copyFileSync(path.join(process.cwd(), "db/custom.db"), dbFile);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.HALO_TRADING_SYMBOLS = "XAUUSD,V75"; // V75 trades 24/7 (Deriv)

let fails = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`, c ? "" : JSON.stringify(extra ?? ""));
  if (!c) fails++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms: number, step = 400): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v as T;
    await sleep(step);
  }
  return null;
}

async function main() {
  const { db } = await import("../src/lib/db");
  await db.botConfig.update({ where: { id: "main" }, data: { executionMode: "paper", sizingMode: "fixed", sizeFixed: 0.1, pauseNew: false, enabled: false } });
  await db.alertSettings.updateMany({ data: { telegramEnabled: false, emailEnabled: false } });
  await db.trade.updateMany({ where: { status: "OPEN" }, data: { status: "VOID", closedAt: new Date() } });
  await db.trade.updateMany({ data: { pnlBooked: true } });
  await db.executionLock.updateMany({ data: { intentId: null } });
  await db.executionIntent.updateMany({ where: { state: { in: ["PENDING", "SUBMITTING", "OPEN", "UNCERTAIN"] } }, data: { state: "CLOSED" } });
  await db.paperAccount.deleteMany({});
  await db.$executeRawUnsafe("UPDATE Trade SET openedAt = openedAt - 259200000, closedAt = CASE WHEN closedAt IS NULL THEN NULL ELSE closedAt - 259200000 END");

  const L = await import("../src/lib/trade-lock");
  const { getKlines, getSymbolMeta } = await import("../src/lib/market");
  const { __tfScannerTest: T } = await import("../src/lib/tf-scanner");
  const { closeAnyRunningTrade } = await import("../src/lib/bot");

  const k = await getKlines("V75", "1m", 50, { fresh: true });
  const pip = getSymbolMeta("V75").mintick * 10;
  const px = k.candles[k.candles.length - 1].close;
  const risk = px * 0.002;

  // open a real Scanner Bot paper trade on a row the scanner runtime holds
  const openScanTrade = async (key: string) => {
    const fire = {
      type: "fire" as const, dir: 1 as const, entry: px, sl: px - risk, tp: px + 3 * risk, risk,
      riskPips: risk / pip, rewardPips: (3 * risk) / pip, levelTop: px, levelBot: px, ext: px, time: Date.now(), message: "e2e test fire",
    };
    const row = T.makeRow("V75", "1m", await T.currentCfg());
    T.rt().rows.set(key, row);
    row.lastPrice = px;
    // the engine's own open trade (what processBar sets on a real fire)
    row.engine.state.trade = {
      dir: 1, entry: px, sl: fire.sl, tp: fire.tp, risk, riskPips: fire.riskPips, rewardPips: fire.rewardPips,
      entryTime: Date.now(), ext: px, levelTop: px, levelBot: px, trigger: px, slModeLabel: "Break extreme + buffer", traded: true,
    };
    T.handleEvents(row, [fire]);
    const opened = await waitFor(async () => (row.openTradeDbId ? db.trade.findUnique({ where: { id: row.openTradeDbId } }) : null), 15_000);
    return { row, fire, opened };
  };

  // ── 1 · listed ───────────────────────────────────────────────────────
  console.log("\n— 1 · Scanner Bot trade appears in the running book —");
  const { row, fire, opened } = await openScanTrade("V75|1m|e2e");
  ok(!!opened && opened.status === "OPEN", "the scanner fire opened a PAPER trade row", opened);
  if (!opened) throw new Error("cannot continue without an open trade");
  const listed = L.listRunningPositions();
  const mine = listed.find((p) => p.dbId === opened.id);
  ok(!!mine && mine.source === "SCAN" && mine.symbol === "V75" && mine.tf === "1m" && mine.dir === 1, "listRunningPositions() reports it (source SCAN, V75 1m BUY)", listed);

  // ── 2 · modify SL/TP ─────────────────────────────────────────────────
  console.log("\n— 2 · MODIFY SL/TP —");
  const bad = await L.amendRunningTrade(opened.id, px + risk, null);
  ok(!bad.ok && /below/.test(bad.error ?? ""), "an SL above price on a BUY is refused", bad);
  const nsl = Math.round((px - risk / 2) * 100) / 100;
  const ntp = Math.round((px + 2 * risk) * 100) / 100;
  const good = await L.amendRunningTrade(opened.id, nsl, ntp);
  ok(good.ok && good.broker === "paper", "valid SL/TP accepted (paper)", good);
  const t2 = await db.trade.findUnique({ where: { id: opened.id } });
  ok(t2?.sl === nsl && t2?.tp === ntp, "trade book row carries the new SL/TP", { sl: t2?.sl, tp: t2?.tp });
  const es = row.engine.snapshot().trade;
  ok(es?.sl === nsl && es?.tp === ntp, "the scanner engine now manages the new SL/TP", es);
  const lk = L.getTradeLock();
  ok(lk?.sl === nsl && lk?.tp === ntp, "the global lock (chart TP/SL boxes) shows the new SL/TP", lk);

  // ── 3 · close one ────────────────────────────────────────────────────
  console.log("\n— 3 · CLOSE the trade —");
  row.lastPrice = px + risk / 4; // a small winner
  const closedOk = await L.closeRunningTrade(opened.id);
  ok(closedOk, "closeRunningTrade() found the scanner trade and closed it");
  const t3 = await waitFor(async () => {
    const t = await db.trade.findUnique({ where: { id: opened.id } });
    return t && t.status !== "OPEN" && t.pnlBooked ? t : null;
  }, 10_000);
  ok(t3?.status === "WIN", "booked as WIN at the market price and P&L booked to the demo balance", t3);
  ok(L.getTradeLock() === null, "the global trade lock released — scanning resumes");
  ok(!L.listRunningPositions().some((p) => p.dbId === opened.id), "the trade left the running book");
  T.rt().rows.delete("V75|1m|e2e");

  // ── 4 · pause new entries ────────────────────────────────────────────
  console.log("\n— 4 · PAUSE NEW ENTRIES reaches the scanner —");
  L.setEntriesPaused(true);
  const { executeFire, loadExecSettings } = await import("../src/lib/execution");
  const refused = await executeFire({ source: "SCAN", symbol: "V75", tf: "1m", fire: { ...fire, time: Date.now() }, levelTop: px, levelBot: px, slModeLabel: "e2e", exec: await loadExecSettings() });
  ok(refused === null && L.getTradeLock() === null, "executeFire refuses a scanner fire while paused", refused);
  L.setEntriesPaused(false);

  // ── 5 · Control Deck CLOSE ───────────────────────────────────────────
  console.log("\n— 5 · Control Deck CLOSE reaches a scanner trade —");
  const s5 = await openScanTrade("V75|1m|e2e5");
  ok(!!s5.opened, "a second scanner trade opened", s5.opened);
  if (s5.opened) {
    const n = await closeAnyRunningTrade();
    ok(n >= 1, `closeAnyRunningTrade() closed it (chart bot was flat) — ${n}`);
    const t5 = await waitFor(async () => {
      const t = await db.trade.findUnique({ where: { id: s5.opened!.id } });
      return t && t.status !== "OPEN" ? t : null;
    }, 10_000);
    ok(!!t5 && L.getTradeLock() === null, "trade closed and lock released", t5);
  }
  T.rt().rows.delete("V75|1m|e2e5");

  // ── 6 · restored after restart ───────────────────────────────────────
  console.log("\n— 6 · trade restored after a restart —");
  const s6 = await openScanTrade("V75|1m|e2e6");
  ok(!!s6.opened, "a third scanner trade opened", s6.opened);
  if (s6.opened) {
    // simulate the restart: the scanner runtime forgets it, the in-memory lock is gone
    T.rt().rows.delete("V75|1m|e2e6");
    (globalThis as unknown as { __haloTradeLock?: unknown }).__haloTradeLock = null;
    (globalThis as unknown as { __haloExecReconciled?: unknown }).__haloExecReconciled = undefined;
    const { ensureReconciled } = await import("../src/lib/exec-lock");
    await ensureReconciled();
    ok(L.getTradeLock()?.tradeDbId === s6.opened.id, "the restart monitor restored the lock for it");
    const r6 = L.listRunningPositions().find((p) => p.dbId === s6.opened!.id);
    ok(!!r6 && r6.price > 0, "it is listed as a running position with a live price", r6);
    const a6 = await L.amendRunningTrade(s6.opened.id, Math.round((px - risk * 0.8) * 100) / 100, null);
    ok(a6.ok, "MODIFY SL works on the restored trade", a6);
    const i6 = await db.executionIntent.findFirst({ where: { tradeId: s6.opened.id } });
    ok(i6?.sl === Math.round((px - risk * 0.8) * 100) / 100, "the restart monitor watches the new SL", i6?.sl);
    const c6 = await L.closeRunningTrade(s6.opened.id);
    const t6 = await db.trade.findUnique({ where: { id: s6.opened.id } });
    ok(c6 && t6?.status !== "OPEN" && L.getTradeLock() === null, "CLOSE works on the restored trade and releases the lock", t6);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}  (throwaway DB: ${dbFile})`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
