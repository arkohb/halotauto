// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · suite settings
//  One persisted JSON row (EdgeSettings id="main") drives the four EDGE
//  layers that sit on top of the unchanged 3EL strategy:
//    • quality   — Signal Quality Score gate + grade-based sizing
//    • manager   — Smart Trade Manager (break-even / partial / trailing)
//    • guardian  — Capital Guardian (daily loss, trade cap, streak pause,
//                  drawdown size cuts)
//    • autopilot — use a walk-forward-validated profile as an overlay
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

export interface EdgeSettings {
  quality: QualitySettings;
  manager: TradeManagerCfg;
  guardian: GuardianSettings;
  autopilot: AutopilotSettings;
}

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
  };
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
