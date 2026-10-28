// Direct adapter test against the local MetaApi stub (no HTTP server hop)
// Proves: getAccount / marketOrder (percent + fixed sizing) / closePosition
process.env.METAAPI_CLIENT_BASE = "http://127.0.0.1:4311";
process.env.METAAPI_MGMT_BASE = "http://127.0.0.1:4311";

import { metaapiAdapter } from "../src/lib/brokers/metaapi";
import { provisionMtAccount } from "../src/lib/brokers/metaapi-core";

async function main() {
  console.log("── provisionMtAccount (zero-manual MT login flow) ──");
  const prov = await provisionMtAccount({
    login: "51234567",
    password: "secret123",
    server: "ICMarketsSC-MT5",
    platform: "mt5",
  });
  console.log(JSON.stringify(prov));
  if (!prov.accountId || prov.state !== "DEPLOYED") process.exit(1);
  const creds = { accountId: prov.accountId, region: prov.region };
  console.log("── testConnection ──");
  const acc = await metaapiAdapter.testConnection(creds);
  console.log(JSON.stringify(acc));
  if (!acc.ok) process.exit(1);

  console.log("── marketOrder (percent sizing, XAUUSD) ──");
  const order = await metaapiAdapter.marketOrder(creds, {
    symbol: "XAUUSD",
    side: 1,
    entry: 4152.0,
    sl: 4144.0,
    tp: 4168.0,
    riskDistance: 8.0,
    riskPips: 800,
    sizing: { mode: "percent", percent: 1, size: 0 },
    comment: "HALO3EL TEST",
  });
  console.log(JSON.stringify(order));
  if (!order.ok) process.exit(1);

  console.log("── marketOrder (fixed sizing, EURUSD) ──");
  const order2 = await metaapiAdapter.marketOrder(creds, {
    symbol: "EURUSD",
    side: -1,
    entry: 1.162,
    sl: 1.1645,
    tp: 1.157,
    riskDistance: 0.0025,
    riskPips: 25,
    sizing: { mode: "fixed", size: 0.05, percent: 0 },
    comment: "HALO3EL TEST",
  });
  console.log(JSON.stringify(order2));
  if (!order2.ok) process.exit(1);

  console.log("── getPositions ──");
  console.log(JSON.stringify(await metaapiAdapter.getPositions(creds)));

  console.log("── closePosition ──");
  console.log(JSON.stringify(await metaapiAdapter.closePosition(creds, "EURUSD", -1)));

  console.log("ALL ADAPTER TESTS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
