"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO NAV RAIL · left command navigation
//
//  Desktop (lg+): fixed icon+label rail — every item maps to a REAL view
//  fed by the existing panels (no dead links, no fake pages).
//  Mobile (<lg): horizontally scrollable chip bar rendered below the header.
//
//  Presentation only — fires onView(); owns no trading state.
// ════════════════════════════════════════════════════════════════════════

import {
  Activity,
  Bell,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  Radar,
  Settings,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";

export type HaloView =
  | "terminal"
  | "scanner"
  | "activity"
  | "risk"
  | "backtest"
  | "performance"
  | "brokers"
  | "alerts"
  | "settings";

interface NavItem {
  id: HaloView;
  label: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "TRADING",
    items: [
      { id: "terminal", label: "Dashboard", icon: LayoutDashboard },
      { id: "scanner", label: "Market", icon: Radar },
      { id: "activity", label: "Trading Activity", icon: Activity },
      { id: "risk", label: "Risk Guardian", icon: ShieldCheck },
    ],
  },
  {
    title: "INTELLIGENCE",
    items: [
      { id: "backtest", label: "Strategy Lab", icon: FlaskConical },
      { id: "performance", label: "Performance", icon: TrendingUp },
    ],
  },
  {
    title: "SYSTEM",
    items: [
      { id: "brokers", label: "Brokers", icon: Landmark },
      { id: "alerts", label: "Alerts", icon: Bell },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const ALL: NavItem[] = GROUPS.flatMap((g) => g.items);

/* ───────────────────────── desktop rail ───────────────────────── */
export function NavRail({ view, onView }: { view: HaloView; onView: (v: HaloView) => void }) {
  return (
    <nav
      aria-label="HALO command navigation"
      className="sticky top-[83px] hidden h-[calc(100vh-83px)] w-[178px] shrink-0 flex-col overflow-y-auto border-r border-[#1C2A47] bg-[#0B1426]/80 backdrop-blur halo-scroll lg:flex xl:w-[196px]"
    >
      <div className="flex-1 space-y-4 px-2.5 py-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="px-2 pb-1.5 text-[8.5px] font-extrabold tracking-[0.26em] text-[#5D6B85]">{g.title}</div>
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
                      className="group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
                      style={{
                        background: active ? "rgba(212,175,55,0.10)" : "transparent",
                        boxShadow: active ? `inset 2.5px 0 0 ${C.gold}` : undefined,
                      }}
                    >
                      <Icon
                        size={15}
                        strokeWidth={2}
                        style={{ color: active ? C.gold : "#8C98AE" }}
                        className="shrink-0 transition-colors group-hover:text-[#D4AF37]"
                      />
                      <span
                        className="truncate text-[11.5px] font-semibold tracking-wide transition-colors"
                        style={{ color: active ? C.gold : "#B8C2D6" }}
                      >
                        {it.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* creed */}
      <div className="border-t border-[#1C2A47]/70 px-4 py-3">
        <p className="text-[9.5px] italic leading-relaxed text-[#5D6B85]">
          &ldquo;Discipline builds wealth. Automation protects it.&rdquo;
        </p>
        <p className="mt-1 text-[8px] font-bold tracking-[0.22em] text-[#8A7423]">— HALO</p>
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
              className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10.5px] font-bold tracking-wide transition-colors"
              style={{
                borderColor: active ? `${C.gold}88` : "#1C2A47",
                background: active ? "rgba(212,175,55,0.12)" : "#101C33",
                color: active ? C.gold : "#8C98AE",
              }}
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
