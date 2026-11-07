// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · suite settings
//  One persisted JSON row (EdgeSettings id="main") drives the four EDGE
//  layers that sit on top of the unchanged 3EL strategy:
//    • quality   — Signal Quality Score gate + grade-based sizing
//    • manager   — Smart Trade Manager (break-even / partial / trailing)
//    • guardian  — Capital Guardian (daily loss, trade cap, streak pause,
//                  drawdown size cuts)
//    • autopilot — use a walk-forward-validated profile as an overlay
//    • filters   — news blackout + trading-session filter (new entries only)
//    • prop      — prop-firm drawdown rules (daily / total, close at limit)
//    • spread    — spread + slippage guard on live orders
//  filters / prop / spread are OFF by default — they decide WHEN the
//  unchanged strategy may open a trade, never how it trades.
//  A synchronous in-memory copy is kept for the hot paths (engine ticks,
//  executeFire) — it is refreshed on every load/save.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { DEFAULT_TRADE_MANAGER, type TradeManagerCfg } from "@/lib/halo/types";

export type GradeLetter = "A+" | "A" | "B" | "C" | "D";
export const GRADE_LETTERS: GradeLetter[] = ["A+", "A", "B", "C", "D"];

export interface QualitySettings {
  enabled: boolean; // grade every fire (always on for the journal; this switch controls the gate + sizing)
  minScore: number; // fires below this score are skipped (0 = take everything)
  gradeSizing: boolean; // scale position size by grade
  sizeByGrade: Record<GradeLetter, number>; // multiplier per grade
  announce: boolean; // read the grade out loud when a trade opens
}

export interface GuardianSettings {
  enabled: boolean;
  dailyLossR: number; // stop new orders once today's closed result reaches −N R (0 = off)
  dailyTradeCap: number; // max new orders per UTC day (0 = off)
  streakLosses: number; // pause after N consecutive losses (0 = off)
  streakPauseMin: number; // pause length in minutes
  ddCut1R: number; // drawdown (R from peak) that halves size (0 = off)
  ddCut1Mult: number;
  ddCut2R: number; // deeper drawdown → stronger cut (0 = off)
  ddCut2Mult: number;
  ruinR: number; // Monte Carlo: "ruin" = a drawdown of this many R
}

export interface AutopilotSettings {
  enabled: boolean; // apply passed profiles as overlays on the live bot
}

export type SessionKey = "asia" | "london" | "newYork";

export interface FilterSettings {
  newsEnabled: boolean; // block new entries around scheduled news
  newsImpact: "high" | "med_high"; // which events count
  newsBeforeMin: number; // minutes before the release
  newsAfterMin: number; // minutes after the release
  sessionEnabled: boolean; // only open trades inside the chosen sessions
  sessions: Record<SessionKey, boolean>;
}

export type PropPreset = "custom" | "ftmo" | "fundednext" | "the5ers" | "fundingpips";

export interface PropSettings {
  enabled: boolean;
  preset: PropPreset;
  initialBalance: number; // account size at the start of the challenge (0 = first balance seen)
  dailyLossPct: number; // max loss in one day, % (0 = off)
  dailyBase: "initial" | "dayStart"; // the daily % is of the initial balance or of today's start
  dayRef: "balance" | "equity"; // today's reference: start-of-day balance or the higher of balance/equity
  maxLossPct: number; // max total loss, % of the initial balance (0 = off)
  maxLossMode: "static" | "trailing"; // static floor, or trailing the peak (up to the initial balance)
  resetHourUtc: number; // when the prop firm's day starts (UTC hour)
  bufferPct: number; // act this many % (of initial) BEFORE the hard limit
  closeAtLimit: boolean; // close open positions when a limit is hit
}

export interface SpreadSettings {
  enabled: boolean;
  maxSpreadPips: number; // refuse when the broker spread is wider (0 = off)
  maxSpreadSlPct: number; // refuse when spread > this % of the SL distance (0 = off)
  maxSlippagePips: number; // refuse when the broker price is this far from the order price (0 = off)
}

export interface EdgeSettings {
  quality: QualitySettings;
  manager: TradeManagerCfg;
  guardian: GuardianSettings;
  autopilot: AutopilotSettings;
  filters: FilterSettings;
  prop: PropSettings;
  spread: SpreadSettings;
}

/** Published 2-step evaluation rules — prop firms change them: always check your own account terms. */
export const PROP_PRESETS: Record<Exclude<PropPreset, "custom">, { label: string; rules: Partial<PropSettings> }> = {
  ftmo: { label: "FTMO", rules: { dailyLossPct: 5, dailyBase: "initial", dayRef: "balance", maxLossPct: 10, maxLossMode: "static" } },
  fundednext: { label: "FundedNext", rules: { dailyLossPct: 5, dailyBase: "dayStart", dayRef: "equity", maxLossPct: 10, maxLossMode: "static" } },
  the5ers: { label: "The5ers", rules: { dailyLossPct: 5, dailyBase: "dayStart", dayRef: "equity", maxLossPct: 10, maxLossMode: "static" } },
  fundingpips: { label: "FundingPips", rules: { dailyLossPct: 5, dailyBase: "dayStart", dayRef: "equity", maxLossPct: 10, maxLossMode: "static" } },
};

