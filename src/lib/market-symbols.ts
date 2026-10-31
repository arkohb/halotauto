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

export type SymbolGroup = "CRYPTO" | "FOREX" | "METALS" | "SYNTHETICS" | "INDICES";

export interface SymbolGroupMeta {
  key: SymbolGroup;
  label: string;
}

export const SYMBOL_GROUPS: SymbolGroupMeta[] = [
  { key: "SYNTHETICS", label: "Deriv · Synthetic Indices" },
  { key: "FOREX", label: "Forex · Majors & Crosses" },
  { key: "INDICES", label: "Deriv · Stock Indices & Energy" },
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

// ── FOREX · Deriv exotics (20) — traded on Deriv MT5, real Yahoo FX data ──
const FX_EXOTICS: Array<[string, string, number]> = [
  // id, label, base (simulator anchor when Yahoo is unreachable)
  ["USDZAR", "USD/ZAR", 17.42],
  ["USDTRY", "USD/TRY", 48.9],
  ["USDMXN", "USD/MXN", 18.31],
  ["USDNOK", "USD/NOK", 10.12],
  ["USDSEK", "USD/SEK", 9.45],
  ["USDSGD", "USD/SGD", 1.29],
  ["USDHKD", "USD/HKD", 7.78],
  ["USDPLN", "USD/PLN", 3.62],
  ["USDCNH", "USD/CNH", 7.09],
  ["USDILS", "USD/ILS", 3.35],
  ["USDINR", "USD/INR", 88.4],
  ["USDTHB", "USD/THB", 32.2],
  ["USDBRL", "USD/BRL", 5.35],
  ["USDCZK", "USD/CZK", 20.9],
  ["USDDKK", "USD/DKK", 6.36],
  ["USDHUF", "USD/HUF", 332.0],
  ["EURTRY", "EUR/TRY", 56.8],
  ["EURPLN", "EUR/PLN", 4.21],
  ["EURNOK", "EUR/NOK", 11.72],
  ["EURSEK", "EUR/SEK", 10.95],
];

// ── DERIV · SYNTHETIC INDICES — the full official catalog ──
// Sources: deriv.com/markets/derived-indices/synthetic-indices (family
// membership, 2026) + per-symbol TradingView pages (DERIV: pro names and
// live anchor prices). `base` feeds the built-in simulator ONLY — synthetics
// have no public OHLC feed, so charts/candles for this group come from the
// seeded simulator and are always labelled "SIM". Entries marked `est` use a
// family interpolation where no public price exists.
interface DerivSpec {
  id: string;
  label: string;
  mintick: number;
  base: number;
  tv?: string; // TradingView pro symbol — omitted when TV carries no feed
}

const DERIV_VOLS: DerivSpec[] = [
  // continuous volatility indices
  { id: "V5", label: "VOL 5", mintick: 0.001, base: 100796.904, tv: "DERIV:VOLATILITY_5_INDEX" },
  { id: "V10", label: "VOL 10", mintick: 0.001, base: 4902.879, tv: "DERIV:VOLATILITY_10_INDEX" },
  { id: "V15", label: "VOL 15", mintick: 0.01, base: 103598.56, tv: "DERIV:VOLATILITY_15_INDEX" },
  { id: "V25", label: "VOL 25", mintick: 0.001, base: 2928.4, tv: "DERIV:VOLATILITY_25_INDEX" },
  { id: "V30", label: "VOL 30", mintick: 0.001, base: 96113.0, tv: "DERIV:VOLATILITY_30_INDEX" },
  { id: "V50", label: "VOL 50", mintick: 0.0001, base: 87.5246, tv: "DERIV:VOLATILITY_50_INDEX" },
  { id: "V75", label: "VOL 75", mintick: 0.01, base: 39040.51, tv: "DERIV:VOLATILITY_75_INDEX" },
  { id: "V90", label: "VOL 90", mintick: 0.01, base: 140918.09, tv: "DERIV:VOLATILITY_90_INDEX" },
  { id: "V100", label: "VOL 100", mintick: 0.01, base: 565.17, tv: "DERIV:VOLATILITY_100_INDEX" },
  // 1-second variants
  { id: "V5S", label: "VOL 5 (1S)", mintick: 0.01, base: 97010.1, tv: "DERIV:VOLATILITY_5_1S_INDEX" },
  { id: "V10S", label: "VOL 10 (1S)", mintick: 0.01, base: 9567.33, tv: "DERIV:VOLATILITY_10_1S_INDEX" },
  { id: "V15S", label: "VOL 15 (1S)", mintick: 0.001, base: 13372.009, tv: "DERIV:VOLATILITY_15_1S_INDEX" },
  { id: "V25S", label: "VOL 25 (1S)", mintick: 0.01, base: 943115.12, tv: "DERIV:VOLATILITY_25_1S_INDEX" },
  { id: "V30S", label: "VOL 30 (1S)", mintick: 0.01, base: 6070.579, tv: "DERIV:VOLATILITY_30_1S_INDEX" },
  { id: "V50S", label: "VOL 50 (1S)", mintick: 0.01, base: 201007.72, tv: "DERIV:VOLATILITY_50_1S_INDEX" },
  { id: "V75S", label: "VOL 75 (1S)", mintick: 0.01, base: 4874.37, tv: "DERIV:VOLATILITY_75_1S_INDEX" },
  { id: "V90S", label: "VOL 90 (1S)", mintick: 0.01, base: 28598.041, tv: "DERIV:VOLATILITY_90_1S_INDEX" },
  { id: "V100S", label: "VOL 100 (1S)", mintick: 0.01, base: 1232.31, tv: "DERIV:VOLATILITY_100_1S_INDEX" },
  { id: "V150S", label: "VOL 150 (1S)", mintick: 0.01, base: 50.45, tv: "DERIV:VOLATILITY_150_1S_INDEX" },
  { id: "V250S", label: "VOL 250 (1S)", mintick: 0.00001, base: 0.29329, tv: "DERIV:VOLATILITY_250_1S_INDEX" },
];

function boomCrash(family: "BOOM" | "CRASH", n: number, mintick: number, base: number, tv?: string): DerivSpec {
  const fam = family === "BOOM" ? "BOOM" : "CRASH";
  return { id: `${fam}${n}`, label: `${fam} ${n}`, mintick, base, tv };
}

const DERIV_BOOM_CRASH: DerivSpec[] = [
  boomCrash("BOOM", 50, 0.001, 104737.206, "DERIV:BOOM_50_INDEX"),
  boomCrash("BOOM", 99, 0.001, 106885.083, "DERIV:BOOM_99_INDEX"),
  boomCrash("BOOM", 100, 0.001, 95479.79, "DERIV:BOOM_100_INDEX"),
  boomCrash("BOOM", 150, 0.0001, 9608.0491, "DERIV:BOOM_150_INDEX"),
  boomCrash("BOOM", 200, 0.001, 101064.156, "DERIV:BOOM_200_INDEX"),
  boomCrash("BOOM", 300, 0.001, 341.356, "DERIV:BOOM_300_INDEX"),
  boomCrash("BOOM", 400, 0.001, 4100.0), // est — no public feed
  boomCrash("BOOM", 500, 0.001, 5907.892, "DERIV:BOOM_500_INDEX"),
  boomCrash("BOOM", 550, 0.001, 7100.0), // est — no public feed
  boomCrash("BOOM", 600, 0.001, 5486.801, "DERIV:BOOM_600_INDEX"),
  boomCrash("BOOM", 750, 0.001, 9500.0), // est — no public feed
  boomCrash("BOOM", 900, 0.001, 9006.224, "DERIV:BOOM_900_INDEX"),
  boomCrash("BOOM", 1000, 0.0001, 14955.1072, "DERIV:BOOM_1000_INDEX"),
  boomCrash("CRASH", 50, 0.001, 98849.082, "DERIV:CRASH_50_INDEX"),
  boomCrash("CRASH", 99, 0.001, 95393.09, "DERIV:CRASH_99_INDEX"),
  boomCrash("CRASH", 100, 0.001, 94052.944, "DERIV:CRASH_100_INDEX"),
  boomCrash("CRASH", 150, 0.0001, 9395.5279, "DERIV:CRASH_150_INDEX"),
  boomCrash("CRASH", 200, 0.001, 101823.14, "DERIV:CRASH_200_INDEX"),
  boomCrash("CRASH", 300, 0.001, 2364.405, "DERIV:CRASH_300_INDEX"),
  boomCrash("CRASH", 400, 0.001, 8900.0), // est — no public feed
  boomCrash("CRASH", 500, 0.001, 2975.0, "DERIV:CRASH_500_INDEX"),
  boomCrash("CRASH", 550, 0.001, 13500.0), // est — no public feed
  boomCrash("CRASH", 600, 0.001, 23806.149, "DERIV:CRASH_600_INDEX"),
  boomCrash("CRASH", 750, 0.001, 20278.0), // est — no public feed
  boomCrash("CRASH", 900, 0.001, 16750.199, "DERIV:CRASH_900_INDEX"),
  boomCrash("CRASH", 1000, 0.0001, 6165.1989, "DERIV:CRASH_1000_INDEX"),
];

const DERIV_EXTRA: DerivSpec[] = [
  // volatility-flavoured boom/crash
  { id: "VBOOM400", label: "VOL BOOM 400", mintick: 0.001, base: 14367.65, tv: "DERIV:VOLATILITY_BOOM_400_INDEX" },
  { id: "VBOOM550", label: "VOL BOOM 550", mintick: 0.001, base: 5572.59, tv: "DERIV:VOLATILITY_BOOM_550_INDEX" },
  { id: "VBOOM750", label: "VOL BOOM 750", mintick: 0.001, base: 11911.94, tv: "DERIV:VOLATILITY_BOOM_750_INDEX" },
  { id: "VCRASH400", label: "VOL CRASH 400", mintick: 0.001, base: 4488.5, tv: "DERIV:VOLATILITY_CRASH_400_INDEX" },
  { id: "VCRASH550", label: "VOL CRASH 550", mintick: 0.01, base: 997.68, tv: "DERIV:VOLATILITY_CRASH_550_INDEX" },
  { id: "VCRASH750", label: "VOL CRASH 750", mintick: 0.001, base: 12008.96, tv: "DERIV:VOLATILITY_CRASH_750_INDEX" },
  // crash/boom flip
  { id: "CBF150", label: "CBF 150", mintick: 0.0001, base: 10161.3268, tv: "DERIV:CRASH_BOOM_FLIP_150_INDEX" },
  { id: "CBF300", label: "CBF 300", mintick: 0.0001, base: 7429.4133, tv: "DERIV:CRASH_BOOM_FLIP_300_INDEX" },
  { id: "CBF500", label: "CBF 500", mintick: 0.0001, base: 10945.7194, tv: "DERIV:CRASH_BOOM_FLIP_500_INDEX" },
  { id: "CBF1000", label: "CBF 1000", mintick: 0.0001, base: 10388.6604, tv: "DERIV:CRASH_BOOM_FLIP_1000_INDEX" },
  // step family
  { id: "STEP", label: "STEP", mintick: 0.1, base: 7383.7, tv: "DERIV:STEP_INDEX" },
  { id: "SKEWSTEP", label: "SKEW STEP", mintick: 0.1, base: 7100.0 }, // est — no public feed
  { id: "MS2", label: "MULTI STEP 2", mintick: 0.01, base: 11765.87, tv: "DERIV:MULTI_STEP_2_INDEX" },
  { id: "MS3", label: "MULTI STEP 3", mintick: 0.01, base: 10848.0, tv: "DERIV:MULTI_STEP_3_INDEX" },
  { id: "MS4", label: "MULTI STEP 4", mintick: 0.01, base: 10271.3, tv: "DERIV:MULTI_STEP_4_INDEX" },
  // jumps (3 jumps per hour)
  { id: "JUMP10", label: "JUMP 10", mintick: 0.01, base: 93927.77, tv: "DERIV:JUMP_10_INDEX" },
  { id: "JUMP25", label: "JUMP 25", mintick: 0.01, base: 143796.27, tv: "DERIV:JUMP_25_INDEX" },
  { id: "JUMP50", label: "JUMP 50", mintick: 0.01, base: 70739.59, tv: "DERIV:JUMP_50_INDEX" },
  { id: "JUMP75", label: "JUMP 75", mintick: 0.01, base: 5006.87, tv: "DERIV:JUMP_75_INDEX" },
  { id: "JUMP100", label: "JUMP 100", mintick: 0.01, base: 100.95, tv: "DERIV:JUMP_100_INDEX" },
  // range break
  { id: "RB100", label: "RANGE BREAK 100", mintick: 0.1, base: 52189.7, tv: "DERIV:RANGE_BREAK_100_INDEX" },
  { id: "RB200", label: "RANGE BREAK 200", mintick: 0.1, base: 68237.0, tv: "DERIV:RANGE_BREAK_200_INDEX" },
  // high-frequency volatility
  { id: "HFVOL10", label: "HF VOL 10", mintick: 0.01, base: 91565.53, tv: "DERIV:HIGH_FREQUENCY_VOL_10_INDEX" },
  { id: "HFVOL25", label: "HF VOL 25", mintick: 0.01, base: 114974.49, tv: "DERIV:HIGH_FREQUENCY_VOL_25_INDEX" },
  { id: "HFVOL50", label: "HF VOL 50", mintick: 0.01, base: 125041.19, tv: "DERIV:HIGH_FREQUENCY_VOL_50_INDEX" },
  { id: "HFVOL75", label: "HF VOL 75", mintick: 0.01, base: 36096.07, tv: "DERIV:HIGH_FREQUENCY_VOL_75_INDEX" },
  { id: "HFVOL100", label: "HF VOL 100", mintick: 0.01, base: 48739.19, tv: "DERIV:HIGH_FREQUENCY_VOL_100_INDEX" },
  // drift switch (est anchors — no public feed)
  { id: "DS10", label: "DRIFT SWITCH 10", mintick: 0.01, base: 9800.0 },
  { id: "DS20", label: "DRIFT SWITCH 20", mintick: 0.01, base: 7600.0 },
  { id: "DS30", label: "DRIFT SWITCH 30", mintick: 0.01, base: 5200.0 },
  // vol switch
  { id: "VSWLOW", label: "VOLSWITCH LOW", mintick: 0.01, base: 9410.37, tv: "DERIV:VOLSWITCH_LOW_VOL_INDEX" },
  { id: "VSWMED", label: "VOLSWITCH MED", mintick: 0.01, base: 7694.22, tv: "DERIV:VOLSWITCH_MEDIUM_VOL_INDEX" },
  { id: "VSWHIGH", label: "VOLSWITCH HIGH", mintick: 0.01, base: 610.76, tv: "DERIV:VOLSWITCH_HIGH_VOL_INDEX" },
  // ladder / trek / DEX (Deriv X & dtrader families)
  { id: "LADDERUP", label: "LADDER UP", mintick: 0.01, base: 6064.9, tv: "DERIV:LADDER_VOLATILITY_UP_INDEX" },
  { id: "LADDERDOWN", label: "LADDER DOWN", mintick: 0.01, base: 18915.53, tv: "DERIV:LADDER_VOLATILITY_DOWN_INDEX" },
  { id: "TREKUP", label: "TREK UP", mintick: 0.01, base: 13512.32, tv: "DERIV:TREK_UP_INDEX" },
  { id: "TREKDOWN", label: "TREK DOWN", mintick: 0.01, base: 8696.44, tv: "DERIV:TREK_DOWN_INDEX" },
  { id: "DEX600UP", label: "DEX 600 UP", mintick: 0.01, base: 1939.43, tv: "DERIV:DEX_600_UP_INDEX" },
  { id: "DEX600DOWN", label: "DEX 600 DOWN", mintick: 0.01, base: 1604.81, tv: "DERIV:DEX_600_DOWN_INDEX" },
  { id: "DEX900UP", label: "DEX 900 UP", mintick: 0.01, base: 2526.75, tv: "DERIV:DEX_900_UP_INDEX" },
  { id: "DEX900DOWN", label: "DEX 900 DOWN", mintick: 0.01, base: 32017.68, tv: "DERIV:DEX_900_DOWN_INDEX" },
  { id: "DEX1500UP", label: "DEX 1500 UP", mintick: 0.01, base: 4586.62, tv: "DERIV:DEX_1500_UP_INDEX" },
  { id: "DEX1500DOWN", label: "DEX 1500 DOWN", mintick: 0.01, base: 31033.05, tv: "DERIV:DEX_1500_DOWN_INDEX" },
];

const DERIV_SYNTHETICS: DerivSpec[] = [...DERIV_VOLS, ...DERIV_BOOM_CRASH, ...DERIV_EXTRA];

/**
 * Simulator flavour for a synthetic symbol. Boom/Crash families spike/drop on
 * average once every N 1-second ticks (N = the number in the id), CBF does
 * both, JUMP jumps 3×/hour, STEP walks a fixed 0.1 lattice.
 */
export interface SimStyle {
  kind: "walk" | "boom" | "crash" | "cbf" | "jump" | "step";
  /** average seconds between spike/drop events (boom/crash/cbf families) */
  k: number;
}

export function simStyleOf(id: string): SimStyle {
  const s = id.toUpperCase();
  const m = /((?:VBOOM|VCRASH|BOOM|CRASH|CBF))(\d+)/.exec(s);
  if (m) {
    const n = Math.max(30, parseInt(m[2], 10) || 1000);
    if (m[1] === "BOOM" || m[1] === "VBOOM") return { kind: "boom", k: n };
    if (m[1] === "CRASH" || m[1] === "VCRASH") return { kind: "crash", k: n };
    return { kind: "cbf", k: n }; // CBF
  }
  if (s.startsWith("JUMP")) return { kind: "jump", k: 1200 }; // 3 jumps / hour
  if (s === "STEP" || s === "SKEWSTEP" || s.startsWith("MS")) return { kind: "step", k: 0 };
  return { kind: "walk", k: 0 };
}

// ── DERIV · STOCK INDICES & ENERGY (MT5 CFDs — real Yahoo OHLC feed) ──
// [id, label, mintick, base (sim anchor), Yahoo ticker, TradingView symbol]
const DERIV_INDICES: Array<[string, string, number, number, string, string]> = [
  ["US30", "US 30 · Wall Street", 0.1, 51770, "^DJI", "DJ:DJI"],
  ["US100", "US 100 · Nasdaq", 0.1, 28385, "^NDX", "NASDAQ:NDX"],
  ["US500", "US 500 · S&P", 0.1, 7580, "^GSPC", "SP:SPX"],
  ["US2000", "US 2000 · Russell", 0.1, 2812, "^RUT", "DJ:RUT"],
  ["GER40", "GER 40 · DAX", 0.1, 25818, "^GDAXI", "XETR:DAX"],
  ["UK100", "UK 100 · FTSE", 0.1, 10730, "^FTSE", "TVC:UKX"],
  ["FRA40", "FRA 40 · CAC", 0.1, 7969, "^FCHI", "EURONEXT:PX1"],
  ["EU50", "EU 50 · Euro Stoxx", 0.1, 6131, "^STOXX50E", "EURONEXT:STOXX50E"],
  ["JPN225", "JPN 225 · Nikkei", 0.1, 63290, "^N225", "TVC:NI225"],
  ["AUS200", "AUS 200 · ASX", 0.1, 8908, "^AXJO", "SP:XJO"],
  ["HK50", "HK 50 · Hang Seng", 0.1, 23294, "^HSI", "HSI:HSI"],
  ["USOIL", "WTI CRUDE OIL", 0.01, 102.95, "CL=F", "TVC:USOIL"],
  ["UKOIL", "BRENT CRUDE OIL", 0.01, 112.33, "BZ=F", "TVC:UKOIL"],
  ["NGAS", "NATURAL GAS", 0.001, 2.88, "NG=F", "NYMEX:NG1!"],
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
    SYMBOL_VENUES[id] = ["deriv", "mt5"];
  }
  for (const [id, label, mintick, base] of FX_CROSSES) {
    out.push({ id, label, mintick, base, group: "FOREX", tv: `OANDA:${id}` });
    SYMBOL_VENUES[id] = ["deriv", "mt5"];
  }
  for (const [id, label, base] of FX_EXOTICS) {
    out.push({ id, label, mintick: 0.00001, base, group: "FOREX", tv: `FX_IDC:${id}` });
    SYMBOL_VENUES[id] = ["deriv"];
  }
  for (const s of DERIV_SYNTHETICS) {
    out.push({ id: s.id, label: s.label, mintick: s.mintick, base: s.base, group: "SYNTHETICS", tv: s.tv ?? "" });
    SYMBOL_VENUES[s.id] = ["deriv"];
  }
  for (const [id, label, mintick, base, ytk, tvs] of DERIV_INDICES) {
    out.push({ id, label, mintick, base, group: "INDICES", tv: tvs });
    SYMBOL_VENUES[id] = ["deriv"];
    YAHOO_INDEX_MAP[id] = ytk;
  }
  for (const [id, label, mintick, base, tvs] of METALS) {
    out.push({ id, label, mintick, base, group: "METALS", tv: `OANDA:${tvs}` });
    SYMBOL_VENUES[id] = ["deriv", "mt5"];
  }
  for (const [id, label, mintick, base] of CRYPTO) {
    out.push({ id, label, mintick, base, group: "CRYPTO", tv: `BINANCE:${id}` });
    SYMBOL_VENUES[id] = ["binance"];
  }
  return out;
}

