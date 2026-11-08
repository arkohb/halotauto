// End-to-end fire tests on a THROWAWAY COPY of the database — never the real
// one, never a live order (execution forced to paper, alerts disabled).
//   1. TradingView webhook close: alert price wins, SL…TP band bounds it
//   2. Scanner Bot: signal → paper trade → global lock → close → booked → unlocked
//   3. Pine strategy: real compile + runtime on live V75 1m bars → open → close
//      → booked → lock released (regression: Pine closes never released it)
//   npx tsx scripts/fire-e2e-test.ts
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "halo-fire-"));
const dbFile = path.join(dir, "test.db");
copyFileSync(path.join(process.cwd(), "db/custom.db"), dbFile);
process.env.DATABASE_URL = `file:${dbFile}`;

let fails = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`, c ? "" : JSON.stringify(extra ?? ""));
  if (!c) fails++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms: number, step = 500): Promise<T | null> {
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
  // isolation: paper only, no outbound alerts, history already booked, clean demo balance
  await db.botConfig.update({ where: { id: "main" }, data: { executionMode: "paper", sizingMode: "fixed", sizeFixed: 0.1 } });
  await db.alertSettings.updateMany({ data: { telegramEnabled: false, emailEnabled: false } });
  await db.trade.updateMany({ where: { status: "OPEN" }, data: { status: "VOID", closedAt: new Date() } });
  await db.trade.updateMany({ data: { pnlBooked: true } });
  await db.paperAccount.deleteMany({});
  // the Capital Guardian's daily trade cap counts trades opened today — push
  // this copy's history back 3 days so each section starts under the cap
  const ageHistory = () => db.$executeRawUnsafe("UPDATE Trade SET openedAt = openedAt - 259200000, closedAt = CASE WHEN closedAt IS NULL THEN NULL ELSE closedAt - 259200000 END");
  await ageHistory();
  const pa = await import("../src/lib/paper-account");
  const lockMod = await import("../src/lib/trade-lock");
  const { getKlines, getSymbolMeta } = await import("../src/lib/market");
  const { loadExecSettings } = await import("../src/lib/execution");

  const onlyPine = process.env.E2E_ONLY === "pine";
  const { subscribeBotEvents } = await import("../src/lib/halo/event-bus");
  const events: string[] = [];
  subscribeBotEvents((e) => events.push(`${e.kind}: ${e.title}${e.title.startsWith("EDGE") ? " — " + (e.spoken ?? "") : ""}`));
  if (!onlyPine) {
  // ── 1 · TradingView close ────────────────────────────────────────────
  console.log("\n— 1 · TradingView webhook close —");
  const tv = await import("../src/lib/tv-webhook");
  const mkTv = (id: string) =>
    db.trade.create({
      data: { id, mode: "TV", execMode: "PAPER", symbol: "XAUUSD", timeframe: "5m", direction: -1, entry: 4152.5, sl: 4165, tp: 4115, riskPips: 125, rewardPips: 375, status: "OPEN", levelTop: 0, levelBot: 0, slMode: "Webhook alert", note: "HALO 3EL SELL", openedAt: new Date() },
    });
  const closeAlert = (price: number) => ({ action: "close" as const, symbol: "XAUUSD", rawSymbol: "XAUUSD", tf: "5m", price, sl: 0, tp: 0, riskPips: 0, comment: "" });
  await mkTv("tv_a");
  await tv.processTvAlert(closeAlert(4140), { forcePaper: true });
  const a = await db.trade.findUnique({ where: { id: "tv_a" } });
  ok(a?.status === "WIN" && Math.abs((a?.resultPips ?? 0) - 125) < 1e-6, "close books the ALERT's price: SELL 4152.5 → 4140 = +125 pips", a);
  await mkTv("tv_b");
  await tv.processTvAlert(closeAlert(3859.15), { forcePaper: true });
  const b = await db.trade.findUnique({ where: { id: "tv_b" } });
  ok(b?.status === "WIN" && Math.abs((b?.resultPips ?? 0) - 375) < 1e-6, "a price far past TP is bounded by the SL…TP band: +375 pips, never +2933.5", b);
  await mkTv("tv_c");
  await tv.processTvAlert(closeAlert(4300), { forcePaper: true });
  const c = await db.trade.findUnique({ where: { id: "tv_c" } });
  ok(c?.status === "LOSS" && Math.abs((c?.resultPips ?? 0) - 125) < 1e-6, "a price far past SL is bounded at the SL: −125 pips", c);
  await db.trade.updateMany({ where: { id: { in: ["tv_a", "tv_b", "tv_c"] } }, data: { pnlBooked: true } });
  await db.paperAccount.deleteMany({});

  // ── 2 · Scanner Bot fire ─────────────────────────────────────────────
  console.log("\n— 2 · Scanner Bot fire (V75 1m, real Deriv prices) —");
  const k = await getKlines("V75", "1m", 50, { fresh: true });
  ok(k.source === "deriv", `feed for V75 is real Deriv (source=${k.source})`);
  const pip = getSymbolMeta("V75").mintick * 10;
  const px = k.candles[k.candles.length - 1].close;
  const risk = px * 0.002;
  const fire = {
    type: "fire" as const, dir: 1 as const, entry: px, sl: px - risk, tp: px + 3 * risk, risk,
    riskPips: risk / pip, rewardPips: (3 * risk) / pip, levelTop: px, levelBot: px, ext: px, time: Date.now(), message: "e2e test fire",
  };
  const { __tfScannerTest: T } = await import("../src/lib/tf-scanner");
  const row = T.makeRow("V75", "1m", await T.currentCfg());
  T.handleEvents(row, [fire]);
  const opened = await waitFor(() => db.trade.findFirst({ where: { mode: "SCAN", symbol: "V75", status: "OPEN" } }), 15_000);
  const why = opened ? null : await db.trade.findFirst({ where: { symbol: "V75" }, orderBy: { createdAt: "desc" } });
  ok(!!opened, "the scanner signal becomes a PAPER trade row (price guard + EDGE gate passed)", why ? { status: why.status, note: why.note } : undefined);
  if (opened) {
    const lk = lockMod.getTradeLock();
    ok(lk?.source === "SCAN" && lk.tradeDbId === opened.id, "the global trade lock engages on that trade", lk);
    const bal0 = (await pa.getPaperAccount()).balance;
    T.handleEvents(row, [{ type: "win", pips: fire.rewardPips, entry: fire.entry, sl: fire.sl, tp: fire.tp, time: Date.now(), message: "e2e TP", reason: "tp" }]);
    const closed = await waitFor(async () => {
      const t = await db.trade.findUnique({ where: { id: opened.id } });
      return t && t.status === "WIN" && t.pnlBooked ? t : null;
    }, 10_000);
    ok(!!closed, "TP closes the trade as WIN and books it", closed);
    ok(lockMod.getTradeLock() === null, "the global trade lock is released");
    const bal1 = (await pa.getPaperAccount()).balance;
    const vol = pa.paperVolumeOf(await loadExecSettings(), fire.riskPips, bal0) * (opened.sizeMult > 0 ? opened.sizeMult : 1);
    const expect = Math.round(fire.rewardPips * 10 * vol * 100) / 100;
    ok(Math.abs(bal1 - bal0 - expect) < 0.011, `demo balance +$${expect.toFixed(2)} (${bal0} → ${bal1})`);
  }

  }
  await ageHistory();

  // ── 3 · Pine strategy fire ───────────────────────────────────────────
  console.log("\n— 3 · Pine strategy (live V75 1m bars; takes 1–3 minutes) —");
  const g = globalThis as unknown as { __haloBotProbe?: () => unknown };
  g.__haloBotProbe = () => ({ enabled: true, pauseNew: false, symbol: "V75", tf: "1m" });
  const store = await import("../src/lib/strategy-store");
  const src = `//@version=5
