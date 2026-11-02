# HALO 3EL Autotrader — Phase 2 Security Report

**Date:** 2 November 2026 · **Branch:** `feature/halo-edge-firebase-cloudflare`
**Environment:** production build (`next build` + `next start`) on a **copy** of the database. The real database was not touched. No live trades, no real payments, no deployment, no git history rewrite.

> **Status: NOT READY FOR STAGING.** Phase 1 and Phase 2 security work is verified, but the P0 items that need your decisions (D1 tenancy, D2 execution guard, D3 history rewrite) and the MetaApi token rotation are still open.

Legend: ✅ tested and passed · ❌ tested and failed · ⛔ blocked (could not test) · ⚠ partially verified

---

## 1. Phase 1 independent verification

| Check | Method | Result |
|---|---|---|
| Server-side check on every protected route | Re-parsed every handler in all 79 route files | ✅ Only 9 handlers have no check, all public by design: sign-in, register, logout, forgot/reset password, verify email, public plan list, `/api` hello, `/api/version` |
| Other entry points | Searched for Server Actions, WebSocket servers, pages reading the DB directly | ✅ None. Background loops (bot/scanner/sweep) have no HTTP surface; `/api/health?tick=1` needs `HALO_CRON_SECRET` |
| Forged / unlicensed / licence-without-trading / admin | Live matrix, 12 routes × 4 identities, run twice | ✅ 401 / 402 / 403 on sensitive / 200 — identical both runs |
| Super Admin | Admin pages + `/api/admin/*` as super admin vs customer | ✅ super admin 200, customer 403 on list and plan edit |
| Voice brain | Forged 401, unlicensed 402, licensed reaches Claude | ✅ |
| Confirmation ownership | Made-up and cross-account confirmation tokens | ✅ refused (code binds the token to the requesting account) |
| Execution-time trading check | Scanner control via brain with a licence lacking trading | ✅ refused with a clear message |
| MetaApi certificate verification | See §2 | ✅ |
| `METAAPI_TOKEN` required, no fallback | See §2 | ✅ |
| Hard-coded credentials | JWT scan of `src/` and the browser bundle | ✅ none |
| Security headers | `curl -I` | ✅ HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP; no `X-Powered-By` |
| Owner mode | `HALO_COMMERCE=off`, no cookie | ✅ bot state / brokers 200 as before |
| Dashboard | Browser, super admin, commercial mode | ✅ all 18 views, chart, TV WEB, live event stream |
| Engine / EDGE / journal tests | Scripts | ✅ all pass (engine, 17/17, 90/90) |

**Missed routes found:** none.

## 2. MetaApi token rotation

| Requirement | Result |
|---|---|
| Token comes from `METAAPI_TOKEN` only | ✅ code reads the env var only (`platformToken()`) |
| No hard-coded fallback | ✅ removed; no JWT anywhere in `src/` or `.next/static` |
| Missing configuration fails safely | ✅ test: with no token, `mFetch` throws "MetaApi is not configured — set the METAAPI_TOKEN server secret." and **no request is sent** |
| Token never logged | ✅ no log statement references the token |
| Token never sent to the browser | ✅ browser bundle contains only the variable *name* in help text |
| Invalid certificate rejected | ✅ test: local HTTPS server with a self-signed certificate → handshake rejected ("self-signed certificate"); the server received no request, so the token was never sent |
| Real hosts pass strict checks | ✅ provisioning, new-york and london hosts answer over fully verified HTTPS (401 without a token) |
| Connection succeeds with the new token | ⛔ **blocked** — no new token exists yet. Revoke the old token at app.metaapi.cloud, create a new one, set `METAAPI_TOKEN`, then run Brokers & MT5 → TEST |

## 3. Git history cleanup plan

Prepared in [`docs/GIT-HISTORY-CLEANUP-PLAN.md`](GIT-HISTORY-CLEANUP-PLAN.md). **Not executed.** Key facts: 3 local branches, **no remote** (so no force-push is needed today), 85 commits all change ID, `.env` in 10 commits (MetaApi token, admin email + password), `db/custom.db` in 68 commits, the token also in `metaapi-core.ts` history and in a committed `tool-results/` file. The working tree must first be made clean (167 pre-existing `skills/` deletions). The plan includes the backup bundle, exact `git filter-repo` commands, verification commands and recovery steps.

## 4. Content Security Policy

