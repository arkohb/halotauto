# HALO 3EL Autotrader — Phase 5 Report

**Date:** 2 November 2026 · **Branch:** `feature/halo-edge-firebase-cloudflare`
**Environment:** production builds on **copies** of the database, a local stand-in for Flutterwave's verify API, and placeholder test keys. Your real database, git history, production, broker accounts and payment providers were not touched. No live trades, no real payments, no deployment, no history rewrite, no strategy change.

> **Staging readiness decision: NOT READY FOR STAGING.** Every P1 code defect in scope is fixed and tested. What remains is credential- and decision-dependent: MetaApi demo testing, the live price-guard threshold, real payment-sandbox runs, applying the database migration, the history rewrite, and staging infrastructure.

Legend: ✅ tested and passed · ⛔ not verified (credentials or service unavailable) · ⚠ partially verified

---

## 1. P1 issues — final status

| P1 issue | Status | Evidence |
|---|---|---|
| Device limit enforced only at activation | ✅ **Fixed** | Every request now checks the device; DB-enforced slots; 2 hidden bypasses closed (§6) |
| Trade lock lost on restart | ✅ **Fixed** (⛔ real-broker "after-ack" case pending MetaApi demo) | Persistent lock + state machine + restart reconciliation (§7) |
| Credentials unencrypted at rest | ✅ **Fixed** (migration rehearsed, not yet applied to your database) | AES-256-GCM; migration verified (§5) |
| Flutterwave webhook verification | ✅ **Fixed** (⛔ real sandbox pending test keys) | Official `verif-hash` scheme + provider re-query; 14 scenarios (§8) |
| 5 high-severity dependency advisories | ✅ **Resolved** — production tree: 0 vulnerabilities | §4 |
| Live trading needs the deviation threshold | ⛔ waiting for your approval (0.30 × ATR recommended) | unchanged by design |

Extra defects found and fixed along the way:
- **Device limits:** reactivating a deactivated device skipped the limit, and suspended licences could still activate devices.
- **Device tokens:** two different storage keys meant one browser could take two device slots.
- **Flutterwave:** the duplicate key would have swallowed a successful payment that followed a failed one, and a failed verification blocked Flutterwave's own retry.
- **Refunds and disputes:** a refunded payment left its licence active; a disputed payment's licence now gets suspended.
- **Dependencies:** two unused dependencies were removed (`@mdxeditor/editor`, `react-syntax-highlighter`).

## 2. Files changed

| Area | Files |
|---|---|
| Device limits | `src/lib/commerce/license-engine.ts`, `src/lib/commerce/auth.ts`, `src/lib/license.ts`, `src/app/api/license/route.ts`, `src/app/api/license/activate/route.ts`, **new** `src/app/api/license/bind/route.ts`, `src/components/halo/auth-gate.tsx` |
| Execution lock | **new** `src/lib/exec-lock.ts`, `src/lib/execution.ts`, `src/lib/tv-webhook.ts`, `src/lib/trade-lock.ts`, `src/lib/bot.ts` (4 lines: restore at boot), **new** `src/app/api/admin/execution-lock/route.ts`, `src/lib/brokers/{types,metaapi-core,metaapi,oanda}.ts` (client order id) |
| Encryption | **new** `src/lib/secret-box.ts`, `src/lib/brokers/index.ts`, `src/lib/alerts.ts`, `src/lib/commerce/mailer.ts`, `src/lib/tv-webhook.ts`, `src/lib/journal/mt5-sync.ts`, `src/app/api/brokers/route.ts`, `src/app/api/brokers/mt-login/route.ts`, `src/app/api/alerts/settings/route.ts`, **new** `scripts/encrypt-credentials.ts`, **new** `scripts/secret-box-selftest.ts` |
| Payments | `src/lib/commerce/payments.ts`, `src/app/api/commerce/webhook/flutterwave/route.ts`, `src/app/api/admin/transactions/route.ts` |
| Dependencies | `package.json`, `package-lock.json` |
| Schema | `prisma/schema.prisma`, `src/lib/db.ts` |
| Config / docs | `.env.example`, `apphosting.yaml`, `docs/MIGRATION-RUNBOOK-2026-11-02.md`, **new** `docs/migrations/2026-11-02-full-schema-to-phase5.sql`, `docs/GIT-HISTORY-CLEANUP-PLAN.md` §11, this report |

