# Database migration runbook (through Phase 5)

**Status:** reviewed and rehearsed on a consistent copy of your real database. **Not applied** to your real database — waiting for your authorisation.

## 1. Which database

`db/custom.db` is the only database file in the project and holds your data (8 users, 22 trades, 4 licences at the time of review). Your `.env` currently points `DATABASE_URL` at a path that does not exist (Prisma P1003, a leftover from the original build platform). Fix it first (step 1).

## 2. What changes

Full SQL, reviewed: [`docs/migrations/2026-11-02-full-schema-to-phase5.sql`](migrations/2026-11-02-full-schema-to-phase5.sql) (no secrets inside).

| Change | Phase | Effect on existing data |
|---|---|---|
| New tables `EdgeSettings`, `AutopilotProfile` | EDGE | none |
| New table `TvAlertEvent` (+ index) | 3 — webhook replay protection | none |
| New tables `ExecutionIntent`, `ExecutionEvent`, `ExecutionLock` (+ indexes) | 5 — persistent execution lock | none |
| `Trade` + `grade`, `gradeLetter`, `sizeMult`, `partialPips` | EDGE | defaults; table rebuilt (rows copied, then old table dropped) |
| `LicenseActivation` + `slot` and unique index `(licenseId, slot)` | 5 — device limits | existing rows get an empty slot; slots are filled automatically on the next activation |
| `Session` + `activationId` | 5 — device binding | empty on existing sessions; browsers re-link automatically |

Nothing that holds data is removed. The only `DROP` is the old `Trade` table after its rows are copied.

**Why not `npm run db:push`:** Prisma stops on the new unique index with a generic "might be data loss" warning (it can't know the column is new and empty). The safe flag-free command correctly refuses, and we never use `--accept-data-loss`. So the reviewed SQL is applied directly instead.

## 3. Rehearsal (2 Nov 2026, copy of `db/custom.db`)

| Check | Result |
|---|---|
| Existing tables: row counts + content of every original column | 24 / 24 identical |
| Schema matches the code afterwards | yes (`migrate diff --exit-code` = 0) |
| `PRAGMA integrity_check` / foreign keys | ok / 0 violations |
| Credential encryption (5 plaintext values) | encrypted and verified 5/5 |
| Plaintext credential fields left in the file | 0 (also after `VACUUM`) |

## 4. Steps (run them yourself, app stopped)

```bash
# 1. in .env (not committed) set:  DATABASE_URL="file:../db/custom.db"
#    then confirm the planned SQL matches the reviewed file (no output from diff = identical)
npm run db:diff > /tmp/halo-plan.sql; diff <(grep -v '^--' /tmp/halo-plan.sql) <(grep -v '^--' docs/migrations/2026-11-02-full-schema-to-phase5.sql)
```

```bash
# 2. consistent backup (db/*.db is git-ignored) and check it
sqlite3 db/custom.db ".backup 'db/backup-pre-phase5.db'" && sqlite3 db/backup-pre-phase5.db "pragma integrity_check;"
```

```bash
# 3. counts before
for t in User Trade License LicenseActivation JournalTrade BrokerAccount Payment; do echo "$t $(sqlite3 db/custom.db "select count(*) from \"$t\";")"; done
```

```bash
# 4. apply the reviewed SQL
sqlite3 db/custom.db < docs/migrations/2026-11-02-full-schema-to-phase5.sql
```

```bash
# 5. verify: counts unchanged, integrity ok, schema in sync (exit 0)
for t in User Trade License LicenseActivation JournalTrade BrokerAccount Payment; do echo "$t $(sqlite3 db/custom.db "select count(*) from \"$t\";")"; done
sqlite3 db/custom.db "pragma integrity_check;"
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code && echo "in sync"
```

```bash
# 6. credential encryption key: generate once, put it in .env as HALO_DATA_KEY="…" (never commit it;
#    keep a copy in your password manager — without it the encrypted credentials cannot be read)
openssl rand -base64 32
```

```bash
# 7. encrypt stored credentials: dry run, then apply, then purge freed pages
npx tsx scripts/encrypt-credentials.ts
npx tsx scripts/encrypt-credentials.ts --apply
sqlite3 db/custom.db "VACUUM;"
```

Then start the app. Signed-in customers re-link their browser automatically. Super Admins are unaffected.

## 5. Rollback

```bash
# app stopped: restore the backup over the live file
cp db/backup-pre-phase5.db db/custom.db
```

Previous code versions work with the restored file. Old backups made **before** step 7 still contain plaintext credentials. Delete them once you're satisfied, and rotate those credentials anyway (they're also in git history).

## 6. Production (Postgres)

Same order: provider snapshot, then `prisma migrate diff` against production, review, apply, set `HALO_DATA_KEY` in Secret Manager, run `scripts/encrypt-credentials.ts --apply` once. Moving to versioned `prisma migrate` migrations is recommended before launch.
