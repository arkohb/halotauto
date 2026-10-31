"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL CALENDAR · monthly grid — green profitable days, red losing
//  days, neutral days without trades; daily P&L + trade count. Selecting a
//  day jumps to the trade book filtered to that exact day (UTC).
// ══════════════════════════════════════════════════════════════════════════

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { PanelCard } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { CalendarCell } from "@/lib/journal/stats";
import { MONTHS, moneyPlain, pnlColor } from "./journal-fmt";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props {
  weeks: CalendarCell[][];
  year: number;
  month0: number;
  ccy: string;
  onMonth: (year: number, month0: number) => void;
  onSelectDay: (day: string) => void;
  onMonthShift: (delta: number) => void;
}

export function JournalCalendar({ weeks, year, month0, ccy, onSelectDay, onMonthShift }: Props) {
  // month totals from the grid itself (cells are already the filtered set)
  let net = 0;
  let trades = 0;
  let green = 0;
  let red = 0;
  for (const w of weeks)
    for (const d of w) {
      if (!d.inMonth || d.net === null) continue;
      net += d.net;
      trades += d.trades;
      if (d.net > 0) green += 1;
      else if (d.net < 0) red += 1;
    }

  return (
    <PanelCard
      title={`TRADING CALENDAR · ${MONTHS[month0].toUpperCase()} ${year}`}
      icon={CalendarDays}
      accent="gold"
      right={
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onMonthShift(-1)} aria-label="Previous month" className="rounded-md border px-2 py-1 text-[9px] font-extrabold" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }}>
            <ChevronLeft size={11} />
          </button>
          <button type="button" onClick={() => onMonthShift(1)} aria-label="Next month" className="rounded-md border px-2 py-1 text-[9px] font-extrabold" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }}>
            <ChevronRight size={11} />
          </button>
        </div>
      }
    >
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-3 pb-2 text-[9px]" style={{ color: C.label }}>
          <span>Month net: <b className="font-mono" style={{ color: pnlColor(net) }}>{moneyPlain(net, ccy)}</b></span>
          <span>Trades: <b className="font-mono" style={{ color: C.txt2 }}>{trades}</b></span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: A.green(0.8) }} /> profitable</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: A.red(0.8) }} /> losing</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: A.white(0.12) }} /> no trades</span>
          <span>· day buckets are UTC — click a day for its trade history</span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {DOW.map((d) => (
            <div key={d} className="pb-1 text-center text-[8px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>{d}</div>
          ))}
          {weeks.flat().map((cell, i) => {
            if (!cell.inMonth) {
              return <div key={`e${i}`} className="min-h-[52px] rounded-md border border-dashed opacity-30" style={{ borderColor: C.lineInner }} aria-hidden />;
            }
            const tone = cell.net === null ? null : cell.net > 0 ? "win" : cell.net < 0 ? "loss" : "flat";
            const bg = tone === "win" ? A.green(0.1) : tone === "loss" ? A.red(0.1) : A.white(0.03);
            const border = tone === "win" ? A.green(0.35) : tone === "loss" ? A.red(0.35) : C.lineInner;
            return (
              <button
                key={cell.day}
                type="button"
                onClick={() => onSelectDay(cell.day)}
                className="flex min-h-[52px] flex-col rounded-md border px-1.5 py-1 text-left transition-all hover:brightness-125"
                style={{ borderColor: border, background: bg }}
                aria-label={`${cell.day}: ${cell.trades} trades, net ${cell.net ?? 0}`}
              >
                <span className="text-[9px] font-extrabold" style={{ color: C.txt2 }}>{cell.dayOfMonth}</span>
                {cell.trades > 0 ? (
                  <>
                    <span className="font-mono text-[9px] font-bold leading-tight" style={{ color: pnlColor(cell.net) }}>
                      {moneyPlain(cell.net, ccy)}
                    </span>
                    <span className="text-[7.5px]" style={{ color: C.label }}>
                      {cell.trades} trade{cell.trades > 1 ? "s" : ""}{cell.wins > 0 ? ` · ${cell.wins}W` : ""}{cell.losses > 0 ? ` · ${cell.losses}L` : ""}
                    </span>
                  </>
                ) : (
                  <span className="mt-auto text-[7.5px]" style={{ color: C.dim }}>—</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </PanelCard>
  );
}
