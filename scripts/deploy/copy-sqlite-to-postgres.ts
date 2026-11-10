// ════════════════════════════════════════════════════════════════════════
//  copy-sqlite-to-postgres · move HALO's data into the production database
//
//  Copies EVERY table (users, licences, plans, payments, trades, journal,
//  settings, Pine strategies, broker accounts …) from the local SQLite file
//  into a PostgreSQL database, parents before children so every foreign
//  key resolves. Read-only on the source.
//
//  Safety: refuses to write when the target already holds users or trades
//  (it never overwrites or deletes anything there). Re-running after a
//  partial copy is safe with --resume (existing ids are skipped).
//
//  Usage (secrets come from the environment — never pass them on the
//  command line):
//    SOURCE_DB=db/custom.db TARGET_DATABASE_URL=… npx tsx scripts/deploy/copy-sqlite-to-postgres.ts
//    … --push      also create/update the tables first (prisma db push)
//    … --resume    allow a target that already has rows (skips existing ids)
//    … --dry-run   count source rows only, write nothing
// ════════════════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PrismaClient, Prisma } from "@prisma/client";

const root = path.resolve(__dirname, "..", "..");
const args = new Set(process.argv.slice(2));
const sourceDb = path.resolve(root, process.env.SOURCE_DB || "db/custom.db");
const targetUrl = process.env.TARGET_DATABASE_URL || "";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
if (!existsSync(sourceDb)) fail(`source database not found: ${sourceDb}`);
if (!args.has("--dry-run") && !/^postgres(ql)?:\/\//.test(targetUrl)) fail("TARGET_DATABASE_URL must be a postgres:// connection string");

// ── a Prisma client for PostgreSQL, generated beside the normal one ─────
const pgOut = path.join(root, "node_modules", ".halo-pg-client");
function ensurePgClient(): void {
  const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8")
    .replace(/(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]+"/, '$1"postgresql"')
    .replace(/generator\s+client\s*\{[^}]*\}/, `generator client {\n  provider = "prisma-client-js"\n  output   = "${pgOut.replace(/\\/g, "/")}"\n}`);
  mkdirSync(pgOut, { recursive: true });
  const schemaPath = path.join(pgOut, "schema.pg.prisma");
  writeFileSync(schemaPath, schema);
  const prismaBin = path.join(root, "node_modules", ".bin", "prisma");
  execFileSync(prismaBin, ["generate", "--schema", schemaPath], { stdio: "inherit", cwd: root });
  if (args.has("--push")) {
    execFileSync(prismaBin, ["db", "push", "--skip-generate", "--schema", schemaPath], {
      stdio: "inherit",
      cwd: root,
      env: { ...process.env, DATABASE_URL: targetUrl },
    });
  }
}

// ── parents before children (from the schema's relations) ─────────────
function copyOrder(): string[] {
  const models = Prisma.dmmf.datamodel.models;
  const deps = new Map<string, Set<string>>();
  for (const m of models) {
    const d = new Set<string>();
    for (const f of m.fields) if (f.kind === "object" && f.relationFromFields && f.relationFromFields.length > 0 && f.type !== m.name) d.add(f.type);
    deps.set(m.name, d);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const d of deps.get(n) ?? []) visit(d);
    out.push(n);
  };
  for (const m of models) visit(m.name);
  return out;
}

const delegate = (client: unknown, model: string) =>
  (client as Record<string, { findMany: (a: object) => Promise<Record<string, unknown>[]>; createMany: (a: object) => Promise<{ count: number }>; count: () => Promise<number> }>)[model.charAt(0).toLowerCase() + model.slice(1)];

async function main() {
  const src = new PrismaClient({ datasources: { db: { url: `file:${sourceDb}` } } });
  const order = copyOrder();
  console.log(`source: ${path.relative(root, sourceDb)} · ${order.length} tables`);

  if (args.has("--dry-run")) {
    for (const m of order) console.log(`  ${m.padEnd(20)} ${await delegate(src, m).count()}`);
    await src.$disconnect();
    return;
  }

  ensurePgClient();
  const req = createRequire(path.join(pgOut, "index.js"));
  const { PrismaClient: PgClient } = req(pgOut) as { PrismaClient: new (o: object) => PrismaClient };
  const dst = new PgClient({ datasources: { db: { url: targetUrl } } });

  const existingUsers = await delegate(dst, "User").count();
  const existingTrades = await delegate(dst, "Trade").count();
  if ((existingUsers > 0 || existingTrades > 0) && !args.has("--resume")) {
    fail(`the target already has ${existingUsers} users and ${existingTrades} trades — refusing to write (use --resume to add only missing rows)`);
  }

  const report: string[] = [];
  let mismatch = 0;
  for (const m of order) {
    const from = delegate(src, m);
    const to = delegate(dst, m);
    const total = await from.count();
    let copied = 0;
    const PAGE = 500;
    for (let skip = 0; skip < total; skip += PAGE) {
      const rows = await from.findMany({ skip, take: PAGE, orderBy: { id: "asc" } } as object).catch(async () =>
        // tables keyed by something other than `id`
        from.findMany({ skip, take: PAGE })
      );
      if (rows.length === 0) break;
      const r = await to.createMany({ data: rows, skipDuplicates: true });
      copied += r.count;
    }
    const after = await to.count();
    const ok = after >= total;
    if (!ok) mismatch++;
    report.push(`  ${ok ? "✓" : "✗"} ${m.padEnd(20)} source ${String(total).padStart(6)} · target ${String(after).padStart(6)}${copied !== total ? ` (inserted ${copied})` : ""}`);
  }
  console.log(report.join("\n"));
  await src.$disconnect();
  await dst.$disconnect();
  if (mismatch) fail(`${mismatch} table(s) did not copy completely`);
  console.log("✓ copy complete — every table in the target has at least the source's rows");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