**Not changed:** strategy engine, indicators, signals, risk parameters, scanner, sweep, Timeframe Scanner Bot, EDGE logic, position management, stop-loss handling.

## 3. Database migration findings

- **Real data location:** `db/custom.db` is the only database file and holds your data (8 users, 22 trades, 4 licences). `.env` `DATABASE_URL` still points to a non-existent path; you need to fix it.
- **Full change** (all phases, additive):
  - new tables `EdgeSettings`, `AutopilotProfile`, `TvAlertEvent`, `ExecutionIntent`, `ExecutionEvent`, `ExecutionLock`;
  - new columns `Trade.grade` / `gradeLetter` / `sizeMult` / `partialPips`, `LicenseActivation.slot` and `Session.activationId`;
  - 4 indexes.
- **Rehearsed on a consistent copy:**
  - 24/24 existing tables are identical;
  - the schema is in sync afterwards;
  - the integrity check passes, with 0 foreign-key problems;
  - credential encryption ran 5/5;
  - 0 plaintext credential fields remain.
- **`npm run db:push` refuses**, correctly, on the new unique index (a generic Prisma warning), so the runbook applies the **reviewed SQL** instead. No `--accept-data-loss` anywhere.
- **Exact commands, verification and rollback:** `docs/MIGRATION-RUNBOOK-2026-11-02.md`. **Not applied — needs your authorisation.**

## 4. Dependency security findings

| Advisory | Reachable in HALO? | Action | Result |
|---|---|---|---|
| sharp < 0.35.5 (libvips / libheif / librsvg CVEs) | No — app code never imports it; Next.js uses its own (already 0.35.5); only `scripts/gen-icons.mjs` | upgraded direct dep to `^0.35.5` (needs Node ≥ 20.9 — App Hosting uses 20+) | fixed |
| js-yaml 4.1.1 (CPU-exhaustion DoS ×4) via `@mdxeditor/editor` | No — the editor package is not imported anywhere | removed the unused dependency (154 packages) | fixed |
| deepmerge-ts < 8 → `@prisma/config` → `prisma` (3 entries) | Only in the Prisma CLI reading your own config (not attacker-controlled) | `overrides: deepmerge-ts ^8.0.2` (official fix needs a breaking Prisma 7+ upgrade) | fixed; `prisma validate`, `generate`, `migrate diff`, `db push` and the Postgres schema all verified |
| prismjs (moderate, DOM clobbering) via `react-syntax-highlighter` | No — not imported anywhere | removed the unused dependency | fixed |
| minimatch (moderate ×14) | Dev tooling only (eslint) — not in the production tree | left | accepted (dev-only) |

`npm audit --omit=dev`: **0 vulnerabilities.** Build and every test suite pass after the changes.

## 5. Credential encryption and migration

- **AES-256-GCM** (node:crypto), key only from the server secret `HALO_DATA_KEY` (32 bytes). Format `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>`.
- **Encrypted:** broker credentials (including any personal MetaApi token), Telegram bot token, SMTP password, web-push private key, TradingView webhook secret.
- **Fail-closed:** no key → saving credentials is refused (and an MT login is refused **before** a cloud account is created); wrong key → credentials unreadable, webhook alerts refused, one clear log line, no values logged.
- **Never in the browser:** decryption happens server-side only; the UI still sees masked values.

| Test | Result |
|---|---|
| Self-test (round trip, tamper, forged tag, wrong key, missing key, malformed, legacy plaintext, unique IVs) | ✅ 15/15 |
| Migration without a key | ✅ aborted, nothing changed |
| Dry run | ✅ counts only, data unchanged |
| Apply | ✅ 6/6 encrypted and verified (test copy); 5/5 on the rehearsal of your database |
| Apply again | ✅ idempotent (0 to do) |
| App before vs after encryption | ✅ identical broker list, webhook secret, Telegram setting; webhook alerts still authenticate |
| New credentials saved | ✅ stored encrypted; no plaintext in the file |
| Wrong key | ✅ fails closed (credentials empty, alerts 401, app healthy, no secrets logged) |
| No key | ✅ save refused with a clear message |
| Recovery with the right key | ✅ everything back |
| Backups | ✅ no plaintext after migration (+ `VACUUM`); ⚠ **older backups made before migration still contain plaintext** — delete them and rotate those credentials |

