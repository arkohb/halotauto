// ══════════════════════════════════════════════════════════════════════════
//  HALO PERFORMANCE JOURNAL · calculation engine (pure functions)
//
//  Every metric is derived ONLY from the recorded JournalTrade rows passed
//  in — nothing is inferred, fabricated or fetched here. Definitions used:
//    · win    : netPnl > 0        · loss  : netPnl < 0
//    · breakeven: netPnl === 0 (counted in the denominator of rates,
//                 in neither the win nor the loss bucket)
//    · grossProfit : Σ netPnl of winning trades (net convention, as in
//                    professional journals — commissions already inside)
//    · grossLoss   : |Σ netPnl of losing trades|
//    · profitFactor: grossProfit ÷ grossLoss (∞ when no losses but >0 wins;
//                    0 when there are no winning trades at all)
//    · netPnl of a trade = grossProfit + commission + swap + fees
//      (MT5 sign convention — commission/swap usually ≤ 0)
//    · costs = −(Σ commission + Σ swap + Σ fees); positive ⇒ money paid.
//      Swap credits can make this negative — reported honestly as-is.
//    · maxDrawdown: peak-to-trough of the cumulative realized net-P&L
//      curve (or of recorded equity snapshots when present); % relative
//      to the running peak before the trough.
//    · R-multiple: price-based — ((exit − entry)·dir) ÷ |entry − SL|,
//      stored per trade when the SL was recorded. Lot/currency-based R
//      is NOT invented when the contract size is unknown.
//    · Sessions derived from the UTC open hour (Asia 00–07, London 07–13,
//      New York 13–21, Sydney 21–24) — labeled "derived" in the UI.
//    · All day bucketing is UTC (trade instants are stored UTC).
// ══════════════════════════════════════════════════════════════════════════

export interface JournalRec {
  id: string;
  source: string; // MT5 | CSV | MANUAL | DEMO
  brokerLabel: string;
  symbol: string;
  direction: string; // BUY | SELL
  volume: number;
  volumeExit: number;
  entryPrice: number;
  exitPrice: number;
  sl: number | null;
  tp: number | null;
  openedAt: string; // ISO
  closedAt: string; // ISO
  durationMin: number;
  grossProfit: number;
  commission: number;
  swap: number;
  fees: number;
  netPnl: number;
  currency: string;
  riskPrice: number | null;
  rMultiple: number | null;
  strategy: string;
  timeframe: string;
  session: string;
  notes: string;
  tags: string[];
  review: JournalReview;
  isDemo: boolean;
}

export interface JournalReview {
  reasonEntry?: string;
  reasonExit?: string;
  chartNotes?: string;
  mistakes?: string;
  lessons?: string;
  rating?: number; // 1..5
}

// ── discipline tags (journaling classifications — NOT trading signals) ──
export const JOURNAL_TAGS: { id: string; label: string; positive: boolean }[] = [
  { id: "followed_plan", label: "Followed trading plan", positive: true },
  { id: "early_entry", label: "Early entry", positive: false },
  { id: "late_entry", label: "Late entry", positive: false },
  { id: "early_exit", label: "Early exit", positive: false },
  { id: "missed_opportunity", label: "Missed opportunity", positive: false },
  { id: "overtrading", label: "Overtrading", positive: false },
  { id: "emotional", label: "Emotional decision", positive: false },
  { id: "sl_adjustment", label: "Stop-loss adjustment", positive: false },
  { id: "disciplined", label: "Disciplined execution", positive: true },
];

export function tagLabel(id: string): string {
  return JOURNAL_TAGS.find((t) => t.id === id)?.label ?? id;
}

// ── helpers ──────────────────────────────────────────────────────────────