**Inventory (from source):** the browser loads only TradingView (script `s3.tradingview.com`, iframe `s.tradingview.com`), the Binance websocket (`wss://stream.binance.com:9443`), the Deriv websocket (`wss://ws.derivws.com`), and same-origin resources (fonts are bundled at build time by `next/font`; voice audio plays from blob/data URLs; service worker `/sw.js`). **Firebase is not used by the app**, so no Firebase origins are listed. MetaApi and Claude are called only from the server, so they are not browser origins.

**Policy (enforced, per request, in `src/proxy.ts`):**

```
default-src 'self';
script-src 'self' 'nonce-<per request>' 'strict-dynamic' https://s3.tradingview.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;  font-src 'self' data:;
connect-src 'self' wss://stream.binance.com:9443 wss://ws.derivws.com;
frame-src https://s.tradingview.com https://www.tradingview.com;
media-src 'self' blob: data:;  worker-src 'self';  manifest-src 'self';
object-src 'none';  base-uri 'self';  form-action 'self';  frame-ancestors 'none';
report-uri /api/csp-report
```

- **Nonces:** a fresh nonce per page request; Next.js stamps it on its own scripts (24 nonce attributes on the dashboard). Every page now renders per request (`dynamic = "force-dynamic"` in the root layout) so no page is served without a nonce.
- **`'strict-dynamic'`:** scripts created by already-trusted scripts are allowed — this is how the TradingView loader is permitted without allowing arbitrary hosts.
- **`style-src 'unsafe-inline'`:** kept deliberately — React renders `style=""` attributes and Tailwind/Next inject `<style>`; inline styles cannot run code. Removing it would need a styling rewrite (low value).
- **Dev only:** `'unsafe-eval'` and `ws://localhost` are added only when `NODE_ENV` is not production.
- **Mode switch:** `HALO_CSP=report` sends `Content-Security-Policy-Report-Only` for future testing; default is enforced.
- **Violation reports:** `POST /api/csp-report` (public, size-capped, rate-limited, log-only).

**Testing:**

| Step | Result |
|---|---|
| Report-only crawl: login, pricing, admin, all 18 dashboard views, TV WEB, a Deriv market | ✅ 0 violations (page listener and server report log) |
| Enforced crawl: same pages + account, checkout | ✅ 0 violations; Binance stream live; TradingView script loaded and its iframe created |
| Injected HTML: inline `onload` handler and `javascript:` link | ✅ both blocked (neither ran) |
| Fetch to an unlisted origin | ✅ blocked (`connect-src`) and reported |
| Deriv websocket | ⛔ **unverified** — Deriv's server returned HTTP 520 to both the browser and Node during testing (their outage, not the policy); `wss://ws.derivws.com` is listed |

## 5. Security test results

| # | Test | Result |
|---|---|---|
| 1 | Forged session → API routes and SSE stream | ✅ 401 |
| 2 | Expired session | ✅ 401 (same user with a valid session: 200) |
| 3 | Revoked licence | ✅ 402 "License revoked" |
| 4 | Logout then reuse the session | ✅ 200 before → 401 after |
| 5 | Cross-user journal edit / delete / list | ✅ 404 / 404 / not listed; record untouched |
| 6 | Customer → admin list / plan edit (privilege escalation) | ✅ 403 / 403; registration always creates CUSTOMER |
| 7 | CSRF: state-changing request from another origin | ✅ 403 (new Origin check) — same request from own origin reaches the handler |
| 8 | TradingView webhook wrong secret | ✅ 401 |
| 9 | Paystack bad signature | ✅ 401 |
| 10 | Paystack valid signature, then exact replay | ✅ 200, then `duplicate: true` (idempotent) |
| 11 | Login brute force | ✅ 429 from the 9th attempt per account+IP |
| 12 | Input validation: path-like symbol, malformed JSON, out-of-range EDGE settings | ✅ 400; ✅ 400 (was 500 — fixed); ✅ clamped (minScore 100, cap 0) |
| 13 | Secrets in the browser bundle | ✅ none (only setting *names* in help text) |
| 14 | Unauthorized WebSocket | ✅ the app runs no WebSocket server; the SSE stream needs a valid licence |
| 15 | TradingView webhook replay | ❌ **finding** — the alert payload carries no timestamp or nonce; an identical alert re-sent later is accepted again once no trade is running (needs the secret, which is now protected). Recommended fix in Phase 3 |
| 16 | Flutterwave webhook | ⛔ not tested — no test key; the signature scheme still looks wrong (audit S-finding) |

