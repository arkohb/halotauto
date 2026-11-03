// HALO Bridge (MT5 EA) self-test — in-process, no MT5, no network.
//   npx tsx scripts/mt5-ea-bridge-test.ts
// A simulated EA polls the hub exactly like mt5/HALO_Bridge.mq5 does.
import { eaPoll, eaPresence, mt5EaAdapter, type EaAccount, type EaResult } from "../src/lib/brokers/mt5-ea";
import { isUncertainBrokerError } from "../src/lib/execution";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEY = "test-pairing-key-0123456789abcdef";
const creds = { eaKey: KEY };
const demo: EaAccount = { login: "1001", server: "Demo-Server", company: "Test Broker", currency: "USD", balance: 10000, equity: 10000, mode: "demo" };

/** simulated EA: polls every 100 ms; `behave` decides each command's result (null = swallow it) */
function startEa(account: EaAccount, behave: (f: string[]) => EaResult | null) {
  let pending: EaResult[] = [];
  let stop = false;
  const seen: string[][] = [];
  (async () => {
    while (!stop) {
      const lines = eaPoll(KEY, account, pending) ?? [];
      pending = [];
      for (const line of lines) {
        const f = line.split("\t");
        seen.push(f);
        const r = behave(f);
        if (r) pending.push(r);
      }
      await sleep(100);
    }
  })();
  return { stop: () => (stop = true), seen };
}

const order = {
  symbol: "XAUUSD",
  side: 1 as const,
  entry: 3910,
  sl: 3905,
  tp: 3925,
  riskDistance: 5,
  riskPips: 50,
  sizing: { mode: "percent" as const, size: 0.01, percent: 1 },
  comment: "HALO 3EL\tBUY|x",
  clientOrderId: "intent-abc",
};

async function main() {
  ok(eaPoll("short", null, []) === null, "poll with a short key is refused");

  const offline = await mt5EaAdapter.marketOrder(creds, order);
  ok(!offline.ok && !isUncertainBrokerError(offline.error ?? ""), `EA offline → clean rejection (not uncertain): ${offline.error}`);

  // ── happy path ──
  let ea = startEa(demo, (f) => {
    const [id, action] = f;
    if (action === "ping") return { id, ok: true };
    if (action === "quote") return { id, ok: true, bid: 3910.1, ask: 3910.4, time: Date.now() };
    if (action === "open") return { id, ok: true, orderId: "555", price: 3910.4, volume: 0.2 };
    if (action === "positions") return { id, ok: true, positions: [{ id: "555", symbol: "XAUUSDm", side: 1, volume: 0.2, entryPrice: 3910.4, sl: 3905, tp: 3925, ea: true }] };
    if (action === "close") return { id, ok: true };
    return { id, ok: false, error: "unknown" };
  });
  await sleep(250);
  ok(eaPresence(creds).online, "EA seen → online");
  const t = await mt5EaAdapter.testConnection(creds);
  ok(t.ok && t.login === "1001" && t.balance === 10000, "testConnection returns the demo account");
  const q = await mt5EaAdapter.getQuote!(creds, "XAUUSD");
  ok(q.ok && q.bid === 3910.1 && q.ask === 3910.4, "getQuote returns bid/ask");
  const o = await mt5EaAdapter.marketOrder(creds, order);
  ok(o.ok && o.brokerOrderId === "555" && o.fillPrice === 3910.4 && o.volume === 0.2, "marketOrder fills through the EA");
  const sent = ea.seen.find((f) => f[1] === "open")!;
  ok(sent[0] === "intent-abc", "order carries the execution-lock id (EA dedupes on it)");
  ok(sent.length === 12 && sent[6] === "percent" && sent[8] === "1" && sent[9] === "5", "sizing mode, % risk and SL distance reach the EA");
  ok(!sent[11].includes("\t") && !sent[11].includes("|"), "comment cannot break the line framing");
  const pos = await mt5EaAdapter.getPositions(creds, "XAUUSD");
  ok(pos.length === 1 && pos[0].side === 1 && pos[0].ea === true, "getPositions maps EA positions");
  const c = await mt5EaAdapter.closePosition(creds, "XAUUSD", 1);
  ok(c.ok, "closePosition through the EA");
  ea.stop();
  await sleep(150);

  // ── EA collects the order but never confirms → TIMEOUT → uncertain ──
  ea = startEa(demo, (f) => (f[1] === "open" ? null : { id: f[0], ok: true }));
  await sleep(250);
  const started = Date.now();
  const lost = await mt5EaAdapter.marketOrder(creds, order);
  ok(!lost.ok && isUncertainBrokerError(lost.error ?? ""), `collected but unconfirmed → uncertain (${Math.round((Date.now() - started) / 1000)} s): ${lost.error}`);
  ea.stop();
  await sleep(150);

  // ── broker rejection is passed through ──
  ea = startEa(demo, (f) => (f[1] === "open" ? { id: f[0], ok: false, error: "MT5 10016: Invalid stops" } : { id: f[0], ok: true }));
  await sleep(250);
  const rej = await mt5EaAdapter.marketOrder(creds, order);
  ok(!rej.ok && rej.error === "MT5 10016: Invalid stops" && !isUncertainBrokerError(rej.error), "MT5 rejection reported as a clean failure");
  ea.stop();
  await sleep(150);

  // ── a REAL account is refused, by HALO and at connect time ──
  ea = startEa({ ...demo, mode: "real" }, (f) => ({ id: f[0], ok: true, orderId: "999" }));
  await sleep(250);
  const real = await mt5EaAdapter.marketOrder(creds, order);
  ok(!real.ok && /not a DEMO/i.test(real.error ?? ""), "real-money MT5 account → order refused by HALO");
  ok(!ea.seen.some((f) => f[1] === "open"), "…and the order never reached the EA");
  const tr = await mt5EaAdapter.testConnection(creds);
  ok(!tr.ok && /demo/i.test(tr.error ?? ""), "real-money MT5 account → connection test fails");
  ea.stop();

  // ── another pairing key never sees these commands ──
  const other = eaPoll("another-key-zzzzzzzzzzzzzzzzzzzzzz", demo, []);
  ok(Array.isArray(other) && other.length === 0, "a different key gets an empty channel");

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main();
