# HALO 3EL Autotrader — Phase 3 Report

**Date:** 2 November 2026 · **Branch:** `feature/halo-edge-firebase-cloudflare`
**Environment:** production build on a **copy** of the database. The real database, git history, production, broker accounts and payment providers were not touched. No live trades, no real payments, no deployment, no history rewrite.

> **Status: NOT READY FOR STAGING.** Phase 3 security work is complete and tested, but decisions A and B, the history rewrite, the MetaApi token rotation and the external-service tests (MT5 demo, payments, AI, Deriv) are still open.

Legend: ✅ tested and passed · ⛔ not tested (credentials or external service unavailable) · ⚠ partially verified

---

## 1. Security vulnerabilities addressed

### 1.1 TradingView alert replay (Phase 2 finding) — fixed

**Design**

| Layer | Behaviour |
|---|---|
| Secret | Shared secret in the alert (TradingView alerts cannot sign messages or set custom headers). Compared in **constant time** on SHA-256 digests, so neither content nor length leaks through timing |
| Freshness | Every alert must carry `ts` (TradingView's `timenow`, epoch ms). Accepted only if ≤ 120 s old (`HALO_TV_MAX_AGE_SEC`, 15–900) and ≤ 30 s in the future |
| Event id | Every alert must carry `id` = `HALO3EL|<ticker>|<timeframe>|<action>|<bar time>` — one event per action per bar. Format validated (8–200 safe characters) |
| Replay store | New table `TvAlertEvent`; primary key = SHA-256 of the id. The id is **claimed before anything executes**. The insert is atomic, so concurrent copies and replays after a restart both fail. Rows older than 7 days are pruned |
| Order of checks | secret → freshness → parse → claim → execute. Unauthenticated or invalid requests never write to the replay table |

The Pine EA now adds `ts` and `id` to every alert. This also collapses the repeated intrabar alerts the script could send within one bar.

**Action for you:** alerts from the **old** Pine EA are now rejected ("re-copy the Pine EA"). Press **COPY PINE EA** again and replace the script in TradingView before using webhook alerts.

**Known limit:** a second entry *of the same direction on the same bar* would be treated as a duplicate (only possible if a trade fires, closes and re-fires within one bar).

### 1.2 Stale code comment
`/api/brokers/mt-login` still described the removed hard-coded "baked key"; corrected.

## 2. Files changed

| File | Change |
|---|---|
| `src/lib/tv-webhook.ts` | Constant-time secret compare; `checkAlertFreshness`, `claimAlertEvent` (replay store) |
| `src/app/api/webhook/tv/route.ts` | Freshness + replay checks before execution; 409 on duplicates |
| `src/lib/pine-ea.ts` | Alerts carry `ts` and `id` (payload only — no strategy change) |
| `prisma/schema.prisma` | **New table** `TvAlertEvent` (additive; nothing existing changed) |
| `src/lib/db.ts` | Client freshness check includes the new model |
| `src/app/api/brokers/mt-login/route.ts` | Comment only |
| `docs/GIT-HISTORY-CLEANUP-PLAN.md` | `skills/` analysis, dry-run results, final checklist |
| `docs/DECISION-A-TENANCY.md` | **New** |
| `docs/DECISION-B-PRICE-GUARD.md` | **New** |
| `docs/PHASE3-REPORT-2026-11-02.md` | **New** — this report |

**Database change:** the new `TvAlertEvent` table was applied to the **test copy only**. Before running this version against your local database, apply it yourself with `npm run db:push`. Otherwise TradingView webhook alerts fail with a server error, because the replay check can't record events. In production it is created by the hosted build.

## 3. Tests executed and results

### 3.1 TradingView replay protection (live, test copy)

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Wrong secret, fresh ts + id | 401, nothing recorded | ✅ 401, 0 events |
| 2 | Missing ts and id (old Pine EA) | 400 with "re-copy" message | ✅ |
| 3 | Missing id | 400 | ✅ |
| 4 | Malformed ts (`"abc"`) | 400 | ✅ |
| 5 | Malformed id (`<script>…`) | 400 | ✅ |
| 6 | Expired (10 min old) | 410 | ✅ |
| 7 | Future-dated (+5 min) | 400 | ✅ |
| — | After cases 1–7 | no events, no trades | ✅ 0 / unchanged |
| 8 | Valid buy | executes once | ✅ 200, one paper trade |
| 9 | Exact duplicate | 409, no trade | ✅ |
| 10 | Valid close | executes | ✅ 200, closed |
| 11 | **12 identical alerts sent at the same moment** | exactly one executes | ✅ 1 × 200, 11 × 409, **1 trade**, 1 replay row |
| 12 | **Replay after an application restart** | 409 | ✅ |

The updated Pine EA passes the app's Pine compiler with no diagnostics. TradingView's own compiler remains the authority: confirm when you paste it.

### 3.2 MetaApi credential handling

| Check | Result |
|---|---|
| Token read only from `METAAPI_TOKEN` (server env) | ✅ |
| No hard-coded fallback; no token-shaped strings in `src/` or the browser bundle | ✅ 0 |
| Missing token | ✅ fails with "MetaApi is not configured…", no request sent |
| **Invalid** token against the real MetaApi server (strict TLS) | ✅ HTTP 401 → user message "MetaApi rejected the platform token…"; the token appears in **neither** the raw nor the user-facing error |
| Self-signed certificate | ✅ rejected before any request (Phase 2 test) |
| Insecure TLS settings anywhere in `src/` | ✅ none |
| Real demo connection with the new token | ⛔ waiting for you to configure the replacement token |

### 3.3 Git history cleanup (dry run on a throwaway clone)
✅ Secrets removed from all 3 branches; 0 complete JWTs left in any object; `.env`/`db/custom.db`/`tool-results/` have no history; the source tree is otherwise identical; the clone **builds** and passes the engine, EDGE and journal tests. The clone was deleted. Details: `docs/GIT-HISTORY-CLEANUP-PLAN.md` §8.

**`skills/` deletions:** 167 files of add-on AI-assistant skills from the original build platform (added 31 Oct). Nothing in the app references them, and the whole folder is gone from disk, which is consistent with a deliberate removal. Recommendation: commit the deletion; only you can confirm it was intended.

## 4. Regression testing results

| Area | Result |
|---|---|
| Authentication / authorization matrix (forged / unlicensed / licence without trading / admin, 12 routes) | ✅ 401 / 402 / 403 on sensitive / 200 |
| Owner mode | ✅ unchanged |
| Super Admin (API + admin page) | ✅ |
| Licensing and entitlements | ✅ (revoked/unlicensed/licensed paths, Phase 2 + rerun) |
| Customer data isolation (journal) | ✅ cross-user edit/delete 404 |
| Session expiry / logout | ✅ expired 401; session dead after logout |
| CSRF origin check | ✅ foreign origin 403 |
| CSP | ✅ enforced, nonces on every page, 0 violations across all 18 views |
| Binance live data | ✅ 131 updates in 10 s |
| Timeframe Scanner Bot | ✅ API + view |
| Performance Journal | ✅ 90/90 calculations |
| Strategy engine / EDGE | ✅ all engine tests, EDGE 17/17 — **no strategy change** |
| TradingView alerts | ✅ (§3.1) |
| Type-check / lint | ✅ 0 errors in `src/` / unchanged (153 pre-existing style errors) |
| AI chat and voice | ⛔ no `ANTHROPIC_API_KEY` (route reachable; clean "no key" message) |
| Deriv | ⛔ Deriv's server returns HTTP 520 (their outage; still failing at the end of testing) |
| MT5 demo | ⛔ needs the new token + a demo account |
| Payments (Paystack/Flutterwave test mode) | ⛔ no test keys. Paystack signature and replay logic were verified in Phase 2 with a placeholder key |

## 5. Remaining risks

| Pri | Risk | Owner |
|---|---|---|
| P0 | Orders possible on simulated/stale prices | Decision B |
| P0 | Shared bot/broker per installation vs per-customer licences | Decision A |
| P0 | Old MetaApi token, admin password and DB contents in git history | You: rotate; then approve the rewrite |
| P1 | Device limit not enforced during use | Phase 4 |
| P1 | Trade lock not restored after restart | Phase 4 (with Decision B) |
| P1 | Broker credentials / alert secrets unencrypted at rest | Phase 4 |
| P1 | Flutterwave webhook scheme likely wrong | needs test keys |
| P1 | 5 high-severity dependency advisories | Phase 4 |
| P2 | No rate limits on AI, backtest, compare and autopilot routes | Phase 4 |
| P3 | `style-src 'unsafe-inline'` (deliberate, low risk) | — |

## 6. Outstanding decisions

1. **Decision A — tenancy** (`docs/DECISION-A-TENANCY.md`). Recommendation: one installation per customer for the pilot.
2. **Decision B — price guard** (`docs/DECISION-B-PRICE-GUARD.md`). Recommendation: block orders on simulated or stale data now; add the deviation check for live next.
3. **D3 — history rewrite** (`docs/GIT-HISTORY-CLEANUP-PLAN.md` §9): approve the final checklist, including the `skills/` deletion.

## 7. External integrations not tested

MetaApi/MT5 demo · Paystack and Flutterwave test mode · Claude (AI chat/voice) · Deriv live ticks (service outage) · TradingView alert delivery from a real TradingView account · Firebase App Hosting · Cloudflare (DNS, proxy, keep-alive worker) · Postgres.

## 8. Exact steps before staging approval

1. **You:** revoke the old MetaApi token at app.metaapi.cloud. Create a new one and set it **only** as a server secret:
   - local: add `METAAPI_TOKEN="…"` to `.env` (never commit it);
   - hosted: `firebase apphosting:secrets:set METAAPI_TOKEN`.
   Then tell me, and I'll run the MT5 **demo** connection test. I won't ask you for the token or display it.
2. **You:** change the Super Admin password; regenerate the TradingView webhook secret; rotate any broker credentials, Telegram or SMTP passwords that were saved in the old database.
3. **You:** decide A and B; approve the history rewrite checklist (including the `skills/` deletion).
4. **Me, after approval:** run the history rewrite with backups; implement Decision B (and the Decision A safeguards); fix the P1 items.
5. **You:** provide test credentials: MetaApi demo account, Paystack and Flutterwave **test** keys, `ANTHROPIC_API_KEY`.
6. **Me:** MT5 demo order flow, payment sandbox flow end to end, AI/voice in Chrome, Deriv once their service is back.
7. **Together:** stand up a staging environment (Postgres, Firebase backend, Cloudflare subdomain), add monitoring and backups, and run the full acceptance test there. Only then is a staging-approval decision appropriate.
8. **You:** re-copy the Pine EA into TradingView and run `npm run db:push` locally before using webhook alerts with this version.