export function dayKeyUtc(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function sessionOfUtc(iso: string): string {
  const h = new Date(iso).getUTCHours();
  if (h < 7) return "Asia";
  if (h < 13) return "London";
  if (h < 21) return "New York";
  return "Sydney";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayOfUtc(iso: string): string {
  return WEEKDAYS[new Date(iso).getUTCDay()];
}

function round(v: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}

// ── core metric block ────────────────────────────────────────────────────

export interface CoreStats {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRatePct: number;
  lossRatePct: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null; // null = no trades at all
  profitFactorLabel: string;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  avgR: number | null; // mean of recorded R-multiples only
  rCount: number; // how many trades had a calculable R
  totalCosts: number; // −(commission+swap+fees); positive = paid
  largestWin: number | null;
  largestLoss: number | null; // negative number (or null)
  maxDrawdown: number; // currency
  maxDrawdownPct: number | null; // relative to the pre-trough peak
  consecutiveWins: number;
  consecutiveLosses: number;
  avgDurationMin: number | null;
  avgRiskPrice: number | null; // where SL recorded
  riskCount: number;
  rewardRiskRatio: number | null; // avgWin ÷ avgLoss
  currencies: string[]; // distinct currencies in the selection
  mixedCurrency: boolean;
}

export function coreStats(recs: JournalRec[]): CoreStats {
  const n = recs.length;
  const winsList = recs.filter((r) => r.netPnl > 0);
  const lossesList = recs.filter((r) => r.netPnl < 0);
  const breakeven = recs.filter((r) => r.netPnl === 0).length;
  const wins = winsList.length;
  const losses = lossesList.length;

  const netPnl = sum(recs.map((r) => r.netPnl));
  const grossProfit = sum(winsList.map((r) => r.netPnl));
  const grossLoss = Math.abs(sum(lossesList.map((r) => r.netPnl)));
  const profitFactor = n === 0 ? null : grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // max drawdown over the cumulative realized curve (ordered by closedAt)
  const ordered = [...recs].sort((a, b) => +new Date(a.closedAt) - +new Date(b.closedAt));
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let ddPeak: number | null = null;
  for (const r of ordered) {
    cum += r.netPnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) {
      maxDd = dd;
      ddPeak = peak;
    }
  }
  const maxDrawdownPct = maxDd > 0 && ddPeak !== null && ddPeak > 0 ? (maxDd / ddPeak) * 100 : null;

  // consecutive streaks
  let cw = 0;
  let cl = 0;
  let bestW = 0;
  let bestL = 0;
  for (const r of ordered) {
    if (r.netPnl > 0) {
      cw += 1;
      cl = 0;
    } else if (r.netPnl < 0) {
      cl += 1;
      cw = 0;
    }
    if (cw > bestW) bestW = cw;
    if (cl > bestL) bestL = cl;
  }

  const rVals = recs.map((r) => r.rMultiple).filter((v): v is number => v !== null && isFinite(v));
  const riskVals = recs.map((r) => r.riskPrice).filter((v): v is number => v !== null && v > 0);
  const currencies = [...new Set(recs.map((r) => r.currency || "USD"))].sort();
  const avgWin = wins > 0 ? grossProfit / wins : null;
  const avgLoss = losses > 0 ? grossLoss / losses : null;

  return {
    totalTrades: n,
    wins,
    losses,
    breakeven,
    winRatePct: n > 0 ? (wins / n) * 100 : 0,
    lossRatePct: n > 0 ? (losses / n) * 100 : 0,
    netPnl,
    grossProfit,
    grossLoss,
    profitFactor,
    profitFactorLabel: n === 0 || profitFactor === null ? "—" : profitFactor === Infinity ? "∞" : profitFactor.toFixed(2),
    avgWin,
    avgLoss,
    expectancy: n > 0 ? netPnl / n : null,
    avgR: rVals.length > 0 ? sum(rVals) / rVals.length : null,
    rCount: rVals.length,
    totalCosts: -(sum(recs.map((r) => r.commission)) + sum(recs.map((r) => r.swap)) + sum(recs.map((r) => r.fees))),
    largestWin: wins > 0 ? Math.max(...winsList.map((r) => r.netPnl)) : null,
    largestLoss: losses > 0 ? Math.min(...lossesList.map((r) => r.netPnl)) : null,
    maxDrawdown: maxDd,
    maxDrawdownPct,
    consecutiveWins: bestW,
    consecutiveLosses: bestL,
    avgDurationMin: n > 0 ? Math.round(sum(recs.map((r) => r.durationMin)) / n) : null,
    avgRiskPrice: riskVals.length > 0 ? sum(riskVals) / riskVals.length : null,
    riskCount: riskVals.length,
    rewardRiskRatio: avgWin !== null && avgLoss !== null && avgLoss > 0 ? avgWin / avgLoss : null,
    currencies,
    mixedCurrency: currencies.length > 1,
  };
}

// ── daily / weekly / monthly P&L ─────────────────────────────────────────

export interface DayPnl {
  day: string; // YYYY-MM-DD (UTC)
  net: number;
  trades: number;
  wins: number;
  losses: number;
}

export function dailyPnl(recs: JournalRec[]): DayPnl[] {
  const m = new Map<string, DayPnl>();
  for (const r of recs) {
    const d = dayKeyUtc(r.closedAt);
    const cell = m.get(d) ?? { day: d, net: 0, trades: 0, wins: 0, losses: 0 };
    cell.net += r.netPnl;
    cell.trades += 1;
    if (r.netPnl > 0) cell.wins += 1;
    else if (r.netPnl < 0) cell.losses += 1;
    m.set(d, cell);
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** ISO week key, e.g. 2026-W43 (weeks start Monday, UTC). */
export function weekKeyUtc(iso: string): string {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((+t - +firstThu) / (7 * 24 * 3600 * 1000));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weeklyPnl(recs: JournalRec[]): DayPnl[] {
  const m = new Map<string, DayPnl>();
  for (const r of recs) {
    const d = weekKeyUtc(r.closedAt);
    const cell = m.get(d) ?? { day: d, net: 0, trades: 0, wins: 0, losses: 0 };
    cell.net += r.netPnl;
    cell.trades += 1;
    if (r.netPnl > 0) cell.wins += 1;
    else if (r.netPnl < 0) cell.losses += 1;
    m.set(d, cell);
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function monthlyPnl(recs: JournalRec[]): DayPnl[] {
  const m = new Map<string, DayPnl>();
  for (const r of recs) {
    const d = dayKeyUtc(r.closedAt).slice(0, 7);
    const cell = m.get(d) ?? { day: d, net: 0, trades: 0, wins: 0, losses: 0 };
    cell.net += r.netPnl;
    cell.trades += 1;
    if (r.netPnl > 0) cell.wins += 1;
    else if (r.netPnl < 0) cell.losses += 1;
    m.set(d, cell);
  }
  return [...m.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** cumulative realized net P&L curve (per closed trade, ordered by time) */
export function cumulativeCurve(recs: JournalRec[]): { t: string; net: number }[] {
  const ordered = [...recs].sort((a, b) => +new Date(a.closedAt) - +new Date(b.closedAt));
  let cum = 0;
  return ordered.map((r) => {
    cum += r.netPnl;
    return { t: r.closedAt, net: round(cum, 2) };
  });
}

// ── calendar month grid ──────────────────────────────────────────────────

export interface CalendarCell {
  day: string; // YYYY-MM-DD
  dayOfMonth: number;
  weekday: number; // 0=Mon … 6=Sun (grid is Monday-first)
  net: number | null; // null = no trades (neutral)
  trades: number;
  wins: number;
  losses: number;
  inMonth: boolean;
}

/** builds a full month grid (weeks × 7, Monday-first) with P&L filled in */
export function calendarMonth(year: number, month0: number, recs: JournalRec[]): CalendarCell[][] {
  const byDay = new Map(dailyPnl(recs).map((d) => [d.day, d]));
  const first = new Date(Date.UTC(year, month0, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push({ day: "", dayOfMonth: 0, weekday: i, net: null, trades: 0, wins: 0, losses: 0, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const hit = byDay.get(key);
    cells.push({
      day: key,
      dayOfMonth: d,
      weekday: (startOffset + d - 1) % 7,
      net: hit ? round(hit.net, 2) : null,
      trades: hit?.trades ?? 0,
      wins: hit?.wins ?? 0,
      losses: hit?.losses ?? 0,
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: "", dayOfMonth: 0, weekday: cells.length % 7, net: null, trades: 0, wins: 0, losses: 0, inMonth: false });
  }
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// ── breakdowns ───────────────────────────────────────────────────────────

export interface BreakdownRow {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  net: number;
  winRatePct: number;
  avgNet: number | null;
}

function breakdown(recs: JournalRec[], keyOf: (r: JournalRec) => string | null): BreakdownRow[] {
  const m = new Map<string, JournalRec[]>();
  for (const r of recs) {
    const k = keyOf(r);
    if (k === null) continue; // not recorded → excluded, never assumed
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return [...m.entries()]
    .map(([key, list]) => {
      const s = coreStats(list);
      return {
        key,
        trades: s.totalTrades,
        wins: s.wins,
        losses: s.losses,
        net: round(s.netPnl, 2),
        winRatePct: round(s.winRatePct, 1),
        avgNet: s.totalTrades > 0 ? round(s.netPnl / s.totalTrades, 2) : null,
      };
    })
    .sort((a, b) => b.net - a.net);
}

export const bySymbol = (recs: JournalRec[]) => breakdown(recs, (r) => r.symbol || null);
export const byDirection = (recs: JournalRec[]) => breakdown(recs, (r) => r.direction || null);
export const byTimeframe = (recs: JournalRec[]) => breakdown(recs, (r) => (r.timeframe ? r.timeframe : null));
export const byStrategy = (recs: JournalRec[]) => breakdown(recs, (r) => (r.strategy ? r.strategy : null));
export const bySession = (recs: JournalRec[]) => breakdown(recs, (r) => (r.session ? r.session : sessionOfUtc(r.openedAt)));
export const byWeekday = (recs: JournalRec[]) => breakdown(recs, (r) => weekdayOfUtc(r.openedAt));
export const bySource = (recs: JournalRec[]) => breakdown(recs, (r) => (r.source === "DEMO" ? "DEMO" : r.source));

// ── discipline tracker ───────────────────────────────────────────────────

export interface DisciplineStats {
  taggedTrades: number;
  positiveTags: number; // followed_plan + disciplined instances
  negativeTags: number;
  adherencePct: number | null; // share of tagged trades carrying a positive tag
  tagCounts: { id: string; label: string; count: number; positive: boolean }[];
  weekly: { week: string; positive: number; negative: number; total: number }[];
  topMistakes: { id: string; label: string; count: number }[];
}

export function disciplineStats(recs: JournalRec[]): DisciplineStats {
  let positiveTags = 0;
  let negativeTags = 0;
  const counts = new Map<string, number>();
  const weeklyMap = new Map<string, { positive: number; negative: number; total: number }>();
  for (const r of recs) {
    if (r.tags.length === 0) continue;
    for (const t of r.tags) {
      const positive = JOURNAL_TAGS.find((x) => x.id === t)?.positive ?? false;
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (positive) positiveTags += 1;
      else negativeTags += 1;
      const wk = weekKeyUtc(r.closedAt);
      const cell = weeklyMap.get(wk) ?? { positive: 0, negative: 0, total: 0 };
      if (positive) cell.positive += 1;
      else cell.negative += 1;
      cell.total += 1;
      weeklyMap.set(wk, cell);
    }
  }
  const tagged = recs.filter((r) => r.tags.length > 0).length;
  const tagCounts = [...counts.entries()]
    .map(([id, count]) => ({ id, label: tagLabel(id), count, positive: JOURNAL_TAGS.find((x) => x.id === id)?.positive ?? false }))
    .sort((a, b) => b.count - a.count);
  return {
    taggedTrades: tagged,
    positiveTags,
    negativeTags,
    adherencePct: tagged > 0 ? (recs.filter((r) => r.tags.some((t) => JOURNAL_TAGS.find((x) => x.id === t)?.positive)).length / tagged) * 100 : null,
    tagCounts,
    weekly: [...weeklyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, ...v })),
    topMistakes: tagCounts.filter((t) => !t.positive).slice(0, 5).map(({ id, label, count }) => ({ id, label, count })),
  };
}

// ── full analytics payload (single call used by /api/journal/stats) ──────

export interface EquitySnapshot {
  day: string;
  balance: number;
  equity: number;
  source: string;
}

export interface AnalyticsPayload {
  core: CoreStats;
  daily: DayPnl[];
  weekly: DayPnl[];
  monthly: DayPnl[];
  cumulative: { t: string; net: number }[];
  equity: { mode: "snapshots" | "derived"; points: { day: string; value: number }[] };
  // broker-recorded BALANCE series — exists only when real snapshots exist;
  // a balance curve is never fabricated from trade P&L (no starting balance known)
  balance: { mode: "snapshots" | "none"; points: { day: string; value: number }[] };
  calendar: { year: number; month0: number; weeks: CalendarCell[][] };
  bySymbol: BreakdownRow[];
  byDirection: BreakdownRow[];
  bySession: BreakdownRow[];
  byWeekday: BreakdownRow[];
  byTimeframe: BreakdownRow[];
  byStrategy: BreakdownRow[];
  bySource: BreakdownRow[];
  discipline: DisciplineStats;
  range: { from: string | null; to: string | null };
}

export function analyticsFor(
  recs: JournalRec[],
  opts: { year: number; month0: number; snapshots: EquitySnapshot[] }
): AnalyticsPayload {
  const core = coreStats(recs);
  // equity curve — REAL snapshots when the broker recorded them, otherwise
  // the derived cumulative net-P&L curve (always labeled at read time)
  const snaps = [...opts.snapshots].sort((a, b) => a.day.localeCompare(b.day));
  const equity =
    snaps.length >= 2
      ? { mode: "snapshots" as const, points: snaps.map((s) => ({ day: s.day, value: round(s.equity, 2) })) }
      : { mode: "derived" as const, points: cumulativeCurve(recs).map((p) => ({ day: dayKeyUtc(p.t), value: p.net })) };
  const balance =
    snaps.length >= 2
      ? { mode: "snapshots" as const, points: snaps.map((s) => ({ day: s.day, value: round(s.balance, 2) })) }
      : { mode: "none" as const, points: [] };
  const byTime = [...recs].sort((a, b) => +new Date(a.closedAt) - +new Date(b.closedAt));
  return {
    core,
    daily: dailyPnl(recs),
    weekly: weeklyPnl(recs),
    monthly: monthlyPnl(recs),
    cumulative: cumulativeCurve(recs),
    equity,
    balance,
    calendar: { year: opts.year, month0: opts.month0, weeks: calendarMonth(opts.year, opts.month0, recs) },
    bySymbol: bySymbol(recs),
    byDirection: byDirection(recs),
    bySession: bySession(recs),
    byWeekday: byWeekday(recs),
    byTimeframe: byTimeframe(recs),
    byStrategy: byStrategy(recs),
    bySource: bySource(recs),
    discipline: disciplineStats(recs),
    range: {
      from: byTime.length > 0 ? byTime[0].closedAt : null,
      to: byTime.length > 0 ? byTime[byTime.length - 1].closedAt : null,
    },
  };
}
