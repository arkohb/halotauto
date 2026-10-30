# STRATEGY STUDIO — Pine Script → Indicator → Auto-Trading

*The commercial feature: traders paste their own Pine Script v5, HALO compiles it
into a real indicator on the chart, and the bot auto-trades its signals through
the same execution path as the built-in 3EL engine.*

---

## 1 · What a trader does

1. Open **Strategy Studio** (nav rail → COMMAND).
2. **NEW** → paste a Pine Script v5 `strategy()` or `indicator()` script, or pick one of the five starter templates (EMA Cross, RSI Reversion with SL/TP, MACD, Supertrend, Bollinger Mean Reversion).
3. **COMPILE & SAVE** — the script is compiled and validated server-side. Errors are reported with `line:col` and a human explanation; nothing silently half-works.
4. Inspect the **live preview**: the compiled indicator is drawn over **real market history** (the same feed the EA trades) with a simulated trade list, win rate and net pips. Past performance disclaimer always shown.
5. Hit **TRADE WITH THIS** → the bot now auto-trades that strategy. The list keeps every named strategy; exactly ONE is active at a time.
6. The **Dashboard / Market Intelligence chart** renders the indicator live (plot lines + buy/sell markers) with a green `PINE · <NAME>` badge.

### Signal → order mapping (honest, no invented risk)

| What the script provides | What the bot does |
| --- | --- |
| `strategy.entry("L", strategy.long)` | Market order in that direction at the next available price after the confirmed bar close |
| `strategy.exit(stop=…, limit=…)` | Those exact prices become the order SL/TP |
| No `strategy.exit` prices | The **risk overlay** chosen in the studio (ATR× or fixed-points stop + R-multiple TP) — the trader's explicit choice, never a hidden default |
| `strategy.close` / `close_all` / opposite signal | Market close, result booked honestly |

**Execution rules:** confirmed-bar evaluation only (Pine bar-close standard — no repaint), entries fill at the next available price, orders route through the SAME `executeFire()` path as the built-in engine (PAPER book or the active CFD broker with sizing + SL/TP + alerts), and the EA **START/STOP** and **PAUSE NEW ENTRIES** operator switches are obeyed exactly.

### Script size — long strategies are first-class

The compiler accepts up to **8,000 lines / 1,000,000 chars** per script (a live counter under the editor shows both). Commercial indicator packs routinely run 1,500–2,500 lines; a generated 2,492-line / 80K-char strategy compiles in ~200 ms, previews over 600 real bars in single-digit seconds, and evaluates each NEW bar in ~20 ms (the live tick) — verified in `scripts/pine-longscript-test.ts` and `scripts/pine-long-live-test.ts`. Safety valves for pathological input: expressions nested deeper than 400 levels, loops beyond 20,000 iterations, or any single bar evaluating longer than 10 s fail with a friendly `line:col` error — never a hang, never a stack crash.

**Indicator-only scripts** (no `strategy.*` calls) still compile and chart. To auto-trade them, map which boolean series is LONG / SHORT / EXIT in the *Manual signal series* panel — the compiler lists every eligible boolean variable.

### Single-active-strategy semantics

While a Pine strategy trades, the built-in 3EL engine stays armed for levels and charting but **its fires are not executed** (alerted honestly, never dropped silently; it cannot even arm a phantom trade). Deactivate to restore 3EL auto-trading. Editing an ACTIVE strategy to a broken source deactivates it automatically — the bot never trades a script that no longer compiles.

---

## 2 · Supported Pine subset

