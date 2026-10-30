// ════════════════════════════════════════════════════════════════════════
//  HALO ACTION REGISTRY · the typed, allowlisted operator surface
//
//  The ONLY set of operations the conversational AI may select. Every
//  action declares:
//    • scope  — who executes it (client UI functions | trusted server)
//    • risk   — read | ui | consequential (consequential ⇒ explicit
//               trader confirmation before the server will execute it)
//    • params — validated shape; anything outside this catalog is
//               rejected by the brain route. No arbitrary execution.
//
//  SAFETY: this registry maps to EXISTING application functions only
//  (view switching, /api/bot/config symbol+tf, /api/bot/control
//  start/stop/close via lib/bot.ts). It never bypasses the trading
//  engine, never touches risk limits, and contains NO discretionary
//  order action — the deterministic 3EL strategy remains the sole
//  source of trade entries.
// ════════════════════════════════════════════════════════════════════════

import { SYMBOLS, TIMEFRAMES } from "@/lib/market-symbols";

// ── views (mirrors nav-rail HaloView — kept here so both sides agree) ──
export type ViewId =
  | "terminal"
  | "scanner"
  | "activity"
  | "risk"
  | "backtest"
  | "performance"
  | "brokers"
  | "alerts"
  | "intel"
  | "settings"
  | "trade-history"
  | "briefing"
  | "learning"
  | "voice"
  | "strategies";

export interface ViewMeta {
  id: ViewId;
  label: string;
  aliases: string[];
}

export const VIEWS: ViewMeta[] = [
  { id: "terminal", label: "Dashboard", aliases: ["dashboard", "command center", "terminal", "home", "main view"] },
  { id: "intel", label: "Market Intelligence", aliases: ["market intelligence", "intelligence", "market intel", "intel", "markets"] },
  { id: "activity", label: "Trading Activity", aliases: ["trading activity", "activity", "open positions", "positions"] },
  { id: "risk", label: "Risk Guardian", aliases: ["risk guardian", "risk", "protection"] },
  { id: "backtest", label: "Strategy Lab", aliases: ["strategy lab", "backtest", "lab", "signals lab"] },
  { id: "strategies", label: "Strategy Studio", aliases: ["strategy studio", "strategies", "pine editor", "pine script", "pine studio", "my strategies", "custom strategy"] },
  { id: "trade-history", label: "Trade History", aliases: ["trade history", "history", "closed trades", "trade log"] },
  { id: "performance", label: "Performance", aliases: ["performance", "stats", "statistics", "analytics"] },
  { id: "briefing", label: "Daily Briefing", aliases: ["daily briefing", "briefing", "market brief"] },
  { id: "learning", label: "Learning Missions", aliases: ["learning missions", "learning", "missions", "strategy guide", "how it works"] },
  { id: "settings", label: "Settings", aliases: ["settings", "preferences", "config", "voice settings"] },
  { id: "scanner", label: "Market Scanner", aliases: ["market scanner", "scanner", "multi-symbol", "watchlist"] },
  { id: "voice", label: "Voice Command", aliases: ["voice command", "voice center", "voice", "talk to halo", "conversation"] },
  { id: "brokers", label: "Brokers & MT5", aliases: ["brokers", "broker", "mt5", "connections", "accounts"] },
  { id: "alerts", label: "Alerts", aliases: ["alerts", "notifications", "telegram"] },
];

export const VIEW_IDS = VIEWS.map((v) => v.id);

export type HistoryPeriod = "today" | "week" | "month" | "all";
export const HISTORY_PERIODS: HistoryPeriod[] = ["today", "week", "month", "all"];

export type CalendarDayParam = "today" | "tomorrow" | "this_week" | "next_week";
export const CALENDAR_DAYS: CalendarDayParam[] = ["today", "tomorrow", "this_week", "next_week"];
export const CALENDAR_IMPACTS = ["all", "high", "med_high"] as const;
export const NEWS_SOURCES = ["bloomberg", "yahoo"] as const;

