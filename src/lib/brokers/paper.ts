// ════════════════════════════════════════════════════════════════════════
//  PAPER adapter · instant simulated fills for testing the LIVE pipeline
//  without real money. Mirrors the adapter contract 1:1.
// ════════════════════════════════════════════════════════════════════════

import {
  AccountInfo,
  BrokerAdapter,
  BrokerCreds,
  OrderRequest,
  OrderResult,
  PositionInfo,
  mapWith,
} from "./types";

const FAKE_BALANCE = 100000;

function paperAccount(equity = FAKE_BALANCE): AccountInfo {
  return {
    ok: true,
    id: "paper",
    currency: "USD",
    balance: FAKE_BALANCE,
    equity,
    margin: 0,
    freeMargin: equity,
    marginLevel: 0,
    leverage: 500,
    login: "HALO-EA",
    server: "HALO PAPER SERVER",
    brokerName: "HALO 3EL Simulator",
    platform: "MT5",
  };
}

export const paperAdapter: BrokerAdapter = {
  kind: "paper",
  mapSymbol: (creds, symbol) => mapWith(creds, symbol, {}),
  async testConnection(): Promise<AccountInfo> {
    return paperAccount();
  },
  async getAccount(): Promise<AccountInfo> {
    return paperAccount();
  },
  async marketOrder(_creds, req: OrderRequest): Promise<OrderResult> {
    const vol = req.sizing.mode === "fixed" ? req.sizing.size : 1;
    return {
      ok: true,
      brokerOrderId: `paper-${Date.now().toString(36)}`,
      fillPrice: req.entry,
      volume: Math.max(0.01, Math.round(vol * 100) / 100),
    };
  },
  async closePosition(): Promise<OrderResult> {
    return { ok: true, brokerOrderId: `paper-close-${Date.now().toString(36)}` };
  },
  async getPositions(): Promise<PositionInfo[]> {
    return [];
  },
};