strategy("HALO e2e probe", overlay=true)
if bar_index % 2 == 0
    strategy.entry("L", strategy.long)
else
    strategy.close("L")
`;
  const saved = await store.compileAndSave({ name: "HALO e2e probe", pineSource: src, useSlATR: true, slATRm: 1.5, rrMult: 3 });
  ok(saved.row.status === "compiled", "the probe strategy compiles", saved.compile);
  const pine = await import("../src/lib/pine-bot");
  const act = await pine.activatePineStrategy(saved.row.id);
  ok(act.ok, "the strategy activates", act);
  let lastDiag = 0;
  const pineOpen = await waitFor(async () => {
    await pine.tickPine(true);
    if (Date.now() - lastDiag > 20_000) {
      lastDiag = Date.now();
      const info = pine.getPineBotInfo();
      const intents = await db.executionIntent.findMany({ where: { state: { not: "CLOSED" } }, select: { state: true, source: true, symbol: true } });
      console.log("  diag", JSON.stringify({ warmed: info.warmed, sym: info.symbol, tf: info.tf, pos: info.position, lock: lockMod.getTradeLock()?.symbol ?? null, intents, events: events.splice(0) }));
    }
    return db.trade.findFirst({ where: { mode: "BOT", slMode: { startsWith: "Pine" }, symbol: "V75" }, orderBy: { createdAt: "desc" } });
  }, 240_000, 4000);
  const rej = pineOpen ? null : await db.trade.findFirst({ where: { symbol: "V75" }, orderBy: { createdAt: "desc" } });
  ok(!!pineOpen && pineOpen.status === "OPEN", "a Pine entry becomes a PAPER trade row", pineOpen ?? (rej ? { status: rej.status, note: rej.note } : null));
  if (pineOpen && pineOpen.status === "OPEN") {
    const lk = lockMod.getTradeLock();
    ok(lk?.tradeDbId === pineOpen.id && lk.source === "BOT", "the global trade lock engages on the Pine trade", lk);
    const closed = await waitFor(async () => {
      await pine.tickPine(true);
      const t = await db.trade.findUnique({ where: { id: pineOpen.id } });
      return t && t.status !== "OPEN" ? t : null;
    }, 240_000, 4000);
    ok(!!closed, "the Pine exit closes the trade", closed ? { status: closed.status, pips: closed.resultPips, note: closed.note } : null);
    if (closed) {
      const booked = await waitFor(async () => (await db.trade.findUnique({ where: { id: pineOpen.id } }))?.pnlBooked, 5_000);
      ok(!!booked, "the Pine close is booked to the demo balance");
      const lk2 = lockMod.getTradeLock();
      ok(!lk2 || lk2.tradeDbId !== pineOpen.id, "the global trade lock is released after the Pine close", lk2);
    }
  }
  await pine.deactivatePineStrategy().catch(() => {});
}

main()
  .catch((e) => {
    console.error(e);
    fails++;
  })
  .finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true }); // the throwaway DB copy only
    } catch {
      // ignore
    }
    console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
    process.exit(fails ? 1 : 0);
  });