// canonical quote targets beyond the trading catalog (indices, commodities,
// dollar gauge) — ids map to Yahoo tickers in lib/halo/intel.ts
export interface QuoteTarget {
  id: string;
  label: string;
  aliases: string[];
}

export const QUOTE_TARGETS: QuoteTarget[] = [
  { id: "SPX", label: "S&P 500", aliases: ["s&p", "s&p 500", "spx", "sp500", "sp 500", "us500", "s and p", "spy", "es", "s&p es"] },
  { id: "NDX", label: "Nasdaq 100", aliases: ["nasdaq 100", "ndx", "ustec", "nas100", "qqq", "nq"] },
  { id: "IXIC", label: "Nasdaq Composite", aliases: ["nasdaq", "nasdaq composite", "ixic", "comp"] },
  { id: "DJI", label: "Dow Jones", aliases: ["dow", "dow jones", "dji", "wall street", "us30", "dia", "ym"] },
  { id: "DAX", label: "DAX", aliases: ["dax", "german index", "ger40", "de40"] },
  { id: "FTSE", label: "FTSE 100", aliases: ["ftse", "ftse 100", "uk100"] },
  { id: "NIKKEI", label: "Nikkei 225", aliases: ["nikkei", "nikkei 225", "japan index", "jp225"] },
  { id: "HSI", label: "Hang Seng", aliases: ["hang seng", "hsi", "hong kong index"] },
  { id: "VIX", label: "VIX", aliases: ["vix", "volatility index", "fear index", "vxx"] },
  { id: "US10Y", label: "US 10-Year Yield", aliases: ["10 year", "us10y", "ten year", "bond yield", "treasury yield", "tnx"] },
  { id: "OIL", label: "WTI Crude Oil", aliases: ["oil", "crude", "crude oil", "wti", "usoil", "uscrude", "uso", "cl"] },
  { id: "BRENT", label: "Brent Crude Oil", aliases: ["brent", "brent oil", "ukoil", "bno"] },
  { id: "NATGAS", label: "Natural Gas", aliases: ["natural gas", "natgas", "nat gas", "gas", "ung"] },
  { id: "DXY", label: "US Dollar Index", aliases: ["dxy", "dollar index", "us dollar index", "usd index", "uup"] },
];

/** raw Yahoo-style tickers the model sometimes emits → canonical target id */
const RAW_TICKER_ALIASES: Record<string, string> = {
  "^gspc": "SPX", gspc: "SPX", "^ndx": "NDX", "^ixic": "IXIC", "^dji": "DJI",
  "^gdaxi": "DAX", "^ftse": "FTSE", "^n225": "NIKKEI", "^hsi": "HSI",
  "^vix": "VIX", "^tnx": "US10Y", "cl=f": "OIL", "bz=f": "BRENT", "ng=f": "NATGAS",
  "dx-y.nyb": "DXY", "gc=f": "XAUUSD", "si=f": "XAGUSD", "pl=f": "XPTUSD", "pa=f": "XPDUSD", "hg=f": "XCUUSD",
};

/**
 * Resolve a spoken/typed quote request to a canonical target id:
 * raw tickers, intel indices/commodities, then the trading-symbol catalog.
 */
export function resolveQuoteTarget(input: string): { id: string; label: string } | null {
  if (!input) return null;
  const rawCanon = RAW_TICKER_ALIASES[input.trim().toLowerCase()];
  if (rawCanon) {
    const direct = QUOTE_TARGETS.find((x) => x.id === rawCanon);
    if (direct) return { id: direct.id, label: direct.label };
    return resolveQuoteTarget(rawCanon); // e.g. GC=F → XAUUSD catalog label
  }
  const raw = input.trim().toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ");
  const compact = raw.replace(/[^a-z0-9&]/g, "");
  for (const t of QUOTE_TARGETS) {
    if (t.id.toLowerCase() === compact) return { id: t.id, label: t.label };
    if (t.aliases.some((a) => a.replace(/\s+/g, "") === compact || a === raw)) return { id: t.id, label: t.label };
  }
  const sym = resolveSymbol(input);
  if (sym) {
    const meta = SYMBOLS.find((s) => s.id === sym);
    return { id: sym, label: meta ? meta.label.split("·")[0].trim() : sym };
  }
  return null;
}