/** index/energy ids → Yahoo chart tickers (used by market.ts + market-history.ts) */
export const YAHOO_INDEX_MAP: Record<string, string> = {};

/** internal symbol id → the broker venues that carry it (filled by build()) */
export const SYMBOL_VENUES: Record<string, Venue[]> = {};

/** true when the group's candles come from the built-in simulator (no public OHLC) */
export function isSimOnlyGroup(g: SymbolGroup): boolean {
  return g === "SYNTHETICS";
}

export const SYMBOLS: SymbolMeta[] = build();

/** TradingView pro symbol → internal id (e.g. "DERIV:BOOM_1000_INDEX" → "BOOM1000") */
export const SYMBOL_BY_TV: Record<string, string> = {};
for (const s of SYMBOLS) {
  if (s.tv) SYMBOL_BY_TV[s.tv.toUpperCase()] = s.id;
}

export function symbolsByGroup(g: SymbolGroup): SymbolMeta[] {
  return SYMBOLS.filter((s) => s.group === g);
}

// ── BROKER VENUES · broker dimension for the chart pair switcher ────────
// A pair can trade on several brokers; the chart picker filters by the
// selected broker so the user browses exactly that broker's catalog:
//   · Deriv   — synthetics, stock indices & energy, derived-FX exotics
//   · MT5/CFD — forex majors & crosses, metals (OANDA/ICMarkets/Pepperstone…)
//   · Binance — crypto spot
export type Venue = "deriv" | "mt5" | "binance";

