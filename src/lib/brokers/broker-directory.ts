// ════════════════════════════════════════════════════════════════════════
//  BROKER DIRECTORY · all prop firms + CFD brokers, built into the system
//
//  Every entry is a firm HALO can trade through OUT OF THE BOX:
//    · kind "metaapi"  → the firm's MT4/MT5 login (login·password·server)
//                        works on the featured MT LOGIN card — servers are
//                        pre-filled from this catalog, MetaApi provisioning
//                        is automatic (platform key ships inside HALO).
//    · kind "oanda"/"ig"/"binance" → native adapters built into HALO.
//    · kind "webhook"/"fxcm"/"ctrader" → secure bridge (futures desks and
//                        platforms without a public MT/trade API).
//
//  Client-safe: pure data, no server imports.
// ════════════════════════════════════════════════════════════════════════

import type { BrokerKind } from "./types";

export interface FirmEntry {
  id: string;
  name: string;
  category: "prop" | "cfd";
  /** which built-in adapter executes orders for this firm */
  kind: BrokerKind;
  platform?: "mt4" | "mt5";
  /** common MT server names — pre-filled as suggestions; always copy the exact name from your MT terminal */
  servers: string[];
  assets: string;
  note?: string;
}

export type DirectoryCategory = "all" | "prop" | "cfd";

// ───────────────────────────── PROP FIRMS ─────────────────────────────

