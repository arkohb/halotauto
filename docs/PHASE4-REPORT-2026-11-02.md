# HALO 3EL Autotrader — Phase 4 Report

**Date:** 2 November 2026 · **Branch:** `feature/halo-edge-firebase-cloudflare`
**Environment:** production build on a **copy** of the database, plus a second throwaway installation for the tenancy test. Your real database, git history, production, broker accounts and payment providers were not touched. No live trades, no real payments, no deployment, no history rewrite.

> **Status: NOT READY FOR STAGING.** The price guard, tenancy model and migration safety are in place and tested. The MetaApi token rotation, the deviation threshold approval, the history rewrite, the P1 defects and all credential-dependent integration tests are still open.

Legend: ✅ tested and passed · ❌ tested and failed · ⛔ not verified (credentials or service unavailable)

---

## 1. Completed work

| Area | Outcome |
|---|---|
| **Decision B — price guard** | Implemented. Every new order (bot, scanner, sweep, Pine, TradingView webhook) is refused on simulated, stale, missing, invalid or unavailable prices; each refusal is recorded as a REJECTED trade with the reason and announced. Entry-only: open positions, stops and closes are untouched |
| **Live-quote deviation check** | Implemented as a **mandatory prerequisite for live trading**: live orders compare the order price with a fresh broker bid/ask (≤ 15 s old). Until a Super Admin sets the threshold, **every live order is refused**. Broker quotes added for MetaApi and OANDA; other brokers can't trade live until they provide one |
| **Decision A — tenancy** | One installation per customer. No code change needed. Isolation proven with two side-by-side installations. Runbook: `docs/TENANCY-RUNBOOK.md` |
| **Migration safety** | Exact diff of your real database vs the schema; rehearsed on a copy (24/24 tables identical, 22/22 trades kept); unsafe `--accept-data-loss` removed from `npm run db:push`; runbook with backup and rollback: `docs/MIGRATION-RUNBOOK-2026-11-02.md` |
| **Git cleanup prep** | `skills/` deletion confirmed unused and committed separately (`64f614f`). Backup **rehearsed**: bundle verified, a restore reproduced all 3 branches and 90 commits exactly. Plan updated (§10). **Not executed** |
| **MetaApi** | Secure configuration steps written (`docs/INTEGRATION-TEST-MATRIX.md` §A). Real tests wait for your new token |
| **Integration matrix** | `docs/INTEGRATION-TEST-MATRIX.md` — per integration: configuration, authentication, connection, core, error handling, security |

## 2. Files changed

| File | Change |
|---|---|
| `src/lib/price-guard.ts` | **New** — feed checks, live deviation check, protected threshold |
| `src/lib/execution.ts` | Price guard before the EDGE gate in `executeFire`; `recordPriceGuardRejection` |
| `src/lib/tv-webhook.ts` | Price guard on webhook entries (closes unaffected); TradingView timeframe mapping |
| `src/lib/brokers/types.ts` | Optional `getQuote` on the broker adapter |
| `src/lib/brokers/metaapi-core.ts`, `metaapi.ts` | MetaApi current-price quote |
| `src/lib/brokers/oanda.ts` | OANDA pricing quote |
| `src/app/api/admin/price-guard/route.ts` | **New** — threshold: GET admin, PUT Super Admin only, range 0.05–5 × ATR or null, audit-logged |
| `scripts/price-guard-selftest.ts` | **New** — 22 checks |
| `package.json` | `db:push` no longer passes `--accept-data-loss`; new `db:diff` preview |
| `docs/…` | `MIGRATION-RUNBOOK-2026-11-02.md`, `migrations/2026-11-02-edge-and-tv-alert-events.sql`, `TENANCY-RUNBOOK.md`, `INTEGRATION-TEST-MATRIX.md`, cleanup plan §10, this report |
| `skills/` | 167 unused files removed (commit `64f614f`) |

**Not changed:** strategy engine, bot, scanner, sweep, Timeframe Scanner Bot, position management, stop-loss handling. **No database schema change in Phase 4.**

