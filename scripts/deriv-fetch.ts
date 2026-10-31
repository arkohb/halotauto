// One-shot: pull the FULL authoritative Deriv symbol catalog from the public
// Deriv WebSocket API (market data needs no auth token, app_id 1089 = docs demo).
// Output: JSON rows {symbol, display_name, market, submarket, pip, spot, open}
// so market-symbols.ts can be built from real data instead of guesses.

const APP_ID = "1089";
const URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

interface ActiveSymbol {
  symbol: string;
  display_name: string;
  market: string;
  submarket: string;
  market_display_name: string;
  pip: number;
  spot: number | null;
  exchange_is_open: number;
  is_trading_suspended: number;
}

const ws = new WebSocket(URL);
const timer = setTimeout(() => {
  console.error("TIMEOUT waiting for active_symbols");
  process.exit(2);
}, 20000);

ws.onopen = () => {
  ws.send(JSON.stringify({ active_symbols: "full", product_type: "basic" }));
};

ws.onmessage = (ev: MessageEvent) => {
  try {
    const msg = JSON.parse(String(ev.data)) as {
      msg_type?: string;
      active_symbols?: ActiveSymbol[];
      error?: { message?: string };
    };
    if (msg.msg_type === "active_symbols") {
      clearTimeout(timer);
      if (msg.error) {
        console.error("API ERROR:", msg.error.message);
        process.exit(2);
      }
      const rows = (msg.active_symbols ?? []).map((s) => ({
        symbol: s.symbol,
        display_name: s.display_name,
        market: s.market,
        market_display_name: s.market_display_name,
        submarket: s.submarket,
        pip: s.pip,
        spot: s.spot,
        open: s.exchange_is_open,
        suspended: s.is_trading_suspended,
      }));
      const wanted = rows.filter(
        (r) =>
          r.market === "synthetic_index" ||
          r.market === "stock_indices" ||
          r.market === "commodities" ||
          r.market === "forex"
      );
      console.log(JSON.stringify({ total: rows.length, interesting: wanted.length }, null, 0));
      console.log(JSON.stringify(wanted, null, 1));
      ws.close();
      process.exit(0);
    }
    if (msg.error) {
      clearTimeout(timer);
      console.error("API ERROR:", msg.error.message ?? JSON.stringify(msg.error));
      process.exit(2);
    }
  } catch (e) {
    // ignore non-JSON frames
  }
};

ws.onerror = (e) => {
  clearTimeout(timer);
  console.error("WS ERROR", e);
  process.exit(3);
};
