// ══════════════════════════════════════════════════════════════════════════
//  HALO PERFORMANCE JOURNAL · CSV import + export
//
//  Import accepts the common journal-export shapes (TradeZella / TraderSync
//  / MT5 report CSVs): headers are matched case-insensitively against a
//  synonym table, quoted fields are honoured, missing optional fields are
//  left EMPTY — never fabricated. Every imported row gets a stable content
//  hash as its dedup key, so re-importing the same file never duplicates.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import type { JournalRec } from "./stats";

export interface CsvTradeInput {
  symbol: string;
  direction: string; // BUY | SELL
  volume: number;
  entryPrice: number;
  exitPrice: number;
  sl: number | null;
  tp: number | null;
  openedAt: Date;
  closedAt: Date;
  grossProfit: number;
  commission: number;
  swap: number;
  fees: number;
  netPnl: number;
  currency: string;
  strategy: string;
  timeframe: string;
  notes: string;
  extKey: string;
}

export interface CsvParseResult {
  rows: CsvTradeInput[];
  errors: string[]; // per-row problems (row skipped, reported honestly)
  skipped: number;
}

// RFC-4180-ish splitter (quoted fields, doubled quotes, CRLF)
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_SYNONYMS: Record<string, string[]> = {
  symbol: ["symbol", "instrument", "pair", "item", "ticker"],
  direction: ["direction", "side", "type", "buy/sell", "long/short", "action"],
  volume: ["volume", "lots", "lot", "size", "lotsize", "units", "volumelots"],
  entryPrice: ["entryprice", "entry", "openprice", "open", "pricein", "buyprice"],
  exitPrice: ["exitprice", "exit", "closeprice", "close", "priceout", "sellprice"],
  sl: ["sl", "stoploss", "stop", "s/l"],
  tp: ["tp", "takeprofit", "target", "t/p"],
  openedAt: ["openedat", "opentime", "opendate", "entrytime", "entrydate", "date", "datetime", "time", "openedutc", "opened"],
  closedAt: ["closedat", "closetime", "closedate", "exittime", "exitdate", "closedutc", "closed"],
  grossProfit: ["grossprofit", "profit", "pnl", "p/l", "profitpips", "realizedpnl", "realized"],
  commission: ["commission", "commissions", "comm"],
  swap: ["swap", "swaps", "overnight"],
  fees: ["fees", "fee"],
  netPnl: ["netpnl", "net", "netprofit", "netp/l"],
  currency: ["currency", "ccy", "accountcurrency"],
  strategy: ["strategy", "setup", "strategy/setup", "playbook"],
  timeframe: ["timeframe", "tf", "charttf"],
  notes: ["notes", "note", "comment", "comments"],
};

/** canonical header form — lowercase, only [a-z0-9] (slashes/&/spaces all
 *  collapse, so "Net P&L", "netp/l" and "NetPL" all become "netpl") */
function canon(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const c = canon(h);
    for (const [field, names] of Object.entries(HEADER_SYNONYMS)) {
      if (idx[field] === undefined && names.some((nm) => canon(nm) === c)) idx[field] = i;
    }
  });
  return idx;
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v === "") return null;
  let s = String(v).replace(/[$\s]/g, "");
  // European decimal comma ("1234,56") — 1-2 digits after a lone comma
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  // otherwise treat every comma as a thousands separator ("1,234,567.89")
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function dateOrNull(v: string | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return isFinite(t) ? new Date(t) : null;
}

function dirOf(v: string | undefined): string {
  const s = (v ?? "").toLowerCase();
  if (s.startsWith("b") || s.includes("long") || s.includes("buy")) return "BUY";
  if (s.startsWith("s") || s.includes("short") || s.includes("sell")) return "SELL";
  return "";
}

