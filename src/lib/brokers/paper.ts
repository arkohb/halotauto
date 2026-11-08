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
  PendingOrderInfo,
  PositionInfo,
  mapWith,
} from "./types";

/** persistent demo balance (lib/paper-account.ts). Lazy import: paper-account
 *  imports execution, which imports this module graph. */
async function currentBalance(): Promise<number> {
  const { getPaperAccount } = await import("../paper-account");
  return (await getPaperAccount()).balance;
}

async function paperAccount(equity?: number): Promise<AccountInfo> {
  const balance = await currentBalance();
  const eq = equity ?? balance;
  return {
    ok: true,
    id: "paper",
    currency: "USD",
    balance,
    equity: eq,
    margin: 0,
    freeMargin: eq,
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
  async closePosition(_creds): Promise<OrderResult> {
    return { ok: true, brokerOrderId: `paper-close-${Date.now().toString(36)}` };
  },
  async getPositions(): Promise<PositionInfo[]> {
    return [];
  },
  async getOrders(): Promise<PendingOrderInfo[]> {
    return [];
  },
  async cancelOrder(): Promise<OrderResult> {
    return { ok: true };
  },
};
