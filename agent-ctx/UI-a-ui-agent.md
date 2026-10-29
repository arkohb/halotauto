# UI-a · Visual-only refactor of 6 HALO dashboard components

Task ID: **UI-a** · Scope: chrome migration to HALO design system + honest states + token alignment. Zero behavior changes intended.

## Files touched (only these)

1. `src/components/halo/market-pulse.tsx`
2. `src/components/halo/status-banner.tsx`
3. `src/components/halo/daily-briefing.tsx`
4. `src/components/halo/scanner-panel.tsx`
5. `src/components/halo/strategy-radar.tsx`
6. `src/components/halo/control-deck.tsx`

## What changed per file

### market-pulse.tsx (already PanelCard → token alignment)
- Feed-source chip in header `right` → `<Pill tone={fresh ? "ok" : "gold"} pulse>` (text `state.feed.source.toUpperCase()` verbatim).
- Change badge `rgba(8,153,129,.14)/rgba(242,54,69,.14)` → `A.green(0.14)/A.red(0.14)`.
- Ad-hoc hexes → tokens: `#6B7A94`→`C.label`, `#16263F`/70→`${C.lineInner}B3`, MiniStat `border-[#16263F] bg-[#0B1426]/70`→`C.lineInner`/`${C.navy}B3`.
- KEPT: `#F5D778` luminous-gold price + `rgba(212,175,55,0.30)` glow (no exact C token exists; color also used in non-assigned files header.tsx / strategy-explainer.tsx — changing it here would desync the brand gold).

### status-banner.tsx (tone-driven banner → tokens only)
- `border-[#1C2A47]` → inline `borderColor: C.line`. Tone-driven bg/fg still come from `toneClasses()` in ui-helpers (NOT an assigned file — untouched). No PanelCard migration: the banner is a full-width tone-colored strip, PanelCard chrome would break its role.

### daily-briefing.tsx (already PanelCard → token alignment)
- `#4FD8FF`→`C.cyan`; `#6B7A94`→`C.label`; `#E8ECF4`→`C.txt`; `#B8C2D6`→`C.txt2`; `#8C98AE`→`C.muted`.
- Level chips `rgba(242,54,69/8,153,129, .4/.07)` → `A.red/A.green(0.4/0.07)`.
- Quote box `border-[rgba(212,175,55,.3)] bg-[rgba(212,175,55,.06)]` → `A.gold(0.3)/A.gold(0.06)` (kept `#F5D778` text, same reason as above).
- Account-status chip → `<Pill tone={live ? "err" : "ok"}>` — text "LIVE ROUTING"/"HEALTHY · PAPER" verbatim.
- All disclosure/session/outlook strings verbatim.

### scanner-panel.tsx (full PanelCard migration + honest states)
- 3 hand-rolled boxes → PanelCards:
  - header card → `PanelCard title="MULTI-SYMBOL SCANNER" icon={ScanSearch} accent="cyan"`, SCAN NOW Button in `right` (classes unchanged), subtitle + 4 stat chips in body.
  - add-symbol card → `PanelCard title="ADD SYMBOL" icon={ListPlus} accent="gold"` (card had no header before; header added by PanelCard chrome).
  - table card → `PanelCard title="WATCHLIST" icon={Table2} accent="cyan"`; table untouched structurally (11 cols, switches, remove AlertDialog, aria-labels verbatim).
  - footnote card stays a plain inner note div, token-aligned (`C.line`/`C.navy4`/`C.muted`).
- Chips (SYMBOLS/ACTIVE/AUTO-TRADE/SIGNALS) → `StatCell` (layout-compatible tile).
- STATUS column text → `Pill` via `statusTone()` color-preserving map: RUNNING/ERROR→err, C3 WATCH→gold, PAUSED/WARMING→muted, default→ok. Row error line kept under it.
- Honest states from EXISTING data only:
  - new `err` boolean set inside the previously-swallowed `catch {}` of `load()`; cleared on success.
  - new `loaded` boolean (first load attempt completed) via `finally`.
  - `err && hasRows` → full `StateFrame state="error" hint="Feed unreachable — showing last known watchlist. Retry to refresh." onRetry={load}` ABOVE the table (table stays visible).
  - `err && !hasRows` → same StateFrame replaces the table.
  - `!loaded && no rows` → `StateFrame state="loading" compact` in the empty-row slot; original empty text kept for genuinely empty watchlist after load.
