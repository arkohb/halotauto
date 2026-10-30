"use client";

// ════════════════════════════════════════════════════════════════════════
//  STRATEGY STUDIO · paste Pine → compile → chart indicator → auto-trade
//
//  The commercial feature: traders paste their own Pine Script v5, the
//  HALO compiler turns it into a real indicator (plotted on the chart)
//  and — when the script places trades — the bot auto-trades it through
//  the SAME execution path as the built-in 3EL engine (paper or live,
//  with sizing, SL/TP, broker routing and alerts). Exactly one strategy
//  trades at a time: the list below selects it.
//
//  Presentation layer — every save/activation hits the real strategy API;
//  nothing here invents data or bypasses risk controls.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, CheckCircle2, ChevronRight, CircleAlert, Copy, FlaskConical, Loader2, Pencil, Plus, Save, Trash2, Zap } from "lucide-react";
import { PageHeader, Pill } from "@/components/halo/panel";
import { PinePreviewChart, type PreviewHLine, type PreviewMarker, type PreviewPlot } from "@/components/halo/pine-preview-chart";
import { A, C, type BotStateRes } from "@/lib/halo/ui-helpers";
import { MAX_PINE_CHARS, MAX_PINE_LINES } from "@/lib/pine/limits";

// ── types mirroring the API ──────────────────────────────────────────────
interface StrategySummary {
  id: string;
  name: string;
  description: string;
  status: "draft" | "compiled" | "error";
  compileMsg: string;
  active: boolean;
  kind: "strategy" | "indicator";
  overlay: boolean;
  hasLong: boolean;
  hasShort: boolean;
  hasExitSLTP: boolean;
  hasClose: boolean;
  plotCount: number;
  inputCount: number;
  plots: { key: string; title: string; style: string }[];
  risk: { useSlATR: boolean; slATRm: number; useSlPts: boolean; slPts: number; rrMult: number };
  signal: { mode: "strategy" | "manual"; longVar?: string; shortVar?: string; exitVar?: string };
  notes: string[];
  signalCandidates: string[];
  updatedAt: string;
}
interface Diagnostic {
  line: number;
  col: number;
  msg: string;
}
interface PreviewRes {
  ok: boolean;
  error?: string;
  kind?: string;
  symbol?: string;
  tf?: string;
  source?: string;
  bars?: number;
  plots?: PreviewPlot[];
  markers?: PreviewMarker[];
  hlines?: PreviewHLine[];
  trades?: { dir: 1 | -1; entryTime: number; entry: number; exitTime: number | null; exit: number | null; reason: string | null; resultPips: number | null }[];
  stats?: { trades: number; closed: number; wins: number; losses: number; winRate: number | null; netPips: number };
  booleanSeries?: string[];
  notes?: string[];
}

