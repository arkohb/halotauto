"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL VIZ · chart primitives for the Performance-Journal command
//  centre. Receives PRE-COMPUTED, verified data — no calculation happens
//  at render time. Isolated from the shared HALO chart wrappers.
// ══════════════════════════════════════════════════════════════════════════

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { A, C } from "@/lib/halo/ui-helpers";

const AXIS = { fill: C.label, fontSize: 8.5, fontFamily: "inherit" } as const;
const GRID = A.white(0.06);

function TipBox(
  active: boolean | undefined,
  payload: { name?: string; value?: number | string }[] | undefined,
  label?: string | number,
  fmt?: (v: number) => string
) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-[10px] shadow-xl"
      style={{ borderColor: A.gold(0.35), background: "rgba(2,11,26,0.96)", color: C.txt, boxShadow: `0 0 18px 0 ${A.blue(0.25)}` }}
    >
      {label !== undefined && (
        <div className="pb-0.5 text-[8.5px] font-bold tracking-wide" style={{ color: C.label }}>
          {label}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="font-mono font-extrabold" style={{ color: C.goldHover }}>
          {p.name ? `${p.name}: ` : ""}
          {fmt && typeof p.value === "number" ? fmt(p.value) : String(p.value ?? "—")}
        </div>
      ))}
    </div>
  );
}

/** glowing trend area (equity / balance / cumulative P&L) with hover points */
export function TrendArea({
  points,
  height = 240,
  name,
  stroke,
}: {
  points: { day: string; value: number }[];
  height?: number;
  name: string;
  stroke?: string;
}) {
  if (points.length === 0) return null;
  // falling line renders red; a caller-supplied stroke always wins
  const lastValue = points[points.length - 1]?.value ?? 0;
  const line = stroke ?? (lastValue >= 0 ? C.cyan : C.red);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="halo-journal-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={line} stopOpacity={0.36} />
            <stop offset="100%" stopColor={line} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={46} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        />
        <Tooltip
          content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, d.label, (v) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
          cursor={{ stroke: A.gold(0.35), strokeDasharray: "4 3" }}
        />
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={line}
          strokeWidth={2}
          fill="url(#halo-journal-glow)"
          dot={{ r: 1.8, fill: line, strokeWidth: 0 }}
          activeDot={{ r: 4.5, fill: C.goldHover, stroke: A.gold(0.5), strokeWidth: 3 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** win/loss donut with the win-rate percentage in the centre */
export function CenterDonut({
  wins,
  losses,
  breakeven,
  centerLabel,
  height = 180,
}: {
  wins: number;
  losses: number;
  breakeven: number;
  centerLabel: string;
  height?: number;
}) {
  const data = [
    { name: "Wins", value: wins, color: C.green },
    { name: "Losses", value: losses, color: C.red },
    { name: "Breakeven", value: breakeven, color: C.gray },
  ].filter((d) => d.value > 0);
  if (data.length === 0) return null;
  return (
    <div className="relative mx-auto" style={{ width: height, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="66%"
            outerRadius="92%"
            paddingAngle={2}
            stroke="none"
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} fillOpacity={0.9} />
            ))}
          </Pie>
          <Tooltip
            content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, undefined, (v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 }))}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[19px] font-extrabold leading-none" style={{ color: C.txt }}>
          {centerLabel}
        </span>
        <span className="pt-0.5 text-[8px] font-bold tracking-[0.2em]" style={{ color: C.label }}>
          WIN RATE
        </span>
      </div>
    </div>
  );
}