export interface VenueMeta {
  key: Venue;
  label: string;
  short: string;
  hint: string;
}

export const VENUES: VenueMeta[] = [
  { key: "deriv", label: "Deriv", short: "DERIV", hint: "Synthetics · Stock Indices · Derived FX" },
  { key: "mt5", label: "MT5 / CFD Brokers", short: "MT5 · CFD", hint: "Forex Majors & Crosses · Metals" },
  { key: "binance", label: "Binance", short: "BINANCE", hint: "Crypto Spot" },
];

export function symbolsByVenue(v: Venue): SymbolMeta[] {
  return SYMBOLS.filter((s) => (SYMBOL_VENUES[s.id] ?? []).includes(v));
}

export function symbolsByVenueGroup(v: Venue, g: SymbolGroup): SymbolMeta[] {
  return SYMBOLS.filter((s) => s.group === g && (SYMBOL_VENUES[s.id] ?? []).includes(v));
}

export function venuesOfSymbol(id: string): Venue[] {
  return SYMBOL_VENUES[id] ?? [];
}

/** group label inside a broker section — the FX group reads differently per venue */
const VENUE_GROUP_LABEL: Record<Venue, Partial<Record<SymbolGroup, string>>> = {
  deriv: { FOREX: "Derived FX · Exotics (Deriv MT5)" },
  mt5: { FOREX: "Forex · Majors & Crosses" },
  binance: {},
};

