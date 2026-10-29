// Client-safe symbol/timeframe metadata (no server-side code)

export interface SymbolMeta {
  id: string;
  label: string;
  mintick: number;
  base: number;
  /** asset class group key */
  group: SymbolGroup;
  /** TradingView advanced-chart symbol, e.g. OANDA:EURUSD */
  tv: string;
}

export type SymbolGroup = "CRYPTO" | "FOREX" | "METALS";

export interface SymbolGroupMeta {
  key: SymbolGroup;
  label: string;
}

export const SYMBOL_GROUPS: SymbolGroupMeta[] = [
  { key: "FOREX", label: "Forex · Majors & Crosses" },
  { key: "METALS", label: "Metals · Gold Silver Platinum" },
  { key: "CRYPTO", label: "Crypto · Binance" },
];

// ── FOREX · majors (7) ──
const FX_MAJORS: Array<[string, string, number, number]> = [
  // id, label, mintick, base (simulator anchor price)
  ["EURUSD", "EUR/USD", 0.00001, 1.162],
  ["GBPUSD", "GBP/USD", 0.00001, 1.332],
  ["USDJPY", "USD/JPY", 0.001, 153.4],
  ["USDCHF", "USD/CHF", 0.00001, 0.802],
  ["USDCAD", "USD/CAD", 0.00001, 1.391],
  ["AUDUSD", "AUD/USD", 0.00001, 0.652],
  ["NZDUSD", "NZD/USD", 0.00001, 0.582],
];

// ── FOREX · crosses (19) ──
const FX_CROSSES: Array<[string, string, number, number]> = [
  ["EURGBP", "EUR/GBP", 0.00001, 0.872],
  ["EURJPY", "EUR/JPY", 0.001, 178.3],
  ["EURCHF", "EUR/CHF", 0.00001, 0.932],
  ["EURAUD", "EUR/AUD", 0.00001, 1.782],
  ["EURCAD", "EUR/CAD", 0.00001, 1.616],
  ["EURNZD", "EUR/NZD", 0.00001, 1.996],
  ["GBPJPY", "GBP/JPY", 0.001, 204.3],
  ["GBPCHF", "GBP/CHF", 0.00001, 1.068],
  ["GBPAUD", "GBP/AUD", 0.00001, 2.043],
  ["GBPCAD", "GBP/CAD", 0.00001, 1.853],
  ["GBPNZD", "GBP/NZD", 0.00001, 2.289],
  ["AUDJPY", "AUD/JPY", 0.001, 100.0],
  ["AUDCAD", "AUD/CAD", 0.00001, 0.907],
  ["AUDNZD", "AUD/NZD", 0.00001, 1.120],
  ["NZDJPY", "NZD/JPY", 0.001, 89.3],
  ["NZDCAD", "NZD/CAD", 0.00001, 0.810],
  ["CADJPY", "CAD/JPY", 0.001, 110.3],
  ["CADCHF", "CAD/CHF", 0.00001, 0.577],
  ["CHFJPY", "CHF/JPY", 0.001, 191.3],
];

// ── METALS (5) ──
const METALS: Array<[string, string, number, number, string]> = [
  // id, label, mintick, base, tv suffix (OANDA)
  ["XAUUSD", "GOLD · XAU/USD", 0.01, 4152, "XAUUSD"],
  ["XAGUSD", "SILVER · XAG/USD", 0.001, 48.6, "XAGUSD"],
  ["XPTUSD", "PLATINUM · XPT/USD", 0.1, 1615, "XPTUSD"],
  ["XPDUSD", "PALLADIUM · XPD/USD", 0.1, 1452, "XPDUSD"],
  ["XCUUSD", "COPPER · XCU/USD", 0.0001, 5.12, "XCUUSD"],
];

// ── CRYPTO (7) ──
const CRYPTO: Array<[string, string, number, number]> = [
  ["PAXGUSDT", "GOLD · PAXG/USDT", 0.01, 4180],
  ["BTCUSDT", "BTC/USDT", 0.01, 84000],
  ["ETHUSDT", "ETH/USDT", 0.01, 3100],
  ["SOLUSDT", "SOL/USDT", 0.01, 210],
  ["BNBUSDT", "BNB/USDT", 0.01, 920],
  ["XRPUSDT", "XRP/USDT", 0.0001, 2.6],
  ["DOGEUSDT", "DOGE/USDT", 0.00001, 0.32],
];