export const DEFAULT_EDGE: EdgeSettings = {
  quality: {
    enabled: true,
    minScore: 0,
    gradeSizing: false,
    sizeByGrade: { "A+": 1.5, A: 1.25, B: 1, C: 0.75, D: 0.5 },
    announce: true,
  },
  manager: { ...DEFAULT_TRADE_MANAGER },
  guardian: {
    enabled: true,
    dailyLossR: 3,
    dailyTradeCap: 8,
    streakLosses: 4,
    streakPauseMin: 120,
    ddCut1R: 6,
    ddCut1Mult: 0.5,
    ddCut2R: 10,
    ddCut2Mult: 0.25,
    ruinR: 20,
  },
  autopilot: { enabled: false },
  filters: {
    newsEnabled: false,
    newsImpact: "high",
    newsBeforeMin: 30,
    newsAfterMin: 30,
    sessionEnabled: false,
    sessions: { asia: true, london: true, newYork: true },
  },
  prop: {
    enabled: false,
    preset: "custom",
    initialBalance: 0,
    dailyLossPct: 5,
    dailyBase: "dayStart",
    dayRef: "balance",
    maxLossPct: 10,
    maxLossMode: "static",
    resetHourUtc: 0,
    bufferPct: 0.5,
    closeAtLimit: true,
  },
  spread: { enabled: false, maxSpreadPips: 0, maxSpreadSlPct: 25, maxSlippagePips: 0 },
};

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Number(v);
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function clampEdge(raw: unknown): EdgeSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof EdgeSettings, Record<string, unknown>>>;
  const q = r.quality ?? {};
  const m = r.manager ?? {};
  const g = r.guardian ?? {};
  const ap = r.autopilot ?? {};
  const f = r.filters ?? {};
  const pr = r.prop ?? {};
  const sp = r.spread ?? {};
  const df = DEFAULT_EDGE.filters;
  const dp = DEFAULT_EDGE.prop;
  const ds = DEFAULT_EDGE.spread;
  const ses = (f.sessions ?? {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
  const dq = DEFAULT_EDGE.quality;
  const dm = DEFAULT_EDGE.manager;
  const dg = DEFAULT_EDGE.guardian;
  const sbg = (q.sizeByGrade ?? {}) as Record<string, unknown>;
  return {
    quality: {
      enabled: q.enabled === undefined ? dq.enabled : Boolean(q.enabled),
      minScore: Math.round(clamp(q.minScore, 0, 100, dq.minScore)),
      gradeSizing: Boolean(q.gradeSizing ?? dq.gradeSizing),
      sizeByGrade: Object.fromEntries(
        GRADE_LETTERS.map((l) => [l, clamp(sbg[l], 0, 5, dq.sizeByGrade[l])])
      ) as Record<GradeLetter, number>,
      announce: q.announce === undefined ? dq.announce : Boolean(q.announce),
    },
    manager: {
      enabled: Boolean(m.enabled ?? dm.enabled),
      beAtR: clamp(m.beAtR, 0, 20, dm.beAtR),
      beOffsetR: clamp(m.beOffsetR, 0, 5, dm.beOffsetR),
      partialAtR: clamp(m.partialAtR, 0, 20, dm.partialAtR),
      partialPct: clamp(m.partialPct, 1, 90, dm.partialPct),
      trailStartR: clamp(m.trailStartR, 0, 20, dm.trailStartR),
      trailATR: clamp(m.trailATR, 0.1, 20, dm.trailATR),
    },
    guardian: {
      enabled: g.enabled === undefined ? dg.enabled : Boolean(g.enabled),
      dailyLossR: clamp(g.dailyLossR, 0, 100, dg.dailyLossR),
      dailyTradeCap: Math.round(clamp(g.dailyTradeCap, 0, 500, dg.dailyTradeCap)),
      streakLosses: Math.round(clamp(g.streakLosses, 0, 50, dg.streakLosses)),
      streakPauseMin: Math.round(clamp(g.streakPauseMin, 1, 10_080, dg.streakPauseMin)),
      ddCut1R: clamp(g.ddCut1R, 0, 500, dg.ddCut1R),
      ddCut1Mult: clamp(g.ddCut1Mult, 0.05, 1, dg.ddCut1Mult),
      ddCut2R: clamp(g.ddCut2R, 0, 500, dg.ddCut2R),
      ddCut2Mult: clamp(g.ddCut2Mult, 0.05, 1, dg.ddCut2Mult),
      ruinR: clamp(g.ruinR, 1, 1000, dg.ruinR),
    },
    autopilot: { enabled: Boolean(ap.enabled ?? false) },
    filters: {
      newsEnabled: Boolean(f.newsEnabled ?? df.newsEnabled),
      newsImpact: pick(f.newsImpact, ["high", "med_high"] as const, df.newsImpact),
      newsBeforeMin: Math.round(clamp(f.newsBeforeMin, 0, 720, df.newsBeforeMin)),
      newsAfterMin: Math.round(clamp(f.newsAfterMin, 0, 720, df.newsAfterMin)),
      sessionEnabled: Boolean(f.sessionEnabled ?? df.sessionEnabled),
      sessions: {
        asia: ses.asia === undefined ? df.sessions.asia : Boolean(ses.asia),
        london: ses.london === undefined ? df.sessions.london : Boolean(ses.london),
        newYork: ses.newYork === undefined ? df.sessions.newYork : Boolean(ses.newYork),
      },
    },
    prop: {
      enabled: Boolean(pr.enabled ?? dp.enabled),
      preset: pick(pr.preset, ["custom", "ftmo", "fundednext", "the5ers", "fundingpips"] as const, dp.preset),
      initialBalance: clamp(pr.initialBalance, 0, 100_000_000, dp.initialBalance),
      dailyLossPct: clamp(pr.dailyLossPct, 0, 50, dp.dailyLossPct),
      dailyBase: pick(pr.dailyBase, ["initial", "dayStart"] as const, dp.dailyBase),
      dayRef: pick(pr.dayRef, ["balance", "equity"] as const, dp.dayRef),
      maxLossPct: clamp(pr.maxLossPct, 0, 90, dp.maxLossPct),
      maxLossMode: pick(pr.maxLossMode, ["static", "trailing"] as const, dp.maxLossMode),
      resetHourUtc: Math.round(clamp(pr.resetHourUtc, 0, 23, dp.resetHourUtc)),
      bufferPct: clamp(pr.bufferPct, 0, 10, dp.bufferPct),
      closeAtLimit: pr.closeAtLimit === undefined ? dp.closeAtLimit : Boolean(pr.closeAtLimit),
    },
    spread: {
      enabled: Boolean(sp.enabled ?? ds.enabled),
      maxSpreadPips: clamp(sp.maxSpreadPips, 0, 10_000, ds.maxSpreadPips),
      maxSpreadSlPct: clamp(sp.maxSpreadSlPct, 0, 100, ds.maxSpreadSlPct),
      maxSlippagePips: clamp(sp.maxSlippagePips, 0, 10_000, ds.maxSlippagePips),
    },
  };
}

/** picking a preset fills its published rules; editing a rule afterwards switches to "custom" */
function applyPreset(p: PropSettings, presetChanged: boolean): PropSettings {
  if (p.preset === "custom") return p;
  const rules = PROP_PRESETS[p.preset].rules;
  if (presetChanged) return { ...p, ...rules };
  const edited = (Object.keys(rules) as (keyof PropSettings)[]).some((k) => rules[k] !== p[k]);
  return edited ? { ...p, preset: "custom" } : p;
}

const gEdge = globalThis as unknown as { __haloEdge?: EdgeSettings; __haloEdgeLoaded?: boolean };

/** Hot-path accessor — last loaded settings (defaults until the first load). */
export function getEdgeSync(): EdgeSettings {
  if (!gEdge.__haloEdgeLoaded) void loadEdge().catch(() => {});
  return gEdge.__haloEdge ?? DEFAULT_EDGE;
}

/** Trade-manager config for live engines (null = classic fixed SL/TP). */
export function liveTradeManager(): TradeManagerCfg | null {
  const m = getEdgeSync().manager;
  return m.enabled ? m : null;
}

export async function loadEdge(): Promise<EdgeSettings> {
  try {
    const row = await db.edgeSettings.findUnique({ where: { id: "main" } });
    const s = clampEdge(row ? JSON.parse(row.json) : {});
    gEdge.__haloEdge = s;
    gEdge.__haloEdgeLoaded = true;
    return s;
  } catch {
    gEdge.__haloEdgeLoaded = true;
    return gEdge.__haloEdge ?? DEFAULT_EDGE;
  }
}

/** Deep-merge a partial patch onto the current settings and persist. */
export async function saveEdge(patch: Partial<{ [K in keyof EdgeSettings]: Partial<EdgeSettings[K]> }>): Promise<EdgeSettings> {
  const cur = await loadEdge();
  const merged = clampEdge({
    quality: { ...cur.quality, ...(patch.quality ?? {}), sizeByGrade: { ...cur.quality.sizeByGrade, ...(patch.quality?.sizeByGrade ?? {}) } },
    manager: { ...cur.manager, ...(patch.manager ?? {}) },
    guardian: { ...cur.guardian, ...(patch.guardian ?? {}) },
    autopilot: { ...cur.autopilot, ...(patch.autopilot ?? {}) },
    filters: { ...cur.filters, ...(patch.filters ?? {}), sessions: { ...cur.filters.sessions, ...(patch.filters?.sessions ?? {}) } },
    prop: applyPreset({ ...cur.prop, ...(patch.prop ?? {}) }, patch.prop?.preset !== undefined && patch.prop.preset !== cur.prop.preset),
    spread: { ...cur.spread, ...(patch.spread ?? {}) },
  });
  await db.edgeSettings.upsert({
    where: { id: "main" },
    create: { id: "main", json: JSON.stringify(merged) },
    update: { json: JSON.stringify(merged) },
  });
  gEdge.__haloEdge = merged;
  gEdge.__haloEdgeLoaded = true;
  return merged;
}
