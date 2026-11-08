// HALO Bridge EA price feed — in-process test with a simulated EA (no MT5).
//   npx tsx scripts/ea-price-feed-test.ts
import { eaCandles, eaLatestQuote, eaPoll, eaSubscribeQuotes, eaWatch, type EaResult, type EaTick } from "../src/lib/brokers/mt5-ea";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEY = "feed-test-pairing-key-0123456789ab";
const creds = { eaKey: KEY, symbolMap: { XAUUSD: "XAUUSDm" } };
const BASE = Date.UTC(2026, 10, 10, 9, 0, 0);

// simulated EA: answers watch/history, streams quotes for watched symbols
const watched = new Set<string>();
let price = 4071.25;
let running = true;
const seen: string[][] = [];
(async () => {
  let pending: EaResult[] = [];
  while (running) {
    const ticks: EaTick[] = [...watched].map((s) => ({ s, b: price, a: price + 0.2, t: Date.now() }));
    const lines = eaPoll(KEY, { login: "1", mode: "demo", balance: 1000, equity: 1000 }, pending, ticks) ?? [];
    pending = [];
    for (const line of lines) {
      const f = line.split("\t");
      seen.push(f);
      if (f[1] === "watch") {
        watched.add(f[2] === "XAUUSDm" ? "XAUUSD" : f[2]);
        pending.push({ id: f[0], ok: true });
      } else if (f[1] === "history") {
        const n = Number(f[7]);
        const bars = Array.from({ length: n }, (_, i) => [BASE + i * 3_600_000, 4070 + i, 4072 + i, 4069 + i, 4071 + i]);
        pending.push({ id: f[0], ok: true, bars });
      }
    }
    await sleep(60);
  }
})();

async function main() {
  await sleep(200);
  const bars = await eaCandles(creds, "XAUUSD", "1h", 5);
  const hist = seen.find((f) => f[1] === "history")!;
  ok(hist[2] === "XAUUSDm" && hist[6] === "1h" && hist[7] === "5", "history asks the EA for the broker's symbol name, timeframe and count");
  ok(bars.length === 5 && bars[0].time === BASE && bars[4].close === 4075, "candles come back oldest-first with UTC times");
  await sleep(300);
  ok(seen.some((f) => f[1] === "watch"), "fetching history also starts the live quote stream");
  const q = eaLatestQuote(creds, "XAUUSD");
  ok(!!q && q.bid === 4071.25 && q.ask === 4071.45, "latest broker bid/ask is available");

  const got: number[] = [];
  const unsub = eaSubscribeQuotes(creds, "XAUUSD", (x) => got.push(x.bid));
  await sleep(300);
  ok(got.length === 0, "unchanged prices are not re-sent to the chart");
  price = 4071.75;
  await sleep(300);
  ok(got.length === 1 && got[0] === 4071.75, "a price change reaches the chart once");
  unsub();
  price = 4072.0;
  await sleep(300);
  ok(got.length === 1, "after unsubscribing nothing more arrives");

  const before = seen.filter((f) => f[1] === "watch").length;
  eaWatch(creds, "XAUUSD");
  await sleep(200);
  ok(seen.filter((f) => f[1] === "watch").length === before, "watching the same symbol twice sends one command");

  running = false;
  await sleep(16_000);
  ok(eaLatestQuote(creds, "XAUUSD") === null, "a quote older than 15 s (EA stopped) is not served");

  let threw = false;
  try {
    await eaCandles(creds, "XAUUSD", "1h", 5);
  } catch {
    threw = true;
  }
  ok(threw, "EA offline → history fails fast, so HALO falls back to OANDA / Yahoo");

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main();
