# HALO 3EL: production-readiness audit (Section 25, first pass)

**Date:** 7 Nov 2026 · **Branch:** `feature/halo-edge-firebase-cloudflare` @ `023369c` · **Scope:** this repository.
**Status:** first pass, with the baseline in §8. No application behaviour was changed for this audit. Two test files were added or fixed (§8).

The levels below mean exactly what the brief defines: IMPLEMENTED (source exists), TESTED (automated or manual tests passed), INTEGRATION VERIFIED (the real external service), DEMO VERIFIED (a real broker demo account), PRODUCTION VERIFIED (the production environment). **Nothing in HALO is DEMO or PRODUCTION VERIFIED yet.**

## 1. Current-state architecture

- **App:** Next.js 16 (App Router), React 19, TypeScript. 82 API routes, 10 pages. `src/proxy.ts` is the gate in front of every page and route. It sets the nonce CSP, checks request origins (CSRF) and checks that a session cookie exists. Real authorisation happens server-side in each route (`src/lib/api-guard.ts`, `commerce/auth`, `license.ts`).
- **Data:** Prisma 6 on SQLite (`db/custom.db`), 30 models. A Postgres switch exists for hosting (`scripts/deploy/prisma-provider.mjs`).
- **Signal engines:** all run inside the Next server process.
  - `lib/halo/engine.ts`: the 3EL strategy.
  - `lib/bot.ts`: the chart bot.
  - `lib/scanner.ts`, `lib/sweep.ts`: the Market Scanner and all-pairs scanner.
  - `lib/tf-scanner.ts`: the multi-timeframe scanner (signals only).
  - `lib/pine-bot.ts` with `lib/pine/*`: Strategy Studio.
- **Order path.** Every path converges on `executeFire()` in `lib/execution.ts`, except the TradingView webhook (`lib/tv-webhook.ts`), which runs the same steps itself. In order:
  1. **Price guard** (`lib/price-guard.ts`).
  2. **EDGE gate** (`lib/edge/gate.ts`): filters, prop rules, quality score, Capital Guardian.
  3. **Persistent execution lock** (`lib/exec-lock.ts`, with the in-memory `lib/trade-lock.ts`).
  4. **Paper book or broker adapter** (`lib/brokers/*`).
- **Market data:**
  - `lib/market.ts`: OANDA practice when configured, otherwise Yahoo (unofficial), with simulator fallback for display only.
  - Binance for crypto; Deriv websocket (currently down) and OANDA SSE relay in the browser (`lib/halo/live-feed.ts`).
- **Brokers:** MetaApi (MT4/5), OANDA, IG, Binance, paper, webhook/FXCM/cTrader/Deriv bridges, and the HALO Bridge EA (`lib/brokers/mt5-ea.ts` with `mt5/HALO_Bridge.mq5`).
- **Commerce:** Paystack and Flutterwave webhooks, licences and device slots (`lib/commerce/*`, `lib/license.ts`).
- **Assistant:** Claude-backed "brain" (`api/halo/brain`, `api/halo/assistant`), browser speech, and a neural TTS route (`api/halo/tts`, currently failing: missing `.z-ai-config`).
- **Journal:** `lib/journal/*`, including MT5 history import (MetaApi only) and the HALO trade sync (`halo-sync.ts`).

## 2. Feature inventory (verified status)