## 3. Approved architectural decisions

1. **Tenancy:** one independent installation per customer (pilot).
2. **Price guard:** refuse simulated, stale, missing, invalid and unverifiable prices — implemented.
3. **Live deviation threshold — awaiting your approval.**
   - **Recommended initial value: 0.30 × ATR(14)** of the signal's timeframe, compared with the broker's executable side (ask for buys, bid for sells).
   - **Why:** the 3EL engine fires when price is back within 0.10 × ATR of the dotted line, so a healthy broker quote at that moment is usually within about 0.1 × ATR plus the spread. 0.30 leaves room for spread and a second or two of latency, while catching gaps, bad ticks, a wrong symbol mapping or a broker price far from the chart feed.
   - **Lower values** (e.g. 0.15) refuse more legitimate orders in fast markets or on wide-spread symbols. **Higher values** (e.g. 0.6) let more slippage through.
   - **How to set it:** Super Admin `PUT /api/admin/price-guard {"maxDeviationAtr": 0.3}`. There's no UI control yet.

## 4. Security tests

| Test | Result |
|---|---|
| Authorization matrix (12 routes × forged / unlicensed / licence without trading / admin) | ✅ 401 / 402 / 403 on sensitive / 200 |
| Session expiry, logout | ✅ |
| CSRF foreign origin | ✅ 403 |
| Security headers | ✅ 6/6 |
| Price-guard threshold: customer change attempt | ✅ 403 |
| Price-guard threshold: out-of-range value | ✅ 400 |
| Price-guard threshold change audit-logged | ✅ `PRICE_GUARD_THRESHOLD_SET` with before/after |
| TradingView replay after a refused alert | ✅ 409 (the event id is claimed before any check that can refuse) |
| Tenancy: sessions across installations | ✅ refused both ways |
| Tenancy: webhook secrets | ✅ differ; cross-use 401 |
| Tenancy: licence key across installations | ✅ 404 |
| Tenancy: journal record across installations | ✅ 404 |
| Tenancy: keep-alive secret not shared | ✅ |

### Price guard tests

| Case | Self-test (pure logic) | Live on test copy |
|---|---|---|
| Fresh real feed | ✅ allowed | ✅ BTCUSDT paper alert executed |
| Simulated prices | ✅ refused | ✅ Deriv V75 alert refused, REJECTED row with reason |
| Stale: refresh failed | ✅ refused | — |
| Stale: market closed (3 h old candle) | ✅ refused | — |
| Missing quote (no candles) | ✅ refused | — |
| Invalid: NaN, 0, negative, high<low, future time | ✅ refused (5 cases) | — |
| Live, threshold not set | ✅ refused | ✅ refused |
| Live, broker quote unavailable | ✅ refused | ✅ refused (OANDA practice account with fake credentials) |
| Live, broker quote stale (60 s) | ✅ refused | ⛔ needs a real broker |
| Price movement beyond the limit (0.5 ATR vs 0.3) | ✅ refused (buy uses ask, sell uses bid) | ⛔ needs a real broker |
| Within the limit | ✅ allowed | ⛔ needs a real broker |
| No ATR | ✅ refused | — |
| Live orders filled during testing | — | ✅ 0 |

## 5. Database migration findings

- **Your real database is missing all new schema**, not only the TradingView table: `EdgeSettings`, `AutopilotProfile`, `TvAlertEvent`, and four new `Trade` columns.
- **Additions only.** SQLite adds the `Trade` columns by rebuilding the table: copy every row, drop the old table, rename. Nothing is removed.
- **Rehearsed on a consistent copy:** 24/24 tables have identical rows and content, 22/22 trades were kept, the integrity check passes, there are 0 foreign-key problems, and the schema matches afterwards.
- **Two problems fixed or flagged:**
  - `npm run db:push` used `--accept-data-loss`; removed.
  - Your `.env` `DATABASE_URL` points to a database that **does not exist** (Prisma P1003). You need to set it to `file:../db/custom.db`.
