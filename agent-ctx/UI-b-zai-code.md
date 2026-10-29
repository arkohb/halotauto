# UI-b — Visual-only refactor of 5 HALO backtest/performance components

**Agent:** Z.ai Code · **Date:** session log · **Task ID:** UI-b
**Scope:** ONLY the 5 assigned files. Zero logic, export, aria-label, copy, or responsive-grid changes.

## Files touched (all under /home/z/my-project/src/components/halo/)

### 1. backtest-panel.tsx (rewritten chrome)
- Hand-rolled `rounded-xl border border-[#1C2A47] bg-[#0F1A30]` boxes → `PanelCard`:
  - Config card → accent **gold**, icon `FlaskConical`, title "BACKTEST DASHBOARD"; header badges → `Pill tone="ok"` + `Pill tone="gold"`; tagline "wick-line break → return · same live engine" moved to a right-aligned body caption (PanelCard header can't flex-wrap; avoids mobile clipping).
  - Equity card → accent **cyan**, `LineChart`, final-pips value into `right`.
  - Profitability card → accent **cyan**, `BarChart3`.
  - Trade log → accent **cyan**, `Table2`, dynamic title string preserved 1:1, "conservative" note into `right`.
- Native `<select>` ×2 → shadcn `Select` (same pattern as header.tsx/scanner-panel): `value`/`onValueChange` wired to the SAME `symPick`/`btTf` setters; exact same option lists (SYMBOLS by group, `t.label`, CUSTOM item). Draft-state contract verified live in browser: picking CUSTOM reveals the ANY TICKER input with the preserved draft; picking a preset hides it.
- `Kpi` kept as a component, restyled via tokens (border `C.line`, bg `C.navy`, label `C.muted`).
- Badges → Pill (ok/gold/muted). Refusal banner → `StateFrame state="error"` with the exact message as `title`, `hint=""` (no invented copy). Equity-curve empty state → `StateFrame compact` (copy verbatim). Table empty row kept as `<td>` (token color only).
- SVG equity curve + trade log table kept; colors only via tokens (`C.line2` zero line, `C.line`/`C.navy` svg box, `C.navy2` sticky head, `C.divider` row borders, `C.muted`/`C.txt` cells).
- Bar-preset buttons: hex/rgba literals → `C.gold`/`C.line2`/`C.muted`/`A.gold(0.1)`.
- Deliberately untouched: shadcn `Input` className hexes (focus-state interplay, codebase convention), `#4A5878` (no matching token), RUN Button gold classes (inline style would break hover:bg).

### 2. backtest-live.tsx (PERF-CRITICAL — minimal chrome-only edits, 12 edits)
- JS-string hex/rgba literals → tokens ONLY: `bannerStyle()` (A.gold/A.green/A.red + `C.gold`, `#2A3A5C`→`C.line2`), chart `grid` colors `"#121D35"`→`C.divider`, `priceLineColor "#5D606B"`→`C.dim`, error box → `A.red(0.5)/A.red(0.1)`, bar-preset & speed buttons → `C.gold/C.line2/C.muted/A.gold(0.1)`, progress gradient → `linear-gradient(90deg,${C.goldDim},${C.gold})`, open-trade box borders → `A.red(0.45)/A.green(0.45)`.
- Ad-hoc badges → `Pill` (5 swaps: header ok+gold, strip gold/ok/muted, done chip gold). Import added: `Pill` from `@/components/halo/panel`, `A` from ui-helpers.
- NOT touched (deliberate): all Tailwind className hexes (value-identical to tokens; class→style swaps would touch dozens of nodes + focus/hover states — against "minimal"), `#E9CB5B`/`#AEB9D6`/`#5D6B8C`/`#4A5878` (no identical tokens), `rgba(15,26,48,0.9)` (navy translucency has no A helper), `sideColor()` rgb triplets + zone-rect rgba composition (chart engine internals). Chart engine, transport controls, frame loop, refs: untouched.

### 3. dashboard-panel.tsx (Pine mirror harmonized)
- Outer chrome → `PanelCard title="◆ HALO 3EL · EQUAL LEVEL REJECTION"` icon `Table2`, accent **gold** (replaces the 2px gold border; gold accent edge keeps it recognizable).
- 18-row zebra kept, colors now token-driven: container inline CSS vars `--zA: C.navy`, `--zB: C.navy2` (same `["--x" as string]` pattern panel.tsx uses); rows use `odd:bg-(--zA) even:bg-(--zB)` — DOM-sibling parity (status strip between rows 1/2) preserved exactly. Verified computed: row1 rgb(11,20,38), row3 rgb(16,28,51) — identical to before.
- Status strip (`toneClasses`) untouched; all 17 label:value pairs verbatim. Footer strip color → `A.gold(0.7)`.
- Note: pre-existing unused `const pip` kept (was in original; lint passes).

### 4. performance-intel.tsx
- Inner hexes → tokens: `#6B7A94`→`C.label` (3 spots), box `border-[#16263F] bg-[#0B1426]/70` → `C.lineInner` + `${C.navy}B3`, Sparkline `#089981/#F23645/#1C2A47` → `C.green/C.red/C.line`.
- "Loading book…" and "No closed trades yet…" → `StateFrame compact` (loading/empty), copy verbatim. Sparkline + PanelCard structure unchanged.

### 5. strategy-explainer.tsx
- Already PanelCard — accent stays **gold** (matches gold headline/chips; the task's "ice-like → cyan" applied to the `#4FD8FF` "missing" color → `C.cyan`, value identical).
- Inner tokens: `#B8C2D6`→`C.txt2` (×2), `#E8ECF4`→`C.txt`, chips → `A.gold(0.35)/A.gold(0.07)/C.gold`, divider `border-[#16263F]/70` → `${C.lineInner}B3`.
- Left untouched: `text-[#F5D778]/90` headline (no identical token; per "if unsure, don't change"). All copy/steps/conditions verbatim.

## Verification (actual output)
1. `bunx eslint src/components/halo/backtest-panel.tsx src/components/halo/backtest-live.tsx src/components/halo/dashboard-panel.tsx src/components/halo/performance-intel.tsx src/components/halo/strategy-explainer.tsx` → **exit 0, zero output (clean)**.
2. `bunx tsc --noEmit 2>&1 | grep -E "backtest-panel|backtest-live|dashboard-panel|performance-intel|strategy-explainer"` → **empty** (only pre-existing errors in `scripts/` + `skills/`, unrelated).
3. Tailwind v4 compiled CSS contains `.odd\:bg-\(--zA\):nth-child(odd){background-color:var(--zA)}`.
4. Live browser smoke test (headless): app loads, no console/page errors; Strategy Lab shows PanelCard region "BACKTEST DASHBOARD" + both shadcn comboboxes with identical labels; CUSTOM → ANY TICKER input toggle works; Performance tab Pine card: title verbatim, zebra vars `#0B1426`/`#101C33`, parity unchanged; Strategy card: 6 gold chips rgba(212,175,55,0.35/0.07), "Waiting on" rgb(79,216,255); backtest header Pills present. `GET /` → 200.

## Behavior guarantees
No changes to: fetch payloads/URLs (`/api/backtest`, `/api/backtest/live`, `/api/trades`), draft state setters, seq-guard logic, engine/replay/frame-loop code, exported names, aria-labels (only added PanelCard's built-in `aria-label`/`role=status` on new chrome), text strings, responsive grid classes.
