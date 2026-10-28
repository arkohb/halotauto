"use client";

import { C, fmtPx, type BotStateRes } from "@/lib/halo/ui-helpers";

export function LevelsCard({ state }: { state: BotStateRes }) {
  const levels = state.engine.levels;
  const nRes = levels.filter((l) => l.side === -1).length;
  const nSup = levels.length - nRes;

  return (
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1C2A47]">
        <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">FRESH EQUAL LEVELS</span>
        <span className="text-[11px] font-mono">
          <span style={{ color: C.red }}>{nRes} RES</span>
          <span className="text-[#8C98AE]"> · </span>
          <span style={{ color: C.green }}>{nSup} SUP</span>
        </span>
      </div>
      {levels.length === 0 ? (
        <div className="px-4 py-3 text-xs text-[#8C98AE]">No fresh levels — scanning for a C1/C2 pair…</div>
      ) : (
        <div className="max-h-44 overflow-y-auto halo-scroll">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] tracking-wider text-[#8C98AE] border-b border-[#1C2A47]">
                <th className="text-left font-medium px-3 py-1.5">SIDE</th>
                <th className="text-right font-medium px-3 py-1.5">ZONE</th>
                <th className="text-right font-medium px-3 py-1.5">WICK EXT</th>
                <th className="text-right font-medium px-3 py-1.5">AGE</th>
              </tr>
            </thead>
            <tbody>
              {[...levels].reverse().map((l) => (
                <tr key={l.id} className="border-b border-[#121D35] last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: l.side === -1 ? "rgba(242,54,69,0.15)" : "rgba(8,153,129,0.15)", color: l.side === -1 ? C.red : C.green }}>
                      {l.side === -1 ? "RESIST · SELL" : "SUPPORT · BUY"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[#E8ECF4]">
                    {fmtPx(l.bot, state.mintick)} → {fmtPx(l.top, state.mintick)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[#8C98AE]">{fmtPx(l.ext, state.mintick)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[#8C98AE]">
                    {Math.max(0, state.engine.barIndex - l.b1Index)}b
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