export function venueGroupLabel(v: Venue, g: SymbolGroup): string {
  return VENUE_GROUP_LABEL[v]?.[g] ?? SYMBOL_GROUPS.find((x) => x.key === g)?.label ?? g;
}

// ── LIVE FEED MAPPING · real-time browser streams (client-safe) ─────────
// The chart's live layer subscribes straight to the venue that publishes
// each instrument, so the candles move tick-by-tick like the real
// TradingView web chart:
//   • SYNTHETICS / FOREX / METALS → Deriv public websocket (app_id 1089):
//     `ticks_history` seeds REAL candles, then `ohlc` pushes the forming
//     candle on every tick. Codes below are Deriv API stream symbols.
//   • CRYPTO → Binance kline websocket (same source as the REST candles).
//   • Anything without a code/hint → no stream; polling keeps driving it.

/** internal id → Deriv websocket stream symbol (high-confidence classics) */
export const DERIV_WS_CODE: Record<string, string> = {
  // continuous volatility indices
  V10: "R_10",
  V25: "R_25",
  V50: "R_50",
  V75: "R_75",
  V100: "R_100",
  // 1-second volatility variants
  V10S: "R_10s",
  V25S: "R_25s",
  V50S: "R_50s",
  V75S: "R_75s",
  V100S: "R_100s",
  // boom / crash classics
  BOOM300: "BOOM300",
  BOOM500: "BOOM500",
  BOOM1000: "BOOM1000",
  CRASH300: "CRASH300",
  CRASH500: "CRASH500",
  CRASH1000: "CRASH1000",
  // step / range break / jump families
  STEP: "stpRNG",
  RB100: "RB100",
  RB200: "RB200",
  JUMP10: "JD10",
  JUMP25: "JD25",
  JUMP50: "JD50",
  JUMP75: "JD75",
  JUMP100: "JD100",
};