## 6. Regression results

| Area | Result |
|---|---|
| Dashboard, 18 views, mobile/desktop | ✅ (browser, commercial mode, super admin) |
| Charts / Binance live stream | ✅ stream active, updates flowing |
| TradingView TV WEB | ✅ script + iframe load under the enforced CSP (the frame doesn't paint inside my preview browser — confirm visually in Chrome) |
| Deriv | ⛔ Deriv server outage (HTTP 520) during testing |
| MT5 | ⛔ needs the new MetaApi token and a demo account |
| EDGE engine | ✅ self-test 17/17 |
| Strategy engine | ✅ regression tests pass — no strategy or execution logic was changed |
| Timeframe Scanner Bot | ✅ view loads; API licence-gated; control requires trading |
| HALO chat / voice | ⛔ needs `ANTHROPIC_API_KEY`; route reachable for licensed users |
| Performance Journal | ✅ 90/90 calculations; isolation tests pass |
| Licensing | ✅ revoked/unlicensed/licensed paths behave correctly |
| Super Admin dashboard | ✅ renders with all sections |
| Payment workflows | ⚠ pricing and checkout pages render; signature + replay verified; real provider initiation not tested (no test keys) |
| Type-check / lint | ✅ 0 errors in `src/` / unchanged (153 pre-existing style errors) |

## 7. Files changed in Phase 2

| File | Change |
|---|---|
| `src/proxy.ts` | Per-request nonce CSP for pages (report-only switch), CSRF Origin check for state-changing API requests, `/api/csp-report` public |
| `src/app/api/csp-report/route.ts` | **New** — CSP violation report sink |
| `src/app/layout.tsx` | `dynamic = "force-dynamic"` so every page carries a nonce |
| `next.config.ts` | Static CSP removed (now per request); other headers kept |
| `src/app/api/journal/route.ts` | Malformed JSON returns 400 instead of 500 |
| `docs/GIT-HISTORY-CLEANUP-PLAN.md` | **New** — D3 plan |
| `docs/PHASE2-REPORT-2026-11-02.md` | **New** — this report |

No database schema change. No trading strategy or execution logic changed.

## 8. Remaining vulnerabilities

| Pri | Item |
|---|---|
| P0 | Orders can be placed on simulated/stale prices (needs D2) |
| P0 | Shared bot/broker per installation vs per-customer licences; journal MT5 sync reads the shared account (needs D1) |
| P0 | Old MetaApi token, admin password and DB contents still in git history (needs D3 + rotation) |
| P1 | Device limit not enforced during use |
| P1 | Trade lock not restored after restart |
| P1 | Broker credentials / alert secrets stored unencrypted |
| P1 | Flutterwave signature scheme likely wrong |
| P1 | 5 high-severity dependency advisories (sharp/libvips, prisma, js-yaml, deepmerge-ts) |
| P2 | TradingView webhook replay (no timestamp/nonce in payload) |
| P2 | No rate limits on AI, backtest/compare/autopilot and trading routes |
| P2 | Rate limits are in-memory (fine for one instance) |
| P3 | `style-src 'unsafe-inline'` (low risk, deliberate) |

## 9. Remaining production blockers

1. Decisions D1, D2, D3.
2. New MetaApi token (+ revoke the old one) and a MetaApi **demo** account for MT5 tests.
3. `ANTHROPIC_API_KEY` for chat/voice tests.
4. Paystack and Flutterwave **test** keys.
5. Postgres, Firebase (Blaze) and Cloudflare access for a staging environment; monitoring and backups.

## 10. Recommended Phase 3

1. **Execution safety (after D2):** refuse orders on simulated/stale feeds; restore the trade lock and open-trade link at boot; TradingView webhook replay protection (timestamp + dedupe window).
2. **History rewrite (after D3 and token rotation)** following the prepared plan.
3. **Tenancy (after D1).**
4. **Commerce:** per-request device enforcement, Flutterwave fix + sandbox tests for both providers, encrypted credential storage.
5. **Platform:** dependency upgrades, rate limits on expensive routes, Prisma migrations + Postgres data migration, monitoring/alerting, staging environment and rollback drill.
6. **Staging acceptance:** MT5 demo run, payment sandbox, AI/voice in Chrome, Deriv once their service is up, full regression.
