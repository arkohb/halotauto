"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · command view for the EDGE layers
//    Signal Quality · Smart Trade Manager · Capital Guardian ·
//    Entry filters · Prop-firm rules · Spread guard ·
//    Adaptive Autopilot · EDGE vs baseline
//  Talks only to /api/edge/*; owns no trading state. Settings are saved as
//  a patch so each card edits just its own block.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, Gauge, Landmark, Loader2, Play, Rocket, Ruler, Scale, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { PanelCard, Pill, StatCell, StateFrame } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { EdgeSettings, PropPreset, SessionKey } from "@/lib/edge/settings";
import type { PropState } from "@/lib/edge/prop";
import type { GuardianVerdict, MonteCarloResult } from "@/lib/edge/guardian";
import type { SimSummary } from "@/lib/edge/simulate";
import type { AutopilotJob, AutopilotParams } from "@/lib/edge/autopilot";

type Notify = (title: string, desc?: string, bad?: boolean) => void;
type Patch = Partial<{ [K in keyof EdgeSettings]: Partial<EdgeSettings[K]> }>;

const GRADE_COLOR: Record<string, string> = { "A+": C.green, A: C.teal, B: C.cyan, C: C.warn, D: C.red };
const fR = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}R`);
const fN = (v: number | null | undefined, d = 1, suf = ""): string => (v === null || v === undefined || !isFinite(v) ? "—" : `${v.toFixed(d)}${suf}`);

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json()) as T & { ok: boolean; error?: string };
  if (!j.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

/* ───────────────────────── small inputs ───────────────────────── */
function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-[11.5px] font-semibold" style={{ color: C.txt2 }}>{label}</span>
        {hint && <span className="block text-[10px]" style={{ color: C.label }}>{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className="relative h-5 w-9 shrink-0 rounded-full border transition-colors"
        style={{ borderColor: on ? A.cyan(0.6) : C.line2, background: on ? A.blue(0.7) : C.navy2 }}
      >
        <span className="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} />
      </button>
    </label>
  );
}

function Num({ label, value, onChange, step = 0.1, min = 0, max = 1000, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px]" style={{ color: C.txt2 }}>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-md border px-2 py-1 text-right text-[11.5px] tabular-nums outline-none"
          style={{ borderColor: C.line2, background: C.deep, color: C.txt }}
        />
        {suffix && <span className="w-6 text-[10px]" style={{ color: C.label }}>{suffix}</span>}
      </span>
    </label>
  );
}

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-[11px]" style={{ color: C.txt2 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border px-2 py-1 text-[11.5px] outline-none"
        style={{ borderColor: C.line2, background: C.deep, color: C.txt }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function Btn({ children, onClick, busy, tone = "blue" }: { children: ReactNode; onClick: () => void; busy?: boolean; tone?: "blue" | "ghost" }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold tracking-wide transition-opacity disabled:opacity-60"
      style={
        tone === "blue"
          ? { borderColor: "transparent", background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`, color: "#fff" }
          : { borderColor: C.line2, background: C.navy2, color: C.txt2 }
      }
    >
      {busy && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  );
}

function GradeBadge({ letter, score }: { letter: string; score?: number | null }) {
  const col = GRADE_COLOR[letter] ?? C.muted;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-extrabold tabular-nums" style={{ color: col, borderColor: `${col}66`, background: `${col}14` }}>
      {letter}
      {score !== undefined && score !== null && <span className="font-semibold opacity-80">{score}</span>}
    </span>
  );
}

/* ───────────────────────── view ───────────────────────── */
export function EdgePanel({ symbol, tf, notify }: { symbol: string; tf: string; notify: Notify }) {
  const [settings, setSettings] = useState<EdgeSettings | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<{ settings: EdgeSettings }>("/api/edge/settings")
      .then((j) => setSettings(j.settings))
      .catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const save = useCallback(
    async (patch: Patch, msg: string) => {
      setSaving(true);
      try {
        const j = await api<{ settings: EdgeSettings }>("/api/edge/settings", patch);
        setSettings(j.settings);
        notify("EDGE", msg);
      } catch (e) {
        notify("EDGE · save failed", (e as Error).message, true);
      } finally {
        setSaving(false);
      }
    },
    [notify]
  );

  if (err)
    return (
      <StateFrame
        state="error"
        title="EDGE settings unavailable"
        hint={err}
        onRetry={() => {
          setErr("");
          load();
        }}
      />
    );
  if (!settings) return <StateFrame state="loading" title="Loading EDGE…" />;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <QualityCard s={settings} save={save} saving={saving} />
      <ManagerCard s={settings} save={save} saving={saving} />
      <GuardianCard s={settings} save={save} saving={saving} />
      <FiltersCard s={settings} save={save} saving={saving} />
      <PropCard key={JSON.stringify(settings.prop)} s={settings} save={save} saving={saving} notify={notify} />
      <SpreadCard s={settings} save={save} saving={saving} />
      <AutopilotCard s={settings} save={save} symbol={symbol} tf={tf} notify={notify} />
      <div className="xl:col-span-2">
        <CompareCard symbol={symbol} tf={tf} notify={notify} />
      </div>
    </div>
  );
}

