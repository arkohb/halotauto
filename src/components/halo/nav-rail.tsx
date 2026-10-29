"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO NAV RAIL · left command navigation (mockup edition)
//
//  Desktop (lg+): fixed icon+label rail — every item maps to a REAL view
//  fed by the existing panels (no dead links, no fake pages).
//    MAIN list mirrors the reference design order:
//    Dashboard · Market Intelligence · Trading Activity · Risk Guardian ·
//    Strategy Lab · Trade History · Performance · Daily Briefing ·
//    Learning Missions · Settings
//    SYSTEM group keeps every remaining real surface reachable:
//    Market Scanner · Voice Command · Brokers · Alerts
//  Mobile (<lg): horizontally scrollable chip bar rendered below the header.
//
//  Presentation only — fires onView(); owns no trading state.
// ════════════════════════════════════════════════════════════════════════

import {
  Activity,
  Bell,
  BookOpen,
  FlaskConical,
  Globe,
  Landmark,
  LayoutDashboard,
  Mic,
  Radar,
  ScrollText,
  Settings,
  ShieldCheck,
  SunMedium,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";

export type HaloView =
  | "terminal"
  | "scanner"
  | "activity"
  | "risk"
  | "backtest"
  | "performance"
  | "brokers"
  | "alerts"
  | "intel"
  | "settings"
  | "trade-history"
  | "briefing"
  | "learning"
  | "voice";

interface NavItem {
  id: HaloView;
  label: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "COMMAND",
    items: [
      { id: "terminal", label: "Dashboard", icon: LayoutDashboard },
      { id: "intel", label: "Market Intelligence", icon: Globe },
      { id: "activity", label: "Trading Activity", icon: Activity },
      { id: "risk", label: "Risk Guardian", icon: ShieldCheck },
      { id: "backtest", label: "Strategy Lab", icon: FlaskConical },
      { id: "trade-history", label: "Trade History", icon: ScrollText },
      { id: "performance", label: "Performance", icon: TrendingUp },
      { id: "briefing", label: "Daily Briefing", icon: SunMedium },
      { id: "learning", label: "Learning Missions", icon: BookOpen },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      { id: "scanner", label: "Market Scanner", icon: Radar },
      { id: "voice", label: "Voice Command", icon: Mic },
      { id: "brokers", label: "Brokers & MT5", icon: Landmark },
      { id: "alerts", label: "Alerts", icon: Bell },
    ],
  },
];

const ALL: NavItem[] = GROUPS.flatMap((g) => g.items);

/* ───────────────────────── desktop rail ───────────────────────── */
export function NavRail({ view, onView }: { view: HaloView; onView: (v: HaloView) => void }) {
  return (
    <nav
      aria-label="HALO command navigation"
      className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-[186px] shrink-0 flex-col overflow-y-auto border-r bg-[#02070F]/85 backdrop-blur halo-scroll lg:flex xl:w-[200px]"
      style={{ borderColor: C.line }}
    >
      <div className="flex-1 space-y-4 px-2.5 py-3.5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="px-2 pb-1.5 text-[8px] font-extrabold tracking-[0.26em]" style={{ color: C.label }}>{g.title}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = view === it.id;
                const Icon = it.icon;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => onView(it.id)}
                      aria-current={active ? "page" : undefined}
                      className="group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left transition-all duration-200"
                      style={
                        active
                          ? {
                              background: `linear-gradient(135deg, ${A.blue(0.85)}, ${A.cyan(0.72)})`,
                              boxShadow: `0 0 16px 0 ${A.blue(0.35)}, inset 0 1px 0 rgba(255,255,255,0.22)`,
                            }
                          : undefined
                      }
                    >
                      <Icon
                        size={15}
                        strokeWidth={2}
                        style={{ color: active ? "#FFFFFF" : C.muted }}
                        className={`shrink-0 transition-colors ${active ? "" : "group-hover:text-[#2ECCFF]"}`}
                      />
                      <span
                        className="truncate text-[11.5px] font-semibold tracking-wide transition-colors"
                        style={{ color: active ? "#FFFFFF" : C.txt2, textShadow: active ? "0 1px 6px rgba(0,20,50,0.4)" : undefined }}
                      >
                        {it.label}
                      </span>
                      {/* hover glow for inactive rows */}
                      {!active && (
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                          style={{ background: `linear-gradient(90deg, ${A.cyan(0.09)}, transparent 70%)`, boxShadow: `inset 0 0 0 1px ${A.cyan(0.14)}` }}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* creed */}
      <div className="border-t px-4 py-3" style={{ borderColor: `${C.line}80` }}>
        <p className="text-[9.5px] italic leading-relaxed" style={{ color: C.dim }}>
          &ldquo;Discipline builds wealth. Automation protects it.&rdquo;
        </p>
        <p className="mt-1 text-[8px] font-bold tracking-[0.22em]" style={{ color: C.goldDim }}>— HALO</p>
      </div>
    </nav>
  );
}

/* ───────────────────────── mobile chip bar ───────────────────────── */
export function NavChips({ view, onView }: { view: HaloView; onView: (v: HaloView) => void }) {
  return (
    <nav aria-label="HALO navigation" className="lg:hidden">
      <div className="halo-scroll flex gap-1.5 overflow-x-auto px-3 py-2">
        {ALL.map((it) => {
          const active = view === it.id;
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onView(it.id)}
              aria-current={active ? "page" : undefined}
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] font-bold tracking-wide transition-all"
              style={
                active
                  ? {
                      borderColor: "transparent",
                      background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`,
                      color: "#FFFFFF",
                      boxShadow: `0 0 14px 0 ${A.blue(0.4)}`,
                    }
                  : { borderColor: C.line, background: C.navy2, color: C.muted }
              }
            >
              <Icon size={12} />
              {it.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
