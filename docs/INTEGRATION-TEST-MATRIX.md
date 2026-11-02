# External integration test matrix

**As of 2 November 2026.** ✅ verified by a test · ❌ test failed · ⛔ not verified (credentials or service unavailable) · — not applicable.
Credentials being configured never counts as "works".

| Integration | Configuration | Authentication | Connection | Core functionality | Error handling | Security |
|---|---|---|---|---|---|---|
| **A. MetaApi / MT5 demo** | ⛔ no `METAAPI_TOKEN` set (code path ✅: env only) | ⛔ (invalid token correctly rejected ✅) | ✅ strict TLS to provisioning, new-york, london hosts | ⛔ | ✅ missing token, invalid token, self-signed cert | ✅ token never logged, never in browser code or errors; no insecure TLS |
| **B. Paystack test** | ⛔ no test keys | ⛔ | ⛔ | ⛔ checkout → verify → licence | ✅ bad signature 401; replay → duplicate (placeholder key) | ✅ HMAC-SHA512, constant-time, idempotent, amount check |
| **C. Flutterwave test** | ⛔ no test keys | ⛔ | ⛔ | ⛔ | ⛔ | ❌ signature scheme likely wrong (fails closed) — fix with test keys |
| **D. Claude (chat/voice)** | ⛔ no `ANTHROPIC_API_KEY` | ⛔ (invalid key → clear message ✅) | ✅ requests reach the API (401 with a bad key) | ⛔ real reply | ✅ missing/invalid key, refusal path in code | ✅ key server-side only (0 occurrences in browser code) |
| **E. Deriv** | ✅ public endpoint, `app_id` 1089, CSP allows only `wss://ws.derivws.com` | — (public data) | ❌ Deriv returns HTTP 520 (their side) at every attempt today | ⛔ chart tick stream | ✅ chart keeps rendering; price guard refuses simulated synthetics | ✅ |

## A. MetaApi / MT5 — secure configuration, then tests

**Configure (you; never paste the token into chat, issues or docs):**
1. app.metaapi.cloud → API access → **revoke** the old token.
2. Create a new token. Store it in your password manager.
3. Local: open `.env` in an editor and add a line `METAAPI_TOKEN="<token>"`. `.env` is git-ignored. Restart the app.
4. Hosted (later): `firebase apphosting:secrets:set METAAPI_TOKEN` (the CLI prompts; nothing is echoed).
5. Tell me it's done. I'll check that the server sees *a* token without printing it.

**Tests (demo account only):**

| # | Test | Pass criteria |
|---|---|---|
| A1 | Authentication | Brokers & MT5 → TEST returns account info |
| A2 | Demo account connectivity | MT demo login connects through MetaApi; status "connected" |
| A3 | Account information | balance, equity, margin match the MT5 terminal |
| A4 | Instrument information | symbol spec (digits, volume min/step) for the traded symbol |
| A5 | Market price | `getQuote` bid/ask within a few points of the terminal; quote time < 15 s |
| A6 | Trade history | journal MT5 sync imports demo deals; deposits kept separate |
| A7 | Order submission (demo) | paper → live on the **demo** account; one small order with SL/TP; appears in the terminal with the same SL/TP |
| A8 | Rejection handling | invalid volume / closed market → clear error, REJECTED record, no retry storm |
| A9 | Interruption and recovery | network cut during a session → reconnects; open demo position keeps broker SL/TP; no duplicate order |
| A10 | Price guard live path | threshold unset → refused; threshold set → quote compared; far quote → refused |

## B. Paystack (test mode)
Needs `PAYSTACK_SECRET_KEY` = an `sk_test_…` key. Tests: initiate checkout (test card) → webhook received and signature valid → payment verified server-side → licence issued once → replay ignored → failed card → no licence → amount mismatch → DISPUTED.

## C. Flutterwave (test mode)
Needs `FLUTTERWAVE_SECRET_KEY` (test) and the dashboard "secret hash". First fix the webhook verification to Flutterwave's documented scheme, then the same flow as B.

## D. Claude
Needs `ANTHROPIC_API_KEY`. Tests: chat question answered from the live snapshot; consequential command asks for confirmation and runs only for the same account; journal insights answer from real statistics; voice in Chrome with the microphone allowed (wake word → reply spoken); invalid key → clear message.

## E. Deriv
No credentials. Re-test when Deriv's endpoint stops returning HTTP 520: chart on a synthetic index streams ticks; the price guard still refuses **orders** on synthetics (server-side prices are simulated until a server-side Deriv feed exists).
