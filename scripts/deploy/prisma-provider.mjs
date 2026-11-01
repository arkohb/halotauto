#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
//  Switch the Prisma datasource provider for the target environment.
//  Local dev keeps SQLite (db/custom.db). Hosted builds (Firebase App
//  Hosting / Cloud Run) have an ephemeral disk, so they use PostgreSQL —
//  set DATABASE_PROVIDER=postgresql (apphosting.yaml does) or give a
//  postgres:// DATABASE_URL. Rewrites prisma/schema.prisma in place; run it
//  in the build container only.
// ════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaPath = join(root, "prisma", "schema.prisma");
const url = process.env.DATABASE_URL ?? "";
const wanted =
  process.env.DATABASE_PROVIDER ||
  (/^postgres(ql)?:\/\//.test(url) ? "postgresql" : /^mysql:\/\//.test(url) ? "mysql" : "sqlite");

if (!["sqlite", "postgresql", "mysql"].includes(wanted)) {
  console.error(`[prisma-provider] unsupported provider "${wanted}"`);
  process.exit(1);
}

const src = readFileSync(schemaPath, "utf8");
const next = src.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"/,
  `$1"${wanted}"`
);
if (next === src) {
  console.log(`[prisma-provider] provider already "${wanted}"`);
} else {
  writeFileSync(schemaPath, next);
  console.log(`[prisma-provider] datasource provider → "${wanted}"`);
}