/** Runtime guard: is an arbitrary string one of the nine real sections? */
export function isViewId(v: string): v is ViewId {
  return VIEWS.some((x) => x.id === v);
}

// ── action catalog ───────────────────────────────────────────────────────
export type ActionScope = "client" | "server";
export type ActionRisk = "read" | "ui" | "consequential";

export interface ActionParam {
  type: "string" | "boolean";
  oneOf?: readonly string[];
  optional?: boolean;
  desc: string;
}

export interface ActionDef {
  id: string;
  description: string; // shown to the LLM + written to the audit log
  scope: ActionScope;
  risk: ActionRisk;
  params: Record<string, ActionParam>;
  /** consequential only — the trader-facing confirmation question */
  confirmQuestion?: string;
  /** consequential only — what actually happens, spoken before confirm */
  confirmEffect?: string;
}

export const ACTIONS: ActionDef[] = [
  // ── tier 1 · navigation & UI (executed client-side on REAL state) ──
  {
    id: "navigate_to_view",
    description: "Open one of the app sections (real client-side navigation, no reload).",
    scope: "client",
    risk: "ui",
    params: { view: { type: "string", oneOf: VIEW_IDS, desc: `view id: ${VIEW_IDS.join(", ")}` } },
  },
  {
    id: "go_back",
    description: "Return to the previously opened section.",
    scope: "client",
    risk: "ui",
    params: {},
  },
  {
    id: "select_symbol",
    description: "Switch the EA chart + engine to a supported symbol (blocked by the server while a trade is open).",
    scope: "client",
    risk: "ui",
    params: { symbol: { type: "string", desc: "symbol id like XAUUSD, EURUSD, BTCUSDT (resolve aliases to these ids)" } },
  },
  {
    id: "set_chart_timeframe",
    description: "Set the chart + engine timeframe.",
    scope: "client",
    risk: "ui",
    params: { tf: { type: "string", oneOf: TIMEFRAMES, desc: `one of: ${TIMEFRAMES.join(", ")}` } },
  },
  {
    id: "refresh_market_data",
    description: "Force-refresh bot state and candles from the live feeds right now.",
    scope: "client",
    risk: "ui",
    params: {},
  },
  {
    id: "open_trade_details",
    description: "Open the Trading Activity section where the open trade and history live.",
    scope: "client",
    risk: "ui",
    params: {},
  },
  {
    id: "filter_trade_history",
    description: "Filter the trade-history table by period (display filter only — changes nothing on any broker).",
    scope: "client",
    risk: "ui",
    params: { period: { type: "string", oneOf: HISTORY_PERIODS, desc: "today | week | month | all" } },
  },
  {
    id: "export_trade_history",
    description: "Download the trade book as a CSV file (last 200 records).",
    scope: "client",
    risk: "ui",
    params: {},
  },
  {
    id: "set_voice_muted",
    description: "Mute or unmute HALO's spoken replies on this device.",
    scope: "client",
    risk: "ui",
    params: { muted: { type: "boolean", desc: "true = mute speech, false = unmute" } },
  },

  // ── tier 2 · read-only intel (answered from the VERIFIED snapshot) ──
  {
    id: "get_account_summary",
    description: "Verified account + performance summary: engine book, execution mode, live balance/equity when a live broker is connected.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "get_strategy_status",
    description: "What the 3EL engine is doing right now: status text, armed levels, ATR, feed health.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "get_daily_signals",
    description: "Today's real signals: fires with direction and result, plus currently armed levels.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "get_open_positions",
    description: "The strategy's currently open position (entry/SL/TP/pips), or 'none'. Broker-side external positions are not listable — say so if asked.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "get_mt5_connection_status",
    description: "Execution mode and broker connection health (status string straight from the runtime).",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "list_pending_orders",
    description: "Read the resting (pending) orders on the active live broker — type, size, trigger price, id. Honest about paper mode and adapters that cannot read orders.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "run_market_scan",
    description: "Run the multi-symbol Market Scanner sweep now and summarise which symbols are scanning, in C3 watch, running or erroring.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "tell_joke",
    description: "Share a light, clean joke to lift the trader's mood (entertainment only — never mixed into data answers). Use when the trader asks for a joke or needs a lift.",
    scope: "server",
    risk: "read",
    params: {
      style: { type: "string", oneOf: ["trading", "tech", "motivation"], optional: true, desc: "trading | tech | motivation (default: any)" },
    },
  },
  {
    id: "list_strategies",
    description: "List every strategy in the Strategy Studio: the built-in HALO 3EL v1.2 engine plus the trader's compiled Pine strategies, and which one the bot is currently auto-trading.",
    scope: "server",
    risk: "read",
    params: {},
  },
  {
    id: "explain_last_rejection",
    description: "Explain from engine state why nothing entered: burned/skipped/expired level counters and the last outcome.",
    scope: "server",
    risk: "read",
    params: {},
  },

  // ── tier 2b · external intel (live fetched from the curated feeds at
  //    question time: ForexFactory calendar, Bloomberg/Yahoo news, Yahoo
  //    quotes). Read-only, cached server-side, failures reported honestly. ──
  {
    id: "get_economic_calendar",
    description: "Live economic calendar from ForexFactory: scheduled releases with impact rating, forecast, previous and actual readings. Use for 'what's on the calendar', 'any high impact news today'.",
    scope: "server",
    risk: "read",
    params: {
      day: { type: "string", oneOf: CALENDAR_DAYS, optional: true, desc: "today | tomorrow | this_week | next_week (default today)" },
      impact: { type: "string", oneOf: CALENDAR_IMPACTS, optional: true, desc: "all | high | med_high (default all)" },
      currency: { type: "string", optional: true, desc: "optional currency filter like USD, EUR, GBP, JPY" },
    },
  },
  {
    id: "get_market_news",
    description: "Latest market headlines from the Bloomberg and Yahoo Finance news feeds. Use for 'what's the latest market news', 'any headlines on gold'.",
    scope: "server",
    risk: "read",
    params: {
      source: { type: "string", oneOf: NEWS_SOURCES, optional: true, desc: "bloomberg | yahoo (default bloomberg)" },
      topic: { type: "string", optional: true, desc: "optional keyword filter, e.g. gold, fed, oil" },
    },
  },
  {
    id: "get_market_quote",
    description: "Live quote via Yahoo Finance for indices, commodities and the trading catalog: S&P 500, Nasdaq, Dow, DAX, FTSE, Nikkei, VIX, US 10Y, WTI/Brent oil, natural gas, DXY, gold, silver, FX pairs, crypto. NOT a trade signal — price info only.",
    scope: "server",
    risk: "read",
    params: {
      symbol: { type: "string", desc: "what to quote, e.g. spx, nasdaq, dow, dax, oil, dxy, gold, EUR/USD, bitcoin (resolve natural names)" },
    },
  },

  // ── tier 3 · consequential controls (server executes ONLY after the
  //    trader explicitly confirms; every execution is audit-logged) ──
  {
    id: "select_strategy",
    description: "Switch which strategy the bot auto-trades: pick a named Pine strategy from the Strategy Studio, or 'default' to restore the built-in HALO 3EL v1.2 engine. While a Pine strategy trades, the built-in engine's fires are skipped.",
    scope: "server",
    risk: "consequential",
    params: { strategy: { type: "string", desc: "strategy name (say 'default' for the built-in HALO 3EL engine)" } },
    confirmQuestion: "Switch the bot's auto-trading strategy?",
    confirmEffect: "The bot will trade the selected strategy on the chart symbol/timeframe — the other engine stays armed for levels but its fires are skipped.",
  },
  {
    id: "pause_new_entries",
    description: "Pause NEW automated entries while KEEPING the EA attached: it keeps managing an open trade and its SL/TP, but accepts no fresh C3 fires while flat. NOT for \"stop the bot\" — that maps to emergency_stop. (For a full detach use emergency stop.)",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "Pause new automated entries?",
    confirmEffect: "No new positions while flat. An open trade (if any) stays fully managed by the engine and its broker SL/TP.",
  },
  {
    id: "resume_new_entries",
    description: "Start / resume automated entries: clear the new-entries pause and, if the EA was detached, START it again with all existing risk settings (covers \"start the bot\", \"resume trading\").",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "Resume automated entries?",
    confirmEffect: "The EA accepts fresh C3 fires again (and restarts if it was detached) with the existing risk settings.",
  },
  {
    id: "close_open_trade",
    description: "Market-close the strategy's currently open trade at the last known price (no-op if flat).",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "Close the open trade at market?",
    confirmEffect: "The open position is flattened at the last known price and the result is booked — this cannot be undone.",
  },
  {
    id: "close_all_positions",
    description: "Close ALL open positions on the active broker at market — including any manual trades (screen parity: the CLOSE ALL quick action). Paper mode closes the EA trade through the engine.",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "Close ALL open positions at market?",
    confirmEffect: "Every open broker position — including manual trades — is market-closed now. This cannot be undone. The EA keeps its current start/stop state.",
  },
  {
    id: "cancel_pending_order",
    description: "Cancel ONE resting (pending) order on the active live broker. Omit orderId only when exactly one order rests on the book — with several, first list them and ask which.",
    scope: "server",
    risk: "consequential",
    params: { orderId: { type: "string", optional: true, desc: "broker order id to cancel (get it from list_pending_orders)" } },
    confirmQuestion: "Cancel this pending order?",
    confirmEffect: "The resting order is deleted at the broker and will never trigger. This cannot be undone.",
  },
  {
    id: "cancel_all_pending_orders",
    description: "Cancel EVERY resting (pending) order on the active live broker (screen parity: flatten the order book).",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "Cancel ALL pending orders?",
    confirmEffect: "Every resting order on the active broker is deleted now — none of them can trigger afterwards. This cannot be undone.",
  },
  {
    id: "modify_position_sltp",
    description: "Amend the stop-loss and/or take-profit on the single open LIVE broker position (screen parity: the MODIFY SL/TP quick action). Never guesses between several positions.",
    scope: "server",
    risk: "consequential",
    params: {
      sl: { type: "string", optional: true, desc: "new stop-loss price (omit to keep current)" },
      tp: { type: "string", optional: true, desc: "new take-profit price (omit to keep current)" },
    },
    confirmQuestion: "Amend SL/TP on the open position?",
    confirmEffect: "The broker updates the protective levels on the open position immediately.",
  },
  {
    id: "reset_engine",
    description: "Reset and re-warm the 3EL engine: clears armed levels and session counters (screen parity: the RESET control). Refused while a trade is open.",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "Reset and re-warm the engine?",
    confirmEffect: "All armed levels and session counters clear; the engine re-warms on the current symbol and timeframe. Open trades block this.",
  },
  {
    id: "emergency_stop",
    description: "Stop / HALT the EA: new entries stop immediately. It does NOT close existing positions — pausing entries and closing positions are separate actions (covers \"stop the bot\", \"detach the EA\").",
    scope: "server",
    risk: "consequential",
    params: {},
    confirmQuestion: "EMERGENCY STOP — halt new entries?",
    confirmEffect: "New entries halt immediately. Existing positions are NOT closed — they keep their broker SL/TP. Close them separately if intended.",
  },
  {
    id: "set_execution_mode",
    description: "Switch order routing between PAPER (simulated fills) and LIVE (real broker orders with real SL/TP).",
    scope: "server",
    risk: "consequential",
    params: { mode: { type: "string", oneOf: ["paper", "live"], desc: "paper | live" } },
    confirmQuestion: "Switch order routing mode?",
    confirmEffect: "In LIVE mode every C3 fire goes to the connected broker with real money. In PAPER mode all fills are simulated.",
  },
];

