// HALO Bridge EA price feed — end-to-end over HTTP against a running server
// whose database is a THROWAWAY copy holding a test admin and an mt5ea
// broker account with pairing key FEED_KEY. A simulated EA posts to the real
// /api/bridge/mt5 endpoint.
//   FEED_BASE=http://127.0.0.1:3100 FEED_KEY=… FEED_EMAIL=… FEED_PASSWORD=… npx tsx scripts/ea-price-feed-e2e.ts
const BASE = process.env.FEED_BASE ?? "http://127.0.0.1:3100";
const KEY = process.env.FEED_KEY ?? "";
const EMAIL = process.env.FEED_EMAIL ?? "";
const PASSWORD = process.env.FEED_PASSWORD ?? "";
if (!KEY || !EMAIL || !PASSWORD || !BASE.includes(":3100")) {
  console.error("refusing to run: needs FEED_KEY/FEED_EMAIL/FEED_PASSWORD and the throwaway server on :3100");
  process.exit(2);
}

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── simulated EA (HTTP, like the real one) ──
const watched = new Set<string>();
let price = 4071.25;
let running = true;
const HOUR = 3_600_000;
const lastBarOpen = Math.floor(Date.now() / HOUR) * HOUR;
(async () => {
  let pending: unknown[] = [];
  while (running) {
    try {
      const ticks = [...watched].map((s) => ({ s, b: price, a: price + 0.2, t: Date.now() }));
      const r = await fetch(`${BASE}/api/bridge/mt5`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-halo-ea-key": KEY },
        body: JSON.stringify({ account: { login: "99", server: "Exness-MT5Trial10", company: "Exness", currency: "USD", balance: 1000, equity: 1000, mode: "demo" }, results: pending, ticks }),
      });
      pending = [];
      for (const line of (await r.text()).split("\n").filter(Boolean)) {
        const f = line.split("\t");
        if (f[1] === "watch") {
          watched.add(f[2]);
          pending.push({ id: f[0], ok: true });
        } else if (f[1] === "history") {
          const n = Math.min(Number(f[7]), 600);
          const bars = Array.from({ length: n }, (_, i) => {
            const t = lastBarOpen - (n - 1 - i) * HOUR;
            const c = 4000 + i * 0.1;
            return [t, c - 0.5, c + 1, c - 1, c];
          });
          pending.push({ id: f[0], ok: true, detail: "XAUUSDm", bars });
        } else {
          pending.push({ id: f[0], ok: true });
        }
      }
    } catch {
      // server busy — retry next poll
    }
    await sleep(300);
  }
})();

async function main() {
  await sleep(1500);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: EMAIL, password: PASSWORD }) });
  const cookie = /halo_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[0] ?? "";
  ok(!!cookie, "test admin signed in on the throwaway server");

  const c = (await (await fetch(`${BASE}/api/market/candles?symbol=XAUUSD&tf=1h&limit=20`, { headers: { cookie } })).json()) as { source?: string; candles?: Array<{ time: number; close: number }> };
  ok(c.source === "exness", `gold candles now come from the broker EA (source: ${c.source})`);
  ok((c.candles ?? []).at(-1)?.time === lastBarOpen, "the newest candle is the broker's current hour (UTC)");

  // live stream
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/market/stream?symbol=XAUUSD&tf=1h`, { headers: { cookie }, signal: ctrl.signal });
  ok(res.status === 200 && /event-stream/.test(res.headers.get("content-type") ?? ""), "live stream opened");
  const reader = res.body!.getReader();
  let text = "";
  const until = async (re: RegExp, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !re.test(text)) {
      const r = await Promise.race([reader.read(), sleep(500).then(() => null)]);
      if (r && !r.done) text += new TextDecoder().decode(r.value);
    }
    return re.test(text);
  };
  ok(await until(/event: source\ndata: exness/, 5000), "the stream says its source is the broker (EXNESS LIVE)");
  await sleep(1200);
  price = 4075.5;
  ok(await until(/"close":4075\.5/, 6000), "a new broker price moves the live candle (close 4075.5)");
  price = 4077.0;
  ok(await until(/"high":4077/, 6000), "the forming candle's high follows the ticks");
  ctrl.abort();

  // bot / engine on the same prices
  let src = "";
  for (let i = 0; i < 20 && src !== "exness"; i++) {
    const s = (await (await fetch(`${BASE}/api/bot/state`, { headers: { cookie } })).json()) as { feed?: { source?: string } };
    src = s.feed?.source ?? "";
    if (src !== "exness") await sleep(2000);
  }
  ok(src === "exness", `the bot runs on the broker's prices too (feed: ${src})`);

  // EA goes offline → fallback
  running = false;
  await sleep(8000);
  const c2 = (await (await fetch(`${BASE}/api/market/candles?symbol=EURUSD&tf=1h&limit=5`, { headers: { cookie } })).json()) as { source?: string };
  ok(c2.source !== "exness", `EA offline → other markets fall back (EURUSD source: ${c2.source})`);

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
