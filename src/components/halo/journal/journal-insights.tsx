"use client";

// ══════════════════════════════════════════════════════════════════════════
//  HALO PERFORMANCE INSIGHTS · journal-scoped analyst. Common questions are
//  answered deterministically from the records; anything else goes to the
//  grounded LLM (statistics only, no invented history, never advice).
// ══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { PanelCard, Pill } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";

const SUGGESTIONS = [
  "How did I perform this month?",
  "Which instrument has produced my highest net profit?",
  "What is my win rate?",
  "What is my average winning trade?",
  "Which days of the week have performed best historically?",
  "Am I following my existing trading strategy?",
  "What mistakes appear most frequently in my journal?",
  "How has my drawdown changed?",
  "How does my performance compare with the previous month?",
];

interface Turn {
  q: string;
  a: string;
  deterministic: boolean;
}

export function JournalInsights({ filterQS, hasData }: { filterQS: string; hasData: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setQ("");
    try {
      const qs = new URLSearchParams(filterQS);
      qs.set("q", text);
      const res = await fetch(`/api/journal/insights?${qs.toString()}`, { cache: "no-store" });
      const j = (await res.json()) as { ok: boolean; answer?: string; error?: string; deterministic?: boolean };
      setTurns((prev) => [{ q: text, a: j.answer ?? j.error ?? "No answer.", deterministic: Boolean(j.deterministic) }, ...prev].slice(0, 12));
    } catch (e) {
      setTurns((prev) => [{ q: text, a: (e as Error).message, deterministic: false }, ...prev]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelCard
      title="HALO PERFORMANCE INSIGHTS"
      icon={Sparkles}
      accent="gold"
      right={<Pill tone="gold">GROUNDED IN YOUR RECORDS</Pill>}
    >
      <div className="space-y-3 p-3">
        <p className="text-[9.5px] leading-relaxed" style={{ color: C.muted }}>
          Every answer is computed from your actual journal records. When data is missing, HALO says so — it never invents history or statistics. Insights are analytical and educational; they never change the strategy and never execute trades.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className="rounded-full border px-2.5 py-1 text-[9px] font-semibold transition-all hover:brightness-125 disabled:opacity-50"
              style={{ borderColor: A.gold(0.3), background: A.gold(0.06), color: C.goldHover }}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask(q);
            }}
            placeholder={hasData ? "Ask anything about your journal…" : "Load trades first — there is nothing to analyse yet"}
            disabled={busy || !hasData}
            aria-label="Ask the journal analyst"
            className="min-w-0 flex-1 rounded-md border px-2.5 py-2 text-[10.5px] font-semibold outline-none placeholder:text-[#51678A] disabled:opacity-50"
            style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
          />
          <button
            type="button"
            onClick={() => void ask(q)}
            disabled={busy || !q.trim() || !hasData}
            className="flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50"
            style={{ borderColor: A.cyan(0.5), background: `linear-gradient(135deg, ${A.blue(0.3)}, ${A.cyan(0.18)})`, color: "#FFFFFF" }}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            ASK
          </button>
        </div>

        <div className="space-y-2">
          {turns.map((t, i) => (
            <div key={i} className="rounded-lg border p-2.5" style={{ borderColor: C.lineInner, background: A.blue(0.04) }}>
              <div className="flex items-center gap-2 pb-1">
                <span className="text-[9.5px] font-extrabold" style={{ color: C.cyan }}>{t.q}</span>
                <Pill tone={t.deterministic ? "ok" : "info"}>{t.deterministic ? "COMPUTED" : "ANALYST"}</Pill>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: C.txt2 }}>{t.a}</p>
            </div>
          ))}
        </div>
      </div>
    </PanelCard>
  );
}
