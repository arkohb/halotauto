"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL DISCIPLINE TRACKER · builds ONLY from the trader's own tags —
//  nothing is auto-labeled as a mistake. Shows adherence, tag frequency
//  and the weekly trend of positive vs negative classifications.
// ══════════════════════════════════════════════════════════════════════════

import { ShieldCheck } from "lucide-react";
import { PanelCard, StateFrame, StatCell } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { AnalyticsPayload } from "@/lib/journal/stats";
import { DisciplineBars } from "./journal-chart";
import { pct } from "./journal-fmt";

export function JournalDiscipline({ data }: { data: AnalyticsPayload }) {
  const d = data.discipline;
  if (d.taggedTrades === 0) {
    return (
      <PanelCard title="TRADING DISCIPLINE TRACKER" icon={ShieldCheck} accent="gold">
        <div className="p-3">
          <StateFrame
            state="empty"
            title="No tagged trades in this selection"
            hint="Discipline is built from YOUR tags on each trade (Followed plan, Emotional decision, Overtrading…). Open any trade in the Trade Book and classify it — nothing is auto-labeled."
          />
        </div>
      </PanelCard>
    );
  }

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      <PanelCard title="DISCIPLINE SNAPSHOT" icon={ShieldCheck} accent="gold">
        <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-3">
          <StatCell label="Tagged trades" value={String(d.taggedTrades)} sub={`of ${data.core.totalTrades} in range`} />
          <StatCell label="Positive-tag trades" value={String(d.positiveTags)} color={C.green} sub="plan followed · disciplined" />
          <StatCell label="Negative-tag trades" value={String(d.negativeTags)} color={C.warn} sub="your recorded slips" />
          <StatCell label="Adherence" value={pct(d.adherencePct)} color={C.teal} sub="share of tagged trades with a positive tag" />
          <StatCell label="Most recorded slip" value={d.topMistakes[0]?.label ?? "—"} sub={d.topMistakes[0] ? `×${d.topMistakes[0].count}` : undefined} />
          <StatCell label="Distinct tags used" value={String(d.tagCounts.length)} />
        </div>
        <p className="px-3 pb-3 text-[8.5px] leading-relaxed" style={{ color: C.label }}>
          These are journaling classifications recorded by you — they are not trading signals, never feed the strategy, and never execute anything.
        </p>
      </PanelCard>

      <PanelCard title="WEEKLY TREND · POSITIVE VS NEGATIVE TAGS" icon={ShieldCheck} accent="teal">
        <div className="p-3">
          <DisciplineBars data={d.weekly} height={190} />
        </div>
      </PanelCard>

      <PanelCard title="TAG FREQUENCY" icon={ShieldCheck} accent="cyan" className="xl:col-span-2">
        <div className="grid gap-1.5 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.tagCounts.map((t) => {
            const max = d.tagCounts[0]?.count || 1;
            return (
              <div key={t.id} className="min-w-0 rounded-lg border px-2.5 py-2" style={{ borderColor: C.lineInner, background: `linear-gradient(180deg, ${A.blue(0.05)}, ${C.deep})` }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[9.5px] font-bold" style={{ color: t.positive ? C.green : C.warn }}>{t.label}</span>
                  <span className="font-mono text-[10px] font-bold" style={{ color: C.txt }}>×{t.count}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: A.white(0.06) }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(8, (t.count / max) * 100)}%`, background: t.positive ? A.green(0.7) : A.warn(0.7) }} />
                </div>
              </div>
            );
          })}
        </div>
      </PanelCard>
    </div>
  );
}
