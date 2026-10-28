// ════════════════════════════════════════════════════════════════════════
//  BROKER ADAPTER CONTRACT · HALO 3EL Autotrader
//  One interface, many CFD brokers. Every adapter executes REAL market
//  orders with SL/TP against its broker's API.
// ════════════════════════════════════════════════════════════════════════

export type BrokerKind =
  | "paper"
  | "oanda"
  | "ig"
  | "metaapi"
  | "binance"
  | "fxcm"
  | "ctrader"
  | "deriv"
  | "webhook";

export interface BrokerCreds {
  [key: string]: string | number | boolean | Record<string, string> | undefined;
  symbolMap?: Record<string, string>; // internal symbol → broker symbol
}

export interface OrderSizing {
  mode: "fixed" | "percent";
  /** fixed: native size (OANDA units / MT lots / IG contracts / crypto base qty) */
  size: number;
  /** percent: risk this % of account equity per trade (riskDistance = |entry−sl|) */
  percent: number;
}

export interface OrderRequest {
  symbol: string; // internal id, e.g. PAXGUSDT
  side: -1 | 1; // -1 SELL / short · +1 BUY / long
  entry: number; // theoretical entry (level edge)
  sl: number;
  tp: number;
  riskDistance: number; // |entry − sl| in price units
  riskPips: number;
  sizing: OrderSizing;
  comment: string;
}

export interface OrderResult {
  ok: boolean;
  brokerOrderId?: string;
  fillPrice?: number;
  volume?: number; // native volume actually used
  error?: string;
  raw?: unknown;
}

export interface AccountInfo {
  ok: boolean;
  id?: string;
  currency?: string;
  balance?: number;
  equity?: number;
  error?: string;
  raw?: unknown;
}

export interface PositionInfo {
  id: string;
  symbol: string; // broker-side symbol
  side: -1 | 1;
  volume: number;
  entryPrice?: number;
  sl?: number;
  tp?: number;
  unrealizedPnl?: number;
}

export interface BrokerAdapter {
  kind: BrokerKind;
  /** internal symbol id → broker-native symbol */
  mapSymbol(creds: BrokerCreds, symbol: string): string;
  /** verify credentials, return account summary */
  testConnection(creds: BrokerCreds): Promise<AccountInfo>;
  getAccount(creds: BrokerCreds): Promise<AccountInfo>;
  marketOrder(creds: BrokerCreds, req: OrderRequest): Promise<OrderResult>;
  /** close the open position on `symbol` (side optional filter) */
  closePosition(creds: BrokerCreds, symbol: string, side?: -1 | 1): Promise<OrderResult>;
  getPositions(creds: BrokerCreds, symbol?: string): Promise<PositionInfo[]>;
}

// ─── shared helpers ────────────────────────────────────────────────────

export class BrokerError extends Error {}

export async function jfetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg =
        (body && typeof body === "object"
          ? JSON.stringify(body).slice(0, 300)
          : String(body ?? "").slice(0, 300)) || `HTTP ${res.status}`;
      throw new BrokerError(`HTTP ${res.status} — ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

/** round a price to sensible decimals based on magnitude (blind-mode helper) */
export function roundPx(px: number): number {
  const a = Math.abs(px);
  if (a >= 500) return Math.round(px * 100) / 100;
  if (a >= 20) return Math.round(px * 1000) / 1000;
  if (a >= 2) return Math.round(px * 10000) / 10000;
  return Math.round(px * 1000000) / 1000000;
}

/** native size for a percent sizing request (units = riskAmt / dist) */
export function percentUnits(
  equity: number,
  percent: number,
  riskDistance: number,
  minUnits = 1
): number {
  const riskAmt = (equity * percent) / 100;
  if (riskDistance <= 0 || riskAmt <= 0) return minUnits;
  return Math.max(minUnits, Math.floor((riskAmt / riskDistance) * 10) / 10);
}

export function mapWith(
  creds: BrokerCreds,
  symbol: string,
  defaults: Record<string, string>
): string {
  const m = creds.symbolMap;
  if (m && typeof m === "object" && m[symbol]) return m[symbol];
  return defaults[symbol] ?? symbol;
}
