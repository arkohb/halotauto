"use client";

// ════════════════════════════════════════════════════════════════════════
//  DAILY BRIEFING · engine-grounded situational card
//  Outlook = the genuine statusOf() engine line; key levels = armed levels;
//  sessions = factual UTC clock math; account = real broker/sim posture.
//  No invented news items — when there is no news feed, nothing is shown.
// ════════════════════════════════════════════════════════════════════════

import { CalendarClock } from "lucide-react";
import { C, fmtPx, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";

function activeSessions(now: Date): string[] {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const out: string[] = [];
  if (h >= 0 && h < 9) out.push("Tokyo");
  if (h >= 7 && h < 16) out.push("London");
  if (h >= 12 && h < 21) out.push("New York");
  if (h >= 21 || h < 6) out.push("Sydney");
  return out;
}

export function DailyBriefing({ state }: { state: BotStateRes }) {
  const { text } = statusOf(state);
  const sessions = activeSessions(new Date());
  const levels = state.engine.levels;
  const t = state.engine.trade;
  const bullish = t ? t.dir === 1 : null;

  return (
    <PanelCard title="DAILY BRIEFING" icon={CalendarClock} accent="cyan" className="h-full" bodyClassName="flex flex-col gap-2 p-3">
      {/* outlook — the real engine status */}
      <div>
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t ? (t.dir === -1 ? C.red : C.green) : "#4FD8FF" }} />
          <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#6B7A94]">Market outlook · engine</span>
        </div>
        <p className="text-[10.5px] font-semibold leading-snug text-[#E8ECF4]">{text}</p>
        <p className="mt-0.5 text-[9.5px] leading-snug text-[#6B7A94]">
          {t
            ? `Position bias ${bullish ? "bullish" : "bearish"} while the trade runs — SL/TP attached at fire time.`
            : levels.length > 0
              ? "Bias neutral until the C3 break confirms a side — both directions stay live."
              : "No bias — the engine needs a fresh equal-level zone first."}
        </p>
      </div>

      {/* key levels — real armed triggers */}
      <div>
        <div className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#6B7A94]">Key levels (dotted triggers)</div>
        {levels.length === 0 ? (
          <p className="text-[10px] text-[#6B7A94]">None armed — scanning for the next C1/C2 zone.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {levels.map((l) => (
              <span
                key={l.id}
                className="rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-bold"
                style={{
                  borderColor: l.side === -1 ? "rgba(242,54,69,0.4)" : "rgba(8,153,129,0.4)",
                  color: l.side === -1 ? C.red : C.green,
                  background: l.side === -1 ? "rgba(242,54,69,0.07)" : "rgba(8,153,129,0.07)",
                }}
              >
                {l.side === -1 ? "RES" : "SUP"} {fmtPx(l.ext, state.mintick)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* sessions — factual clock */}
      <div>
        <div className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#6B7A94]">Sessions open</div>
        <p className="font-mono text-[10.5px] font-bold text-[#B8C2D6]">{sessions.length > 0 ? sessions.join(" · ") : "Interbank closed · crypto continues"}</p>
      </div>

      {/* account posture — real */}
      <div className="mt-auto flex items-center justify-between border-t border-[#16263F]/70 pt-2">
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#6B7A94]">Account status</span>
        <span
          className="rounded-full px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.12em]"
          style={{
            background: state.exec.executionMode === "live" ? "rgba(242,54,69,0.12)" : "rgba(8,153,129,0.12)",
            color: state.exec.executionMode === "live" ? C.red : C.green,
          }}
        >
          {state.exec.executionMode === "live" ? "LIVE ROUTING" : "HEALTHY · PAPER"}
        </span>
      </div>

      <p className="rounded-lg border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.06)] px-2.5 py-1.5 text-[9.5px] italic leading-snug text-[#F5D778]">
        &ldquo;Patience is a position. Let the setup come to you.&rdquo; — HALO
      </p>
    </PanelCard>
  );
}