- Table chrome: row divider `#141F38`→`C.divider` (inline borderBottomColor), hover `#101C33`→`C.navy2` via `--row-hov` CSS var + `hover:bg-[var(--row-hov)]` (token value, variant-safe). Selects/AlertDialog/Button classes untouched (kept "exactly" per spec).

### control-deck.tsx (PanelCard chrome, aria-safe)
- Outer section → `<section aria-label="Dashboard control deck" className="mb-4">` wrapper PRESERVED (tests depend on the exact aria-label) wrapping `PanelCard title="CONTROL DECK" icon={Zap} accent="gold"`; old "⌁ CONTROL DECK" text span replaced by PanelCard header (sanctioned by spec title "CONTROL DECK").
- NET/WIN/RUN/MODE inline `Stat`s → `StatCell` ×4 in `right`, same values/colors, same `hidden md:flex` responsiveness. `Stat` helper deleted.
- New `scanErr` flag: set in existing `.catch(() => {})` of the 15s `/api/scanner` badge poll, cleared in `.then` (alive-guarded). Renders `<StateFrame state="offline" title="Scanner badge unavailable" compact />` between header and tile grid — tiles never replaced.
- `tileStyle()` emits tokens: `rgba(242,54,69,.55)`→`A.red(0.55)`, `rgba(212,175,55,.55/.7)`→`A.gold(0.55/0.7)`, `#1C2A47`→`C.line`, `#16233D`→`C.navy3`, `rgba(242,54,69,.07)`→`A.red(0.07)`, `#101C33`→`C.navy2`. Dot `#5D606B`→`C.dim`.
- LIVE-routing strip → `A.red(0.4)`/`A.red(0.1)` borders/bg. All 8 tiles, 3 AlertDialogs, confirm flows, aria-labels, `DeckView`/`TileNode` exports untouched.

### strategy-radar.tsx (tokens only, no logic)
- Chrome `#1C2A47`→`C.line`, `#0F1A30`→`C.navy4`, `#2A3A5C`→`C.line2`, `#0B1426`/80→`${C.navy}CC`, /40→`${C.navy}66`, `#16263F`→`C.lineInner`, `#0D1730`/80→`${C.panel}CC`, text hexes→`C.txt/C.txt2/C.muted/C.label`.
- SVG stops/strokes `rgba(79,216,255,x)`→`A.cyan(x)` (exact); `rgba(140,152,174,0.75)`→`${C.muted}BF`; `rgba(11,20,38,α)`→`${C.navy}40/00` (same RGB, hex-alpha).
- NOT touched: `halo-radar-sweep`/`is-live`/`halo-radar-ping` classes, sweep logic, blip math, all aria-labels, `#5D6B85` (no token match), `focus-visible:ring-[#4FD8FF]` (Tailwind variant class, value = C.cyan).

## Verification (actual output)
```
$ bunx eslint <6 files>  → ESLINT: CLEAN (exit 0, no output)
$ bunx tsc --noEmit | grep -E "market-pulse|status-banner|daily-briefing|scanner-panel|strategy-radar|control-deck"
  → (empty, grep exit 1 = no matches)
```
Full tsc has 7 pre-existing errors, all in `scripts/` and `skills/` (out of scope, untouched). Dev server: `GET / 200`, all polls 200, `✓ Compiled` — no runtime errors after edits.

## Notes for next agents
- `#F5D778` (luminous gold) and `#FF4B59`/`#FF4D5B` (red hovers) are NOT in the C token set — left verbatim. If the design system grows a `luminousGold` token, migrate market-pulse/daily-briefing/header/strategy-explainer together.
- `toneClasses()` in `src/lib/halo/ui-helpers.ts` still contains hardcoded hexes (e.g. `#2A2410` wait-bg, `#FFD9DC`/`#C8F5E8` run fgs) — ui-helpers was not in my file list.
- control-deck `tileClass()` keeps Tailwind hex classes (`ring-[#D4AF37]/70`, `hover:bg-[#16233D]`) because focus/hover variants can't be inline styles — values equal tokens.
- Scanner row hover uses an inline `--row-hov` CSS var so the hover color is token-driven without touching globals.css.