type CardProps = { s: EdgeSettings; save: (p: Patch, msg: string) => Promise<void>; saving: boolean };

/* ───────────────────────── 1 · Signal Quality ───────────────────────── */
interface GradesRes {
  recent: Array<{ id: string; symbol: string; tf: string; dir: number; grade: number | null; letter: string; sizeMult: number; status: string; r: number | null; openedAt: number }>;
  table: Array<{ letter: string; trades: number; winRate: number | null; avgR: number | null; netR: number }>;
}

function QualityCard({ s, save, saving }: CardProps) {
  const [q, setQ] = useState(s.quality);
  const [g, setG] = useState<GradesRes | null>(null);
  useEffect(() => {
    api<GradesRes>("/api/edge/grades").then(setG).catch(() => setG(null));
  }, []);
  return (
    <PanelCard title="SIGNAL QUALITY SCORE" icon={Sparkles} accent="gold" right={<Pill tone={q.enabled ? "ok" : "muted"}>{q.enabled ? "GATE ON" : "GRADE ONLY"}</Pill>} bodyClassName="p-3 space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        Every 3EL fire is scored 0–100 (A+ to D) from trend, room to target, level freshness, break quality, volatility and session. Skip weak setups, size up strong ones.
      </p>
      <div className="divide-y" style={{ borderColor: C.divider }}>
        <Toggle label="Use the grade on orders" hint="off = grade is recorded and spoken only" on={q.enabled} onChange={(v) => setQ({ ...q, enabled: v })} />
        <Num label="Minimum score to trade" value={q.minScore} step={5} max={100} onChange={(v) => setQ({ ...q, minScore: v })} />
        <Toggle label="Size by grade" on={q.gradeSizing} onChange={(v) => setQ({ ...q, gradeSizing: v })} />
        {q.gradeSizing && (
          <div className="grid grid-cols-5 gap-1.5 py-2">
            {(["A+", "A", "B", "C", "D"] as const).map((l) => (
              <label key={l} className="flex flex-col items-center gap-1">
                <GradeBadge letter={l} />
                <input
                  type="number"
                  step={0.25}
                  min={0}
                  max={5}
                  value={q.sizeByGrade[l]}
                  onChange={(e) => setQ({ ...q, sizeByGrade: { ...q.sizeByGrade, [l]: Number(e.target.value) } })}
                  className="w-full rounded-md border px-1 py-1 text-center text-[11px] tabular-nums outline-none"
                  style={{ borderColor: C.line2, background: C.deep, color: C.txt }}
                />
              </label>
            ))}
          </div>
        )}
        <Toggle label="Read the grade out when a trade opens" on={q.announce} onChange={(v) => setQ({ ...q, announce: v })} />
      </div>
      <Btn busy={saving} onClick={() => void save({ quality: q }, "Signal Quality settings saved")}>Save</Btn>

      <div>
        <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.2em]" style={{ color: C.label }}>YOUR BOOK · RESULT BY GRADE</div>
        {!g || g.table.every((r) => r.trades === 0) ? (
          <p className="text-[10.5px]" style={{ color: C.dim }}>No graded trades yet — grades appear here as the bot trades.</p>
        ) : (
          <GradeTableView rows={g.table} />
        )}
      </div>
      {g && g.recent.length > 0 && (
        <div className="max-h-40 overflow-y-auto halo-scroll">
          <table className="w-full text-[10.5px] tabular-nums">
            <tbody>
              {g.recent.map((t) => (
                <tr key={t.id} className="border-t" style={{ borderColor: C.divider }}>
                  <td className="py-1" style={{ color: C.txt2 }}>{t.symbol} {t.tf}</td>
                  <td style={{ color: t.dir === 1 ? C.green : C.red }}>{t.dir === 1 ? "BUY" : "SELL"}</td>
                  <td><GradeBadge letter={t.letter} score={t.grade} /></td>
                  <td style={{ color: C.muted }}>×{t.sizeMult.toFixed(2)}</td>
                  <td className="text-right" style={{ color: (t.r ?? 0) >= 0 ? C.green : C.red }}>{t.status === "OPEN" ? "open" : fR(t.r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

function GradeTableView({ rows }: { rows: Array<{ letter: string; trades: number; winRate: number | null; avgR: number | null; netR: number }> }) {
  return (
    <table className="w-full text-[11px] tabular-nums">
      <thead>
        <tr style={{ color: C.label }} className="text-[9.5px] tracking-wider">
          <th className="py-1 text-left font-bold">GRADE</th>
          <th className="text-right font-bold">TRADES</th>
          <th className="text-right font-bold">WIN %</th>
          <th className="text-right font-bold">AVG R</th>
          <th className="text-right font-bold">NET R</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.letter} className="border-t" style={{ borderColor: C.divider }}>
            <td className="py-1"><GradeBadge letter={r.letter} /></td>
            <td className="text-right" style={{ color: C.txt2 }}>{r.trades}</td>
            <td className="text-right" style={{ color: C.txt2 }}>{fN(r.winRate, 0, "%")}</td>
            <td className="text-right" style={{ color: (r.avgR ?? 0) >= 0 ? C.green : C.red }}>{fR(r.avgR)}</td>
            <td className="text-right" style={{ color: r.netR >= 0 ? C.green : C.red }}>{r.trades ? fR(r.netR, 1) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ───────────────────────── 2 · Smart Trade Manager ───────────────────────── */
function ManagerCard({ s, save, saving }: CardProps) {
  const [m, setM] = useState(s.manager);
  return (
    <PanelCard title="SMART TRADE MANAGER" icon={Gauge} accent="teal" right={<Pill tone={m.enabled ? "ok" : "muted"}>{m.enabled ? "ACTIVE" : "OFF"}</Pill>} bodyClassName="p-3 space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        Moves the stop to break-even, banks part of the trade early and trails the stop behind price. Stop changes are sent to MT5 and OANDA; partial closes to MT5 only. On other brokers the bot closes the trade itself at the managed level.
      </p>
      <div className="divide-y" style={{ borderColor: C.divider }}>
        <Toggle label="Manage open trades" on={m.enabled} onChange={(v) => setM({ ...m, enabled: v })} />
        <Num label="Break-even after" value={m.beAtR} suffix="R" onChange={(v) => setM({ ...m, beAtR: v })} />
        <Num label="Break-even lock-in" value={m.beOffsetR} step={0.05} suffix="R" onChange={(v) => setM({ ...m, beOffsetR: v })} />
        <Num label="Partial close at" value={m.partialAtR} suffix="R" onChange={(v) => setM({ ...m, partialAtR: v })} />
        <Num label="Partial close size" value={m.partialPct} step={5} min={1} max={90} suffix="%" onChange={(v) => setM({ ...m, partialPct: v })} />
        <Num label="Trail from" value={m.trailStartR} suffix="R" onChange={(v) => setM({ ...m, trailStartR: v })} />
        <Num label="Trail distance" value={m.trailATR} suffix="ATR" onChange={(v) => setM({ ...m, trailATR: v })} />
      </div>
      <p className="text-[10px]" style={{ color: C.dim }}>Set any trigger to 0 to switch that step off. Steps run on closed bars only.</p>
      <Btn busy={saving} onClick={() => void save({ manager: m }, "Trade Manager settings saved")}>Save</Btn>
    </PanelCard>
  );
}

/* ───────────────────────── 3 · Capital Guardian ───────────────────────── */
interface GuardianRes {
  verdict: GuardianVerdict;
  monteCarlo: MonteCarloResult | null;
  sample: number;
}

function GuardianCard({ s, save, saving }: CardProps) {
  const [g, setG] = useState(s.guardian);
  const [st, setSt] = useState<GuardianRes | null>(null);
  const refresh = useCallback(() => {
    api<GuardianRes>("/api/edge/guardian").then(setSt).catch(() => setSt(null));
  }, []);
  useEffect(refresh, [refresh, s.guardian]);
  const v = st?.verdict;
  const mc = st?.monteCarlo;
  return (
    <PanelCard
      title="CAPITAL GUARDIAN"
      icon={ShieldCheck}
      accent="green"
      right={v ? <Pill tone={!g.enabled ? "muted" : v.allow ? "ok" : "err"} pulse={g.enabled && !v.allow}>{!g.enabled ? "OFF" : v.allow ? "ORDERS ALLOWED" : "ORDERS BLOCKED"}</Pill> : null}
      bodyClassName="p-3 space-y-3"
    >
      {v && (
        <>
          {!v.allow && g.enabled && (
            <div className="rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: A.red(0.4), background: A.red(0.08), color: C.red }}>{v.reason}</div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <StatCell label="TODAY" value={fR(v.status.todayR)} color={v.status.todayR >= 0 ? C.green : C.red} sub={`${v.status.todayTrades} trades`} />
            <StatCell label="DRAWDOWN" value={fR(-v.status.ddR, 1)} color={v.status.ddR > 0 ? C.warn : C.txt2} sub={`size ×${v.sizeMult.toFixed(2)}`} />
            <StatCell label="LOSS STREAK" value={String(v.status.streak)} color={v.status.streak >= 3 ? C.warn : C.txt2} sub={v.status.pauseUntil && v.status.pauseUntil > Date.now() ? "paused" : "—"} />
          </div>
        </>
      )}
      <div className="divide-y" style={{ borderColor: C.divider }}>
        <Toggle label="Guard every new order" hint="bot · scanner · sweep" on={g.enabled} onChange={(x) => setG({ ...g, enabled: x })} />
        <Num label="Daily loss limit" value={g.dailyLossR} step={0.5} suffix="R" onChange={(x) => setG({ ...g, dailyLossR: x })} />
        <Num label="Daily trade cap" value={g.dailyTradeCap} step={1} onChange={(x) => setG({ ...g, dailyTradeCap: x })} />
        <Num label="Pause after losses in a row" value={g.streakLosses} step={1} onChange={(x) => setG({ ...g, streakLosses: x })} />
        <Num label="Pause length" value={g.streakPauseMin} step={15} min={1} max={10080} suffix="min" onChange={(x) => setG({ ...g, streakPauseMin: x })} />
        <Num label="Drawdown → cut size" value={g.ddCut1R} suffix="R" onChange={(x) => setG({ ...g, ddCut1R: x })} />
        <Num label="  …to" value={g.ddCut1Mult} step={0.05} min={0.05} max={1} suffix="×" onChange={(x) => setG({ ...g, ddCut1Mult: x })} />
        <Num label="Deeper drawdown" value={g.ddCut2R} suffix="R" onChange={(x) => setG({ ...g, ddCut2R: x })} />
        <Num label="  …to" value={g.ddCut2Mult} step={0.05} min={0.05} max={1} suffix="×" onChange={(x) => setG({ ...g, ddCut2Mult: x })} />
        <Num label="Ruin = drawdown of" value={g.ruinR} step={1} min={1} suffix="R" onChange={(x) => setG({ ...g, ruinR: x })} />
      </div>
      <Btn busy={saving} onClick={() => void save({ guardian: g }, "Capital Guardian settings saved")}>Save</Btn>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[9px] font-extrabold tracking-[0.2em]" style={{ color: C.label }}>MONTE CARLO · RISK OF RUIN</span>
          {mc && (
            <Pill tone={mc.ruinProb < 0.05 ? "ok" : mc.ruinProb < 0.2 ? "warn" : "err"}>
              {(mc.ruinProb * 100).toFixed(1)}% ruin
            </Pill>
          )}
        </div>
        {!mc ? (
          <p className="text-[10.5px]" style={{ color: C.dim }}>Needs at least 5 closed trades in your book ({st?.sample ?? 0} so far).</p>
        ) : (
          <>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mc.bands.map((b) => ({ step: b.step, outer: [b.p5, b.p95], inner: [b.p25, b.p75], p50: b.p50 }))} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={C.divider} vertical={false} />
                  <XAxis dataKey="step" tick={{ fill: C.label, fontSize: 9 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: C.label, fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(x: number) => `${x.toFixed(0)}R`} />
                  <Tooltip
                    contentStyle={{ background: C.deep, border: `1px solid ${C.line2}`, fontSize: 11 }}
                    labelFormatter={(l) => `after ${l} trades`}
                    formatter={(val: unknown) => (Array.isArray(val) ? `${(val[0] as number).toFixed(1)}R … ${(val[1] as number).toFixed(1)}R` : `${(val as number).toFixed(1)}R`)}
                  />
                  <Area dataKey="outer" name="5–95%" stroke="none" fill={A.cyan(0.12)} isAnimationActive={false} />
                  <Area dataKey="inner" name="25–75%" stroke="none" fill={A.cyan(0.25)} isAnimationActive={false} />
                  <Area dataKey="p50" name="median" stroke={C.cyan} fill="none" strokeWidth={1.6} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px]" style={{ color: C.label }}>
              {mc.sims.toLocaleString()} reshuffles of your {mc.sample} closed trades over {mc.horizon} trades. Median result {fR(mc.medianFinalR, 1)}, worst 5% {fR(mc.p5FinalR, 1)}, 95th-percentile drawdown {mc.p95MaxDdR.toFixed(1)}R. Ruin = a {mc.ruinR}R drawdown.
            </p>
          </>
        )}
      </div>
    </PanelCard>
  );
}

/* ───────────────────────── Entry filters ───────────────────────── */
const SESSION_LABEL: Record<SessionKey, string> = { asia: "Asia · 00–09 UTC", london: "London · 07–16 UTC", newYork: "New York · 12–21 UTC" };

function FiltersCard({ s, save, saving }: CardProps) {
  const [f, setF] = useState(s.filters);
  const on = f.newsEnabled || f.sessionEnabled;
  return (
    <PanelCard title="NEWS & SESSION FILTERS" icon={CalendarClock} accent="teal" right={<Pill tone={on ? "ok" : "muted"}>{on ? "FILTERING" : "OFF"}</Pill>} bodyClassName="p-3 space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        Stops NEW trades around scheduled news for the instrument&apos;s currencies (ForexFactory calendar) and outside the sessions you pick. Open trades are never touched. If the calendar can&apos;t be read, trading continues and the alert says the blackout was inactive.
      </p>
      <div className="divide-y" style={{ borderColor: C.divider }}>
        <Toggle label="News blackout" hint="every source: bot · scanners · TradingView" on={f.newsEnabled} onChange={(v) => setF({ ...f, newsEnabled: v })} />
        <Pick label="Events" value={f.newsImpact} options={[["high", "High impact"], ["med_high", "Medium + high"]]} onChange={(v) => setF({ ...f, newsImpact: v })} />
        <Num label="Stop before" value={f.newsBeforeMin} step={5} max={720} suffix="min" onChange={(v) => setF({ ...f, newsBeforeMin: v })} />
        <Num label="Resume after" value={f.newsAfterMin} step={5} max={720} suffix="min" onChange={(v) => setF({ ...f, newsAfterMin: v })} />
        <Toggle label="Trade only in sessions" on={f.sessionEnabled} onChange={(v) => setF({ ...f, sessionEnabled: v })} />
        {(Object.keys(SESSION_LABEL) as SessionKey[]).map((k) => (
          <Toggle key={k} label={SESSION_LABEL[k]} on={f.sessions[k]} onChange={(v) => setF({ ...f, sessions: { ...f.sessions, [k]: v } })} />
        ))}
      </div>
      <p className="text-[10px]" style={{ color: C.dim }}>Session hours are fixed UTC (no daylight-saving shift). Deriv synthetics have no news and are never blacked out.</p>
      <Btn busy={saving} onClick={() => void save({ filters: f }, "News & session filters saved")}>Save</Btn>
    </PanelCard>
  );
}

/* ───────────────────────── Prop-firm rules ───────────────────────── */
interface PropRes {
  status: { enabled: boolean; live: boolean; state: PropState | null; dailyFloor: number | null; totalFloor: number | null; error: string | null; lastCheck: number | null };
  presets: Record<string, { label: string }>;
}
const fM = (v: number | null | undefined): string => (v === null || v === undefined || !isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

function PropCard({ s, save, saving, notify }: CardProps & { notify: Notify }) {
  const [p, setP] = useState(s.prop);
  const [st, setSt] = useState<PropRes | null>(null);
  const [resetting, setResetting] = useState(false);
  const refresh = useCallback(() => {
    api<PropRes>("/api/edge/prop").then(setSt).catch(() => setSt(null));
  }, []);
  useEffect(refresh, [refresh, s.prop]);
  const ps = st?.status;
  const state = ps?.state ?? null;
  const breached = !!state && (state.breachTotal || !!state.breachDay);
  const reset = async () => {
    setResetting(true);
    try {
      await api("/api/edge/prop", { action: "reset" });
      notify("Prop rules", "Breach cleared — the day is re-anchored to the current balance");
      refresh();
    } catch (e) {
      notify("Prop rules · reset failed", (e as Error).message, true);
    } finally {
      setResetting(false);
    }
  };
  const tone = !p.enabled ? "muted" : breached ? "err" : ps?.live ? "ok" : "warn";
  const label = !p.enabled ? "OFF" : breached ? "LIMIT HIT" : ps?.live ? "WATCHING" : "LIVE ONLY";
  return (
    <PanelCard title="PROP-FIRM RULES" icon={Landmark} accent="gold" right={<Pill tone={tone} pulse={p.enabled && breached}>{label}</Pill>} bodyClassName="p-3 space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        Watches the live account&apos;s balance and equity every 15 s. At a daily or total loss limit (minus the buffer) HALO stops new trades and, if chosen, closes every open position. Paper mode has no real balance, so these rules act on live accounts only.
      </p>
      {p.enabled && state?.breachNote && breached && (
        <div className="rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: A.red(0.4), background: A.red(0.08), color: C.red }}>{state.breachNote}</div>
      )}
      {p.enabled && ps?.error && <div className="text-[10.5px]" style={{ color: C.warn }}>{ps.error}</div>}
      {p.enabled && state && (
        <div className="grid grid-cols-3 gap-2">
          <StatCell label="EQUITY" value={fM(state.lastEquity)} sub={`balance ${fM(state.lastBalance)}`} />
          <StatCell label="DAILY FLOOR" value={fM(ps?.dailyFloor)} color={C.warn} sub={`day ${state.dayKey}`} />
          <StatCell label="TOTAL FLOOR" value={fM(ps?.totalFloor)} color={C.red} sub={`initial ${fM(state.initialBalance)}`} />
        </div>
      )}
      <div className="divide-y" style={{ borderColor: C.divider }}>
        <Toggle label="Enforce prop-firm rules" on={p.enabled} onChange={(v) => setP({ ...p, enabled: v })} />
        <Pick<PropPreset>
          label="Preset"
          value={p.preset}
          options={[["custom", "Custom"], ["ftmo", "FTMO"], ["fundednext", "FundedNext"], ["the5ers", "The5ers"], ["fundingpips", "FundingPips"]]}
          onChange={(v) => setP({ ...p, preset: v })}
        />
        <Num label="Initial balance (0 = first seen)" value={p.initialBalance} step={1000} max={100000000} onChange={(v) => setP({ ...p, initialBalance: v })} />
        <Num label="Daily loss limit" value={p.dailyLossPct} step={0.5} max={50} suffix="%" onChange={(v) => setP({ ...p, dailyLossPct: v, preset: "custom" })} />
        <Pick label="Daily % of" value={p.dailyBase} options={[["initial", "Initial balance"], ["dayStart", "Start of day"]]} onChange={(v) => setP({ ...p, dailyBase: v, preset: "custom" })} />
        <Pick label="Start of day uses" value={p.dayRef} options={[["balance", "Balance"], ["equity", "Higher of balance/equity"]]} onChange={(v) => setP({ ...p, dayRef: v, preset: "custom" })} />
        <Num label="Max total loss" value={p.maxLossPct} step={0.5} max={90} suffix="%" onChange={(v) => setP({ ...p, maxLossPct: v, preset: "custom" })} />
        <Pick label="Total limit" value={p.maxLossMode} options={[["static", "Static (from initial)"], ["trailing", "Trailing (from peak)"]]} onChange={(v) => setP({ ...p, maxLossMode: v, preset: "custom" })} />
        <Num label="Day resets at" value={p.resetHourUtc} step={1} max={23} suffix="UTC" onChange={(v) => setP({ ...p, resetHourUtc: v })} />
        <Num label="Safety buffer" value={p.bufferPct} step={0.1} max={10} suffix="%" onChange={(v) => setP({ ...p, bufferPct: v })} />
        <Toggle label="Close all positions at the limit" on={p.closeAtLimit} onChange={(v) => setP({ ...p, closeAtLimit: v })} />
      </div>
      <p className="text-[10px]" style={{ color: C.dim }}>Presets use the firms&apos; published 2-step evaluation rules. Firms change them, so always check your own account terms. A daily breach clears at the next prop-firm day; a total breach needs a Super Admin reset.</p>
      <div className="flex flex-wrap gap-2">
        <Btn busy={saving} onClick={() => void save({ prop: p }, "Prop-firm rules saved")}>Save</Btn>
        {breached && (
          <Btn tone="ghost" busy={resetting} onClick={() => void reset()}>Reset breach (Super Admin)</Btn>
        )}
      </div>
    </PanelCard>
  );
}

/* ───────────────────────── Spread & slippage guard ───────────────────────── */
function SpreadCard({ s, save, saving }: CardProps) {
  const [g, setG] = useState(s.spread);
  return (
    <PanelCard title="SPREAD & SLIPPAGE GUARD" icon={Ruler} accent="green" right={<Pill tone={g.enabled ? "ok" : "muted"}>{g.enabled ? "GUARDING" : "OFF"}</Pill>} bodyClassName="p-3 space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        Before a LIVE order, HALO reads the broker&apos;s bid/ask and refuses the trade when the spread is too wide or the price has already run too far from the order price. Fills that slip past the limit are recorded and alerted. Paper trades have no broker quote, so this guard applies to live orders.
      </p>
      <div className="divide-y" style={{ borderColor: C.divider }}>
        <Toggle label="Guard live orders" on={g.enabled} onChange={(v) => setG({ ...g, enabled: v })} />
        <Num label="Max spread" value={g.maxSpreadPips} step={0.5} max={10000} suffix="pips" onChange={(v) => setG({ ...g, maxSpreadPips: v })} />
        <Num label="Max spread vs stop" value={g.maxSpreadSlPct} step={5} max={100} suffix="%" onChange={(v) => setG({ ...g, maxSpreadSlPct: v })} />
        <Num label="Max slippage" value={g.maxSlippagePips} step={0.5} max={10000} suffix="pips" onChange={(v) => setG({ ...g, maxSlippagePips: v })} />
      </div>
      <p className="text-[10px]" style={{ color: C.dim }}>Set any limit to 0 to switch it off. &quot;Spread vs stop&quot; works on every market (e.g. 25% = spread may be at most a quarter of the stop distance).</p>
      <Btn busy={saving} onClick={() => void save({ spread: g }, "Spread & slippage guard saved")}>Save</Btn>
    </PanelCard>
  );
}

/* ───────────────────────── 4 · Adaptive Autopilot ───────────────────────── */
interface Profile {
  id: string;
  symbol: string;
  tf: string;
  params: AutopilotParams | null;
  inSample: SimSummary | null;
  oos: SimSummary | null;
  base: SimSummary | null;
  combos: number;
  bars: number;
  passed: boolean;
  live: boolean;
  verdict: string;
  updatedAt: number;
}

function AutopilotCard({ s, save, symbol, tf, notify }: Omit<CardProps, "saving"> & { symbol: string; tf: string; notify: Notify }) {
  const [job, setJob] = useState<AutopilotJob | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [bars, setBars] = useState(6000);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api<{ job: AutopilotJob; profiles: Profile[] }>("/api/edge/autopilot")
      .then((j) => {
        setJob(j.job);
        setProfiles(j.profiles);
      })
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [job?.running, refresh]);

  const run = async () => {
    setBusy(true);
    try {
      const j = await api<{ job: AutopilotJob }>("/api/edge/autopilot", { action: "run", symbol, tf, bars });
      setJob(j.job);
      notify("Autopilot", `Testing 486 combinations on ${symbol} ${tf}…`);
    } catch (e) {
      notify("Autopilot", (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (p: Profile) => {
    try {
      const j = await api<{ profiles: Profile[] }>("/api/edge/autopilot", { action: p.live ? "off" : "live", id: p.id });
      setProfiles(j.profiles);
    } catch (e) {
      notify("Autopilot", (e as Error).message, true);
    }
  };

  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <PanelCard
      title="ADAPTIVE AUTOPILOT"
      icon={Wand2}
      accent="cyan"
      right={<Pill tone={s.autopilot.enabled ? "live" : "muted"}>{s.autopilot.enabled ? "APPLYING PROFILES" : "PROFILES NOT APPLIED"}</Pill>}
      bodyClassName="p-3 space-y-3"
    >
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        Tests 486 setting combinations on this market, picks the best on the first 70% of history, then checks it on the last 30% it never saw. A profile only goes live if it is profitable on that unseen data and beats your current settings. Your saved settings are never overwritten.
      </p>
      <Toggle label="Apply live profiles to the bot" on={s.autopilot.enabled} onChange={(v) => void save({ autopilot: { enabled: v } }, v ? "Autopilot profiles applied" : "Autopilot profiles switched off")} />
      <div className="flex flex-wrap items-center gap-2">
        <Num label="History" value={bars} step={1000} min={1000} max={50000} suffix="bars" onChange={setBars} />
        <Btn busy={busy || job?.running} onClick={() => void run()}>
          <Rocket size={12} /> Optimise {symbol} {tf}
        </Btn>
      </div>
      {job?.running && (
        <div>
          <div className="mb-1 flex justify-between text-[10.5px]" style={{ color: C.txt2 }}>
            <span>{job.symbol} {job.tf} · {job.done}/{job.total}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.navy2 }}>
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.cyan})` }} />
          </div>
        </div>
      )}
      {job && !job.running && job.error && <p className="text-[11px]" style={{ color: C.red }}>{job.error}</p>}

      {profiles.length === 0 ? (
        <p className="text-[10.5px]" style={{ color: C.dim }}>No profiles yet — run the optimiser on a market.</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <div key={p.id} className="rounded-lg border p-2.5" style={{ borderColor: p.live ? A.green(0.45) : C.line, background: C.deep }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] font-bold" style={{ color: C.txt }}>{p.symbol} {p.tf}</span>
                <Pill tone={p.live ? "live" : p.passed ? "info" : "err"}>{p.live ? "LIVE" : p.passed ? "PASSED · PAUSED" : "REJECTED"}</Pill>
                <span className="ml-auto text-[9.5px]" style={{ color: C.dim }}>{new Date(p.updatedAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-[10.5px]" style={{ color: C.txt2 }}>{p.verdict}</p>
              {p.params && (
                <p className="mt-1 text-[10px] tabular-nums" style={{ color: C.label }}>
                  R:R {p.params.rrMult} · SL {p.params.slATRm}×ATR · break {p.params.breakATR} · return {p.params.eqTolATR} · min grade {p.params.minScore} · manager {p.params.manager ? "on" : "off"}
                </p>
              )}
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-[10px] tabular-nums">
                <MiniStat label="IN-SAMPLE" s={p.inSample} />
                <MiniStat label="UNSEEN" s={p.oos} />
                <MiniStat label="CURRENT · UNSEEN" s={p.base} />
              </div>
              {p.passed && (
                <div className="mt-2">
                  <Btn tone="ghost" onClick={() => void toggle(p)}>{p.live ? "Pause profile" : "Make live"}</Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function MiniStat({ label, s }: { label: string; s: SimSummary | null }) {
  return (
    <div className="rounded-md border px-1.5 py-1" style={{ borderColor: C.lineInner }}>
      <div className="text-[8.5px] font-bold tracking-wider" style={{ color: C.label }}>{label}</div>
      {s ? (
        <>
          <div style={{ color: s.netR >= 0 ? C.green : C.red }}>{fR(s.netR, 1)}</div>
          <div style={{ color: C.muted }}>{s.trades} tr · PF {fN(s.profitFactor, 2)}</div>
        </>
      ) : (
        <div style={{ color: C.dim }}>—</div>
      )}
    </div>
  );
}

/* ───────────────────────── 5 · EDGE vs baseline ───────────────────────── */
/** both equity curves on one time axis, each carried forward between its own points */
function mergeCurves(base: Array<{ t: number; r: number }>, edge: Array<{ t: number; r: number }>): Array<{ t: number; base: number; edge: number }> {
  const pts = [...base.map((p) => ({ t: p.t, k: "base" as const, r: p.r })), ...edge.map((p) => ({ t: p.t, k: "edge" as const, r: p.r }))].sort((a, b) => a.t - b.t);
  const out: Array<{ t: number; base: number; edge: number }> = [];
  const last = { base: 0, edge: 0 };
  for (const p of pts) {
    last[p.k] = p.r;
    out.push({ t: p.t, base: last.base, edge: last.edge });
  }
  return out;
}

interface CompareRes {
  symbol: string;
  tf: string;
  bars: number;
  source: string;
  baseline: { summary: SimSummary; curve: Array<{ t: number; r: number }> };
  edge: { summary: SimSummary; curve: Array<{ t: number; r: number }> };
  gradeTable: Array<{ letter: string; trades: number; winRate: number | null; avgR: number | null; netR: number }>;
  layers: { quality: { minScore: number } | null; manager: unknown; guardian: boolean };
}

function CompareCard({ symbol, tf, notify }: { symbol: string; tf: string; notify: Notify }) {
  const [bars, setBars] = useState(5000);
  const [spread, setSpread] = useState(0);
  const [res, setRes] = useState<CompareRes | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setRes(await api<CompareRes>("/api/edge/compare", { symbol, tf, bars, spreadPips: spread }));
    } catch (e) {
      notify("EDGE vs baseline", (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const merged = res ? mergeCurves(res.baseline.curve, res.edge.curve) : [];

  const rows: Array<[string, (s: SimSummary) => string]> = [
    ["Trades", (s) => String(s.trades)],
    ["Skipped by EDGE", (s) => String(s.skipped)],
    ["Win rate", (s) => fN(s.winRate, 1, "%")],
    ["Net result", (s) => fR(s.netR, 1)],
    ["Profit factor", (s) => fN(s.profitFactor, 2)],
    ["Expectancy / trade", (s) => fR(s.expectancyR)],
    ["Max drawdown", (s) => `${s.maxDdR.toFixed(1)}R`],
  ];

  return (
    <PanelCard title="EDGE VS BASELINE" icon={Scale} accent="gold" bodyClassName="p-3 space-y-3">
      <p className="text-[10.5px] leading-relaxed" style={{ color: C.label }}>
        One click runs the same real history twice — the plain 3EL strategy, and the same strategy with every EDGE layer you have switched on — plus a table showing whether higher grades actually earn more on this market.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Num label="Bars" value={bars} step={1000} min={300} max={100000} onChange={setBars} />
        <Num label="Spread" value={spread} step={0.5} max={100} suffix="pips" onChange={setSpread} />
        <Btn busy={busy} onClick={() => void run()}>
          <Play size={12} /> Run {symbol} {tf}
        </Btn>
      </div>

      {!res ? (
        <p className="text-[10.5px]" style={{ color: C.dim }}>No comparison yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={merged} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={C.divider} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: C.label, fontSize: 9 }} tickFormatter={(t: number) => new Date(t).toLocaleDateString()} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: C.label, fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(x: number) => `${x.toFixed(0)}R`} />
                  <Tooltip contentStyle={{ background: C.deep, border: `1px solid ${C.line2}`, fontSize: 11 }} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} formatter={(v: unknown) => `${(v as number).toFixed(2)}R`} />
                  <Line dataKey="base" name="Baseline" stroke={C.muted} dot={false} strokeWidth={1.4} isAnimationActive={false} />
                  <Line dataKey="edge" name="EDGE" stroke={C.cyan} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-[9.5px] tracking-wider" style={{ color: C.label }}>
                  <th className="py-1 text-left font-bold">{res.symbol} {res.tf} · {res.bars.toLocaleString()} bars · {res.source}</th>
                  <th className="text-right font-bold">BASELINE</th>
                  <th className="text-right font-bold" style={{ color: C.cyan }}>EDGE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, f]) => (
                  <tr key={label} className="border-t" style={{ borderColor: C.divider }}>
                    <td className="py-1" style={{ color: C.txt2 }}>{label}</td>
                    <td className="text-right" style={{ color: C.muted }}>{f(res.baseline.summary)}</td>
                    <td className="text-right font-semibold" style={{ color: C.txt }}>{f(res.edge.summary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px]" style={{ color: C.dim }}>
              Results in R (net of spread ÷ initial risk × size). EDGE layers in this run: {[res.layers.quality ? `quality gate ≥ ${res.layers.quality.minScore}` : null, res.layers.manager ? "trade manager" : null, res.layers.guardian ? "capital guardian" : null].filter(Boolean).join(" · ") || "none switched on"}.
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.2em]" style={{ color: C.label }}>DO HIGHER GRADES EARN MORE? (ALL BASELINE FIRES)</div>
            <GradeTableView rows={res.gradeTable} />
          </div>
        </div>
      )}
    </PanelCard>
  );
}
