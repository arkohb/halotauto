// Client-safe symbol/timeframe metadata (no server-side code)

export interface SymbolMeta {
  id: string;
  label: string;
  mintick: number;
  base: number;
}

export const SYMBOLS: SymbolMeta[] = [
  { id: "PAXGUSDT", label: "GOLD · PAXG/USDT", mintick: 0.01, base: 4180 },
  { id: "BTCUSDT", label: "BTC/USDT", mintick: 0.01, base: 84000 },
  { id: "ETHUSDT", label: "ETH/USDT", mintick: 0.01, base: 3100 },
  { id: "SOLUSDT", label: "SOL/USDT", mintick: 0.01, base: 210 },
  { id: "BNBUSDT", label: "BNB/USDT", mintick: 0.01, base: 920 },
  { id: "XRPUSDT", label: "XRP/USDT", mintick: 0.0001, base: 2.6 },
  { id: "DOGEUSDT", label: "DOGE/USDT", mintick: 0.00001, base: 0.32 },
];

export function getSymbolMeta(id: string): SymbolMeta {
  return SYMBOLS.find((s) => s.id === id) ?? SYMBOLS[0];
}

export const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export function tfSec(tf: string): number {
  const map: Record<string, number> = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "1d": 86400,
  };
  return map[tf] ?? 300;
}

export function decimalsOf(mintick: number): number {
  if (!isFinite(mintick) || mintick <= 0) return 2;
  if (mintick >= 1) return 0;
  return Math.min(8, Math.max(0, Math.round(-Math.log10(mintick))));
}
