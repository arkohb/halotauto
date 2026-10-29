"use client";

// ────────────────────────────────────────────────────────────────────────
//  HALO DESIGN SYSTEM · shared primitives (v2)
//
//  The canonical card chrome + states + pills for every view of the
//  command centre. Consume these instead of hand-rolling card chrome so
//  the whole app rebrands from one place:
//    • PanelCard   — glass card with accent-tinted header (unchanged API)
//    • PageHeader  — per-view title block with icon + subtitle + actions
//    • StateFrame  — honest loading / empty / error / offline states
//    • Pill        — unified status pill (ok/live/warn/err/info/gold/muted)
//    • StatCell · TelemetryRow · CheckRow — data display rows
//  Colors come exclusively from C / A / pillStyle (ui-helpers.ts).
// ────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Loader2, Unplug } from "lucide-react";
import { A, C, pillStyle, type PillTone } from "@/lib/halo/ui-helpers";

interface Props {
  title: string;
  icon: LucideIcon;
  accent?: "cyan" | "gold" | "green" | "red" | "teal" | "warn";
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  cyan: C.cyan,
  gold: C.gold,
  green: C.green,
  red: C.red,
  teal: C.teal,
  warn: C.warn,
};

export function PanelCard({ title, icon: Icon, accent = "cyan", right, children, className = "", bodyClassName = "" }: Props) {
  const a = ACCENT[accent];
  return (
    <section
      aria-label={title}
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border backdrop-blur transition-colors duration-300 ${className}`}
      style={{
        borderColor: C.panelLine,
        background: `linear-gradient(180deg, ${A.blue(0.05)}, transparent 26%), linear-gradient(180deg, ${C.panel}, ${C.deep})`,
        // layered glass: top light edge + deep drop shadow for 3D depth
        boxShadow:
          "inset 0 1px 0 rgba(120,200,255,0.08), inset 0 0 0 1px rgba(46,204,255,0.02), 0 14px 34px rgba(0,4,12,0.5), 0 2px 8px rgba(0,4,12,0.4)",
      }}
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: C.lineInner, background: `linear-gradient(90deg, ${a}14, transparent 62%)` }}
      >
        <Icon size={13} strokeWidth={2.2} style={{ color: a }} aria-hidden />
        <h2
          className="truncate text-[11px] font-extrabold tracking-[0.16em]"
          style={{ color: C.txt3, textShadow: `0 0 14px ${a}55` }}
        >
          {title}
        </h2>
        {/* luminous divider tail — the mockup's glowing rule under card titles */}
        <span
          aria-hidden
          className="ml-1 hidden h-px min-w-6 flex-1 sm:block"
          style={{ background: `linear-gradient(90deg, ${a}55, transparent 85%)` }}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Per-view page header: bold title + purpose line + trailing actions (mockup style). */
export function PageHeader({ icon: Icon, title, sub, right, className = "" }: { icon: LucideIcon; title: string; sub?: string; right?: ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
            style={{
              borderColor: A.cyan(0.35),
              background: `linear-gradient(135deg, ${A.blue(0.28)}, ${A.cyan(0.1)})`,
              boxShadow: `0 0 16px 0 ${A.cyan(0.16)}`,
            }}
          >
            <Icon size={15} style={{ color: C.cyan }} aria-hidden />
          </span>
          <h1 className="truncate text-[17px] font-extrabold tracking-[0.02em]" style={{ color: C.txt, textShadow: "0 0 18px rgba(46,204,255,0.18)" }}>
            {title}
          </h1>
        </div>
        {sub && <p className="mt-1 pl-[42px] text-[11px] leading-snug" style={{ color: C.muted }}>{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** Unified status pill — one recipe for every connection/live/warning chip. */
export function Pill({ tone = "muted", pulse, children, className = "" }: { tone?: PillTone; pulse?: boolean; children: ReactNode; className?: string }) {
  const s = pillStyle(tone);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.12em] ${className}`}
      style={{ background: s.bg, color: s.fg, boxShadow: `inset 0 0 0 1px ${s.line}` }}
    >
      {pulse && (
        <span
          className="halo-anim-beacon inline-block h-[5px] w-[5px] rounded-full"
          style={{ background: s.fg, ["--beacon" as string]: `${s.fg}80` }}
        />
      )}
      {children}
    </span>
  );
}

