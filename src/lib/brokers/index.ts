// ════════════════════════════════════════════════════════════════════════
//  BROKER REGISTRY · resolve adapters, mask credentials
//  SERVER-ONLY (imports adapters that use crypto / node APIs).
// ════════════════════════════════════════════════════════════════════════

import { BrokerAdapter, BrokerCreds, BrokerKind } from "./types";
import { oandaAdapter } from "./oanda";
import { igAdapter } from "./ig";
import { metaapiAdapter } from "./metaapi";
import { binanceAdapter } from "./binance";
import { paperAdapter } from "./paper";
import { createBridgeAdapter } from "./bridge";

const fxcmAdapter = createBridgeAdapter("fxcm");
const ctraderAdapter = createBridgeAdapter("ctrader");
const derivAdapter = createBridgeAdapter("deriv");
const webhookAdapter = createBridgeAdapter("webhook");

const REGISTRY: Record<BrokerKind, BrokerAdapter> = {
  paper: paperAdapter,
  oanda: oandaAdapter,
  ig: igAdapter,
  metaapi: metaapiAdapter,
  binance: binanceAdapter,
  fxcm: fxcmAdapter,
  ctrader: ctraderAdapter,
  deriv: derivAdapter,
  webhook: webhookAdapter,
};

export function isBrokerKind(k: string): k is BrokerKind {
  return Object.prototype.hasOwnProperty.call(REGISTRY, k);
}

export function getAdapter(kind: BrokerKind): BrokerAdapter {
  return REGISTRY[kind];
}

export function parseCreds(json: string): BrokerCreds {
  try {
    const j = JSON.parse(json) as BrokerCreds;
    return typeof j === "object" && j ? j : {};
  } catch {
    return {};
  }
}

const SECRET_KEYS = [
  "apiToken",
  "token",
  "apiKey",
  "apiSecret",
  "password",
  "secret",
  "accountId",
  "identifier",
  "chatId",
];

/** mask credentials for API/UI transport — never send raw secrets to the client */
export function maskCreds(creds: BrokerCreds): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (v === undefined || v === null) continue;
    if (k === "symbolMap" || k === "pointSizes") {
      out[k] = "configured";
      continue;
    }
    const s = String(v);
    if (SECRET_KEYS.includes(k)) {
      out[k] = s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
    } else if (typeof v === "boolean") {
      out[k] = s;
    } else {
      out[k] = s.length > 42 ? `${s.slice(0, 42)}…` : s;
    }
  }
  return out;
}

/** merge a creds patch: masked values ("••••…") keep the stored original */
export function mergeCreds(existingJson: string, patch: Record<string, unknown>): string {
  const existing = parseCreds(existingJson);
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "symbolMap" || k === "pointSizes") {
      out[k] = v;
      continue;
    }
    if (typeof v === "string" && v.includes("••")) continue; // masked → keep old
    if (v === "" || v === undefined || v === null) delete out[k];
    else out[k] = v;
  }
  return JSON.stringify(out);
}
