"use client";

// ════════════════════════════════════════════════════════════════════════
//  STRATEGY EXPLAINER · why HALO is in its current state (not entered yet)
//  Derived 100% from the live engine snapshot + real config — no invented
//  conditions. Facts: what the engine is doing; missing: what it waits for;
//  invalidators: what would kill the setup; chips: actual config values.
// ════════════════════════════════════════════════════════════════════════

import { Lightbulb } from "lucide-react";
import { A, C, fmtPx, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";

export function StrategyExplainer({ state }: { state: BotStateRes }) {
  const e = state.engine;
  const cfg = state.config;
  const t = e.trade;
  const hasSup = e.levels.some((l) => l.side === 1);
  const hasRes = e.levels.some((l) => l.side === -1);
  const dec = state.mintick >= 0.01 ? 2 : 4;

  // ── RANGE FILTER live check: are the armed support & resistance too close? ──
  const supLv = e.levels.find((l) => l.side === 1);
  const resLv = e.levels.find((l) => l.side === -1);
  const srGapAtr =
    cfg.rangeFilter && supLv && resLv && e.atr && e.atr > 0
      ? Math.abs(supLv.top + supLv.bot - resLv.top - resLv.bot) / 2 / e.atr
      : null;
  const rangeBlocked = srGapAtr !== null && srGapAtr < cfg.rangeSepATR;

  // ── conditions evaluated against REAL state ──
  const met: string[] = [];
  const missing: string[] = [];

  met.push(state.enabled ? "EA engine is ON and watching every bar" : "EA engine is ON standby — market still tracked");
  if (state.feed.source !== "simulator" && !/slow|error|unreachable/i.test(state.feed.note || "")) met.push(`Live feed connected (${state.feed.source})`);
  else missing.push(`Feed degraded (${state.feed.source}) — levels still computed, execution stays honest`);

  if (t) {
    met.push(`C3 fire executed — ${t.dir === -1 ? "SELL" : "BUY"} running from ${fmtPx(t.entry, state.mintick)}`);
    met.push(` Protective SL ${fmtPx(t.sl, state.mintick)} and TP ${fmtPx(t.tp, state.mintick)} attached (1:${cfg.rrMult.toFixed(1)})`);
  } else if (e.levels.length > 0) {
    met.push(`Equal-level zone armed at ${fmtPx(e.levels[0].ext, state.mintick)} (dotted trigger frozen)`);
    missing.push(`Waiting for the C3 break — price must push ≥ ${(cfg.breakATR * (e.atr ?? 0)).toFixed(dec)} beyond the dotted line (${cfg.breakATR}× ATR)`);
    missing.push("Waiting for the return to the level — the retest fires the entry the moment price touches it");
    if (rangeBlocked) {
      missing.push(
        `Range filter ACTIVE — the armed support & resistance are only ${srGapAtr?.toFixed(1)}× ATR apart (< ${cfg.rangeSepATR}× ATR): fires are SKIPPED as ranging until fresh levels further apart form`
      );
    }
  } else {
    missing.push("No fresh C1/C2 pair yet — two candles must form an equal-level zone before anything arms");
    missing.push(`Pair tolerance in force: gap ≤ ${cfg.pairTolATR}× ATR, separation ≥ ${cfg.minSepATR}× ATR`);
  }

  const invalidators = t
    ? ["SL touched — same-bar SL+TP overlap counts as a loss (worst-case rule)", "TP reached — trade closes at 1:" + cfg.rrMult.toFixed(1)]
    : [
        `Level expires after ${cfg.expiryBars} bars of age`,
        "Opposite extreme invalidates (burns) the zone",
        "Levels too close to price stay crowded and are skipped",
        cfg.rangeFilter
          ? `Ranging market with support & resistance closer than ${cfg.rangeSepATR}× ATR — the fire is skipped and fresher levels further out are armed`
          : "Range filter is OFF — tight S/R boxes trade unfiltered",
      ];

  const headline = t
    ? `Managing a live ${t.dir === -1 ? "SELL" : "BUY"} — HALO protects the position, it does not chase it.`
    : e.levels.length > 0
      ? `HALO is monitoring an armed ${hasSup && hasRes ? "support + resistance" : hasSup ? "support" : "resistance"} zone — momentum must prove itself before entry.`
      : "HALO is scanning for a C1/C2 equal-level formation — patience is part of the strategy.";

  return (
    <PanelCard title="STRATEGY EXPLANATION" icon={Lightbulb} accent="gold" className="h-full" bodyClassName="p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#F5CD6B]/90">{headline}</p>
      <p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: C.txt2 }}>
        Bullish/bearish structure is only traded when it ends in an <span style={{ color: C.txt }}>equal-level rejection</span>: the wick line is frozen, broken, and retested — the engine never repaints and never anticipates.
      </p>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
        <CheckList title="Conditions met" tone="met" items={met} />
        <CheckList title="Waiting on" tone="missing" items={missing} />
        <CheckList title="Invalidates setup" tone="invalid" items={invalidators} />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1 border-t pt-2" style={{ borderColor: `${C.lineInner}B3` }}>
        <Chip label={`MODE ${cfg.sigMode.toUpperCase()}`} />
        <Chip label={`SL ${cfg.slMode.toUpperCase()}`} />
        <Chip label={`RR 1:${cfg.rrMult.toFixed(1)}`} />
        <Chip label={`BREAK ${cfg.breakATR}×ATR`} />
        <Chip label={`EQ TOL ${cfg.eqTolATR}×ATR`} />
        <Chip label={`EXPIRY ${cfg.expiryBars}b`} />
        <Chip label={cfg.rangeFilter ? `RANGE FILTER ${cfg.rangeSepATR}×ATR` : "RANGE FILTER OFF"} />
      </div>
    </PanelCard>
  );
}

function CheckList({ title, tone, items }: { title: string; tone: "met" | "missing" | "invalid"; items: string[] }) {
  const color = tone === "met" ? C.green : tone === "missing" ? C.cyan : C.red;
  const glyph = tone === "met" ? "✓" : tone === "missing" ? "○" : "✕";
  if (items.length === 0) return null;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em]" style={{ color }}>
          {title}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className="flex gap-1.5 text-[9.5px] leading-snug" style={{ color: C.txt2 }}>
            <span className="shrink-0 font-bold" style={{ color }}>
              {glyph}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 font-mono text-[8.5px] font-bold tracking-wider"
      style={{ borderColor: A.gold(0.35), background: A.gold(0.07), color: C.gold }}
    >
      {label}
    </span>
  );
}