/**
 * Normalized display-name candidates for symbols whose stream code is not
 * fixed here — resolved at runtime against Deriv `active_symbols` (both the
 * display name and the raw symbol are normalized and compared). Keeps the
 * map future-proof as Deriv lists new instruments.
 */
export const DERIV_NAME_HINTS: Record<string, string[]> = {
  V5: ["volatility5index"],
  V15: ["volatility15index"],
  V30: ["volatility30index"],
  V90: ["volatility90index"],
  V5S: ["volatility51sindex"],
  V15S: ["volatility151sindex"],
  V30S: ["volatility301sindex"],
  V90S: ["volatility901sindex"],
  V150S: ["volatility1501sindex"],
  V250S: ["volatility2501sindex"],
  BOOM50: ["boom50index"],
  BOOM99: ["boom99index"],
  BOOM100: ["boom100index"],
  BOOM150: ["boom150index"],
  BOOM200: ["boom200index"],
  BOOM400: ["boom400index"],
  BOOM550: ["boom550index"],
  BOOM600: ["boom600index"],
  BOOM750: ["boom750index"],
  BOOM900: ["boom900index"],
  CRASH50: ["crash50index"],
  CRASH99: ["crash99index"],
  CRASH100: ["crash100index"],
  CRASH150: ["crash150index"],
  CRASH200: ["crash200index"],
  CRASH400: ["crash400index"],
  CRASH550: ["crash550index"],
  CRASH600: ["crash600index"],
  CRASH750: ["crash750index"],
  CRASH900: ["crash900index"],
  VBOOM400: ["volatilityboom400index"],
  VBOOM550: ["volatilityboom550index"],
  VBOOM750: ["volatilityboom750index"],
  VCRASH400: ["volatilitycrash400index"],
  VCRASH550: ["volatilitycrash550index"],
  VCRASH750: ["volatilitycrash750index"],
  CBF150: ["crashboomflip150index"],
  CBF300: ["crashboomflip300index"],
  CBF500: ["crashboomflip500index"],
  CBF1000: ["crashboomflip1000index"],
  SKEWSTEP: ["skewstepindex"],
  MS2: ["multistep2index"],
  MS3: ["multistep3index"],
  MS4: ["multistep4index"],
  HFVOL10: ["highfrequencyvol10index"],
  HFVOL25: ["highfrequencyvol25index"],
  HFVOL50: ["highfrequencyvol50index"],
  HFVOL75: ["highfrequencyvol75index"],
  HFVOL100: ["highfrequencyvol100index"],
  DS10: ["driftswitch10index"],
  DS20: ["driftswitch20index"],
  DS30: ["driftswitch30index"],
  VSWLOW: ["volswitchlowindex", "volswitchlowvolindex"],
  VSWMED: ["volswitchmediumindex", "volswitchmediumvolindex"],
  VSWHIGH: ["volswitchhighindex", "volswitchhighvolindex"],
  LADDERUP: ["ladderupindex", "laddervolatilityupindex"],
  LADDERDOWN: ["ladderdownindex", "laddervolatilitydownindex"],
  TREKUP: ["trekupindex", "trekvolatilityupindex"],
  TREKDOWN: ["trekdownindex", "trekvolatilitydownindex"],
  DEX600UP: ["dex600upindex"],
  DEX600DOWN: ["dex600downindex"],
  DEX900UP: ["dex900upindex"],
  DEX900DOWN: ["dex900downindex"],
  DEX1500UP: ["dex1500upindex"],
  DEX1500DOWN: ["dex1500downindex"],
  // stock indices & energy — Deriv OTC names + raw symbol fallbacks
  US30: ["wallstreetindex", "us30index", "otcdji30", "dj30index"],
  US100: ["us100index", "nasdaq100index", "otcndx100"],
  US500: ["us500index", "sp500index", "otcspx500", "otcspu500"],
  US2000: ["us2000index", "russell2000index", "otcrussell2000"],
  GER40: ["ger40index", "germany40index", "dax40index", "otcger40"],
  UK100: ["uk100index", "ftse100index", "otcuk100"],
  FRA40: ["fra40index", "france40index", "cac40index", "otcfra40"],
  EU50: ["eu50index", "eurostoxx50index", "otceu50"],
  JPN225: ["jpn225index", "japan225index", "nikkei225index", "otcjpn225"],
  AUS200: ["aus200index", "asx200index", "otcaus200"],
  HK50: ["hk50index", "hangsengindex", "otchk50"],
  USOIL: ["usoilindex", "wticrudeoilindex", "wticrudeindex", "otcusoil"],
  UKOIL: ["ukoilindex", "brentcrudeoilindex", "brentcrudeindex", "otcukoil"],
  NGAS: ["ngasindex", "naturalgasindex", "otcngas"],
  // metals — display-name fallbacks when the frx code is rejected
  XAUUSD: ["xauusd", "gold"],
  XAGUSD: ["xagusd", "silver"],
  XPTUSD: ["xptusd", "platinum"],
  XPDUSD: ["xpdusd", "palladium"],
  XCUUSD: ["xcuusd", "copper"],
};

/** bar granularities the Deriv candle stream accepts (seconds) */
export const DERIV_GRANULARITIES = new Set<number>([
  60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400,
]);

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
