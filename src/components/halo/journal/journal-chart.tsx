"use client";

// HALO Performance Journal · recharts wrappers on the shared palette.
// All charts are ResponsiveContainer-based (desktop → mobile) and receive
// pre-computed, verified data — no calculation happens at render time.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

function TipBox(active: boolean | undefined, payload: { name?: string; value?: number | string }[] | undefined, label?: string | number, fmt?: (v: number) => string) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-[9.5px] shadow-xl"
      style={{ borderColor: C.panelLine, background: "rgba(2,11,26,0.95)", color: C.txt }}
    >
      {label !== undefined && <div className="pb-0.5 font-bold" style={{ color: C.label }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="font-mono font-bold">
          {p.name}: {fmt && typeof p.value === "number" ? fmt(p.value) : String(p.value ?? "—")}
        </div>
      ))}
    </div>
  );
}

/** equity / cumulative curve — mode is labeled by the caller */
export function EquityCurve({ points, height = 190 }: { points: { day: string; value: number }[]; height?: number }) {
  if (points.length === 0) return null;
  const positive = (points[points.length - 1]?.value ?? 0) >= 0;
  const stroke = positive ? C.green : C.red;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="halo-journal-eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.34} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={42} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
        <Tooltip content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, d.label, (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 }))} />
        <Area type="monotone" dataKey="value" name="Equity / cumulative net" stroke={stroke} strokeWidth={1.8} fill="url(#halo-journal-eq)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** daily / weekly / monthly net P&L bars — green positive, red negative */
export function PnlBars({ data, height = 190 }: { data: { day: string; net: number }[]; height?: number }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={30} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
        <Tooltip content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, d.label, (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 }))} cursor={{ fill: A.white(0.04) }} />
        <Bar dataKey="net" name="Net P&L" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.net > 0 ? A.green(0.8) : d.net < 0 ? A.red(0.8) : A.white(0.25)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** cumulative net P&L line (per closed trade) */
export function CumulativeLine({ points, height = 190 }: { points: { t: string; net: number }[]; height?: number }) {
  if (points.length === 0) return null;
  const data = points.map((p) => ({ t: new Date(p.t).toISOString().slice(5, 16).replace("T", " "), net: p.net }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={56} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
        <Tooltip content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, d.label, (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 }))} />
        <Line type="monotone" dataKey="net" name="Cumulative net" stroke={C.cyan} strokeWidth={1.8} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** win / loss / breakeven donut */
export function OutcomeDonut({ wins, losses, breakeven, height = 170 }: { wins: number; losses: number; breakeven: number; height?: number }) {
  const data = [
    { name: "Wins", value: wins, color: C.green },
    { name: "Losses", value: losses, color: C.red },
    { name: "Breakeven", value: breakeven, color: C.gray },
  ].filter((d) => d.value > 0);
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={3} stroke="none" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} fillOpacity={0.85} />
          ))}
        </Pie>
        <Tooltip content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, undefined)} />
        <Legend wrapperStyle={{ fontSize: 9, color: C.txt2 }} iconSize={7} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** discipline tag frequency (weekly positive vs negative) */
export function DisciplineBars({ data, height = 180 }: { data: { week: string; positive: number; negative: number }[]; height?: number }) {
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={18} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
        <Tooltip content={(d) => TipBox(d.active, d.payload as { name?: string; value?: number | string }[] | undefined, d.label)} cursor={{ fill: A.white(0.04) }} />
        <Legend wrapperStyle={{ fontSize: 9, color: C.txt2 }} iconSize={7} />
        <Bar dataKey="positive" name="Positive tags" stackId="t" fill={A.green(0.75)} isAnimationActive={false} radius={[0, 0, 0, 0]} />
        <Bar dataKey="negative" name="Negative tags" stackId="t" fill={A.red(0.75)} isAnimationActive={false} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