const PROPS: FirmEntry[] = [
  {
    id: "ftmo",
    name: "FTMO",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FTMO-Server", "FTMO-Server2", "FTMO-Server3", "FTMO-Demo"],
    assets: "FX · Metals · Indices · Crypto",
    note: "Challenge / Verification / Funded — use the MT login emailed when your account was issued.",
  },
  {
    id: "fundednext",
    name: "FundedNext",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FundedNext-Server", "FundedNext-Server2", "FundedNext-Demo"],
    assets: "FX · Metals · Indices",
    note: "Stellar / Evaluation accounts — MT5 login from the FundedNext dashboard.",
  },
  {
    id: "fundingpips",
    name: "Funding Pips",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FundingPips-Server", "FundingPips-Server2", "FPUS-Live"],
    assets: "FX · Metals · Indices · Crypto",
    note: "Student / Zero / Evaluation — MT5 credentials from your Funding Pips dashboard.",
  },
  {
    id: "the5ers",
    name: "The5ers",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["The5ers-Live", "The5ers-Server", "The5ers-MT5"],
    assets: "FX · Metals · Indices",
    note: "High Stakes / Hyper Growth / Bootcamp accounts.",
  },
  {
    id: "funded-trading-plus",
    name: "Funded Trading Plus",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FTPlus-Server", "FundedTradingPlus-Server", "FTP-Live"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "e8-funding",
    name: "E8 Funding",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["E8-MT5", "E8Funding-Server", "E8-Server2"],
    assets: "FX · Metals · Indices · Crypto",
    note: "E8 Track / Elev8 — TradeLocker is also offered; MT5 login works here.",
  },
  {
    id: "myforexfunds",
    name: "MyForexFunds",
    category: "prop",
    kind: "metaapi",
    platform: "mt4",
    servers: ["MyForexFunds-Server", "MyForexFunds-Server2", "MFF-Server"],
    assets: "FX · Metals · Indices",
    note: "Legacy accounts — confirm your firm account is active before connecting.",
  },
  {
    id: "blue-guardian",
    name: "Blue Guardian",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["BlueGuardian-Server", "Guardian-Server", "BlueGuardian-Live"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "alpha-capital",
    name: "Alpha Capital Group",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["ACG-Server", "AlphaCapital-Server", "AlphaCapitalGroup-Server"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "maven-trading",
    name: "Maven Trading",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Maven-Server", "MavenTrading-Server", "Maven-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "instant-funding",
    name: "Instant Funding",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["InstantFunding-Server", "InstantFunding-Live", "InstantFunding-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "ftuk",
    name: "FTUK",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FTUK-Server", "FTUK-Live", "FTUK-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "breakout",
    name: "Breakout",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Breakout-Server", "Breakout-Live", "Breakout-Demo"],
    assets: "FX · Metals · Crypto",
    note: "Prop with crypto focus — MT5 and TradeLocker both offered.",
  },
  {
    id: "the-funded-trader",
    name: "The Funded Trader",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["TheFundedTrader-Server", "TFT-Server", "TheFundedTrader-Live"],
    assets: "FX · Metals · Indices",
    note: "Confirm your account status with the firm before connecting.",
  },
  {
    id: "funder-trading",
    name: "Funder Trading",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FunderTrading-Server", "Funder-Live", "Funder-Demo"],
    assets: "FX · Metals · Futures (futures via bridge)",
  },
  {
    id: "myfundedfx",
    name: "MyFundedFX",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["MyFundedFX-Server", "MFFX-Server", "MyFundedFX-Live"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "funded-engineer",
    name: "Funded Engineer",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FundedEngineer-Server", "FundedEngineer-Live", "FundedEngineer-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "ofp",
    name: "OFP Funding",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["OFP-Server", "OFP-Funded-Live", "OFP-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "brightfunded",
    name: "BrightFunded",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["BrightFunded-Server", "BrightFunded-Live", "BrightFunded-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "aqua-funded",
    name: "Aqua Funded",
    category: "prop",
    kind: "metaapi",
    platform: "mt5",
    servers: ["AquaFunded-Server", "AquaFunded-Live", "AquaFunded-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "oanda-prop",
    name: "OANDA Prop Trader",
    category: "prop",
    kind: "oanda",
    servers: [],
    assets: "FX · Metals · Indices CFDs",
    note: "Runs on OANDA v20 — the OANDA API form opens pre-labeled; paste your OANDA token + account ID.",
  },
  // futures & platform-native prop desks — no public MT API exists, route via bridge
  {
    id: "topstep",
    name: "Topstep",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Futures · CME",
    note: "Futures desk on Rithmic/Tradovate — no MT4/MT5 API exists. Route C3 orders through the webhook bridge (Custom bridge / Webhook).",
  },
  {
    id: "apex",
    name: "Apex Trader Funding",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Futures · CME",
    note: "Rithmic/NinjaTrader/Tradovate — connect via the webhook bridge.",
  },
  {
    id: "bulenox",
    name: "Bulenox",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Futures · CME",
    note: "Rithmic/Tradovate — connect via the webhook bridge.",
  },
  {
    id: "earn2trade",
    name: "Earn2Trade",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Futures · CME",
    note: "Rithmic/Sierrachart — connect via the webhook bridge.",
  },
  {
    id: "myfundedfutures",
    name: "MyFundedFutures (MFFU)",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Futures · CME",
    note: "Rithmic/Tradovate — connect via the webhook bridge.",
  },
  {
    id: "take-profit-trader",
    name: "Take Profit Trader",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Futures · CME",
    note: "PRO accounts on Rithmic — connect via the webhook bridge.",
  },
  {
    id: "hyrotrader",
    name: "HyroTrader",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "Crypto (Bybit)",
    note: "Crypto prop on Bybit — connect via the webhook bridge.",
  },
  {
    id: "sabiotrade",
    name: "SabioTrade",
    category: "prop",
    kind: "webhook",
    servers: [],
    assets: "FX · Indices · Crypto",
    note: "Proprietary platform — connect via the webhook bridge.",
  },
];

// ───────────────────────────── CFD BROKERS ─────────────────────────────

const CFD: FirmEntry[] = [
  {
    id: "icmarkets",
    name: "IC Markets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["ICMarketsSC-MT5", "ICMarketsSC-MT4", "ICMarkets-Live07", "ICMarkets-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "pepperstone",
    name: "Pepperstone",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Pepperstone-Live08", "Pepperstone-Live03", "Pepperstone-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "xm",
    name: "XM",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["XMGlobal-MT5 2", "XMGlobal-MT5Real 12", "XMGlobal-MT4 2", "XMGlobal-MT5Demo 2"],
    assets: "FX · Metals · Indices · Oil",
  },
  {
    id: "exness",
    name: "Exness",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Exness-MT5Real8", "Exness-MT5Real16", "Exness-MT4Real8", "Exness-MT5Trial7"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "vantage",
    name: "Vantage",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["VantageInternational-Live", "VantageInternationalLive 5", "VantageInternational-Demo"],
    assets: "FX · Metals · Indices · Oil",
  },
  {
    id: "axi",
    name: "Axi",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Axi-US03-Live", "Axi-AU04-Live", "Axi-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "fxpro",
    name: "FxPro",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FxPro-Server", "FxPro-Server2", "FxPro-Server03"],
    assets: "FX · Metals · Indices · Futures",
  },
  {
    id: "thinkmarkets",
    name: "ThinkMarkets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["ThinkMarkets-Live", "ThinkMarkets-Live02", "ThinkMarkets-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "globalprime",
    name: "Global Prime",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Global-Prime-Live", "Global-Prime-Live 2", "Global-Prime-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "eightcap",
    name: "Eightcap",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Eightcap-Live", "Eightcap-Live29", "Eightcap-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "fusion",
    name: "Fusion Markets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FusionMarkets-Live", "Fusion-MT5-Live", "FusionMarkets-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "tickmill",
    name: "Tickmill",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Tickmill-Live", "Tickmill-Live13", "Tickmill-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "fbs",
    name: "FBS",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FBS-Real", "FBS-Real2", "FBS-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "hfmarkets",
    name: "HF Markets (HotForex)",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["HFMarkets-Live", "HFMarkets-Live07", "HFMarkets-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "octa",
    name: "Octa (OctaFX)",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["OctaFX-Real", "OctaFX-Real4", "OctaFX-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "justmarkets",
    name: "JustMarkets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["JustMarkets-Real", "JustMarkets-Real2", "JustMarkets-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "roboforex",
    name: "RoboForex",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["RoboForex-Real", "RoboForex-Pro", "RoboForex-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "alpari",
    name: "Alpari",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Alpari-MT5", "Alpari-MT5-Demo", "Alpari-Pro-MT4"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "fxtm",
    name: "FXTM (ForexTime)",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["FXTM-Real", "FXTM-Server", "FXTM-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "avatrade",
    name: "AvaTrade",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Ava-Fin", "AvaTrade-Live", "AvaTradeMT5-Demo"],
    assets: "FX · Metals · Indices · Crypto",
  },
  {
    id: "admirals",
    name: "Admirals",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Admiral-Server", "Admiral-Live", "Admiral-MT5-Demo"],
    assets: "FX · Metals · Indices · ETFs",
  },
  {
    id: "blackbull",
    name: "BlackBull Markets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["BlackBull-MT5", "BlackBull-Live", "BlackBullMarkets-Live"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "tmgm",
    name: "TMGM",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["TMGMT4-Live", "TMGM-MT5-Live", "TMGM-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "hantec",
    name: "Hantec Markets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["HantecPrime-Live", "Hantec-Live", "Hantec-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "deriv-mt",
    name: "Deriv (MT5)",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Deriv-Real", "Deriv-Demo"],
    assets: "FX · Metals · Synthetic indices",
  },
  {
    id: "gomarkets",
    name: "GO Markets",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["GOMarkets-Live", "GOMarkets-MT5", "GOMarkets-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "infinox",
    name: "INFINOX",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["INFINOX-MT5", "INFINOX-Live", "INFINOX-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "axiory",
    name: "Axiory",
    category: "cfd",
    kind: "metaapi",
    platform: "mt5",
    servers: ["Axiory-Live", "AxioryAsia-Live", "Axiory-Demo"],
    assets: "FX · Metals · Indices",
  },
  {
    id: "oanda",
    name: "OANDA",
    category: "cfd",
    kind: "oanda",
    servers: [],
    assets: "FX · Metals · Indices CFDs",
    note: "Native v20 REST adapter built in — paste your OANDA API token + account ID (practice or live).",
  },
  {
    id: "ig",
    name: "IG Markets",
    category: "cfd",
    kind: "ig",
    servers: [],
    assets: "FX · Metals · Indices · Shares CFDs",
    note: "Native Dealing API v3 adapter built in — paste your IG API key + identifier (demo or live).",
  },
  {
    id: "fxcm",
    name: "FXCM",
    category: "cfd",
    kind: "fxcm",
    servers: [],
    assets: "FX · Metals · Indices",
    note: "FXCM's own REST stack needs a host — route through the secure FXCM bridge.",
  },
  {
    id: "binance",
    name: "Binance",
    category: "cfd",
    kind: "binance",
    servers: [],
    assets: "Crypto spot — the EA's crypto leg",
    note: "Native HMAC-signed spot adapter built in — paste your Binance API key + secret (spot trading enabled).",
  },
];

export const BROKER_DIRECTORY: FirmEntry[] = [...PROPS, ...CFD];

export function firmById(id: string): FirmEntry | undefined {
  return BROKER_DIRECTORY.find((f) => f.id === id);
}

export function searchFirms(query: string, category: DirectoryCategory): FirmEntry[] {
  const q = query.trim().toLowerCase();
  return BROKER_DIRECTORY.filter((f) => {
    if (category !== "all" && f.category !== category) return false;
    if (!q) return true;
    return (
      f.name.toLowerCase().includes(q) ||
      f.assets.toLowerCase().includes(q) ||
      f.servers.some((s) => s.toLowerCase().includes(q)) ||
      (f.note ?? "").toLowerCase().includes(q)
    );
  });
}

/** union of every MT server name in the directory — feeds the login card's autocomplete */
export const DIRECTORY_MT_SERVERS: string[] = Array.from(
  new Set(BROKER_DIRECTORY.flatMap((f) => f.servers))
).sort();

/** short connector label shown on each directory tile */
export function viaLabel(kind: BrokerKind): string {
  switch (kind) {
    case "metaapi":
      return "MT4/MT5 · direct login";
    case "oanda":
      return "OANDA v20 API";
    case "ig":
      return "IG Dealing API";
    case "binance":
      return "Binance API";
    case "fxcm":
      return "secure bridge";
    case "ctrader":
      return "secure bridge";
    case "deriv":
      return "secure bridge";
    case "webhook":
      return "webhook bridge";
    default:
      return "built-in";
  }
}
