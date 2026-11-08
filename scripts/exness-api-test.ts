// Exness Trader API client — test against a local SIMULATED Exness server
// that verifies every request's Ed25519 signature (no real Exness, no key).
//   npx tsx scripts/exness-api-test.ts
import crypto from "node:crypto";
import http from "node:http";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const API_KEY = "exnsk-test-local";
const ACCOUNT = "5550001";
const TF_ENUM = new Set(["S1", "S5", "S15", "M1", "M3", "M5", "M10", "M15", "M30", "H1", "H2", "H4", "D1", "W1", "MN"]);

// ── simulated Exness ──
const stats = { accessPoint: 0, badSig: 0, candleQueries: [] as URLSearchParams[], wsHandshakes: 0, wsRejected: 0, subscribes: [] as string[][] };
function verify(method: string, url: string, h: http.IncomingHttpHeaders): string | null {
  const data = String(h["exn-data"] ?? "");
  const sig = String(h["exn-sign"] ?? "");
  if (h["exn-api-key"] !== API_KEY || h["exn-sign-version"] !== "1") return "AUTH_INVALID_API_KEY";
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(b64urlDecode(data).toString());
  } catch {
    return "AUTH_INVALID_SIGNATURE";
  }
  const emptyHash = b64url(crypto.createHash("sha256").update("").digest());
  if (p.api_key !== API_KEY || p.method !== method || p.path !== url || p.body_hash !== emptyHash || p.idempotency_key !== "" || p.sign_version !== 1) return "AUTH_INVALID_SIGNATURE";
  if (String(p.timestamp) !== String(h["exn-timestamp"]) || Math.abs(Date.now() - Number(p.timestamp)) > 30_000) return "AUTH_INVALID_SIGNATURE";
  if (!crypto.verify(null, b64urlDecode(data), publicKey, b64urlDecode(sig))) return "AUTH_INVALID_SIGNATURE";
  return null;
}
const HOUR = 3_600_000;
const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  const bad = verify(req.method ?? "GET", url, req.headers);
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (bad) {
    stats.badSig++;
    return send(401, { error: { code: bad } });
  }
  const u = new URL(url, "http://x");
  if (u.pathname === "/v1/trading/access-point") {
    stats.accessPoint++;
    return send(200, { access_point: `http://127.0.0.1:${(server.address() as { port: number }).port}`, account_id: u.searchParams.get("account_id") });
  }
  if (u.pathname === `/v1/configuration/accounts/${ACCOUNT}/instruments`) return send(200, { instruments: ["EURUSD", "XAUUSDm", "US30"] });
  if (u.pathname === `/v1/market-data/accounts/${ACCOUNT}/candles`) {
    const q = u.searchParams;
    stats.candleQueries.push(q);
    if (!["EURUSD", "XAUUSDm", "US30"].includes(q.get("instrument") ?? "")) return send(404, { error: { code: "MARKET_INSTRUMENT_NOT_FOUND" } });
    if (!TF_ENUM.has(q.get("timeframe") ?? "")) return send(400, { error: { code: "REQUEST_INVALID_TIMEFRAME" } });
    // like the real API: from (required) + count (negative = the N candles before `from`), max 1000 per request
    const fromMs = Date.parse(q.get("from") ?? "");
    const count = Number(q.get("count") ?? "0");
    if (!Number.isFinite(fromMs) || !count) return send(400, { error: { code: "REQUEST_INVALID_PARAMETERS" } });
    if (Math.abs(count) > 1000) return send(400, { error: { code: "REQUEST_INVALID_COUNT" } });
    // negative: the N candles opened strictly before `from` (newest = the one containing `from`)
    const first = count < 0 ? Math.floor((fromMs - 1) / HOUR) * HOUR - (Math.abs(count) - 1) * HOUR : Math.ceil(fromMs / HOUR) * HOUR;
    const candles = [];
    for (let t = first, k = 0; k < Math.abs(count); t += HOUR, k++) {
      const c = 4000 + (t / HOUR) % 50;
      candles.push({ time: new Date(t).toISOString().replace(".000Z", "+00:00"), open: c, high: c + 2, low: c - 2, close: c + 1, volume: 10 });
    }
    return send(200, { candles });
  }
  send(404, { error: { code: "NOT_FOUND" } });
});
const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has("exness-ws-protocol") ? "exness-ws-protocol" : false) });
const sockets: WsSocket[] = [];
server.on("upgrade", (req, sock, head) => {
  stats.wsHandshakes++;
  if (req.url !== `/v1/server-events/accounts/${ACCOUNT}/ws/ticks` || verify("GET", req.url ?? "", req.headers)) {
    stats.wsRejected++;
    sock.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return sock.destroy();
  }
  wss.handleUpgrade(req, sock, head, (ws) => {
    sockets.push(ws);
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as { subscribe?: { event: string; instruments: string[] } };
      if (m.subscribe?.event === "ticks") {
        stats.subscribes.push(m.subscribe.instruments);
        for (const i of m.subscribe.instruments) ws.send(JSON.stringify({ instrument: i, bid: 4071.25, ask: 4071.45, timestamp: new Date().toISOString() }));
      }
    });
  });
});
const pushTick = (instrument: string, bid: number) => {
  for (const s of sockets) if (s.readyState === 1) s.send(JSON.stringify({ instrument, bid, ask: bid + 0.2, timestamp: new Date().toISOString() }));
};

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.EXNESS_API_KEY = API_KEY;
  process.env.EXNESS_API_SECRET = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.EXNESS_GATEWAY_URL = `http://127.0.0.1:${port}`;
  process.env.EXNESS_ACCOUNT_ID = ACCOUNT;
  const api = await import("../src/lib/exness-api");

  // official test vector (RFC 8032 public test key — not a credential)
  const rfc = api.loadExnessPrivateKey("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  const h = api.exnessHeaders({ apiKey: "exnsk-synthetic-example", key: rfc }, "GET", "/v1/trading/access-point?account_id=123456", "", "", 1773656070123);
  ok(h["EXN-SIGN"] === "l-H_Acia8YoTjKFMg-3fon3NOEX8TalNVA7c01DQ9dHb7pVBJC4y06qC-DbpETzh1KToiOprqEV6uzN3t69ICQ", "signature matches Exness's published test vector byte for byte");
  ok(api.exnessStatus().configured, "credentials load from .env-style variables (PEM key)");

  const bars = await api.exnessCandles("XAUUSD", "1h", 50);
  const q = stats.candleQueries.at(-1)!;
  ok(stats.badSig === 0, "every request passed the server's signature check");
  ok(q.get("instrument") === "XAUUSDm" && q.get("timeframe") === "H1" && q.get("price_type") === "bid", "gold resolved to the account's XAUUSDm, timeframe H1, bid prices");
  ok(bars.length === 50 && bars.every((b, i) => i === 0 || b.time > bars[i - 1].time), "50 candles, oldest → newest");
  ok(bars.at(-1)!.time === Math.floor(Date.now() / HOUR) * HOUR, "newest candle is the current hour (UTC)");
  const t0 = Date.now();
  await Promise.all([api.exnessCandles("XAUUSD", "1h", 5), api.exnessCandles("XAUUSD", "1h", 5), api.exnessCandles("XAUUSD", "1h", 5)]);
  ok(Date.now() - t0 >= 1000, "candle requests are spaced to stay within Exness's 2-per-second limit");
  let busy = "";
  const cold = Array.from({ length: 12 }, () => api.exnessCandles("EURUSD", "1h", 5, false).catch((e: Error) => { busy = e.message; return []; }));
  await Promise.all(cold);
  ok(/Exness busy/.test(busy), "background (scanner) requests that would wait too long are refused at once, so they use the next source");

  ok(q.get("count") === "-50", "asks for the last 50 candles before now (works across weekends)");
  const before = stats.candleQueries.length;
  const big = await api.exnessCandles("EURUSD", "1h", 1500);
  ok(stats.candleQueries.length - before === 2 && big.length === 1500 && new Set(big.map((b) => b.time)).size === 1500, "1500 candles are fetched as 1000 + 500 without gaps or duplicates");
  ok(stats.accessPoint === 1, "the access point is discovered once and cached");

  let missing = "";
  try {
    await api.exnessCandles("GBPJPY", "1h", 10);
  } catch (e) {
    missing = (e as Error).message;
  }
  ok(/not available on this Exness account/.test(missing), "a symbol the account does not have is reported clearly");

  // live ticks
  const got: number[] = [];
  const unsub = await api.subscribeExnessTicks("XAUUSD", (t) => got.push(t.bid));
  await sleep(800);
  ok(stats.wsHandshakes >= 1 && stats.wsRejected === 0, "tick WebSocket handshake passed the server's signature check");
  ok(JSON.stringify(stats.subscribes.at(-1)) === '["XAUUSDm"]', "subscribed to the account's own instrument name");
  ok(got[0] === 4071.25, "first tick (last price) arrives on subscribe");
  pushTick("XAUUSDm", 4075.5);
  await sleep(300);
  ok(got.at(-1) === 4075.5, "a new Exness tick reaches HALO");
  unsub?.();
  await sleep(300);
  pushTick("XAUUSDm", 4080);
  await sleep(300);
  ok(got.at(-1) === 4075.5, "after the last viewer leaves, the stream is closed");

  // a wrong key is refused by Exness — HALO surfaces the error
  api.resetExnessCaches();
  process.env.EXNESS_API_SECRET = crypto.generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  let authErr = "";
  try {
    await api.exnessCandles("XAUUSD", "1h", 10);
  } catch (e) {
    authErr = (e as Error).message;
  }
  ok(/HTTP 401/.test(authErr) && /AUTH_INVALID_SIGNATURE/.test(authErr), "a wrong private key is rejected (401 AUTH_INVALID_SIGNATURE) and reported");

  process.env.EXNESS_API_SECRET = "not-a-key";
  api.resetExnessCaches();
  ok(!api.exnessStatus().configured && /could not be loaded/.test(api.exnessStatus().error), "an unreadable secret is reported, never used");

  server.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
