"use client";

// ════════════════════════════════════════════════════════════════════════
//  DAILY BRIEFING · engine-grounded situational card
//  Outlook = the genuine statusOf() engine line; key levels = armed levels;
//  sessions = factual UTC clock math; account = real broker/sim posture.
//  Next high-impact event = REAL ForexFactory feed via /api/intel/calendar
//  (hidden entirely when the feed is unavailable — nothing invented).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { A, C, fmtPx, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard, Pill } from "./panel";

function activeSessions(now: Date): string[] {
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const out: string[] = [];
  if (h >= 0 && h < 9) out.push("Tokyo");
  if (h >= 7 && h < 16) out.push("London");
  if (h >= 12 && h < 21) out.push("New York");
  if (h >= 21 || h < 6) out.push("Sydney");
  return out;
}

interface NextEvent {
  title: string;
  currency: string;
  date: string;
  forecast: string;
}

/** next upcoming high-impact calendar release — real feed, hidden on failure */
function useNextHighImpact(): NextEvent | null | "unavailable" {
  const [ev, setEv] = useState<NextEvent | null | "unavailable" | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/intel/calendar?day=this_week&impact=high", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { ok?: boolean; events?: { title: string; currency: string; date: string; forecast: string; actual: string }[] };
        if (!alive) return;
        if (!j.ok || !Array.isArray(j.events)) {
          setEv("unavailable");
          return;
        }
        const now = Date.now();
        const next = j.events.map((e) => ({ ...e, t: new Date(e.date).getTime() })).filter((e) => isFinite(e.t)).sort((a, b) => a.t - b.t).find((e) => e.t >= now);
        setEv(next ? { title: next.title, currency: next.currency, date: next.date, forecast: next.forecast } : null);
      } catch {
        if (alive) setEv("unavailable");
      }
    };
    void load();
    const id = setInterval(load, 600_000); // calendar moves slowly — 10 min cadence
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return ev ?? null;
}

export function DailyBriefing({ state }: { state: BotStateRes }) {
  const { text } = statusOf(state);
  const sessions = activeSessions(new Date());
  const levels = state.engine.levels;
  const t = state.engine.trade;
  const bullish = t ? t.dir === 1 : null;
  const nextEvent = useNextHighImpact();

  return (
    <PanelCard title="DAILY BRIEFING" icon={CalendarClock} accent="cyan" className="h-full" bodyClassName="flex flex-col gap-2 p-3">
      {/* outlook — the real engine status */}
      <div>
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t ? (t.dir === -1 ? C.red : C.green) : C.cyan }} />
          <span className="text-[9px] font-extrabold uppercase tracking-[0.16em]" style={{ color: C.label }}>Market outlook · engine</span>
        </div>
        <p className="text-[10.5px] font-semibold leading-snug" style={{ color: C.txt }}>{text}</p>
        <p className="mt-0.5 text-[9.5px] leading-snug" style={{ color: C.label }}>
          {t
            ? `Position bias ${bullish ? "bullish" : "bearish"} while the trade runs — SL/TP attached at fire time.`
            : levels.length > 0
              ? "Bias neutral until the C3 break confirms a side — both directions stay live."
              : "No bias — the engine needs a fresh equal-level zone first."}
        </p>
      </div>

      {/* key levels — real armed triggers */}
      <div>
        <div className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.16em]" style={{ color: C.label }}>Key levels (dotted triggers)</div>
        {levels.length === 0 ? (
          <p className="text-[10px]" style={{ color: C.label }}>None armed — scanning for the next C1/C2 zone.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {levels.map((l) => (
              <span
                key={l.id}
                className="rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-bold"
                style={{
                  borderColor: l.side === -1 ? A.red(0.4) : A.green(0.4),
                  color: l.side === -1 ? C.red : C.green,
                  background: l.side === -1 ? A.red(0.07) : A.green(0.07),
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
        <div className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.16em]" style={{ color: C.label }}>Sessions open</div>
        <p className="font-mono text-[10.5px] font-bold" style={{ color: C.txt2 }}>{sessions.length > 0 ? sessions.join(" · ") : "Interbank closed · crypto continues"}</p>
      </div>

      {/* next high-impact event — REAL ForexFactory feed, hidden when down */}
      {nextEvent !== "unavailable" && nextEvent && (
        <div>
          <div className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.16em]" style={{ color: C.label }}>Next high-impact release · ForexFactory</div>
          <p className="text-[10.5px] font-semibold leading-snug text-[#F5CD6B]">
            {nextEvent.currency} · {nextEvent.title}
          </p>
          <p className="text-[9.5px] font-mono" style={{ color: C.muted }}>
            {new Date(nextEvent.date).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
            {nextEvent.forecast ? ` · forecast ${nextEvent.forecast}` : ""}
          </p>
        </div>
      )}

      {/* account posture — real */}
      <div className="mt-auto flex items-center justify-between border-t pt-2" style={{ borderColor: `${C.lineInner}B3` }}>
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em]" style={{ color: C.label }}>Account status</span>
        <Pill tone={state.exec.executionMode === "live" ? "err" : "ok"}>
          {state.exec.executionMode === "live" ? "LIVE ROUTING" : "HEALTHY · PAPER"}
        </Pill>
      </div>

      <p
        className="rounded-lg border px-2.5 py-1.5 text-[9.5px] italic leading-snug text-[#F5CD6B]"
        style={{ borderColor: A.gold(0.3), background: A.gold(0.06) }}
      >
        &ldquo;Patience is a position. Let the setup come to you.&rdquo; — HALO
      </p>
    </PanelCard>
  );
}