function build(): SymbolMeta[] {
  const out: SymbolMeta[] = [];
  for (const [id, label, mintick, base] of FX_MAJORS) {
    out.push({ id, label, mintick, base, group: "FOREX", tv: `OANDA:${id}` });
  }
  for (const [id, label, mintick, base] of FX_CROSSES) {
    out.push({ id, label, mintick, base, group: "FOREX", tv: `OANDA:${id}` });
  }
  for (const [id, label, mintick, base, tvs] of METALS) {
    out.push({ id, label, mintick, base, group: "METALS", tv: `OANDA:${tvs}` });
  }
  for (const [id, label, mintick, base] of CRYPTO) {
    out.push({ id, label, mintick, base, group: "CRYPTO", tv: `BINANCE:${id}` });
  }
  return out;
}

export const SYMBOLS: SymbolMeta[] = build();

export function symbolsByGroup(g: SymbolGroup): SymbolMeta[] {
  return SYMBOLS.filter((s) => s.group === g);
}

export function getSymbolMeta(id: string): SymbolMeta {
  return SYMBOLS.find((s) => s.id === id) ?? SYMBOLS[0];
}

export function tvSymbolOf(id: string): string {
  return getSymbolMeta(id).tv;
}

export const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** internal tf → TradingView widget interval */
export function tvInterval(tf: string): string {
  const map: Record<string, string> = {
    "1m": "1",
    "3m": "3",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "1d": "D",
  };
  return map[tf] ?? "5";
}

export function tfSec(tf: string): number {
  const map: Record<string, number> = {
    "1m": 60,
    "2m": 120,
    "3m": 180,
    "5m": 300,
    "10m": 600,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "3h": 10800,
    "4h": 14400,
    "6h": 21600,
    "8h": 28800,
    "12h": 43200,
    "1d": 86400,
    "3d": 259200,
    "1w": 604800,
  };
  return map[tf] ?? 300;
}

// ── BACKTEST TIMEFRAMES · every standard bar size, M1 → W1 ──
// The live chart keeps the 9-preset TIMEFRAMES list; the backtest dashboard
// accepts any of these so one can "back test any bar of choice".
export interface BtTf {
  id: string;
  sec: number;
  label: string;
}

export const BT_TIMEFRAMES: BtTf[] = [
  { id: "1m", sec: 60, label: "M1 · 1 minute" },
  { id: "2m", sec: 120, label: "M2 · 2 minutes" },
  { id: "3m", sec: 180, label: "M3 · 3 minutes" },
  { id: "5m", sec: 300, label: "M5 · 5 minutes" },
  { id: "10m", sec: 600, label: "M10 · 10 minutes" },
  { id: "15m", sec: 900, label: "M15 · 15 minutes" },
  { id: "30m", sec: 1800, label: "M30 · 30 minutes" },
  { id: "1h", sec: 3600, label: "H1 · 1 hour" },
  { id: "2h", sec: 7200, label: "H2 · 2 hours" },
  { id: "3h", sec: 10800, label: "H3 · 3 hours" },
  { id: "4h", sec: 14400, label: "H4 · 4 hours" },
  { id: "6h", sec: 21600, label: "H6 · 6 hours" },
  { id: "8h", sec: 28800, label: "H8 · 8 hours" },
  { id: "12h", sec: 43200, label: "H12 · 12 hours" },
  { id: "1d", sec: 86400, label: "D1 · 1 day" },
  { id: "3d", sec: 259200, label: "D3 · 3 days" },
  { id: "1w", sec: 604800, label: "W1 · 1 week" },
];

export function isBtTf(tf: string): boolean {
  return BT_TIMEFRAMES.some((t) => t.id === tf);
}

export function decimalsOf(mintick: number): number {
  if (!isFinite(mintick) || mintick <= 0) return 2;
  if (mintick >= 1) return 0;
  return Math.min(8, Math.max(0, Math.round(-Math.log10(mintick))));
}
