"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL REPORTS · daily / weekly / monthly / custom / instrument /
//  discipline reports rendered from the /api/journal/report payload, with
//  CSV export of the same window and a print action.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { FileDown, FileText, Printer } from "lucide-react";
import { PanelCard, Pill, StatCell, StateFrame } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { CoreStats, DisciplineStats, BreakdownRow } from "@/lib/journal/stats";
import { BreakTable } from "./journal-analytics";
import { dt, moneyPlain, pnlColor } from "./journal-fmt";

const KINDS: { id: string; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "custom", label: "Custom period" },
  { id: "instrument", label: "Instrument" },
  { id: "discipline", label: "Discipline" },
];

interface ReportPayload {
  kind: string;
  title: string;
  sub: string;
  generatedAt: string;
  currency: string[];
  core: CoreStats;
  daily: { day: string; net: number; trades: number }[];
  bySymbol: BreakdownRow[];
  byDirection: BreakdownRow[];
  bySession: BreakdownRow[];
  byStrategy: BreakdownRow[];
  discipline: DisciplineStats;
  winners: { id: string; symbol: string; direction: string; netPnl: number; closedAt: string; isDemo: boolean }[];
  losers: { id: string; symbol: string; direction: string; netPnl: number; closedAt: string; isDemo: boolean }[];
  observations: string[];
  totals: number;
}

export function JournalReports({ filterQS, ccy }: { filterQS: string; ccy: string }) {
  const [kind, setKind] = useState("monthly");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams(filterQS);
      qs.set("kind", kind);
      const res = await fetch(`/api/journal/report?${qs.toString()}`, { cache: "no-store" });
      const j = (await res.json()) as { ok: boolean; report?: ReportPayload; error?: string };
      if (!j.ok || !j.report) throw new Error(j.error ?? "Could not build the report.");
      setReport(j.report);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filterQS, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const c = report?.core;

  return (
    <PanelCard
      title="PERFORMANCE REPORTS"
      icon={FileText}
      accent="cyan"
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              aria-pressed={kind === k.id}
              className="rounded-md border px-2 py-1 text-[8.5px] font-extrabold tracking-[0.1em] uppercase transition-all"
              style={kind === k.id ? { borderColor: A.cyan(0.5), background: A.cyan(0.12), color: C.cyan } : { borderColor: C.line, background: C.navy2, color: C.muted }}
            >
              {k.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const qs = new URLSearchParams(filterQS);
              window.open(`/api/journal/export?${qs.toString()}`, "_blank");
            }}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125"
            style={{ borderColor: A.gold(0.45), background: A.gold(0.08), color: C.goldHover }}
          >
            <FileDown size={11} /> EXPORT CSV (SAME WINDOW)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125"
            style={{ borderColor: A.cyan(0.4), background: A.cyan(0.08), color: C.cyan }}
          >
            <Printer size={11} /> PRINT / PDF
          </button>
          {report && <span className="text-[8.5px]" style={{ color: C.label }}>Generated {dt(report.generatedAt)} · {report.totals} trades in window</span>}
        </div>

        {loading ? (
          <StateFrame state="loading" title="Building the report" hint="Compiling metrics from your journal records." />
        ) : err ? (
          <StateFrame state="error" title="Report failed" hint={err} onRetry={() => void load()} />
        ) : report && c ? (
          <div className="space-y-3">
            <div className="rounded-lg border p-3" style={{ borderColor: C.panelLine, background: `linear-gradient(180deg, ${A.blue(0.06)}, ${C.deep})` }}>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <div>
                  <div className="text-[13px] font-extrabold tracking-wide" style={{ color: C.txt3 }}>{report.title}</div>
                  <div className="text-[9.5px]" style={{ color: C.label }}>{report.sub} · currency {report.currency.join("/")}</div>
                </div>
                <Pill tone="gold">HALO 3EL · PERFORMANCE JOURNAL</Pill>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">
                <StatCell label="Trades" value={String(c.totalTrades)} />
                <StatCell label="Net P&L" value={moneyPlain(c.netPnl, ccy)} color={pnlColor(c.netPnl)} />
                <StatCell label="Win rate" value={`${c.winRatePct.toFixed(1)}%`} color={C.green} />
                <StatCell label="Profit factor" value={c.profitFactorLabel} />
                <StatCell label="Max drawdown" value={moneyPlain(c.maxDrawdown, ccy)} color={C.red} />
                <StatCell label="Costs (net)" value={moneyPlain(c.totalCosts, ccy)} />
              </div>
            </div>

            <div className="rounded-lg border p-3" style={{ borderColor: C.lineInner, background: A.blue(0.03) }}>
              <div className="pb-1.5 text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>OBSERVATIONS</div>
              <ul className="list-disc space-y-1 pl-4">
                {report.observations.map((o, i) => (
                  <li key={i} className="text-[10px] leading-relaxed" style={{ color: C.txt2 }}>{o}</li>
                ))}
              </ul>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <BreakTable title="By instrument" rows={report.bySymbol} ccy={ccy} />
              <BreakTable title="By direction" rows={report.byDirection} ccy={ccy} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TopList title="TOP WINNING TRADES" rows={report.winners} ccy={ccy} />
              <TopList title="TOP LOSING TRADES" rows={report.losers} ccy={ccy} />
            </div>
          </div>
        ) : null}
      </div>
    </PanelCard>
  );
}

function TopList({ title, rows, ccy }: { title: string; rows: ReportPayload["winners"]; ccy: string }) {
  return (
    <div className="min-w-0 rounded-lg border" style={{ borderColor: C.lineInner }}>
      <div className="border-b px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.14em]" style={{ borderColor: C.lineInner, color: C.label, background: A.blue(0.06) }}>{title}</div>
      {rows.length === 0 ? (
        <p className="px-2.5 py-2 text-[9px]" style={{ color: C.dim }}>None in this window.</p>
      ) : (
        <div className="halo-scroll max-h-[220px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5 last:border-0" style={{ borderColor: A.white(0.05) }}>
              <span className="truncate text-[9.5px] font-bold" style={{ color: C.txt }}>
                {r.symbol} {r.direction} {r.isDemo && <Pill tone="gold">DEMO</Pill>}
              </span>
              <span className="shrink-0 font-mono text-[9.5px]" style={{ color: C.label }}>{dt(r.closedAt)}</span>
              <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: pnlColor(r.netPnl) }}>{moneyPlain(r.netPnl, ccy)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
