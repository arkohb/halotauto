# Decision A — Customer tenancy and data isolation

**Status:** awaiting your decision. Nothing in this document has been implemented.

## The problem

Licensing sells per-customer licences, but the trading side of HALO is built for **one owner per installation**:

| Shared per installation (one copy) | Per user (isolated) |
|---|---|
| `BotConfig "main"` (symbol, timeframe, strategy settings, execution mode, sizing) · `BrokerAccount` (all broker credentials) · `Trade` book · `AlertSettings` (Telegram/SMTP) · `WebhookConfig "tv"` (one TradingView secret) · `EdgeSettings "main"` · `AutopilotProfile` · `TraderProfile "main"` · scanner/sweep/Scanner Bot runtime · the in-memory bot engine and trade lock | `User`, `Session`, `License`, `LicenseActivation`, `Payment`, `JournalTrade`/`JournalState`/`JournalEquity` |

In a multi-customer deployment today, every licensed customer would read and control the **same** bot, the **same** broker account and the **same** trade book. Journal MT5 sync also reads the shared MetaApi account.

## Options

### Option 1 — One installation per customer (dedicated deployment)

Each customer gets their own Firebase App Hosting backend, database and secrets. Inside an installation, "users" are the customer and their staff.

- **Security:** strongest isolation — separate process, database and secrets per customer; a bug cannot leak data across customers.
- **Code change:** small. Licensing binds to the installation; admin roles stay as they are. No change to the trading engine.
- **Operations:** one deployment per customer. Needs a provisioning script (create backend, database, secrets, DNS), an update rollout to every installation, and per-customer monitoring.
- **Cost:** roughly $25–60/month per customer for an always-on single instance + small Postgres (estimate). Must be priced into the offer or charged as hosting.
- **Scale:** linear and predictable; one customer's load never affects another.

### Option 2 — Shared multi-tenant platform

One deployment; every trading record gets an owner and every engine runs per customer.

- **Security:** isolation depends on every query and route being scoped correctly — a single missed `userId` filter leaks one customer's broker credentials or trades to another. Needs systematic tests and review.
- **Code change:** large. `userId` added to ~12 models; every trading/broker/alert/webhook/EDGE route scoped; the in-memory bot, trade lock, scanner and sweep become per-tenant; per-tenant TradingView secrets; journal sync restricted to the user's own accounts.
- **Operations:** one deployment, but one Node process cannot run hundreds of engines — this needs a worker architecture (job queue + engine workers), horizontal scaling and per-tenant rate limits.
- **Cost:** cheaper per customer at scale; much higher build and test cost up front.
- **Risk:** highest — it rewrites the execution runtime the strategy runs in.

### Option 3 — Shared platform, signals only (customers execute on their own side)

The shared platform keeps accounts, licensing, journal, AI, the Scanner Bot and EDGE analytics, but does **not** hold broker credentials or place orders. Customers execute through their own MT5 EA / TradingView alerts / their own installation.

- **Security:** the platform never stores customers' broker credentials — the most sensitive data disappears.
- **Code change:** moderate — remove/disable execution features in the shared deployment; per-user isolation for the remaining features (journal is already isolated).
- **Operations:** simplest shared service.
- **Product impact:** HALO stops being an autotrader for customers on the shared service; automation moves to the customer's side.

## Regulatory note (not legal advice)

Placing trades on customers' broker accounts on their behalf (Options 1 and 2 as a hosted service) may be a regulated activity in some jurisdictions. Option 3 and self-hosted installations reduce that exposure. Take advice before commercial launch.

## Recommendation

**Option 1 for the controlled pilot**, because it matches the existing design, needs no change to the trading engine and gives the strongest isolation. Re-evaluate Option 3 (or a later Option 2) once customer numbers make per-customer deployments impractical.

Immediate safeguards under Option 1:
- Journal MT5 sync restricted to the installation owner's accounts (the installation is one customer, so this is consistent).
- Registration on a customer's installation limited to invited users (no public sign-up).

## Tests required (Option 1)

1. Provision two installations; confirm no shared database, secrets or sessions.
2. A session from installation A is rejected by installation B.
3. Licence bound to installation; activation on another installation refused.
4. Invited-user registration only; public `/register` disabled per installation.
5. Full regression on each installation (dashboard, bot paper mode, journal, scanner, EDGE).
6. Update rollout: deploy a new version to both; both healthy; rollback on one.