export const ACTION_IDS = ACTIONS.map((a) => a.id);
export const consequentialActions = ACTIONS.filter((a) => a.risk === "consequential").map((a) => a.id);

export function getAction(id: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.id === id);
}

// ── symbol / timeframe resolution (server-side normalization) ───────────
const SYMBOL_ALIASES: Record<string, string> = {
  gold: "XAUUSD", xau: "XAUUSD", xauusd: "XAUUSD", "xau/usd": "XAUUSD",
  silver: "XAGUSD", xag: "XAGUSD", xagusd: "XAGUSD",
  platinum: "XPTUSD", palladium: "XPDUSD", copper: "XCUUSD",
  paxg: "PAXGUSDT", paxgusdt: "PAXGUSDT",
  bitcoin: "BTCUSDT", btc: "BTCUSDT", btcusdt: "BTCUSDT",
  ethereum: "ETHUSDT", eth: "ETHUSDT", ethusdt: "ETHUSDT",
  solana: "SOLUSDT", sol: "SOLUSDT", bnb: "BNBUSDT",
  ripple: "XRPUSDT", xrp: "XRPUSDT", dogecoin: "DOGEUSDT", doge: "DOGEUSDT",
  euro: "EURUSD", eur: "EURUSD", cable: "GBPUSD", pound: "GBPUSD", gbp: "GBPUSD",
  yen: "USDJPY", aussie: "AUDUSD", kiwi: "NZDUSD", loonie: "USDCAD",
  swissy: "USDCHF", franc: "USDCHF",
};

