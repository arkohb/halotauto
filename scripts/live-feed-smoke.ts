// Smoke test for the client live-feed module (runs anywhere WebSocket exists).
// bun scripts/live-feed-smoke.ts
import { subscribeLiveBars, liveStatusOf } from "../src/lib/halo/live-feed";

function watch(label: string, symbol: string, tf: string, ms: number): Promise<{ updates: number; last?: string; status?: string }> {
  return new Promise((resolve) => {
    let updates = 0;
    let last: string | undefined;
    let status: string | undefined;
    const t0 = Date.now();
    const un = subscribeLiveBars(symbol, tf, {
      onStatus: (st) => {
        status = `active=${st.active} kind=${st.kind} note=${st.note ?? "-"}`;
        console.log(`  [${label}] status: ${status}  (+${Date.now() - t0}ms)`);
      },
      onHistory: (bars) => {
        console.log(`  [${label}] history: ${bars.length} bars, last close=${bars[bars.length - 1]?.close}`);
      },
      onUpdate: (b) => {
        updates++;
        last = `${new Date(b.time).toISOString()} O=${b.open} H=${b.high} L=${b.low} C=${b.close}`;
      },
    });
    setTimeout(() => {
      un();
      resolve({ updates, last, status: status ?? liveStatusOf(symbol, tf).note });
    }, ms);
  });
}

const btc = await watch("BINANCE BTCUSDT 1m", "BTCUSDT", "1m", 12_000);
console.log(`BTCUSDT result: updates=${btc.updates} status=${btc.status}`);
if (btc.last) console.log(`  last bar: ${btc.last}`);

const v75 = await watch("DERIV V75 (blocked in sandbox → expect graceful inactive)", "V75", "1m", 10_000);
console.log(`V75 result: updates=${v75.updates} status=${v75.status}`);

const paxg = await watch("BINANCE PAXGUSDT 5m", "PAXGUSDT", "5m", 8_000);
console.log(`PAXGUSDT result: updates=${paxg.updates} status=${paxg.status}`);

const bad = await watch("UNMAPPED TF (2m → no stream)", "BTCUSDT", "2m", 3_000);
console.log(`BTCUSDT 2m result: updates=${bad.updates} status=${bad.status}`);

console.log("SMOKE DONE");
process.exit(0);
