# Database migration runbook — EDGE + TradingView alert events

**Status:** reviewed and rehearsed on a copy of your real database. **Not applied** to your real database.

## 1. What changes (exact diff: your `db/custom.db` → current schema)

Generated with `prisma migrate diff` from a read-only copy of `db/custom.db`. Full SQL: [`docs/migrations/2026-11-02-edge-and-tv-alert-events.sql`](migrations/2026-11-02-edge-and-tv-alert-events.sql).

| Change | Type | Effect on existing data |
|---|---|---|
| `CREATE TABLE "EdgeSettings"` | addition | none |
| `CREATE TABLE "AutopilotProfile"` | addition | none |
| `CREATE TABLE "TvAlertEvent"` + index | addition | none |
| `Trade`: add `grade` (NULL), `gradeLetter` (`''`), `sizeMult` (`1`), `partialPips` (NULL) | addition | existing trades get the defaults shown |
| `Trade` table rebuild (`new_Trade` → copy all rows → `DROP TABLE "Trade"` → rename) | **how SQLite adds columns here** | rows copied before the old table is dropped; nothing removed |

No column or table that holds data is removed. The only `DROP` is the old `Trade` table **after** its rows have been copied into the new one.

## 2. Rehearsal result (copy of your database)

| Check | Result |
|---|---|
| Existing tables compared (row count + content of every original column) | 24 / 24 identical |
| `Trade` rows | 22 → 22 |
| New tables created | `EdgeSettings`, `AutopilotProfile`, `TvAlertEvent` |
| New `Trade` columns and defaults | `grade=NULL`, `gradeLetter=''`, `sizeMult=1`, `partialPips=NULL` |
| `PRAGMA integrity_check` | ok |
| Foreign-key check | 0 violations |
| Schema matches after migration | yes (`migrate diff --exit-code` = 0) |

## 3. Two problems found and fixed first

1. **`npm run db:push` ran `prisma db push --accept-data-loss`** — that flag silently accepts destructive changes. It is now plain `prisma db push`, which stops and asks if a change would lose data. New helper: `npm run db:diff` previews the SQL.
2. **Your `.env` `DATABASE_URL` points to a database that does not exist** (Prisma error P1003 — most likely a path left over from the original build platform). The app's real data is in `db/custom.db`. Set (in `.env`, not committed):
   `DATABASE_URL="file:../db/custom.db"`  (the path is relative to the `prisma/` folder)

## 4. Steps (run them yourself, in order)

```bash
# 1. stop the app (Ctrl+C in the terminal running it)
```

```bash
# 2. fix DATABASE_URL in .env as shown in §3, then confirm Prisma sees the database (no error = OK)
npm run db:diff
```

```bash
# 3. consistent backup (db/*.db files are git-ignored)
sqlite3 db/custom.db ".backup 'db/backup-2026-11-02.db'" && sqlite3 db/backup-2026-11-02.db "pragma integrity_check;"
```

```bash
# 4. record row counts before
for t in Trade User License JournalTrade BrokerAccount BotConfig; do echo "$t $(sqlite3 db/custom.db "select count(*) from \"$t\";")"; done
```

```bash
# 5. apply — if Prisma ever asks you to accept data loss, answer NO and stop
npm run db:push
```

```bash
# 6. verify: new tables exist, counts unchanged, schema in sync
sqlite3 db/custom.db ".tables" | tr -s ' ' '\n' | grep -E "TvAlertEvent|EdgeSettings|AutopilotProfile"
for t in Trade User License JournalTrade BrokerAccount BotConfig; do echo "$t $(sqlite3 db/custom.db "select count(*) from \"$t\";")"; done
sqlite3 db/custom.db "pragma integrity_check;"
```

Expected: the three table names print, the counts match step 4, and the integrity check says `ok`.

## 5. Rollback

```bash
# stop the app first, then restore the backup over the live file
cp db/backup-2026-11-02.db db/custom.db
```

The previous code still works with the restored database because the change only **adds** tables and columns.

## 6. Production (Postgres)

The hosted build runs `prisma db push` against Postgres (`build:apphosting`). Before the first production deploy: take a provider snapshot, run the same diff against production (`prisma migrate diff --from-url <prod> --to-schema-datamodel prisma/schema.prisma --script`), review it, then deploy. Moving to versioned Prisma migrations (`prisma migrate`) is recommended before launch (Phase 5).
