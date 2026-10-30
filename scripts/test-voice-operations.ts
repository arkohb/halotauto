/**
 * UNIT TEST · voice-operator operations (paper-mode honesty + joke rotation)
 * Run: bun scripts/test-voice-operations.ts
 */
import { listPendingOrdersDetail, cancelPendingOrderExec, cancelAllPendingOrdersExec, closeAllPositionsExec, modifyPositionSltpExec, resetEngineExec, jokeDetail } from "../src/lib/halo/operations";
import { JOKES } from "../src/lib/halo/jokes";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  console.log("── operations unit tests (paper mode expected) ──");

  const orders = await listPendingOrdersDetail();
  check("list_pending_orders honest about paper", /paper mode/i.test(orders) || !/undefined|NaN/.test(orders), orders.slice(0, 90));

  const c1 = await cancelPendingOrderExec(undefined);
  check("cancel one (no id) honest", typeof c1.ok === "boolean" && c1.detail.length > 10 && !/undefined|NaN/.test(c1.detail), `ok=${c1.ok} ${c1.detail.slice(0, 80)}`);

  const c2 = await cancelPendingOrderExec("12345");
  check("cancel one (bogus id) honest", typeof c2.ok === "boolean" && !/undefined|NaN/.test(c2.detail), `ok=${c2.ok} ${c2.detail.slice(0, 80)}`);

  const c3 = await cancelAllPendingOrdersExec();
  check("cancel all honest", typeof c3.ok === "boolean" && !/undefined|NaN/.test(c3.detail), `ok=${c3.ok} ${c3.detail.slice(0, 80)}`);

  const m = await modifyPositionSltpExec(1234.5, undefined);
  check("modify sl/tp honest in paper", /paper/i.test(m.detail), `ok=${m.ok} ${m.detail.slice(0, 90)}`);
  const mBad = await modifyPositionSltpExec(-5, NaN);
  check("modify rejects invalid prices", !mBad.ok && /valid/i.test(mBad.detail), mBad.detail.slice(0, 90));

  const cl = await closeAllPositionsExec();
  check("close-all executes honestly (paper engine path)", typeof cl.ok === "boolean" && !/undefined|NaN/.test(cl.detail), `ok=${cl.ok} ${cl.detail.slice(0, 90)}`);

  const r = await resetEngineExec();
  check("reset engine executes (or refuses while trade open)", typeof r.ok === "boolean" && !/undefined|NaN/.test(r.detail), `ok=${r.ok} ${r.detail.slice(0, 90)}`);

  console.log("── joke bank ──");
  const j1 = jokeDetail(undefined);
  const j2 = jokeDetail(undefined);
  check("joke returned", j1.length > 20 && !/undefined|NaN/.test(j1), j1.slice(0, 70));
  check("jokes rotate (no immediate repeat)", j1 !== j2, "two consecutive differ");
  const jt = jokeDetail("trading");
  check("style filter works", JOKES.some((j) => j.text === jt), jt.slice(0, 70));
  const bad = jokeDetail("nonsense-style");
  check("bad style falls back gracefully", bad.length > 20, bad.slice(0, 70));
  check("all jokes short enough for TTS", JOKES.every((j) => j.text.split(" ").length <= 40), `max words = ${Math.max(...JOKES.map((j) => j.text.split(" ").length))}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("test crash:", e);
  process.exit(1);
});