/** parse a full CSV document into candidate journal rows */
export function parseTradesCsv(csvText: string): CsvParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ["CSV needs a header row plus at least one trade row."], skipped: 0 };
  const header = splitCsvLine(lines[0]);
  const idx = mapHeaders(header);
  if (idx.symbol === undefined || idx.entryPrice === undefined) {
    return {
      rows: [],
      errors: [
        `Required columns not found. Need at least: symbol/instrument and entry/open price. Detected: ${header.join(", ")}`,
      ],
      skipped: 0,
    };
  }
  const rows: CsvTradeInput[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const get = (f: string) => (idx[f] !== undefined ? cols[idx[f]] : undefined);
    const symbol = (get("symbol") ?? "").toUpperCase();
    const entryPrice = numOrNull(get("entryPrice"));
    if (!symbol || entryPrice === null) {
      errors.push(`Row ${i + 1}: missing symbol or entry price — skipped.`);
      skipped++;
      continue;
    }
    const direction = dirOf(get("direction"));
    if (!direction) {
      errors.push(`Row ${i + 1}: direction (BUY/SELL) missing or unreadable — skipped.`);
      skipped++;
      continue;
    }
    const openedAt = dateOrNull(get("openedAt"));
    const closedAt = dateOrNull(get("closedAt")) ?? openedAt;
    if (!openedAt || !closedAt) {
      errors.push(`Row ${i + 1}: open/close date missing or unparsable — skipped.`);
      skipped++;
      continue;
    }
    const exitPrice = numOrNull(get("exitPrice")) ?? entryPrice;
    const grossProfit = numOrNull(get("grossProfit")) ?? 0;
    const commission = numOrNull(get("commission")) ?? 0;
    const swap = numOrNull(get("swap")) ?? 0;
    const fees = numOrNull(get("fees")) ?? 0;
    const netGiven = numOrNull(get("netPnl"));
    const netPnl = netGiven !== null ? netGiven : grossProfit + commission + swap + fees;
    // stable content hash → the same file imported twice never duplicates
    const hash = crypto
      .createHash("sha256")
      .update(
        [symbol, direction, get("volume") ?? "", entryPrice, exitPrice, openedAt.toISOString(), closedAt.toISOString(), netPnl].join("|")
      )
      .digest("hex")
      .slice(0, 24);
    rows.push({
      symbol,
      direction,
      volume: numOrNull(get("volume")) ?? 0,
      entryPrice,
      exitPrice,
      sl: numOrNull(get("sl")),
      tp: numOrNull(get("tp")),
      openedAt,
      closedAt,
      grossProfit,
      commission,
      swap,
      fees,
      netPnl,
      currency: (get("currency") ?? "USD").toUpperCase() || "USD",
      strategy: get("strategy") ?? "",
      timeframe: get("timeframe") ?? "",
      notes: get("notes") ?? "",
      extKey: `csv:${hash}`,
    });
  }
  return { rows, errors, skipped };
}

// ── export ───────────────────────────────────────────────────────────────

const EXPORT_HEADERS = [
  "Symbol", "Direction", "Volume (lots)", "Entry", "Exit", "SL", "TP",
  "Opened (UTC)", "Closed (UTC)", "Duration (min)", "Gross P&L", "Commission",
  "Swap", "Fees", "Net P&L", "Currency", "R multiple", "Strategy", "Timeframe",
  "Session", "Source", "Tags", "Notes",
];

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tradesToCsv(recs: JournalRec[]): string {
  const lines = [EXPORT_HEADERS.join(",")];
  for (const r of recs) {
    lines.push(
      [
        r.symbol, r.direction, r.volume, r.entryPrice, r.exitPrice,
        r.sl ?? "", r.tp ?? "",
        r.openedAt, r.closedAt, r.durationMin,
        r.grossProfit, r.commission, r.swap, r.fees, r.netPnl, r.currency,
        r.rMultiple !== null ? r.rMultiple.toFixed(2) : "",
        r.strategy, r.timeframe, r.session,
        r.isDemo ? "DEMO" : r.source,
        r.tags.map((t) => t.replace(/_/g, " ")).join("; "),
        r.notes,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}
