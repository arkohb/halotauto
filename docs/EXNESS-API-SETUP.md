# Exness Trader API: live prices for HALO

HALO can take **live ticks and candles straight from your Exness trading account** through Exness's official Trader API ([www.exness-api.com](https://www.exness-api.com/)). There's no MT5 to keep running. HALO uses it for **market data only** and never trades through it.

Price sources for forex, metals and indices are tried in this order:
1. **Exness Trader API** (this guide).
2. MT5 via the HALO Bridge EA, if it's online.
3. OANDA practice, if configured.
4. Yahoo.

When an Exness source is live, the chart badge shows **EXNESS LIVE**.

> The **Partnership API** key from the partner area won't work here. It's for reports and rebates, with no prices. You need a **Trading** key.

## 1. Create a Trading API key (Exness Personal Area)
1. Sign in to your Exness **trading** Personal Area, not the partner area.
2. Open **Key Management** and create an API key.
   - Select the trading account the key can access.
   - Give it market-data access. HALO doesn't need trading permissions.
   - The docs don't say whether demo accounts are supported. Try it with your demo account selected.
3. Save these in your password manager:
   - the **API key id** (starts with `exnsk-`),
   - the **private key** (128 hex characters if Exness generated it, or your own PEM),
   - the **Gateway host** from the DNS widget on the same page,
   - your **trading account number**.

## 2. Put them in `.env` (never in chat or code)
```bash
open -e "/Users/ant/Documents/Halo-Edge Autotrader/.env"
```
Add four lines, then save:
```
EXNESS_API_KEY="exnsk-…"
EXNESS_API_SECRET="the-private-key"
EXNESS_GATEWAY_URL="https://…"
EXNESS_ACCOUNT_ID="12345678"
```
Restart HALO afterwards.

## 3. Check
The chart badge should read **EXNESS LIVE**, and **Admin → Execution → System Health → Price data** should say `source exness`.

If it doesn't:
- A wrong or mismatched key shows as `HTTP 401 AUTH_INVALID_SIGNATURE`.
- A symbol your account doesn't offer is reported by name.
- HALO pauses the API for 60 seconds after an error and uses the next source in the meantime.

## How it works (for reviewers)
- **Signing:** every request is signed with Ed25519 using the `EXN-*` headers. It's verified against Exness's published test vector in `scripts/exness-api-test.ts`.
- **Access point:** discovered once via the Gateway (`/v1/trading/access-point`) and cached for 6 hours.
- **Candles:** `GET /v1/market-data/accounts/{id}/candles`, bid prices, timeframes M1–D1, UTC times.
- **Live ticks:** signed WebSocket `/v1/server-events/accounts/{id}/ws/ticks`, using your account's own instrument names (e.g. `XAUUSDm`).
- **Code:** `src/lib/exness-api.ts` and `src/lib/exness-feed.ts`.
