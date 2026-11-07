// Persistent execution lock — concurrency, duplicate and restart test.
//   npx tsx scripts/exec-lock-concurrency-test.ts
// Also covers uncertain-order reconciliation BY ORDER REFERENCE, through the
// HALO Bridge EA adapter answered by a simulated EA (no MT5, no broker).
// Runs against a THROWAWAY SQLite file (never db/custom.db): the schema is
// created with `prisma db push` on an empty file in the OS temp folder.
// No broker, no network. Proves the lock is atomic within one process AND
// across separate processes, keeps uncertain orders locked, and recovers
// correctly after a restart.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKER = process.argv[2] === "worker";
const DB_FILE = process.env.LOCK_TEST_DB ?? path.join(os.tmpdir(), `halo-lock-test-${process.pid}.db`);
process.env.DATABASE_URL = `file:${DB_FILE}`;
process.env.NODE_ENV = "production"; // quiet Prisma query logging

const intent = (n: number) => ({ source: "BOT" as const, symbol: "XAUUSD", tf: "1h", dir: 1 as const, entry: 4000 + n, sl: 3990, tp: 4030, live: false });

async function worker(): Promise<void> {
  const { beginIntent } = await import("../src/lib/exec-lock");
  const n = Number(process.argv[3] ?? 10);
  const res = await Promise.all(Array.from({ length: n }, (_, i) => beginIntent(intent(i)).catch(() => null)));
  process.stdout.write(`WON ${res.filter(Boolean).length}\n`);
  process.exit(0);
}

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};

function runWorker(n: number): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [...process.execArgv, __filename, "worker", String(n)], { env: { ...process.env, LOCK_TEST_DB: DB_FILE } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(Number(/WON (\d+)/.exec(out)?.[1] ?? -1)));
  });
}