/** Honest shared states — loading / empty / error / offline, never invented data. */
export function StateFrame({
  state,
  title,
  hint,
  onRetry,
  compact = false,
  className = "",
}: {
  state: "loading" | "empty" | "error" | "offline";
  title?: string;
  hint?: string;
  onRetry?: () => void;
  /** compact = no icon column, single-line row (for table cells / tight cards) */
  compact?: boolean;
  className?: string;
}) {
  const meta = {
    loading: { icon: Loader2, fg: C.cyan, title: title ?? "Loading live data", hint: hint ?? "Fetching from the real source — nothing is invented." },
    empty: { icon: Inbox, fg: C.label, title: title ?? "Nothing here yet", hint: hint ?? "This fills in as real activity arrives." },
    error: { icon: AlertTriangle, fg: C.red, title: title ?? "Could not reach the data source", hint: hint ?? "The display never invents values — retry to refresh." },
    offline: { icon: Unplug, fg: C.warn, title: title ?? "Disconnected", hint: hint ?? "Waiting for the connection to return." },
  }[state];
  const Icon = meta.icon;

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 ${className}`}
        style={{ borderColor: `${meta.fg}44`, background: `${meta.fg}08` }}
        role="status"
      >
        <Icon size={12} style={{ color: meta.fg }} className={state === "loading" ? "animate-spin" : ""} aria-hidden />
        <span className="text-[10px] font-bold" style={{ color: meta.fg }}>{meta.title}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto rounded-md border px-2 py-0.5 text-[8.5px] font-extrabold tracking-[0.12em] transition-colors hover:brightness-125"
            style={{ borderColor: A.cyan(0.4), background: A.cyan(0.08), color: C.cyan }}
          >
            RETRY
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-7 text-center ${className}`}
      style={{ borderColor: `${meta.fg}33`, background: `${meta.fg}05` }}
      role="status"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full border"
        style={{ borderColor: `${meta.fg}44`, background: `${meta.fg}0d`, boxShadow: `0 0 16px 0 ${meta.fg}14` }}
      >
        <Icon size={15} style={{ color: meta.fg }} className={state === "loading" ? "animate-spin" : ""} aria-hidden />
      </span>
      <div className="text-[11px] font-extrabold tracking-[0.06em]" style={{ color: meta.fg }}>{meta.title}</div>
      <div className="max-w-[320px] text-[9.5px] leading-relaxed" style={{ color: C.label }}>{meta.hint}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-lg border px-3 py-1.5 text-[9px] font-extrabold tracking-[0.14em] transition-all hover:brightness-125"
          style={{ borderColor: A.cyan(0.45), background: A.cyan(0.08), color: C.cyan }}
        >
          RETRY NOW
        </button>
      )}
    </div>
  );
}

/** Small stat cell used across the dashboard cards. */
export function StatCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div
      className="min-w-0 rounded-lg border px-2.5 py-2"
      style={{
        borderColor: C.lineInner,
        background: `linear-gradient(180deg, ${A.blue(0.05)}, ${C.deep})`,
      }}
    >
      <div className="truncate text-[8.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.label }}>{label}</div>
      <div className="truncate font-mono text-[13px] font-bold leading-tight" style={{ color: color ?? C.txt }}>
        {value}
      </div>
      {sub && <div className="truncate font-mono text-[8.5px]" style={{ color: C.label }}>{sub}</div>}
    </div>
  );
}

/** Label:value telemetry row (AI core / risk cards). */
export function TelemetryRow({ icon, label, value, color }: { icon?: ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 border-b py-[5px] last:border-0" style={{ borderColor: `${A.white(0.05)}` }}>
      <span className="flex w-4 shrink-0 justify-center" style={{ color: A.cyan(0.8) }}>{icon}</span>
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.label }}>{label}</span>
      <span className="ml-auto truncate text-right font-mono text-[10.5px] font-bold" style={{ color: color ?? C.txt }}>
        {value}
      </span>
    </div>
  );
}

/** Risk check line with PASS / FAIL / INFO pill. */
export function CheckRow({ label, verdict, detail }: { label: string; verdict: "pass" | "fail" | "info"; detail: string }) {
  const tone: PillTone = verdict === "pass" ? "ok" : verdict === "fail" ? "err" : "gold";
  return (
    <div className="flex items-center gap-2 border-b py-[5px] last:border-0" style={{ borderColor: A.white(0.05) }}>
      <Pill tone={tone}>{verdict === "pass" ? "PASS" : verdict === "fail" ? "FAIL" : "INFO"}</Pill>
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.12em]" style={{ color: C.label }}>{label}</span>
      <span className="ml-auto truncate text-right text-[10px] font-medium" style={{ color: verdict === "fail" ? C.red : C.txt2 }}>
        {detail}
      </span>
    </div>
  );
}