- **Steps, verification and rollback:** `docs/MIGRATION-RUNBOOK-2026-11-02.md`. Not applied to your real database.

## 6. Integration test results

| | Config | Auth | Connection | Core | Errors | Security |
|---|---|---|---|---|---|---|
| MetaApi / MT5 demo | ⛔ | ⛔ | ✅ TLS | ⛔ | ✅ | ✅ |
| Paystack test | ⛔ | ⛔ | ⛔ | ⛔ | ✅ | ✅ |
| Flutterwave test | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ❌ scheme likely wrong |
| Claude | ⛔ | ⛔ | ✅ reaches API | ⛔ | ✅ | ✅ |
| Deriv | ✅ | — | ❌ HTTP 520 (their side, all day) | ⛔ | ✅ | ✅ |

Binance live data ✅ (26 chart updates in 8 s; REST 200).

## 7. Regression results

| Area | Result |
|---|---|
| Authentication, sessions, owner mode, Super Admin | ✅ |
| Licensing and entitlements | ✅ |
| Device limits during use | ❌ unchanged P1 — still enforced only at activation |
| Journal and customer data isolation | ✅ 90/90 calculations; cross-user and cross-installation 404 |
| Timeframe Scanner Bot | ✅ API + view; unchanged code |
| TradingView alerts and replay prevention | ✅ |
| Binance live data | ✅ |
| Deriv | ⛔ outage |
| AI chat and voice | ⛔ no key |
| MT5 | ⛔ no token / demo account |
| Price guard | ✅ (§4) |
| CSP and headers | ✅ 0 violations across 18 views |
| Existing-position protection | ✅ code: guard is entry-only; TradingView close still executed; no change to stop/close/modify paths |
| Engine, EDGE, journal, price-guard tests | ✅ all pass; 0 type errors; lint unchanged (153 pre-existing style errors) |
| Firestore | — not used by HALO (no reads or writes added) |

## 8. Remaining defects

| Pri | Defect |
|---|---|
| P0 | Old secrets in git history — needs token revocation, admin password change and your authorisation of the rewrite |
| P1 | Device limit not enforced during use |
| P1 | Trade lock not restored after a restart |
| P1 | Broker credentials and alert secrets stored unencrypted |
| P1 | Flutterwave webhook scheme |
| P1 | 5 high-severity dependency advisories |
| P1 | Live trading is blocked until the deviation threshold is approved (by design) |
| P2 | Rate limits missing on AI, backtest, compare and autopilot routes |
| P2 | No admin UI for the price-guard threshold (API only) |
| P2 | Live-quote check only available for MetaApi and OANDA brokers |

## 9. Outstanding credentials and actions (yours)

1. **MetaApi:** revoke the old token; set a new `METAAPI_TOKEN` locally (`.env`); provide a **demo** MT5 account. Don't share the token with me.
2. **Approve** the deviation threshold (recommended 0.30 × ATR) or give your value.
3. **Database:** fix `DATABASE_URL` in `.env`, then follow the migration runbook (backup → `npm run db:push` → verify).
4. **Old secrets:** change the Super Admin password; regenerate the TradingView webhook secret; rotate saved broker, Telegram and SMTP credentials; re-copy the Pine EA.
5. **Authorise** the git history rewrite (cleanup plan §9 and §10).
6. **Test keys:** Paystack and Flutterwave test keys, and `ANTHROPIC_API_KEY`.

## 10. Staging readiness assessment

**NOT READY FOR STAGING.** Met: authorization, sessions, CSRF, CSP, replay protection, price guard, tenancy isolation, migration safety (rehearsed), strategy unchanged, journal accuracy.
Not met: secret rotation and history rewrite; MT5 demo verification; payment sandbox; AI; device limits; trade-lock recovery; encrypted credentials; dependency advisories; staging infrastructure (Postgres, Firebase backend, Cloudflare, monitoring, backups, rollback drill).
