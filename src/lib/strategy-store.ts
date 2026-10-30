// ════════════════════════════════════════════════════════════════════════
//  STRATEGY STORE · compile + persist helpers shared by the API routes
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { compilePine, type CompiledPine, type PineDiagnostic } from "@/lib/pine";
import type { PineStrategy } from "@prisma/client";

export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  status: "draft" | "compiled" | "error";
  compileMsg: string;
  active: boolean;
  kind: "strategy" | "indicator";
  overlay: boolean;
  hasLong: boolean;
  hasShort: boolean;
  hasExitSLTP: boolean;
  hasClose: boolean;
  plotCount: number;
  inputCount: number;
  plots: { key: string; title: string; style: string }[];
  risk: { useSlATR: boolean; slATRm: number; useSlPts: boolean; slPts: number; rrMult: number };
  signal: { mode: "strategy" | "manual"; longVar?: string; shortVar?: string; exitVar?: string };
  notes: string[];
  signalCandidates: string[];
  lastTradedAt: string | null;
  updatedAt: string;
}

export function metaOf(row: PineStrategy): CompiledPine | null {
  try {
    return JSON.parse(row.compiledJson) as CompiledPine;
  } catch {
    return null;
  }
}

export function toSummary(row: PineStrategy): StrategySummary {
  const meta = metaOf(row);
  let signal: StrategySummary["signal"] = { mode: "strategy" };
  try {
    const sj = JSON.parse(row.signalJson || "{}") as StrategySummary["signal"];
    if (sj.mode === "manual") signal = sj;
  } catch {
    // default
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as StrategySummary["status"],
    compileMsg: row.compileMsg,
    active: row.active,
    kind: meta?.kind ?? "indicator",
    overlay: meta?.overlay ?? true,
    hasLong: meta?.hasLong ?? false,
    hasShort: meta?.hasShort ?? false,
    hasExitSLTP: meta?.hasExitSLTP ?? false,
    hasClose: meta?.hasClose ?? false,
    plotCount: meta?.plots.length ?? 0,
    inputCount: meta?.inputs.length ?? 0,
    plots: (meta?.plots ?? []).slice(0, 8).map((p) => ({ key: p.key, title: p.title, style: p.style })),
    risk: { useSlATR: row.useSlATR, slATRm: row.slATRm, useSlPts: row.useSlPts, slPts: row.slPts, rrMult: row.rrMult },
    signal,
    notes: meta?.notes ?? [],
    signalCandidates: meta?.signalCandidates ?? [],
    lastTradedAt: row.lastTradedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function fmtDiagnostics(diags: PineDiagnostic[]): string {
  return diags.slice(0, 8).map((d) => `L${d.line}:${d.col} — ${d.msg}`).join("\n");
}

export function clampRisk(r: { useSlATR?: boolean; slATRm?: number; useSlPts?: boolean; slPts?: number; rrMult?: number }) {
  return {
    useSlATR: r.useSlATR !== false,
    slATRm: Math.min(20, Math.max(0.1, Number(r.slATRm) || 1.5)),
    useSlPts: r.useSlPts === true,
    slPts: Math.min(10_000_000, Math.max(1, Number(r.slPts) || 1000)),
    rrMult: Math.min(20, Math.max(0.1, Number(r.rrMult) || 3)),
  };
}

/** compile + persist; returns the row and the compile result */
export async function compileAndSave(
  data: Record<string, unknown>,
  existingId?: string
): Promise<{ row: PineStrategy; compile: { ok: boolean; diagnostics: PineDiagnostic[]; fatal?: PineDiagnostic }; summary: StrategySummary }> {
  const row0 = existingId ? await db.pineStrategy.findUnique({ where: { id: existingId } }) : null;
  const name = (typeof data.name === "string" && data.name.trim().slice(0, 80)) || row0?.name || "Untitled strategy";
  const description = typeof data.description === "string" ? data.description.slice(0, 300) : row0?.description ?? "";
  const source = typeof data.pineSource === "string" ? data.pineSource.slice(0, 60_000) : row0?.pineSource ?? "";
  const risk = clampRisk(data as Parameters<typeof clampRisk>[0]);

  let signalJson = row0?.signalJson ?? "{}";
  if (data.signalJson && typeof data.signalJson === "object") {
    signalJson = JSON.stringify(data.signalJson);
  }

  const res = compilePine(source);
  const status = res.meta.ok ? "compiled" : "error";
  const compileMsg = res.error
    ? `✗ ${res.error.line}:${res.error.col} — ${res.error.msg}`
    : res.meta.ok
      ? `✓ Compiled · ${res.meta.kind === "strategy" ? "auto-trading signals detected" : "indicator only — pick signal series for trading"} · ${res.meta.plots.length} plot(s)`
      : `✗ ${res.meta.diagnostics.length} error(s):\n${fmtDiagnostics(res.meta.diagnostics)}`;

  const payload = {
    name,
    description,
    pineSource: source,
    compiledJson: JSON.stringify(res.meta),
    status,
    compileMsg,
    signalJson,
    ...risk,
  };

  const row = existingId
    ? await db.pineStrategy.update({ where: { id: existingId }, data: payload })
    : await db.pineStrategy.create({ data: payload });

  return {
    row,
    compile: { ok: res.meta.ok, diagnostics: res.meta.diagnostics, ...(res.error ? { fatal: res.error } : {}) },
    summary: toSummary(row),
  };
}
