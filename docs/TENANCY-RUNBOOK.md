# Decision A (approved) — one installation per customer

**Approved:** one independent installation per customer for the commercial pilot.
**Code change needed:** none. HALO keeps every customer-specific item in its own database or its own server secrets, so separate installations are isolated by construction. This runbook covers how to run it safely.

## 1. What each customer installation has of its own

| Item | Where it lives | Isolation |
|---|---|---|
| Users, sessions, admin accounts | installation database | ✅ tested — sessions don't cross installations |
| Licences, device activations, payments | installation database | ✅ tested — another installation's licence key is unknown |
| MT5 / broker connections and credentials | installation database (`BrokerAccount`) | ✅ tested — separate lists |
| TradingView webhook secret | installation database (`WebhookConfig`) | ✅ tested — another installation's secret is rejected |
| Journal records | installation database (+ per-user inside it) | ✅ tested — other installation's trade id → 404 |
| Scanner watchlists, Scanner Bot state, bot settings, trade book | installation database + its own process memory | ✅ tested — separate |
| `METAAPI_TOKEN`, `ANTHROPIC_API_KEY`, `HALO_CRON_SECRET`, payment keys | that installation's secret manager | ✅ tested — another installation's cron secret does not tick |
| Domain | its own subdomain (e.g. `customer-a.halo…`) | — |

### Isolation test (2 Nov 2026)
Two installations ran side by side, each with its own database. Results: sessions rejected across installations both ways; broker lists 2 vs 0; webhook secrets differ and are rejected across; licence key from A → 404 on B; journal record from A → 404 on B; scanner and trade records separate; keep-alive secret not shared.

## 2. Provisioning a customer (per installation)

1. **Database:** a new Postgres database (own user and password). Never share a database between customers.
2. **Firebase App Hosting backend:** `firebase apphosting:backends:create --backend halo-<customer>`; `apphosting.yaml` unchanged (1 instance).
3. **Secrets for that backend only:** `DATABASE_URL`, `METAAPI_TOKEN` (customer's own MetaApi token or yours, per your commercial terms), `ANTHROPIC_API_KEY`, `HALO_CRON_SECRET` (unique random value), payment keys if that installation takes payments.
4. **Domain:** Cloudflare DNS for `<customer>.yourdomain` → that backend; SSL Full (strict); `/api/*` not cached.
5. **Keep-alive worker:** one per installation (or one worker with a list), using that installation's `HALO_CRON_SECRET`.
6. **First admin:** run `scripts/admin-credentials.ts` against that database (`ADMIN_EMAIL`/`ADMIN_PASSWORD` env; password never printed).
7. **Close public sign-up:** Admin → Settings → registration closed; invite the customer's users instead.
8. **Licence:** issue the customer's licence from that installation's admin dashboard; the customer activates it there.

## 3. Administrator access

- Each installation has its own Super Admin. Use a distinct password per installation, stored in a password manager.
- Your operator access to a customer installation is a separate admin account on that installation — removable by deleting the account.
- Admin actions are recorded in that installation's audit log.

## 4. Backups and recovery

- Postgres provider daily snapshots + point-in-time recovery, retained ≥ 14 days, **per installation**.
- Before every update: manual snapshot.
- Restore drill once before launch: restore a snapshot into a scratch database, point a staging backend at it, verify login, journal and trade book.

## 5. Updates and maintenance

- Every installation deploys the **same tagged release** from git.
- Roll out to a staging installation first, then one pilot customer, then the rest.
- Each App Hosting backend keeps its previous rollout; rollback = re-promote the previous rollout in the Firebase console (per installation).
- Database changes: run the reviewed diff per installation before deploying (see `MIGRATION-RUNBOOK-2026-11-02.md`).

## 6. Operational limitations

- **Cost scales per customer:** each installation runs one always-on instance plus a database (estimate $25–60/month each). Price it into the offer.
- **Operational load:** N installations to update, monitor and back up. A provisioning script and a release checklist are needed beyond a handful of customers.
- **No cross-customer features:** there's no shared dashboard across customers. Each installation is managed on its own.
- **Regulatory:** running trading on customers' broker accounts may be regulated in some jurisdictions — take advice (not legal advice).