The compiler is a real lexer → parser → bar-by-bar evaluator (Pine series semantics, `var` carry, `x[n]` history, tuples, user functions, arrays, `na` propagation, Pine's next-bar-open fill model, conservative stop-first intrabar SL/TP).

**Supported:** `ta.*` — sma ema wma rma vwma hma rsi macd atr tr stdev dev variance bb bbw stoch highest lowest change mom roc crossover crossunder cross cum vwap wpr cci mfi obv linreg supertrend sar pivothigh pivotlow valuewhen barssince rising falling median percentrank sum · `math.*` `str.*` `array.*` `input.*` (incl. `options=[…]`) · `strategy.entry/exit/close/close_all/cancel*` · `plot / plotshape / plotchar / plotarrow / hline / bgcolor / barcolor / fill` · `alert / alertcondition` (captured as HALO status alerts) · drawing objects (`line/label/box`) execute for script logic but are **not rendered** (noted honestly at compile) · `barstate / syminfo / timeframe` constants.

**Not supported (clear errors, exact line):** `request.*` / `ticker.*` (external data — the compiler works offline on the chart feed), libraries/imports, UDTs (`type`), `switch`, `method` declarations. Unknown functions/identifiers are caught at compile time with suggestions.

Proof bar: **the app's own 3EL Pine EA template** (`src/lib/pine-ea.ts`) compiles and fires trades in the compiler's test suite (`scripts/pine-compiler-test.ts`, 47 checks).

---

## 3 · Commercial licensing (one-time payment)

- **Owner mode (default):** `HALO_LICENSE_SECRET` unset → no gate, app behaves exactly as before. This is the seller's own instance / dev mode.
- **Licensed mode:** set `HALO_LICENSE_SECRET=<your secret>` in the environment. Consequential endpoints (bot control, bot config, strategy create/edit/delete/activate) return **HTTP 402** until activation; read-only views stay browsable for demos. The UI shows a full-screen **ACTIVATE HALO** screen (key + e-mail).

**Selling a copy:**

```bash
HALO_LICENSE_SECRET=<your secret> bun scripts/license-mint.ts --holder "buyer@email.com"
# →  Key : HALO-XXXX-XXXX-XXXX-XXXX
```

Send key + e-mail to the buyer; they enter it once. Keys are deterministic per holder (re-minting re-issues the same key) and verified with HMAC-SHA256 + timing-safe compare. A stored activation re-verifies against the holder on every boot — owner-mode records never unlock a licensed deployment, and a wrong holder/e-mail is rejected. Activation is permanent for that installation (stored in its own DB).

---

## 4 · Architecture map

| Piece | File |
| --- | --- |
| Pine lexer / parser / runtime / compiler | `src/lib/pine/lexer.ts`, `parser.ts`, `runtime.ts`, `compile.ts` |
| Auto-trade runtime (selection, warming, execution) | `src/lib/pine-bot.ts` |
| Selection leaf module (no import cycles) | `src/lib/strategy-select.ts` |
| Compile + persist helpers | `src/lib/strategy-store.ts` |
| API: list/create · read/update/delete · activate · preview | `src/app/api/strategies/**` |
| License lib + API + mint CLI | `src/lib/license.ts`, `src/app/api/license/route.ts`, `scripts/license-mint.ts` |
| Strategy Studio UI | `src/components/halo/strategy-studio.tsx` |
| Preview chart | `src/components/halo/pine-preview-chart.tsx` |
| Chart overlay (plots + markers + badge) | `src/components/halo/chart-panel.tsx` (`pineStrategy` prop) |
| Activation screen | `src/components/halo/license-gate.tsx` |
| Voice: `list_strategies`, `select_strategy` + navigation | `src/lib/halo/actions.ts`, `src/lib/halo/operations.ts`, `src/app/api/halo/brain/route.ts` |

**Untouched by design:** the 3EL strategy engine (`src/lib/halo/engine.ts` — ARMED→BROKEN→RETEST→FIRE), the broker adapters, and the order logic in `execution.ts` (custom strategies *call* it; nothing inside it changed).

## 5 · Tests (all green at ship time)

- `bun scripts/pine-compiler-test.ts` — **47/47**: templates compile, signals fire on synthetic candles, Pine next-bar-open fill model, SL/TP from `strategy.exit`, MACD/Supertrend tuples, manual signal capture, honest errors, the 3EL EA template itself.
- `bun scripts/strategies-e2e.ts` — **42/42** against the live app: CRUD, preview over real XAUUSD history, activation + single-active semantics, broken-source deactivation, delete-restore, license mint/verify/reject, voice registry wiring.
- Browser E2E (agent-browser): template → compile → save → activate → chart badge + EMA overlay rendering → restore built-in; license gate screen → UI activation → unlock. No console errors.