async function main(): Promise<void> {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], { env: { ...process.env }, stdio: "ignore" });
  ok(fs.existsSync(DB_FILE) && !DB_FILE.includes("custom.db"), `throwaway database created (${DB_FILE})`);

  const { db } = await import("../src/lib/db");
  const lock = await import("../src/lib/exec-lock");
  const reset = async () => {
    await db.executionEvent.deleteMany();
    await db.executionIntent.deleteMany();
    await db.executionLock.deleteMany();
    await db.trade.deleteMany();
    await db.brokerAccount.deleteMany();
  };

  // 1 · 50 simultaneous orders in one process
  await reset();
  const res = await Promise.all(Array.from({ length: 50 }, (_, i) => lock.beginIntent(intent(i))));
  const winners = res.filter(Boolean);
  ok(winners.length === 1, `50 simultaneous orders → exactly 1 takes the lock (got ${winners.length})`);
  const holder = await lock.lockHolder();
  ok(holder?.intentId === winners[0]?.id, "the lock row points at the single winner");
  const abandoned = await db.executionIntent.count({ where: { state: "ABANDONED" } });
  ok(abandoned === 49, `the 49 losers are recorded as ABANDONED, nothing sent (got ${abandoned})`);
  ok(new Set(res.filter(Boolean).map((r) => r!.clientOrderId)).size === winners.length, "every order attempt has a unique client order id");

  // 2 · a held lock refuses duplicates (repeated webhook / scanner event)
  ok((await lock.beginIntent(intent(99))) === null, "a duplicate order while the lock is held is refused");

  // 3 · uncertain broker answer keeps the lock
  await lock.markSubmitting(winners[0]!.id);
  await lock.markUncertain(winners[0]!.id, "test: broker timeout");
  ok((await lock.lockHolder())?.state === "UNCERTAIN", "uncertain order keeps the lock");
  ok((await lock.beginIntent(intent(100))) === null, "no new order while an order is uncertain (never blindly resent)");

  // 4 · Super Admin resolution: confirmed NOT executed → released, no trade invented
  const r1 = await lock.resolveUncertain(winners[0]!.id, "not_executed", "test-admin");
  ok(r1.ok && (await lock.lockHolder()) === null, "resolved 'not executed' → lock released");
  ok((await db.trade.count()) === 0, "resolving 'not executed' creates no trade record");
  const ev = await db.executionEvent.findMany({ where: { intentId: winners[0]!.id }, orderBy: { at: "asc" } });
  ok(ev.map((e) => e.toState).join(">") === "PENDING>SUBMITTING>UNCERTAIN>REJECTED", `full audit trail recorded (${ev.map((e) => e.toState).join(" > ")})`);
  ok((await lock.resolveUncertain(winners[0]!.id, "executed", "test-admin")).ok === false, "an already-resolved order cannot be resolved again");

  // 5 · explicit rejection releases; open trade holds until it closes
  const a = await lock.beginIntent(intent(1));
  await lock.markRejected(a!.id, "test: broker rejected");
  ok((await lock.lockHolder()) === null, "broker rejection → lock released");
  const b = await lock.beginIntent(intent(2));
  const tr = await db.trade.create({ data: { mode: "BOT", execMode: "PAPER", symbol: "XAUUSD", timeframe: "1h", direction: 1, entry: 4000, sl: 3990, tp: 4030, riskPips: 100, rewardPips: 300, status: "OPEN", levelTop: 0, levelBot: 0, slMode: "test", openedAt: new Date() } });
  await lock.markOpen(b!.id, tr.id);
  ok((await lock.beginIntent(intent(3))) === null, "an OPEN trade keeps the lock");
  await lock.releaseForTrade(tr.id, "test: TP hit");
  ok((await lock.lockHolder()) === null, "trade closed → lock released");

  // 6 · restart during a PENDING order (crash before submission) → abandoned + released
  await reset();
  const p = await lock.beginIntent(intent(4));
  delete (globalThis as { __haloExecReconciled?: unknown }).__haloExecReconciled;
  await lock.ensureReconciled();
  ok((await db.executionIntent.findUnique({ where: { id: p!.id } }))?.state === "ABANDONED" && (await lock.lockHolder()) === null, "restart during PENDING → ABANDONED, lock released (nothing was sent)");

  // 7 · restart during an UNCERTAIN live order with no reachable broker → lock kept
  const u = await lock.beginIntent({ ...intent(5), live: true, brokerKind: "metaapi", brokerAccountId: "missing-broker" });
  await lock.markSubmitting(u!.id);
  await lock.markUncertain(u!.id, "test: no answer");
  delete (globalThis as { __haloExecReconciled?: unknown }).__haloExecReconciled;
  await lock.ensureReconciled();
  ok((await lock.lockHolder())?.intentId === u!.id && (await lock.lockHolder())?.state === "UNCERTAIN", "restart during UNCERTAIN (broker unknown) → still locked, waits for reconciliation");
  ok((await lock.beginIntent(intent(6))) === null, "…and no new order is accepted meanwhile");

  // 8 · restart during SUBMITTING paper order whose trade was written → recovered as OPEN
  await reset();
  const s = await lock.beginIntent(intent(7));
  await lock.markSubmitting(s!.id);
  await db.trade.create({ data: { mode: "BOT", execMode: "PAPER", brokerOrderId: s!.clientOrderId, symbol: "XAUUSD", timeframe: "1h", direction: 1, entry: 4007, sl: 3990, tp: 4030, riskPips: 170, rewardPips: 230, status: "OPEN", levelTop: 0, levelBot: 0, slMode: "test", openedAt: new Date() } });
  delete (globalThis as { __haloExecReconciled?: unknown }).__haloExecReconciled;
  await lock.ensureReconciled();
  ok((await db.executionIntent.findUnique({ where: { id: s!.id } }))?.state === "OPEN", "restart during SUBMITTING (paper trade written) → recovered as OPEN by its client order id");
  const w = (globalThis as { __haloExecWatch?: ReturnType<typeof setInterval> }).__haloExecWatch;
  if (w) clearInterval(w);

  // 9 · uncertain-order reconciliation by order reference (simulated HALO Bridge EA)
  await reset();
  const { eaPoll } = await import("../src/lib/brokers/mt5-ea");
  const KEY = "lock-test-pairing-key-0123456789";
  const acct = await db.brokerAccount.create({ data: { kind: "mt5ea", label: "test EA", credsJson: JSON.stringify({ eaKey: KEY }), status: "ok", active: true } });
  let answer: { status: string; orderId?: string } | null = { status: "open", orderId: "777" };
  const seenLookups: string[] = [];
  let eaRunning = true;
  void (async () => {
    let pending: Array<Record<string, unknown>> = [];
    while (eaRunning) {
      const lines = eaPoll(KEY, { login: "1", mode: "demo", balance: 1000, equity: 1000 }, pending as never) ?? [];
      pending = [];
      for (const line of lines) {
        const f = line.split("\t");
        if (f[1] === "lookup") {
          seenLookups.push(f[10]);
          if (answer) pending.push({ id: f[0], ok: true, status: answer.status, orderId: answer.orderId, detail: "simulated" });
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  })();
  await new Promise((r) => setTimeout(r, 200));
  const live = (n: number) => ({ ...intent(n), live: true, brokerKind: "mt5ea", brokerAccountId: acct.id });
  const uncertain = async (n: number) => {
    const x = await lock.beginIntent(live(n));
    await lock.markSubmitting(x!.id);
    await lock.markUncertain(x!.id, "test: no broker answer");
    return x!;
  };

  const o = await uncertain(10);
  ok(o.clientOrderId.length <= 15, `client order id fits broker limits (${o.clientOrderId.length} chars, MetaApi comment + id ≤ 26)`);
  ok((await lock.reconcileByReference(o.id, "test")) === "open", "broker says OPEN by order id → recovered");
  const oi = await db.executionIntent.findUnique({ where: { id: o.id } });
  ok(oi?.state === "OPEN" && (await db.trade.count({ where: { brokerOrderId: "777", slMode: "recovered" } })) === 1, "intent OPEN + trade booked with the broker's position id");
  ok(seenLookups.at(-1) === o.clientOrderId, "the EA was asked about exactly this order id");
  const ww = (globalThis as { __haloExecWatch?: ReturnType<typeof setInterval> }).__haloExecWatch;
  if (ww) clearInterval(ww);
  await db.executionLock.updateMany({ data: { intentId: null } });

  answer = { status: "closed", orderId: "778" };
  const c = await uncertain(11);
  const tradesBefore = await db.trade.count();
  ok((await lock.reconcileByReference(c.id, "test")) === "closed", "broker says filled-and-closed → CLOSED");
  ok((await lock.lockHolder()) === null && (await db.trade.count()) === tradesBefore, "…lock released and NO result invented (broker history has it)");

  answer = { status: "absent" };
  const a2 = await uncertain(12);
  ok((await lock.reconcileByReference(a2.id, "test")) === "unknown", "'absent' within 60 s of sending is not trusted yet");
  ok((await db.executionIntent.findUnique({ where: { id: a2.id } }))?.state === "UNCERTAIN" && (await lock.lockHolder())?.intentId === a2.id, "…order stays UNCERTAIN and locked");
  await db.executionIntent.update({ where: { id: a2.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
  ok((await lock.reconcileByReference(a2.id, "test")) === "absent", "'absent' after 60 s → broker confirms no execution");
  ok((await db.executionIntent.findUnique({ where: { id: a2.id } }))?.state === "REJECTED" && (await lock.lockHolder()) === null, "…REJECTED and lock released");

  answer = null; // EA stops answering
  const u2 = await uncertain(13);
  eaRunning = false;
  await new Promise((r) => setTimeout(r, 7000)); // EA counted offline after 6 s
  ok((await lock.reconcileByReference(u2.id, "test")) === "unknown", "EA offline → unknown, never guessed");
  const attempts = await db.executionEvent.count({ where: { intentId: u2.id, detail: { startsWith: "reconcile attempt" } } });
  ok(attempts === 1 && (await lock.lockHolder())?.intentId === u2.id, "every attempt is recorded and the order stays locked");
  const uw = (globalThis as { __haloUncertainWatch?: ReturnType<typeof setInterval> }).__haloUncertainWatch;
  if (uw) clearInterval(uw);

  // 10 · separate processes racing on the same database file
  await reset();
  const counts = await Promise.all(Array.from({ length: 8 }, () => runWorker(10)));
  const total = counts.reduce((x, y) => x + Math.max(0, y), 0);
  ok(counts.every((c) => c >= 0) && total === 1, `8 processes × 10 simultaneous orders → exactly 1 winner across processes (got ${total}; per process ${counts.join(",")})`);
  ok((await db.executionIntent.count({ where: { state: "ABANDONED" } })) === 79, "the other 79 attempts are ABANDONED");

  await db.$disconnect();
  fs.rmSync(DB_FILE, { force: true });
  fs.rmSync(`${DB_FILE}-journal`, { force: true });
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}

if (WORKER) void worker();
else
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