/** Resolve a spoken/typed symbol to a supported catalog id, or null. */
export function resolveSymbol(input: string): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  if (SYMBOL_ALIASES[raw]) return SYMBOL_ALIASES[raw];
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (SYMBOL_ALIASES[compact]) return SYMBOL_ALIASES[compact];
  const byId = SYMBOLS.find((s) => s.id.toLowerCase() === compact);
  if (byId) return byId.id;
  // label match — "EUR/USD" → EURUSD, "GOLD · XAU/USD" → contains XAUUSD
  const byLabel = SYMBOLS.find((s) => {
    const lbl = s.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    return lbl === compact || lbl.includes(compact);
  });
  return byLabel?.id ?? null;
}

const TF_ALIASES: Record<string, string> = {
  "1min": "1m", minute: "1m", "1minute": "1m", "3min": "3m", "5min": "5m",
  "15min": "15m", "30min": "30m", hourly: "1h", hour: "1h", "1hour": "1h", h1: "1h",
  "2hour": "2h", "4hour": "4h", h4: "4h", daily: "1d", day: "1d", d1: "1d",
};

export function resolveTimeframe(input: string): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase().replace(/\s+/g, "");
  if ((TIMEFRAMES as readonly string[]).includes(raw)) return raw;
  if (TF_ALIASES[raw]) return TF_ALIASES[raw];
  // "4h" style, "m15", "15" → guess
  const m = raw.match(/^(?:m|h|d)?(\d+)(?:m|h|d|min|hour|s)?$/);
  if (m) {
    const n = m[1];
    if ((TIMEFRAMES as readonly string[]).includes(`${n}m`)) return `${n}m`;
    if ((TIMEFRAMES as readonly string[]).includes(`${n}h`)) return `${n}h`;
    if (n === "1" && raw.includes("d")) return "1d";
  }
  return null;
}

