"use client";

// Shared panel chrome for the HALO command-center dashboard cards.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";

interface Props {
  title: string;
  icon: LucideIcon;
  accent?: "cyan" | "gold" | "green" | "red";
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  cyan: "#4FD8FF",
  gold: "#D4AF37",
  green: "#089981",
  red: "#F23645",
};

export function PanelCard({ title, icon: Icon, accent = "cyan", right, children, className = "", bodyClassName = "" }: Props) {
  const a = ACCENT[accent];
  return (
    <section
      aria-label={title}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-[#0D1730]/90 backdrop-blur ${className}`}
      style={{
        borderColor: "#1E3358",
        // layered glass: top light edge + deep drop shadow for 3D depth
        boxShadow:
          "inset 0 1px 0 rgba(79,216,255,0.07), inset 0 0 0 1px rgba(79,216,255,0.02), 0 12px 32px rgba(3,8,18,0.45), 0 2px 8px rgba(3,8,18,0.35)",
      }}
    >
      <header
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
        style={{ borderColor: "#16263F", background: `linear-gradient(90deg, ${a}0F, transparent 65%)` }}
      >
        <Icon size={13} strokeWidth={2.2} style={{ color: a }} aria-hidden />
        <h2 className="truncate text-[10.5px] font-extrabold tracking-[0.2em]" style={{ color: "#DDE6F5" }}>
          {title}
        </h2>
        <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Small stat cell used across the dashboard cards. */
export function StatCell({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#16263F] bg-[#0B1426]/70 px-2.5 py-2">
      <div className="truncate text-[8.5px] font-bold uppercase tracking-[0.14em] text-[#6B7A94]">{label}</div>
      <div className="truncate font-mono text-[13px] font-bold leading-tight" style={{ color: color ?? C.txt }}>
        {value}
      </div>
      {sub && <div className="truncate text-[8.5px] font-mono text-[#6B7A94]">{sub}</div>}
    </div>
  );
}

/** Label:value telemetry row (AI core / risk cards). */
export function TelemetryRow({ icon, label, value, color }: { icon?: ReactNode; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[#16263F]/60 py-[5px] last:border-0">
      <span className="flex w-4 shrink-0 justify-center text-[#4FD8FF]/80">{icon}</span>
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#6B7A94]">{label}</span>
      <span className="ml-auto truncate text-right font-mono text-[10.5px] font-bold" style={{ color: color ?? C.txt }}>
        {value}
      </span>
    </div>
  );
}

/** Risk check line with PASS / FAIL / INFO pill. */
export function CheckRow({ label, verdict, detail }: { label: string; verdict: "pass" | "fail" | "info"; detail: string }) {
  const color = verdict === "pass" ? "#089981" : verdict === "fail" ? "#F23645" : "#D4AF37";
  const bg = verdict === "pass" ? "rgba(8,153,129,0.12)" : verdict === "fail" ? "rgba(242,54,69,0.12)" : "rgba(212,175,55,0.10)";
  return (
    <div className="flex items-center gap-2 border-b border-[#16263F]/60 py-[5px] last:border-0">
      <span
        className="shrink-0 rounded px-1.5 py-px text-[8px] font-extrabold tracking-[0.12em]"
        style={{ background: bg, color }}
      >
        {verdict === "pass" ? "PASS" : verdict === "fail" ? "FAIL" : "INFO"}
      </span>
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#6B7A94]">{label}</span>
      <span className="ml-auto truncate text-right text-[10px] font-medium" style={{ color: verdict === "fail" ? "#F23645" : "#B8C2D6" }}>
        {detail}
      </span>
    </div>
  );
}