## 6. Device-limit tests

| Test | Result |
|---|---|
| Starter (1) / Pro (2) / Elite (3) / Ultimate (5) | ✅ exactly 1 / 2 / 3 / 5 devices; the next refused |
| 10 simultaneous activations on a 1-device licence | ✅ 1 succeeded, 9 refused, 1 active in the DB |
| Request without device cookie / forged cookie / another licence's device | ✅ 402 / 402 / 402 |
| Re-link an already-activated browser | ✅ 200, then access granted |
| A second browser takes the same device | ✅ the first browser is signed out |
| Bind a token that was never activated | ✅ 404 |
| Deactivate a device | ✅ its browser is signed out immediately |
| Replacement device | ✅ accepted |
| Reactivate the old deactivated device (bypass) | ✅ refused — limit reached |
| Revoked / suspended / expired licence | ✅ new devices refused; existing devices lose access |
| Administrators | ✅ unaffected (they manage, they don't use a seat) |
| Existing users after deployment | ✅ re-linked automatically on next visit (no re-entry of the key) |

## 7. Execution-lock recovery tests

| Test | Result |
|---|---|
| Normal lifecycle (paper) | ✅ PENDING → SUBMITTING → OPEN → CLOSED, every transition logged |
| Second order while one is open | ✅ refused |
| **8 different orders at the same moment** | ✅ exactly 1 trade |
| Restart with an open trade | ✅ database and in-memory locks restored; new orders refused; close releases it |
| Crash before submission (PENDING) | ✅ abandoned, lock released (nothing was sent) |
| Crash before the paper trade was written | ✅ abandoned, lock released |
| Crash right after the paper trade was written | ✅ adopted as OPEN, lock kept |
| …that trade then closed while the app was down | ✅ next restart: CLOSED, lock released |
| LIVE crash before the broker answered | ✅ UNCERTAIN, lock kept — **also across another restart** (no timeout release) |
| LIVE crash, broker reachable but shows no position | ✅ still UNCERTAIN (absence is not proof) |
| Resolution | ✅ customer 403; Super Admin resolve → released; audit-logged |
| Error classification | ✅ timeouts / fetch failures / 5xx / hang-ups → UNCERTAIN; "no money", "invalid volume", 4xx → REJECTED |
| LIVE crash **after** the broker accepted, with the position present | ⛔ needs the MetaApi demo account |

The lock never closes, modifies or opens a broker position; open-position management, broker-side SL/TP and closing operations are unchanged.

## 8. Payment verification tests

Flutterwave (local stand-in for the verify API; official scheme per developer.flutterwave.com):

| # | Scenario | Result |
|---|---|---|
| 1–3 | Forged hash / missing header / API key used as the hash (old bug) | ✅ 401, nothing changed |
| 4 | Genuine success (webhook body claimed 1,000,000 — ignored) | ✅ VERIFIED from the provider's 199; 1 licence |
| 5 | Duplicate | ✅ ignored, still 1 licence |
| 6 | Wrong amount (provider: 150) | ✅ DISPUTED, no licence |
| 7 | Wrong currency (provider: NGN) | ✅ DISPUTED, no licence |
| 8 | Failed payment | ✅ FAILED, no licence |
| 9 | Webhook says successful, provider says failed | ✅ FAILED, no licence |
| 10 | Transaction belongs to another order | ✅ 422, order untouched |
| 11 | Delayed webhook (order 3 days old) | ✅ verified once |
| 12 | Provider outage on first try, then Flutterwave's retry | ✅ 502, then verified on retry |
| 13 | Unknown transaction id | ✅ 502, no licence |
| 14 | Replay of the genuine event | ✅ ignored |
| 15 | Refund recorded by Super Admin | ✅ licence REVOKED |
| 16 | Dispute flagged (incl. a not-yet-activated licence) | ✅ licence SUSPENDED |

Paystack regression: bad signature 401 ✅ · valid signature processed ✅ · replay → duplicate ✅.
**Not tested:** real Paystack and Flutterwave sandbox transactions ⛔ (no test keys). Flutterwave documents no refund webhook event, so refunds are recorded by the Super Admin (and now revoke the licence).

## 9. MT5 demo test results

⛔ **Not run** — no new `METAAPI_TOKEN` or demo account has been configured. Code paths ready: strict TLS, client order ids for reconciliation, broker quotes for the price guard, the execution lock's live paths. Test plan A1–A10 in `docs/INTEGRATION-TEST-MATRIX.md`. Price-guard demo testing at 0.30 × ATR waits for your approval of that test configuration.

## 10. Remaining risks and blockers

| Pri | Item | Needs |
|---|---|---|
| P0 | Old secrets in git history | token revocation + admin password change + your authorisation (§11 of the cleanup plan) |
| P1 | Database migration not applied to your real database | your authorisation + `DATABASE_URL` fix + `HALO_DATA_KEY` |
| P1 | MT5 demo verification (incl. execution-lock after-ack case, price guard on real quotes) | new MetaApi token + demo account |
| P1 | Live trading blocked until the deviation threshold is approved | your decision |
| P1 | Payment sandbox runs (Paystack, Flutterwave) | test keys + `FLUTTERWAVE_WEBHOOK_HASH` |
| P2 | AI chat/voice end-to-end | `ANTHROPIC_API_KEY` |
| P2 | Deriv live ticks | Deriv's service (HTTP 520 all day) |
| P2 | Rate limits on AI / backtest / compare / autopilot routes | Phase 6 |
| P2 | No admin UI for the price-guard threshold and execution-lock resolution (API only) | Phase 6 |
| P3 | 153 pre-existing React style lint errors | — |
| — | Staging infrastructure, monitoring, backups, rollback drill | Firebase / Postgres / Cloudflare access |

## 11. Staging readiness decision

**NOT READY FOR STAGING.** All in-scope P1 code defects are fixed and tested on test copies, the strategy is unchanged, and the full regression passes (authorization matrix, sessions, device limits, journal isolation, CSRF, CSP 0 violations, replay protection, price guard, execution lock, encryption, payments, owner mode, Binance live feed). Staging approval still needs: the database migration applied, secrets rotated and history cleaned, MT5 demo and payment-sandbox verification with real test credentials, and a staging environment with monitoring and backups.

---

## 12. Applied to the real database (3 November 2026, with your authorisation)

| Step | Result |
|---|---|
| Nothing using `db/custom.db` | ✅ no app process, no open handles |
| `.env` `DATABASE_URL` → `file:../db/custom.db` | ✅ Prisma reaches the database (P1003 gone); `.env` git-ignored, permissions `600` |
| Backup `db/backup-pre-phase5.db` (SQLite `.backup`) | ✅ integrity ok; counts match (8 users, 22 trades, 4 licences, 8 activations, 78 journal trades, 2 brokers, 127 sessions) |
| Planned SQL vs reviewed file | ✅ identical |
| Migration applied | ✅ 24/24 existing tables identical (rows + every original column); integrity ok; 0 FK violations; schema in sync; 6 new tables present |
| `HALO_DATA_KEY` generated into `.env` (never displayed) | ✅ |
| Credential encryption | ✅ 5/5 encrypted and verified (2 brokers, Telegram token, VAPID key, webhook secret); `VACUUM`; 0 plaintext credential fields in the file |
| Read-back with the key | ✅ every value decrypts through the app's own functions |
| Non-credential data after encryption | ✅ 21/21 tables identical |

The app was **not** started against the real database (the bot auto-attaches on boot); all checks used direct queries and scripts.

**Your actions:**
- Copy `HALO_DATA_KEY` from `.env` into your password manager now. Without it the stored credentials cannot be read.
- `db/backup-pre-phase5.db` still contains the **old plaintext** credentials. Keep it only as long as you want a rollback, then delete it. Rotate those credentials anyway (they are also in git history).