// ── parameter validation ─────────────────────────────────────────────────
export type ValidateOk = { ok: true; params: Record<string, string | boolean>; note?: string; label?: string };
export type ValidateFail = { ok: false; error: string };

export function validateActionParams(id: string, rawParams: unknown): ValidateOk | ValidateFail {
  const def = getAction(id);
  if (!def) return { ok: false, error: `Unknown action "${String(id).slice(0, 40)}" — it is not in the allowlist.` };
  const raw = (rawParams && typeof rawParams === "object" ? rawParams : {}) as Record<string, unknown>;
  const out: Record<string, string | boolean> = {};

  for (const [key, spec] of Object.entries(def.params)) {
    const v = raw[key];
    if (v === undefined || v === null || v === "") {
      if (!spec.optional) return { ok: false, error: `Missing parameter "${key}" for ${id}.` };
      continue;
    }
    if (spec.type === "boolean") {
      if (typeof v === "boolean") out[key] = v;
      else if (v === "true") out[key] = true;
      else if (v === "false") out[key] = false;
      else return { ok: false, error: `Parameter "${key}" must be a boolean for ${id}.` };
      continue;
    }
    if (typeof v !== "string") return { ok: false, error: `Parameter "${key}" must be a string for ${id}.` };
    const val = v.trim();
    if (!val) return { ok: false, error: `Parameter "${key}" is empty for ${id}.` };
    if (spec.oneOf) {
      const lowered = spec.oneOf.find((o) => o.toLowerCase() === val.toLowerCase());
      if (!lowered) return { ok: false, error: `Parameter "${key}" must be one of: ${spec.oneOf.join(", ")}.` };
      out[key] = lowered;
      continue;
    }
    if (val.length > 40) return { ok: false, error: `Parameter "${key}" is too long.` };
    out[key] = val;
  }

  // semantic normalization on top of shape validation
  if (id === "select_symbol") {
    const resolved = resolveSymbol(String(out.symbol ?? ""));
    if (!resolved) return { ok: false, error: `"${String(out.symbol).slice(0, 24)}" is not a supported symbol. Say the pair name (e.g. gold, EUR/USD, BTC) and I'll map it.` };
    out.symbol = resolved;
  }
  if (id === "set_chart_timeframe") {
    const resolved = resolveTimeframe(String(out.tf ?? ""));
    if (!resolved) return { ok: false, error: `"${String(out.tf).slice(0, 24)}" is not a supported timeframe. Supported: ${TIMEFRAMES.join(", ")}.` };
    out.tf = resolved;
  }
  if (id === "get_market_quote") {
    const resolved = resolveQuoteTarget(String(out.symbol ?? ""));
    if (!resolved) return { ok: false, error: `"${String(out.symbol).slice(0, 24)}" is not a quotable symbol. I can quote the trading catalog (gold, EUR/USD, BTC...) plus S&P 500, Nasdaq, Dow, DAX, FTSE, Nikkei, VIX, US 10Y, oil, natural gas and DXY.` };
    out.symbol = resolved.id;
    out._label = resolved.label;
  }
  if (id === "get_economic_calendar" && typeof out.currency === "string") {
    out.currency = out.currency.toUpperCase().slice(0, 4);
    // the model may send ALL/ANY to mean "no currency filter" — strip it
    if (out.currency === "ALL" || out.currency === "ANY") delete out.currency;
    else if (!/^[A-Z]{3,4}$/.test(out.currency)) return { ok: false, error: `"${out.currency}" is not a currency code — say USD, EUR, GBP, JPY and similar.` };
  }
  // the quote's human label rides along outside the executable params
  const label = typeof out._label === "string" ? out._label : undefined;
  delete out._label;
  return { ok: true, params: out, ...(label ? { label } : {}) };
}
