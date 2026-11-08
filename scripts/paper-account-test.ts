// Persistent demo balance: exactly-once booking (runs against a throwaway
// copy of the database — never the real one).   npx tsx scripts/paper-account-test.ts
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "halo-paper-"));
const dbFile = path.join(dir, "test.db");
copyFileSync(path.join(process.cwd(), "db/custom.db"), dbFile);
process.env.DATABASE_URL = `file:${dbFile}`;

let fails = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`, c ? "" : JSON.stringify(extra ?? ""));
  if (!c) fails++;
};

async function main() {
  const { db } = await import("../src/lib/db");
  const pa = await import("../src/lib/paper-account");
  await db.trade.updateMany({ data: { pnlBooked: true } }); // isolate from history
  await db.paperAccount.deleteMany({});
  await db.botConfig.update({ where: { id: "main" }, data: { sizingMode: "fixed", sizeFixed: 0.5 } });

  const a0 = await pa.getPaperAccount();
  ok(a0.balance === 100_000, "a new demo account starts at $100,000", a0);

  const mk = (id: string, status: string, resultPips: number | null, execMode = "PAPER") =>
    db.trade.create({
      data: { id, mode: "SCAN", execMode, symbol: "XAUUSD", timeframe: "15m", direction: 1, entry: 4000, sl: 3990, tp: 4030, riskPips: 100, rewardPips: 300, status, resultPips, levelTop: 4000, levelBot: 4000, slMode: "Fixed points", openedAt: new Date(), closedAt: status === "OPEN" ? null : new Date() },
    });
  await mk("pt_win", "WIN", 300);
  await mk("pt_loss_pos", "LOSS", 100); // LOSS stored as a positive magnitude
  await mk("pt_open", "OPEN", null);
  await mk("pt_live", "WIN", 300, "LIVE");

  const results = await Promise.all([pa.syncPaperBookings(), pa.syncPaperBookings(), pa.bookPaperCloseFromDb("pt_win")]);
  const a1 = await pa.getPaperAccount();
  // 0.5 lot × $10/pip: +300p = +1500, −100p = −500
  ok(a1.balance === 101_000, "a win and a loss book once each: +$1,500 − $500 (losses never count as gains)", { balance: a1.balance, results });
  await pa.syncPaperBookings();
  ok((await pa.getPaperAccount()).balance === 101_000, "a second sweep books nothing again");
  ok((await db.trade.findUnique({ where: { id: "pt_open" } }))?.pnlBooked === false, "an open trade is not booked");
  ok((await db.trade.findUnique({ where: { id: "pt_live" } }))?.pnlBooked === false, "a LIVE trade is never booked (the broker owns that balance)");

  await db.trade.update({ where: { id: "pt_open" }, data: { status: "LOSS", resultPips: -100, closedAt: new Date() } });
  await pa.syncPaperBookings();
  ok((await pa.getPaperAccount()).balance === 100_500, "when the open trade closes, its result books on the next sweep");

  const r = await pa.resetPaperAccount();
  ok(r.balance === 100_000, "reset puts the balance back to $100,000");
  await pa.syncPaperBookings();
  ok((await pa.getPaperAccount()).balance === 100_000, "already-booked trades do not come back after a reset");

  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