| Feature | Status | Evidence / gap |
|---|---|---|
| 3EL engine, armed levels, C3 entry, fixed SL/TP, range filter | TESTED | `test-break-return-engine`, `level-lifecycle-test`, `range-filter-test` |
| Scanners (Market, all-pairs, multi-timeframe) | IMPLEMENTED | Seen running in-app; no automated tests. Simulated markets now produce signals only |
| Strategy Studio / Pine | TESTED (compiler, 1 failure) | `pine-compiler-test` 41/42: **HALO's own built-in 3EL Pine EA template fails in HALO's Pine engine (`timenow` unsupported, line 70)**. It still works in TradingView. `barstate` is unsupported too (seen on a user script). The engine is strategy code, so it isn't changed without approval |
| Backtest | IMPLEMENTED | `verify-backtest` exists; no regression suite in the baseline |
| Paper trading | TESTED (manual) | Seen end-to-end in this session |
| One-trade lock (DB, survives restart) | **TESTED** | `exec-lock-concurrency-test` (21/21): 50 simultaneous orders → 1 winner; 8 separate processes × 10 → 1 winner; uncertain orders keep the lock; restart recovery for PENDING, UNCERTAIN and SUBMITTING; "not executed" resolution creates no trade; full event audit trail |
| Uncertain-order handling | **TESTED** (simulated EA) | Never resent. Reconciled **by HALO's order id** at restart, every 60 s, and on a Super Admin re-check: MetaApi (positions + history orders by `clientId`), OANDA (`orders/@<id>`), HALO Bridge EA (id stamped as the MT5 comment). Other brokers only recover a HALO-tagged position. Filled-and-closed releases the lock without inventing a result; "absent" is trusted only after 60 s. Every attempt is logged. **Admin → Execution** page shows the lock, each uncertain order with its full trail and Super Admin re-check / resolve buttons (confirmation dialogs; audit-logged). Not yet run against a real broker |
| Price guard (simulated, stale, invalid, deviation) | TESTED | `price-guard-selftest`. Covers `executeFire` (bot, scanners, sweep, Pine) and the webhook. The deviation threshold is unset, so **every live order is refused** |
| Spread / slippage guard | TESTED (unit) | `edge-filters-prop-test`. Not yet run against a broker quote. One % of stop limit covers all markets; **no per-instrument limits** |
| HALO EDGE (quality, manager, Guardian, autopilot) | TESTED (unit) | `edge-selftest` |
| Prop-firm equity rules | TESTED (unit) | Live account only; not run against a broker |
| News blackout / session filter | TESTED (unit) | **Built at the user's request before this brief.** Off by default. The brief asks for separate approval for news blocking: it remains off until approved |
| Charts (CURRENT / ALL LEVELS, signal labelling) | TESTED (manual) | Checked in-app |
| OANDA practice feed | IMPLEMENTED | Not configured (no keys) → not INTEGRATION VERIFIED |
| Yahoo data | IMPLEMENTED | **Unofficial, not licensed for a commercial product** |
| MetaApi | Auth INTEGRATION VERIFIED (token HTTP 200) | Account creation blocked by MetaApi billing; no orders |
| OANDA / IG / Binance adapters | IMPLEMENTED | Not verified against the services this session |
| HALO Bridge EA | TESTED (simulated EA, 17 checks) | **Never compiled or run in MT5** |
| Journal (incl. bot trades in pips) | TESTED (API, manual) | 19 HALO trades synced. One bad +2,933-pip test record (awaiting decision) |
| Auth, sessions, licence, device slots | IMPLEMENTED + TESTED in Phases 1–5 | See `PHASE*-REPORT` docs |
| **Super Admin 2FA** | **ABSENT** | Only a UI OTP component exists |
| Rate limiting | PARTIAL | Auth, licence and checkout routes only. **AI, backtest, autopilot and scanner routes have none** |
| Credential encryption (AES-256-GCM) | TESTED | `secret-box-selftest`; real DB migrated 5/5 |
| Webhook replay protection | TESTED (Phase 3) | |
| Paystack / Flutterwave | IMPLEMENTED (+ stub tests in Phase 5) | **No sandbox credentials → not INTEGRATION VERIFIED** |
| Voice assistant | IMPLEMENTED | Neural TTS broken (missing config); the browser voice fallback works |
| Monitoring (Sentry, heartbeat, uptime) | **ABSENT** | Telegram, e-mail and push alerts exist |
| Backups / DR | MANUAL | Backups exist (`db/backup-pre-*.db`, `~/HALO-backups`); no automation, no restore test |

## 3. Confirmed achievements

Verified directly in this session:
- **Execution:** the persistent lock and its restart reconciliation; the price guard across all order paths.
- **Security:** credential encryption; git history scrubbed (0 old secrets found in history).
- **Journal:** bot trades sync into it; stuck paper trades are settled or voided.
- **Charts:** signal and traded labelling.
- **Market data:** Yahoo request rationing; gold back on real data.
- **New features:** the EA bridge server side, the EDGE prop and spread guards, and the news and session filters, all at unit level.

## 4. Incomplete or unverified

- **Brokers:** every broker execution path, the EA in MT5, and OANDA, IG and Binance orders.
- **Payments:** both sandboxes.
- **Admin:** 2FA.
- **Platform:** rate limits on expensive routes; monitoring; automated backups and restore tests; Postgres; hosting.
- **Market data:** a licensed source.
- **Legal:** terms, privacy policy and risk disclosure.
- **Voice:** fix or remove the neural engine.
- **Execution:** reconciliation by order reference, per-instrument spread limits, and an automated concurrency test.

## 5. Critical and high-severity issues

