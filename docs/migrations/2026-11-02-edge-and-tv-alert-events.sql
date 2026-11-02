-- CreateTable
CREATE TABLE "EdgeSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'main',
    "json" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AutopilotProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "inSampleJson" TEXT NOT NULL,
    "oosJson" TEXT NOT NULL,
    "baseJson" TEXT NOT NULL,
    "combos" INTEGER NOT NULL,
    "bars" INTEGER NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "verdict" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TvAlertEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "alertTs" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL,
    "execMode" TEXT NOT NULL DEFAULT 'PAPER',
    "brokerKind" TEXT NOT NULL DEFAULT '',
    "brokerOrderId" TEXT NOT NULL DEFAULT '',
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "direction" INTEGER NOT NULL,
    "entry" REAL NOT NULL,
    "sl" REAL NOT NULL,
    "tp" REAL NOT NULL,
    "riskPips" REAL NOT NULL,
    "rewardPips" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "resultPips" REAL,
    "levelTop" REAL NOT NULL,
    "levelBot" REAL NOT NULL,
    "slMode" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "grade" INTEGER,
    "gradeLetter" TEXT NOT NULL DEFAULT '',
    "sizeMult" REAL NOT NULL DEFAULT 1,
    "partialPips" REAL,
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Trade" ("brokerKind", "brokerOrderId", "closedAt", "createdAt", "direction", "entry", "execMode", "id", "levelBot", "levelTop", "mode", "note", "openedAt", "resultPips", "rewardPips", "riskPips", "sl", "slMode", "status", "symbol", "timeframe", "tp") SELECT "brokerKind", "brokerOrderId", "closedAt", "createdAt", "direction", "entry", "execMode", "id", "levelBot", "levelTop", "mode", "note", "openedAt", "resultPips", "rewardPips", "riskPips", "sl", "slMode", "status", "symbol", "timeframe", "tp" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TvAlertEvent_receivedAt_idx" ON "TvAlertEvent"("receivedAt");