// ── starter templates (real, compile-ready Pine v5) ──────────────────────
const TEMPLATES: { name: string; source: string }[] = [
  {
    name: "EMA Cross strategy",
    source: `//@version=5
strategy("My EMA Cross", overlay=true)
fastLen = input.int(9, "Fast EMA", minval=1)
slowLen = input.int(21, "Slow EMA", minval=2)
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
longCond  = ta.crossover(fast, slow)
shortCond = ta.crossunder(fast, slow)
if longCond
    strategy.entry("Long", strategy.long)
if shortCond
    strategy.entry("Short", strategy.short)
plot(fast, "Fast EMA", color=color.lime)
plot(slow, "Slow EMA", color=color.red)`,
  },
  {
    name: "RSI reversion with SL/TP",
    source: `//@version=5
strategy("RSI Reversion", overlay=false)
len = input.int(14, "RSI length")
os  = input.float(30, "Oversold")
ob  = input.float(70, "Overbought")
r = ta.rsi(close, len)
longCond  = ta.crossover(r, os)
shortCond = ta.crossunder(r, ob)
if longCond
    strategy.entry("L", strategy.long)
    strategy.exit("XL", from_entry="L", stop=close * 0.97, limit=close * 1.06)
if shortCond
    strategy.entry("S", strategy.short)
    strategy.exit("XS", from_entry="S", stop=close * 1.03, limit=close * 0.94)
plot(r, "RSI", color=color.purple)
hline(70, "OB", color=color.red)
hline(30, "OS", color=color.green)`,
  },
  {
    name: "MACD signal indicator",
    source: `//@version=5
indicator("MACD Signals")
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
longCond  = ta.crossover(macdLine, signalLine)
shortCond = ta.crossunder(macdLine, signalLine)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(hist, "Histogram", style=plot.style_histogram)
plotshape(longCond, "Bull", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(shortCond, "Bear", style=shape.triangledown, location=location.abovebar, color=color.red)`,
  },
  {
    name: "Supertrend strategy",
    source: `//@version=5
strategy("Supertrend", overlay=true)
factor = input.float(3.0, "Factor", step=0.1)
len    = input.int(10, "ATR length")
[sup, dir] = ta.supertrend(factor, len)
longCond  = ta.crossover(dir * -1, 0)
shortCond = ta.crossunder(dir * -1, 0)
if longCond
    strategy.entry("ST-L", strategy.long)
if shortCond
    strategy.entry("ST-S", strategy.short)
plot(sup, "Supertrend", color=dir < 0 ? color.red : color.green)`,
  },
  {
    name: "Bollinger mean reversion",
    source: `//@version=5
strategy("BB Mean Reversion", overlay=true)
len  = input.int(20, "BB length")
mult = input.float(2.0, "BB mult", step=0.1)
basis = ta.sma(close, len)
dev   = mult * ta.stdev(close, len)
upper = basis + dev
lower = basis - dev
longCond  = ta.crossover(close, lower)
shortCond = ta.crossunder(close, upper)
if longCond
    strategy.entry("BB-L", strategy.long)
if shortCond
    strategy.entry("BB-S", strategy.short)
plot(basis, "Basis", color=color.orange)
plot(upper, "Upper", color=color.gray)
plot(lower, "Lower", color=color.gray)`,
  },
];

const EMPTY_EDITOR = { name: "", description: "", source: "" };

