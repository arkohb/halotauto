# Decision B — Trading price guard and execution-price protection

**Status:** awaiting your decision. Nothing in this document has been implemented. None of the options changes the 3EL strategy rules — they only decide **whether an order may be sent** when the price data is untrustworthy.

## The problem (verified in the audit)

- The server falls back to a built-in **market simulator** when a live feed is unreachable, and **Deriv synthetic indices are always simulated** on the server (Deriv's feed isn't used server-side).
- The bot, scanner, sweep and Pine bot can fire orders from those candles — including **live** broker orders. The test database already contains sweep trades on V30/V50S made from simulated candles.
- When a feed is slow, the bot keeps going on **cached** candles ("Feed slow — using cached candles").
- Nothing compares the strategy's entry price with an independent live quote before sending the order.

All order paths pass through one function, `executeFire()` (bot, scanner, sweep, Pine), plus the TradingView webhook path — so a guard can be enforced in two places.

## Options

### B1 — Block orders on simulated data (source guard)
Refuse any order when the feed that produced the signal is `simulator`.
- **Security:** removes the most serious failure (real orders from invented prices).
- **Effect:** Deriv synthetics can no longer trade until a real server-side Deriv feed exists.
- **Effort:** small — the feed source is already known per symbol.

### B2 — Block orders on stale data (freshness guard)
Refuse when the newest candle/tick used is older than a limit (e.g. 2 × the poll interval for intrabar signals, or more than one bar for bar-close signals).
- **Security:** prevents trading on frozen prices after outages.
- **Effect:** occasional refused signals during feed hiccups (announced, never silent).
- **Effort:** small.

### B3 — Execution-price deviation guard
Before sending, compare the signal's entry with an independent current quote (the broker's own quote where the adapter provides it, else the live feed). Refuse if the gap exceeds a limit (e.g. 0.5 × ATR or a fixed number of pips per market). After the fill, record slippage (fill vs intended).
- **Security:** catches wrong-symbol mapping, bad ticks and large gaps.
- **Effect:** needs per-market thresholds; one extra broker call per order (latency).
- **Effort:** medium; depends on what each broker adapter exposes.

### B4 — Real server-side Deriv feed
Add a server-side Deriv websocket client so synthetics use real ticks.
- **Effect:** lets Deriv synthetics trade again under B1.
- **Effort:** medium; needs Deriv's service reachable from the host (it returned HTTP 520 during Phase 2 testing).

### Paper vs live
- **Live:** guards must fail closed (no order).
- **Paper:** either the same (cleanest records) or allow but label the trade "simulated price" so it never appears as real performance.

## Recommendation

**B1 + B2 now, enforced in `executeFire()` and the TradingView webhook path, fail-closed for live and paper; B3 for live mode next; B4 only if Deriv synthetics are part of the product.** Every refusal is announced (alert + voice) with the reason, and recorded, like the existing Capital Guardian refusals.

## Tests required

1. Force the simulator (block outbound feeds in the test environment) → signals still appear, **no order** is placed, refusal announced and logged.
2. Stale feed (freeze candles beyond the limit) → refused; resumes when fresh.
3. Deriv synthetic symbol → refused under B1 (until B4).
4. Deviation (B3): inject a quote far from the entry → refused; normal quote → order sent.
5. Engine regression tests unchanged (proves no strategy change); EDGE self-test; backtests unaffected (backtests already reject simulator data).
6. MT5 **demo**: real order flow still works with fresh real prices.
