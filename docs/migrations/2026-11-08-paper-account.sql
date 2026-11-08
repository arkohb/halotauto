-- 2026-11-08 · Persistent paper (demo) balance
-- Additive only: one new table, one new column with a default. No rows are
-- rewritten, no table is rebuilt, nothing is dropped.
-- Back up db/custom.db first (sqlite3 db/custom.db ".backup '<path>'").
-- Rollback: restore the backup (SQLite cannot drop a column on older builds).

CREATE TABLE IF NOT EXISTS "PaperAccount" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
    "balance" REAL NOT NULL DEFAULT 100000,
    "startingBalance" REAL NOT NULL DEFAULT 100000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" DATETIME NOT NULL
);

ALTER TABLE "Trade" ADD COLUMN "pnlBooked" BOOLEAN NOT NULL DEFAULT false;