export function StrategyStudio({ state, notify }: { state: BotStateRes; notify: (title: string, desc?: string, bad?: boolean) => void }) {
  const [strategies, setStrategies] = useState<StrategySummary[]>([]);
  const [selected, setSelected] = useState<{ id: string | null; name: string; kind: "builtin" | "pine" } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // null = new draft
  const [editor, setEditor] = useState<{ name: string; description: string; source: string }>(EMPTY_EDITOR);
  const [compile, setCompile] = useState<{ ok: boolean; diagnostics: Diagnostic[]; fatal?: Diagnostic } | null>(null);
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [previewCandles, setPreviewCandles] = useState<{ time: number; open: number; high: number; low: number; close: number }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [risk, setRisk] = useState({ useSlATR: true, slATRm: 1.5, useSlPts: false, slPts: 1000, rrMult: 3.0 });
  const [sigMap, setSigMap] = useState<{ longVar: string; shortVar: string; exitVar: string }>({ longVar: "", shortVar: "", exitVar: "" });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const srcRef = useRef<HTMLTextAreaElement | null>(null);

  const loadList = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch("/api/strategies", { cache: "no-store" });
      const j = (await r.json()) as { ok: boolean; strategies: StrategySummary[]; selected: { id: string | null; name: string; kind: "builtin" | "pine" } };
      if (j.ok) {
        setStrategies(j.strategies);
        setSelected(j.selected);
      }
    } catch {
      // keep previous
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadStrategy = useCallback(async (id: string) => {
    setBusy("load");
    try {
      const r = await fetch(`/api/strategies/${id}`, { cache: "no-store" });
      const j = (await r.json()) as { ok: boolean; strategy?: StrategySummary & { pineSource: string } };
      if (j.ok && j.strategy) {
        const s = j.strategy;
        setEditingId(id);
        setEditor({ name: s.name, description: s.description, source: s.pineSource });
        setRisk(s.risk);
        setSigMap({ longVar: s.signal.longVar ?? "", shortVar: s.signal.shortVar ?? "", exitVar: s.signal.exitVar ?? "" });
        setCompile(s.status === "compiled" ? { ok: true, diagnostics: [] } : s.status === "error" ? { ok: false, diagnostics: [] } : null);
        setPreview(null);
        setPreviewCandles([]);
      }
    } finally {
      setBusy(null);
    }
  }, []);

  const newDraft = useCallback(() => {
    setEditingId(null);
    setEditor(EMPTY_EDITOR);
    setCompile(null);
    setPreview(null);
    setPreviewCandles([]);
    setRisk({ useSlATR: true, slATRm: 1.5, useSlPts: false, slPts: 1000, rrMult: 3.0 });
    setSigMap({ longVar: "", shortVar: "", exitVar: "" });
    srcRef.current?.focus();
  }, []);

  // ── save + compile ────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setBusy("save");
    try {
      const url = editingId ? `/api/strategies/${editingId}` : "/api/strategies";
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editor.name, description: editor.description, pineSource: editor.source, ...risk, signalJson: { mode: sigMap.longVar ? "manual" : "strategy", ...(sigMap.longVar ? sigMap : {}) } }),
      });
      const j = (await r.json()) as { ok: boolean; strategy?: StrategySummary; compile?: { ok: boolean; diagnostics: Diagnostic[]; fatal?: Diagnostic }; error?: string };
      if (!j.ok) {
        notify("Save rejected", j.error, true);
        return;
      }
      setCompile(j.compile ?? null);
      if (j.strategy) setEditingId(j.strategy.id);
      notify(
        j.compile?.ok ? "COMPILED ✓" : "COMPILE ERRORS",
        j.compile?.ok
          ? `${j.strategy?.name} is saved. ${j.strategy?.kind === "strategy" ? "Auto-trading signals detected." : "Indicator only — pick signal series below to trade it."}`
          : "Fix the errors listed below and compile again.",
        !j.compile?.ok
      );
      await loadList();
      if (j.compile?.ok && j.strategy) void runPreview(j.strategy.id);
    } catch (e) {
      notify("Save failed", (e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }, [editingId, editor, risk, sigMap, notify, loadList]);

  // ── preview over real history ─────────────────────────────────────────
  const runPreview = useCallback(
    async (id: string) => {
      setBusy("preview");
      try {
        const r = await fetch(`/api/strategies/${id}/preview?symbol=${state.symbol}&tf=${state.tf}&limit=400`, { cache: "no-store" });
        const j = (await r.json()) as PreviewRes & { candles?: { time: number; open: number; high: number; low: number; close: number }[] };
        if (j.ok) {
          setPreview(j);
          // the preview endpoint doesn't return raw candles — pull them for the chart
          const cr = await fetch(`/api/market/candles?symbol=${state.symbol}&tf=${state.tf}&limit=400`, { cache: "no-store" });
          const cj = (await cr.json()) as { candles?: { time: number; open: number; high: number; low: number; close: number }[] };
          setPreviewCandles(cj.candles ?? []);
        } else {
          setPreview(j);
          notify("Preview failed", j.error, true);
        }
      } catch (e) {
        notify("Preview failed", (e as Error).message, true);
      } finally {
        setBusy(null);
      }
    },
    [state.symbol, state.tf, notify]
  );

  // ── activation ────────────────────────────────────────────────────────
  const activate = useCallback(
    async (id: string | null, name: string) => {
      setBusy(id ?? "builtin");
      try {
        if (id === null) {
          // back to the built-in 3EL engine: deactivate whichever pine is active
          const active = strategies.find((s) => s.active);
          if (active) {
            await fetch(`/api/strategies/${active.id}/activate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active: false }),
            });
          }
          notify("BUILT-IN STRATEGY RESTORED", `The bot is back on HALO 3EL v1.2. No Pine strategy is auto-trading.`);
        } else {
          const r = await fetch(`/api/strategies/${id}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: true }),
          });
          const j = (await r.json()) as { ok: boolean; error?: string };
          if (!j.ok) {
            notify("Cannot activate", j.error, true);
            return;
          }
          notify(`TRADING WITH "${name.toUpperCase()}"`, "The bot now auto-trades this strategy — the built-in 3EL engine's fires are skipped while it stays active. Routing still obeys PAPER/LIVE and the EA start/stop switch.", state.exec.executionMode === "live");
        }
        await loadList();
      } finally {
        setBusy(null);
      }
    },
    [strategies, notify, loadList, state.exec.executionMode]
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy("delete");
      try {
        const r = await fetch(`/api/strategies/${id}`, { method: "DELETE" });
        const j = (await r.json()) as { ok: boolean; error?: string };
        if (!j.ok) {
          notify("Delete failed", j.error, true);
          return;
        }
        if (editingId === id) newDraft();
        notify("Strategy deleted");
        await loadList();
      } finally {
        setConfirmDelete(null);
        setBusy(null);
      }
    },
    [editingId, newDraft, notify, loadList]
  );

  const applySignalMap = useCallback(async () => {
    if (!editingId) return;
    setBusy("sigmap");
    try {
      const r = await fetch(`/api/strategies/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editor.name, description: editor.description, pineSource: editor.source, ...risk, signalJson: { mode: sigMap.longVar ? "manual" : "strategy", ...(sigMap.longVar ? sigMap : {}) } }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) {
        notify("Signal map rejected", j.error, true);
        return;
      }
      notify("SIGNAL SERIES MAPPED", sigMap.longVar ? `Long: ${sigMap.longVar} · Short: ${sigMap.shortVar || "—"} · Exit: ${sigMap.exitVar || "—"}` : "Back to the script's own strategy.entry() signals.");
      await loadList();
    } finally {
      setBusy(null);
    }
  }, [editingId, editor, risk, sigMap, notify, loadList]);

  const activePine = useMemo(() => strategies.find((s) => s.active), [strategies]);
  const boolChoices = useMemo(() => {
    const set = new Set<string>([...(preview?.booleanSeries ?? []), ...(strategies.find((s) => s.id === editingId)?.signalCandidates ?? [])]);
    return [...set];
  }, [preview, strategies, editingId]);

  // ── render ────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-12 gap-3">
      <PageHeader
        className="col-span-full"
        icon={Braces}
        title="STRATEGY STUDIO"
        sub="Paste your Pine Script v5 → HALO compiles it into a real indicator on the chart and auto-trades its signals — same execution path, same risk controls as the built-in engine."
        right={
          selected ? (
            <Pill tone={selected.kind === "pine" ? "live" : "info"} pulse={selected.kind === "pine"}>
              {selected.kind === "pine" ? `TRADING: ${selected.name}` : "TRADING: HALO 3EL v1.2"}
            </Pill>
          ) : undefined
        }
      />

      {/* ── strategy list ── */}
      <div className="col-span-12 space-y-3 xl:col-span-4">
        <div className="rounded-xl p-3" style={{ background: C.panel, boxShadow: `inset 0 0 0 1px ${C.panelLine}` }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-extrabold tracking-[0.22em]" style={{ color: C.label }}>
              STRATEGY LIST · SELECT WHAT THE BOT TRADES
            </span>
            <button
              type="button"
              onClick={newDraft}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-extrabold tracking-[0.12em] transition-colors"
              style={{ background: A.cyan(0.12), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.35)}` }}
            >
              <Plus size={11} /> NEW
            </button>
          </div>

          {/* built-in engine — always available, never deletable */}
          <button
            type="button"
            onClick={() => void activate(null, "HALO 3EL v1.2")}
            disabled={busy === "builtin"}
            className="group mb-2 w-full rounded-lg p-3 text-left transition-all disabled:opacity-60"
            style={{
              background: selected?.kind === "builtin" ? `linear-gradient(135deg, ${A.blue(0.16)}, ${A.cyan(0.08)})` : C.navy2,
              boxShadow: `inset 0 0 0 1px ${selected?.kind === "builtin" ? A.cyan(0.5) : C.lineInner}`,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-[12px] font-bold" style={{ color: C.txt }}>
                  HALO 3EL v1.2
                  <span className="rounded px-1 py-px text-[7.5px] font-extrabold tracking-[0.1em]" style={{ background: A.gold(0.14), color: C.goldHover }}>
                    BUILT-IN
                  </span>
                </div>
                <div className="mt-0.5 text-[9.5px]" style={{ color: C.muted }}>
                  C1/C2 equal levels → C3 wick-line break & return. The default engine.
                </div>
              </div>
              {selected?.kind === "builtin" ? (
                <Pill tone="ok">ACTIVE</Pill>
              ) : (
                <span className="flex items-center gap-0.5 text-[9px] font-extrabold tracking-wider" style={{ color: C.cyan }}>
                  USE <ChevronRight size={11} />
                </span>
              )}
            </div>
          </button>

          {/* pine strategies */}
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 halo-scroll">
            {strategies.length === 0 && (
              <div className="rounded-lg px-3 py-6 text-center text-[10.5px] leading-relaxed" style={{ color: C.dim, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
                No custom strategies yet. Paste your first Pine Script with <span style={{ color: C.cyan }}>NEW</span> — pick a template to start.
              </div>
            )}
            {strategies.map((s) => {
              const isEditing = editingId === s.id;
              return (
                <div
                  key={s.id}
                  className="rounded-lg p-3 transition-all"
                  style={{
                    background: s.active ? `linear-gradient(135deg, ${A.green(0.14)}, ${A.teal(0.07)})` : isEditing ? C.navy3 : C.navy2,
                    boxShadow: `inset 0 0 0 1px ${s.active ? A.green(0.5) : isEditing ? A.blue(0.4) : C.lineInner}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => void loadStrategy(s.id)} className="min-w-0 text-left">
                      <div className="flex items-center gap-1.5 truncate text-[12px] font-bold" style={{ color: C.txt }}>
                        {s.name}
                        <span className="rounded px-1 py-px text-[7.5px] font-extrabold tracking-[0.1em]" style={{ background: s.kind === "strategy" ? A.teal(0.14) : A.white(0.08), color: s.kind === "strategy" ? C.teal : C.muted }}>
                          {s.kind === "strategy" ? "AUTO-TRADE" : "INDICATOR"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px]" style={{ color: C.muted }}>
                        <span style={{ color: s.status === "compiled" ? C.green : s.status === "error" ? C.red : C.warn }}>
                          {s.status === "compiled" ? "✓ COMPILED" : s.status === "error" ? "✗ ERRORS" : "DRAFT"}
                        </span>
                        <span>· {s.plotCount} plot{s.plotCount === 1 ? "" : "s"}</span>
                        {s.hasLong || s.hasShort ? (
                          <span>
                            · {s.hasLong ? "LONG" : ""} {s.hasShort ? "SHORT" : ""}
                          </span>
                        ) : null}
                        {s.hasExitSLTP ? <span>· script SL/TP</span> : null}
                      </div>
                    </button>
                    {s.active ? <Pill tone="live" pulse>TRADING</Pill> : null}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {!s.active && s.status === "compiled" && (
                      <button
                        type="button"
                        onClick={() => void activate(s.id, s.name)}
                        disabled={busy === s.id}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[8.5px] font-extrabold tracking-[0.12em] transition-colors disabled:opacity-50"
                        style={{ background: A.green(0.14), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.4)}` }}
                      >
                        {busy === s.id ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />} TRADE WITH THIS
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadStrategy(s.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[8.5px] font-extrabold tracking-[0.12em]"
                      style={{ background: A.white(0.06), color: C.txt2, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}
                    >
                      <Pencil size={10} /> EDIT
                    </button>
                    {confirmDelete === s.id ? (
                      <button
                        type="button"
                        onClick={() => void remove(s.id)}
                        className="rounded-md px-2 py-1 text-[8.5px] font-extrabold tracking-[0.12em]"
                        style={{ background: A.red(0.16), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.45)}` }}
                      >
                        CONFIRM DELETE
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(s.id)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[8.5px] font-extrabold tracking-[0.12em]"
                        style={{ background: "transparent", color: C.dim, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* honesty card */}
        <div className="rounded-xl p-3" style={{ background: C.panel, boxShadow: `inset 0 0 0 1px ${C.panelLine}` }}>
          <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.22em]" style={{ color: C.label }}>
            HOW AUTO-TRADING DECIDES SL / TP
          </div>
          <ul className="space-y-1.5 text-[10px] leading-relaxed" style={{ color: C.muted }}>
            <li>
              <span style={{ color: C.teal }}>1 · Script prices</span> — strategy.exit(stop=…, limit=…) values are used exactly as your script computes them.
            </li>
            <li>
              <span style={{ color: C.cyan }}>2 · Risk overlay</span> — when the script sets none, the overlay below applies (your explicit choice, never a hidden default).
            </li>
            <li>
              <span style={{ color: C.warn }}>3 · Signal exits</span> — strategy.close / the opposite signal market-closes the position.
            </li>
            <li>
              <span style={{ color: C.label }}>Execution</span> — confirmed bar close (Pine standard, no repaint) · entries fill at the next available price · obeys the EA start/stop and PAUSE NEW ENTRIES switches.
            </li>
          </ul>
        </div>
      </div>

      {/* ── editor ── */}
      <div className="col-span-12 space-y-3 xl:col-span-8">
        <div className="rounded-xl p-3" style={{ background: C.panel, boxShadow: `inset 0 0 0 1px ${C.panelLine}` }}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              value={editor.name}
              onChange={(e) => setEditor((ed) => ({ ...ed, name: e.target.value }))}
              placeholder="Strategy name (shown in the list)"
              className="min-w-[180px] flex-1 rounded-lg px-3 py-2 text-[12.5px] font-semibold outline-none"
              style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}
            />
            <select
              value=""
              onChange={(e) => {
                const t = TEMPLATES.find((x) => x.name === e.target.value);
                if (t) setEditor((ed) => ({ ...ed, source: t.source, name: ed.name || t.name }));
              }}
              className="rounded-lg px-2 py-2 text-[10px] font-bold outline-none"
              style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.cyan }}
              aria-label="Load a starter template"
            >
              <option value="">TEMPLATES…</option>
              {TEMPLATES.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy === "save" || !editor.source.trim()}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[10px] font-extrabold tracking-[0.14em] transition-all disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`, color: "#FFFFFF" }}
            >
              {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              COMPILE & SAVE
            </button>
          </div>

          <textarea
            ref={srcRef}
            value={editor.source}
            onChange={(e) => setEditor((ed) => ({ ...ed, source: e.target.value }))}
            spellCheck={false}
            placeholder={`//@version=5\nstrategy("My Strategy", overlay=true)\n…paste your Pine Script here…`}
            className="halo-scroll w-full rounded-lg p-3 font-mono text-[11.5px] leading-[1.55] outline-none"
            style={{ background: C.deep, border: `1px solid ${C.line2}`, color: "#D7E7FF", minHeight: 380, resize: "vertical", tabSize: 4 }}
          />

          {/* size feedback — long scripts are first-class (commercial packs run 1,500-2,500+ lines) */}
          {(() => {
            const src = editor.source;
            if (!src) return null;
            const lines = src.split("\n").length;
            const chars = src.length;
            const near = lines > MAX_PINE_LINES * 0.9 || chars > MAX_PINE_CHARS * 0.9;
            const over = lines > MAX_PINE_LINES || chars > MAX_PINE_CHARS;
            return (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] tracking-wide" style={{ color: over ? C.red : near ? C.warn : C.muted }}>
                <span>
                  {lines.toLocaleString()} line{lines === 1 ? "" : "s"} · {chars.toLocaleString()} chars
                </span>
                <span style={{ color: C.dim }}>
                  limit {MAX_PINE_LINES.toLocaleString()} lines / {MAX_PINE_CHARS.toLocaleString()} chars — 2,500-line strategy packs compile fine
                </span>
                {over && <span className="font-bold">· TOO LARGE — trim the script before compiling</span>}
              </div>
            );
          })()}

          {/* compile feedback */}
          {compile && (
            <div
              className="mt-2 rounded-lg p-3"
              style={{ background: compile.ok ? A.green(0.08) : A.red(0.07), boxShadow: `inset 0 0 0 1px ${compile.ok ? A.green(0.35) : A.red(0.35)}` }}
            >
              {compile.ok ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={14} style={{ color: C.green }} className="mt-0.5 shrink-0" />
                  <div className="text-[10.5px] leading-relaxed" style={{ color: C.txt2 }}>
                    Compiled cleanly. {activePine?.id === editingId ? "" : "Activate it with TRADE WITH THIS to have the bot auto-trade it."}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <CircleAlert size={14} style={{ color: C.red }} className="mt-0.5 shrink-0" />
                  <div className="space-y-1 text-[10.5px] leading-relaxed" style={{ color: "#FFC9CE" }}>
                    {(compile.fatal ? [compile.fatal] : compile.diagnostics.slice(0, 6)).map((d, i) => (
                      <div key={i}>
                        <span className="font-mono font-bold">
                          L{d.line}:{d.col}
                        </span>{" "}
                        — {d.msg}
                      </div>
                    ))}
                    {compile.diagnostics.length > 6 && <div style={{ color: C.muted }}>+ {compile.diagnostics.length - 6} more…</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* risk overlay + manual signal map */}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg p-3" style={{ boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
              <div className="mb-2 text-[9px] font-extrabold tracking-[0.2em]" style={{ color: C.label }}>
                RISK OVERLAY · USED ONLY WHEN THE SCRIPT SETS NO SL/TP
              </div>
              <div className="flex flex-wrap items-end gap-3 text-[10px]" style={{ color: C.muted }}>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={risk.useSlATR} onChange={(e) => setRisk((r) => ({ ...r, useSlATR: e.target.checked }))} />
                  ATR stop ×
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={risk.slATRm}
                    onChange={(e) => setRisk((r) => ({ ...r, slATRm: Number(e.target.value) }))}
                    className="w-16 rounded px-1.5 py-1 text-center"
                    style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={risk.useSlPts} onChange={(e) => setRisk((r) => ({ ...r, useSlPts: e.target.checked }))} />
                  or fixed points
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={risk.slPts}
                    onChange={(e) => setRisk((r) => ({ ...r, slPts: Number(e.target.value) }))}
                    className="w-20 rounded px-1.5 py-1 text-center"
                    style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  TP (R ×)
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={risk.rrMult}
                    onChange={(e) => setRisk((r) => ({ ...r, rrMult: Number(e.target.value) }))}
                    className="w-16 rounded px-1.5 py-1 text-center"
                    style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg p-3" style={{ boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[9px] font-extrabold tracking-[0.2em]" style={{ color: C.label }}>
                  MANUAL SIGNAL SERIES · FOR INDICATOR SCRIPTS
                </span>
                <button
                  type="button"
                  onClick={() => void applySignalMap()}
                  disabled={!editingId}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[8.5px] font-extrabold tracking-[0.12em] disabled:opacity-40"
                  style={{ background: A.cyan(0.1), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.35)}` }}
                >
                  APPLY MAP
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[9px] font-bold" style={{ color: C.muted }}>
                <div>
                  LONG when
                  <select value={sigMap.longVar} onChange={(e) => setSigMap((m) => ({ ...m, longVar: e.target.value }))} className="mt-1 w-full rounded px-1.5 py-1" style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}>
                    <option value="">— script entry() —</option>
                    {boolChoices.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  SHORT when
                  <select value={sigMap.shortVar} onChange={(e) => setSigMap((m) => ({ ...m, shortVar: e.target.value }))} className="mt-1 w-full rounded px-1.5 py-1" style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}>
                    <option value="">—</option>
                    {boolChoices.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  EXIT when
                  <select value={sigMap.exitVar} onChange={(e) => setSigMap((m) => ({ ...m, exitVar: e.target.value }))} className="mt-1 w-full rounded px-1.5 py-1" style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}>
                    <option value="">—</option>
                    {boolChoices.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* preview */}
        <div className="rounded-xl p-3" style={{ background: C.panel, boxShadow: `inset 0 0 0 1px ${C.panelLine}` }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[9px] font-extrabold tracking-[0.22em]" style={{ color: C.label }}>
              <FlaskConical size={11} /> LIVE PREVIEW · {state.symbol} {state.tf} · REAL MARKET HISTORY
            </span>
            {editingId && (
              <button
                type="button"
                onClick={() => void runPreview(editingId)}
                disabled={busy === "preview"}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[8.5px] font-extrabold tracking-[0.12em] disabled:opacity-50"
                style={{ background: A.white(0.06), color: C.txt2, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}
              >
                {busy === "preview" ? <Loader2 size={10} className="animate-spin" /> : <Copy size={10} />} RE-RUN PREVIEW
              </button>
            )}
          </div>

          {!preview && (
            <div className="flex h-[200px] items-center justify-center rounded-lg text-[10.5px]" style={{ color: C.dim, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}>
              Compile & save a strategy to see its indicator and simulated trades on real {state.symbol} {state.tf} history.
            </div>
          )}

          {preview && !preview.ok && (
            <div className="rounded-lg p-3 text-[10.5px]" style={{ background: A.red(0.07), color: "#FFC9CE", boxShadow: `inset 0 0 0 1px ${A.red(0.3)}` }}>
              {preview.error}
            </div>
          )}

          {preview?.ok && (
            <>
              <PinePreviewChart candles={previewCandles} plots={preview.plots ?? []} markers={preview.markers ?? []} hlines={preview.hlines ?? []} height={340} />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px]" style={{ color: C.muted }}>
                <span>
                  {preview.bars} confirmed bars · feed: <span style={{ color: C.cyan }}>{preview.source}</span>
                </span>
                {preview.stats && (
                  <>
                    <span>· simulated trades: <b style={{ color: C.txt }}>{preview.stats.trades}</b></span>
                    {preview.stats.closed > 0 && (
                      <>
                        <span>· win rate: <b style={{ color: (preview.stats.winRate ?? 0) >= 50 ? C.green : C.red }}>{preview.stats.winRate}%</b></span>
                        <span>
                          · net: <b style={{ color: preview.stats.netPips >= 0 ? C.green : C.red }}>{preview.stats.netPips >= 0 ? "+" : "−"}{Math.abs(preview.stats.netPips).toFixed(1)} pips</b>
                        </span>
                      </>
                    )}
                  </>
                )}
                <span className="ml-auto">Past performance never guarantees future results.</span>
              </div>
              {preview.notes && preview.notes.length > 0 && (
                <div className="mt-2 rounded-lg p-2 text-[9.5px] leading-relaxed" style={{ background: A.warn(0.07), color: C.warn }}>
                  {preview.notes.map((n, i) => (
                    <div key={i}>• {n}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
