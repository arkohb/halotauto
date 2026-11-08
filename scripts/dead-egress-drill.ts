// Dead-network drill: every outbound fetch hangs forever. A crypto candle
// request must fall back to the simulator within the 7 s deadline instead of
// burning 4 exchanges × timeout.   npx tsx scripts/dead-egress-drill.ts
let inFlight = 0;
let maxInFlight = 0;
(globalThis as unknown as { fetch: (u: string, i?: { signal?: AbortSignal }) => Promise<Response> }).fetch = (_u, init) =>
  new Promise((_res, rej) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    init?.signal?.addEventListener("abort", () => {
      inFlight--;
      rej(new Error("aborted"));
    });
  });

let fails = 0;
const ok = (c: boolean, m: string, extra?: unknown) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`, c ? "" : JSON.stringify(extra ?? ""));
  if (!c) fails++;
};
async function main() {
  const { getKlines } = await import("../src/lib/market");
  const t0 = Date.now();
  const r = await getKlines("BTCUSDT", "1h", 100, { deep: true });
  const took = Date.now() - t0;
  ok(r.source === "simulator" && r.candles.length > 0, "dead network → simulator fallback serves candles", r.source);
  ok(took < 9000, `bounded by the deadline (took ${(took / 1000).toFixed(1)} s, was up to 20 s)`, took);
  ok(maxInFlight <= 2, `requests do not pile up (max ${maxInFlight} in flight)`, maxInFlight);
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
