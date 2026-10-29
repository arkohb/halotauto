"use client";

import { Layers } from "lucide-react";
import { A, C, fmtPx, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";

export function LevelsCard({ state }: { state: BotStateRes }) {
  const levels = state.engine.levels;
  const nRes = levels.filter((l) => l.side === -1).length;
  const nSup = levels.length - nRes;

  return (
    <PanelCard
      title="FRESH EQUAL LEVELS"
      icon={Layers}
      accent="cyan"
      right={
        <span className="text-[11px] font-mono">
          <span style={{ color: C.red }}>{nRes} RES</span>
          <span style={{ color: C.muted }}> · </span>
          <span style={{ color: C.green }}>{nSup} SUP</span>
        </span>
      }
    >
      {levels.length === 0 ? (
        <div className="px-4 py-3 text-xs" style={{ color: C.muted }}>No fresh levels — scanning for a C1/C2 pair…</div>
      ) : (
        <div className="max-h-44 overflow-y-auto halo-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] tracking-wider border-b" style={{ color: C.muted, borderColor: C.line }}>
                <th className="text-left font-medium px-3 py-1.5">SIDE</th>
                <th className="text-right font-medium px-3 py-1.5">ZONE</th>
                <th className="text-right font-medium px-3 py-1.5">DOTTED TRIG</th>
                <th className="text-right font-medium px-3 py-1.5">AGE</th>
              </tr>
            </thead>
            <tbody>
              {[...levels].reverse().map((l) => (
                <tr key={l.id} className="border-b last:border-0" style={{ borderColor: C.divider }}>
                  <td className="px-3 py-1.5">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: l.side === -1 ? A.red(0.15) : A.green(0.15), color: l.side === -1 ? C.red : C.green }}>
                      {l.side === -1 ? "RESIST · SELL" : "SUPPORT · BUY"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono" style={{ color: C.txt }}>
                    {fmtPx(l.bot, state.mintick)} → {fmtPx(l.top, state.mintick)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold" style={{ color: C.gold }}>{fmtPx(l.ext, state.mintick)}</td>
                  <td className="px-3 py-1.5 text-right font-mono" style={{ color: C.muted }}>
                    {Math.max(0, state.engine.barIndex - l.b1Index)}b
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}