| Sev | Issue |
|---|---|
| CRITICAL (launch) | No execution path verified on a real demo broker (EA uncompiled; MetaApi unfunded) |
| CRITICAL (launch) | Market data is Yahoo (unlicensed) unless OANDA is configured; futures vs spot mismatch with brokers |
| ~~HIGH~~ fixed | Uncertain orders are now reconciled by broker order reference (see §2) |
| ~~HIGH~~ fixed | MetaApi order comment + client id was 34–36 chars against MetaApi's documented 26-char limit (orders at risk of rejection or a truncated id). The id is now 15 chars and the comment is trimmed to fit |
| HIGH | No Super Admin 2FA |
| HIGH | No rate limits on AI, backtest and autopilot routes (cost and abuse) |
| HIGH | Engines run inside the web process: a restart or HMR can leave timers on old code, as seen this session; needs a dedicated worker in production |
| HIGH | No monitoring or alerting for a stalled bot, stale data or a stuck lock |
| HIGH | Old MetaApi token not yet confirmed revoked by the provider |
| MEDIUM | SQLite in production; no automated backups or restore test |
| MEDIUM | Paper "restart monitor" counts a stop hit inside the entry candle (could be optimistic or pessimistic) |
| MEDIUM | Bad +2,933-pip test trade distorts journal statistics |
| MEDIUM | Neural TTS route returns 502 on every greeting |
| MEDIUM | Pine engine lacks `timenow` / `barstate`: the built-in 3EL EA template and some user scripts can't run in Strategy Studio |

## 6. Strategy files: do not modify without approval

`src/lib/halo/engine.ts`, `src/lib/halo/types.ts` (HaloConfig / engine types), `src/lib/halo/c3-form.ts`, `src/lib/range-scan.ts`, `src/lib/pine/*`, `src/lib/pine-bot.ts`, `src/lib/pine-ea.ts`, `src/lib/edge/quality.ts`, `src/lib/edge/simulate.ts`, `src/lib/edge/autopilot.ts`, `src/lib/edge/trade-manager.ts` (trade-management behaviour), and the backtest routes `src/app/api/backtest/*`.

## 7. Phased plan (priority order)

1. **Execution safety (no approval needed):**
   - ~~An automated concurrency and duplicate test for the lock against a throwaway DB.~~ Done: `exec-lock-concurrency-test`, 21/21.
   - ~~Store and query the broker order reference during reconciliation.~~ Done (MetaApi, OANDA, HALO Bridge EA; others tag-checked).
   - ~~An admin page for uncertain orders and the price-guard threshold.~~ Done: Admin → Execution.
2. **Capital protection:** verify Capital Guardian and the prop rules on a demo account.
3. **Security:** Super Admin 2FA, and rate limits on AI, backtest, autopilot and scanner routes.
4. **Integrations:** OANDA practice, the EA demo, MetaApi, then IG and Binance. Needs credentials.
5. **Data:** Postgres plan, automated backups and a restore test; the decision on the bad trade.
6. **Commercial:** payment sandboxes, legal drafts, monitoring, hosting.
7. **User experience:** fix or remove the voice engine; AI cost controls.

## 8. Test baseline (`023369c` + test fixes, 7 Nov 2026)

| Check | Result |
|---|---|
| `tsc` | 0 errors in `src/` (73 in old probe / example scripts) |
| `eslint src` | 154 problems (153 errors, 1 warning), all pre-existing (mostly `set-state-in-effect`) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `next build` | OK |
| secret-box-selftest | 15/15 |
| price-guard-selftest | 22/22 |
| edge-selftest | 17/17 |
| edge-filters-prop-test | 38/38 |
| journal-calc-test | all green |
| test-break-return-engine | all engine tests pass |
| range-filter-test | 11/11 |
| level-lifecycle-test | 26/26 |
| mt5-ea-bridge-test | 17/17 (simulated EA) |
| pine-longscript-test | 20/20 |
| deriv-catalog-test | 68/68 |
| **pine-compiler-test** | **41/42**: the built-in EA template uses `timenow` (see §2). The test file also had a top-level `await` that the runner can't load; changed to a static import (test file only) |
| **exec-lock-concurrency-test** (new) | **33/33** on a throwaway DB (`db/custom.db` verified unchanged by checksum), including reconciliation by order reference through a simulated EA |
| adapter-stub-test | **not run**: needs the local MetaApi stub, which requires the Bun runtime (not installed) |

## 9. Actions needing the user (credentials or approval)

1. Compile and run the HALO Bridge EA on the Exness demo.
2. Put the OANDA practice token and account ID in `.env`.
3. Approve 0.30 × ATR for demo testing only.
4. Put the Paystack and Flutterwave **test** keys in `.env`.
5. Confirm MetaApi has revoked the old token.
6. Decide whether the +2,933-pip test trade should be marked VOID.
7. Approve enabling the news blackout (built, off).
8. Change the Exness demo password (it was shared in chat).

## 10. Recommended next milestone

**HALO 3EL: Verified Demo Staging Release.** First the execution-safety tests and admin tooling (item 1 of §7, which needs no approval), then the EA demo run with the 0.30 × ATR threshold.
