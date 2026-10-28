// Client-safe broker metadata (used by the UI to render dynamic forms)

import type { BrokerKind } from "./types";

export interface CredField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "switch";
  options?: string[];
  placeholder?: string;
  hint?: string;
}

export interface BrokerMeta {
  kind: BrokerKind;
  name: string;
  tagline: string;
  supportsPercent: boolean;
  sizeLabel: string;
  sizeHint: string;
  fields: CredField[];
  notes: string[];
  bridge?: boolean;
}

export const BROKERS: BrokerMeta[] = [
  {
    kind: "oanda",
    name: "OANDA v20",
    tagline: "FX · metals · indices CFDs — practice or live REST API",
    supportsPercent: true,
    sizeLabel: "UNITS",
    sizeHint: "OANDA units of the base instrument (e.g. 10 = 10 oz XAU). Percent sizing = risk % of equity ÷ SL distance.",
    fields: [
      { key: "apiToken", label: "API token", type: "password", placeholder: "a1b2… (myfxbook/oanda token)" },
      { key: "accountId", label: "Account ID", type: "text", placeholder: "101-004-1234567-001" },
      { key: "environment", label: "Environment", type: "select", options: ["practice", "live"] },
    ],
    notes: [
      "Default symbol map: PAXGUSDT→XAU_USD, BTCUSDT→BTC_USD … override in advanced.",
      "Orders are market (FOK) with stopLossOnFill + takeProfitOnFill attached.",
    ],
  },
  {
    kind: "ig",
    name: "IG Markets",
    tagline: "Dealing API v3 — demo or live CFD account",
    supportsPercent: true,
    sizeLabel: "CONTRACTS",
    sizeHint: "IG size in contracts. Percent sizing = risk % of equity ÷ SL distance (1 unit of risk per point).",
    fields: [
      { key: "apiKey", label: "API key", type: "password", placeholder: "X-IG-API-KEY" },
      { key: "identifier", label: "Identifier", type: "text", placeholder: "your IG username" },
      { key: "password", label: "Password", type: "password", placeholder: "IG account password" },
      { key: "environment", label: "Environment", type: "select", options: ["demo", "live"] },
    ],
    notes: [
      "Set your epics in the symbol map, e.g. PAXGUSDT → CS.D.XAUUSD.CFDR.IP.",
      "Stop/limit distances use IG 'points' — override pointSizes if your market differs (FX 0.0001, JPY 0.01, metals 0.1, crypto 1).",
    ],
  },
  {
    kind: "metaapi",
    name: "MT4 / MT5 · MetaApi",
    tagline: "IC Markets · Pepperstone · XM · Exness · FTMO · Vantage …",
    supportsPercent: true,
    sizeLabel: "LOTS",
    sizeHint: "Volume in lots (0.01 min). Percent sizing uses the symbol's contract size fetched live.",
    fields: [
      { key: "token", label: "MetaApi token", type: "password", placeholder: "eyeJwt token from app.metaapi.cloud" },
      { key: "accountId", label: "Account ID", type: "text", placeholder: "account id from metaapi cloud" },
    ],
    notes: [
      "One connection covers virtually every MT4/MT5 CFD broker on earth.",
      "Account is auto-deployed; free tier works — create a copy of your MT account at app.metaapi.cloud.",
    ],
  },
  {
    kind: "binance",
    name: "Binance Spot",
    tagline: "Crypto leg — real spot orders + OCO SL/TP",
    supportsPercent: true,
    sizeLabel: "BASE QTY",
    sizeHint: "Quantity in base asset (e.g. 0.01 BTC). Percent sizing = risk % of USDT equity ÷ SL distance.",
    fields: [
      { key: "apiKey", label: "API key", type: "password" },
      { key: "apiSecret", label: "API secret", type: "password" },
      { key: "testnet", label: "Use testnet", type: "switch" },
    ],
    notes: [
      "Spot only → long (BUY) signals execute; SELL signals are rejected by design.",
      "HMAC-signed requests; enable only 'Enable Spot Trading' + 'Read' on the API key.",
    ],
  },
  {
    kind: "fxcm",
    name: "FXCM",
    tagline: "Via secure order bridge (socket.io API needs a host)",
    supportsPercent: false,
    sizeLabel: "LOTS",
    sizeHint: "Lots passed to your bridge; run the FXCM REST bridge sample and paste its URL.",
    fields: [
      { key: "bridgeUrl", label: "Bridge URL", type: "text", placeholder: "https://your-host/fxcm-bridge" },
      { key: "secret", label: "Shared secret (optional)", type: "password", placeholder: "HMAC verified on both sides" },
    ],
    notes: ["The bridge receives {action:'open', sl, tp, size …} and executes via FXCM REST."],
    bridge: true,
  },
  {
    kind: "ctrader",
    name: "cTrader",
    tagline: "Via bridge (Open API is protobuf/TCP — needs a gateway)",
    supportsPercent: false,
    sizeLabel: "VOLUME",
    sizeHint: "Volume in 100k units passed to your cBot / gateway bridge.",
    fields: [
      { key: "bridgeUrl", label: "Bridge URL", type: "text", placeholder: "https://your-host/ctrader-bridge" },
      { key: "secret", label: "Shared secret (optional)", type: "password" },
    ],
    notes: ["Point a cBot or the cTrader Open API gateway at this URL and it executes 3EL orders."],
    bridge: true,
  },
  {
    kind: "deriv",
    name: "Deriv",
    tagline: "Via bridge (websocket API + multiplier contracts)",
    supportsPercent: false,
    sizeLabel: "STAKE",
    sizeHint: "Stake/contracts passed to your bridge which maps them to Deriv multipliers.",
    fields: [
      { key: "bridgeUrl", label: "Bridge URL", type: "text", placeholder: "https://your-host/deriv-bridge" },
      { key: "secret", label: "Shared secret (optional)", type: "password" },
    ],
    notes: ["frxXAUUSD / cryBTCUSD mappings go in the symbol map."],
    bridge: true,
  },
  {
    kind: "webhook",
    name: "Custom bridge / Webhook",
    tagline: "Any platform — MT5 EA, TradingView-style receiver, own gateway",
    supportsPercent: false,
    sizeLabel: "SIZE",
    sizeHint: "Free-form size forwarded to your receiver.",
    fields: [
      { key: "bridgeUrl", label: "Webhook URL", type: "text", placeholder: "https://your-host/order" },
      { key: "secret", label: "Shared secret (optional)", type: "password" },
    ],
    notes: [
      "Payload: {action:'open', symbol, side, entry, sl, tp, riskDistance, size, comment} + X-HALO-SIGN HMAC header when a secret is set.",
      "Reply 2xx with {ok:true, orderId?, price?}.",
    ],
    bridge: true,
  },
  {
    kind: "paper",
    name: "Paper (simulated)",
    tagline: "Instant simulated fills — test the live pipeline risk-free",
    supportsPercent: false,
    sizeLabel: "SIZE",
    sizeHint: "Simulated size recorded on the trade.",
    fields: [],
    notes: ["No credentials needed. Fills at the theoretical level price."],
  },
];

export function brokerMeta(kind: string): BrokerMeta | undefined {
  return BROKERS.find((b) => b.kind === kind);
}
