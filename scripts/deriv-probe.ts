// One-off probe: verify Deriv WS API reachability + message shapes from sandbox.
// Run: bun scripts/deriv-probe.ts
const APP_ID = "1089";
const url = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const ws = new WebSocket(url);
let reqId = 0;
const pending = new Map<number, { resolve: (v: any) => void }>();

function send(req: Record<string, unknown>): Promise<any> {
  const id = ++reqId;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ ...req, req_id: id }));
  });
}

const timeout = setTimeout(() => {
  console.error("PROBE TIMEOUT");
  process.exit(1);
}, 25000);

ws.onopen = async () => {
  console.log("OPEN ok");
  try {
    // 1) active_symbols — validate symbol codes for our catalog
    const act = await send({ active_symbols: "brief", product_type: "basic" });
    const syms: any[] = act.active_symbols ?? [];
    console.log("active_symbols count:", syms.length, "err:", act.error?.code ?? "none");
    const interesting = syms.filter((s) =>
      /volatility|boom|crash|step|jump|range break|drift|skew|multi|ladder|trek|dex|switch|hf/i.test(s.display_name || "")
    );
    for (const s of interesting.slice(0, 90)) console.log(`  ${s.symbol}  |  ${s.display_name}  | market=${s.market} sub=${s.submarket}`);
    const fx = syms.filter((s) => s.market === "forex").slice(0, 12);
    console.log("forex sample:");
    for (const s of fx) console.log(`  ${s.symbol} | ${s.display_name}`);
    const metals = syms.filter((s) => s.market === "commodities" || /metal/i.test(s.submarket || ""));
    console.log("metals/commodities sample:");
    for (const s of metals.slice(0, 12)) console.log(`  ${s.symbol} | ${s.display_name} | ${s.submarket}`);
    const idx = syms.filter((s) => s.market === "stock_indices" || s.market === "indices");
    console.log("stock indices sample:");
    for (const s of idx.slice(0, 20)) console.log(`  ${s.symbol} | ${s.display_name} | ${s.submarket}`);
    const crypto = syms.filter((s) => s.market === "cryptocurrency");
    console.log("crypto sample:");
    for (const s of crypto.slice(0, 10)) console.log(`  ${s.symbol} | ${s.display_name}`);

    // 2) ticks_history candles for R_100 (VOL 100) — real synthetic OHLC
    const hist = await send({
      ticks_history: "R_100",
      adjust_start_time: 1,
      count: 30,
      end: "latest",
      style: "candles",
      granularity: 60,
    });
    console.log("R_100 candles err:", hist.error?.code ?? "none", "n=", (hist.candles ?? []).length);
    if (hist.candles?.length) console.log("  last 2:", JSON.stringify(hist.candles.slice(-2)));

    // 3) live ohlc subscription — should push updates every ~2s
    const subId = ++reqId;
    let ohlcCount = 0;
    ws.send(JSON.stringify({ ticks_history: "R_100", count: 5, end: "latest", style: "candles", granularity: 60, subscribe: 1, req_id: subId }));
    const sub2 = ++reqId;
    ws.send(JSON.stringify({ ticks_history: "frxEURUSD", count: 5, end: "latest", style: "candles", granularity: 60, subscribe: 1, req_id: sub2 }));
    const t0 = Date.now();
    await new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (Date.now() - t0 > 9000) {
          clearInterval(iv);
          resolve();
        }
      }, 500);
    });
    console.log("live ohlc events received:", ohlcCount);
    console.log("PROBE DONE");
    clearTimeout(timeout);
    process.exit(0);
  } catch (e) {
    console.error("PROBE ERROR", e);
    process.exit(1);
  }
};

ws.onmessage = (ev) => {
  try {
    const m = JSON.parse(String(ev.data));
    if (m.req_id && pending.has(m.req_id)) {
      pending.get(m.req_id)!.resolve(m);
      pending.delete(m.req_id);
      return;
    }
    if (m.msg_type === "ohlc") {
      console.log(`  OHLC ${m.ohlc.symbol} g=${m.ohlc.granularity} O=${m.ohlc.open} H=${m.ohlc.high} L=${m.ohlc.low} C=${m.ohlc.close} open_time=${m.ohlc.open_time}`);
    } else if (m.msg_type === "candles" && m.subscription) {
      console.log(`  SUB-HISTORY ${m.echo_req?.ticks_history} n=${m.candles?.length} subId=${m.subscription?.id}`);
    } else if (m.msg_type === "ping") {
      ws.send(JSON.stringify({ ping: m.ping }));
    } else if (m.error) {
      console.log("  ERR:", m.error.code, m.error.message, JSON.stringify(m.echo_req ?? {}));
    }
  } catch {
    // ignore parse errors
  }
};

ws.onerror = (e) => {
  console.error("WS ERROR", (e as any)?.message ?? e);
};
ws.onclose = (ev) => {
  console.log("WS CLOSE", ev.code, ev.reason);
};
