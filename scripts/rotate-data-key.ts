// ══════════════════════════════════════════════════════════════════════════
//  rotate-data-key · replace HALO_DATA_KEY and re-encrypt every stored secret
//
//  Run with the app STOPPED and a verified backup of db/custom.db and .env:
//    npx tsx --env-file=.env scripts/rotate-data-key.ts --backup-dir ~/HALO-backups/<folder>
//  The backup folder must contain custom.db and env.backup (made beforehand).
//
//  Steps (prints counts and key ids only — never a key or a secret):
//    1. find every enc:v1 value in every table/column; decrypt all with the
//       OLD key (abort if any fails)
//    2. generate a NEW 32-byte key; encrypt every value with it
//    3. write the NEW key into .env (atomic temp-file rename)
//    4. update the database in ONE transaction (each row guarded by its old
//       value); on failure .env is restored
//    5. read everything back with the NEW key and compare to the plaintext;
//       on any mismatch both db/custom.db and .env are restored from backup
// ══════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { isSealed, open, seal } from "../src/lib/secret-box";

const args = process.argv.slice(2);
const backupDir = args[args.indexOf("--backup-dir") + 1] ?? "";
const ENV = path.join(process.cwd(), ".env");
const DB = path.join(process.cwd(), "db", "custom.db");
const keyId = (b64: string) => crypto.createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").slice(0, 8);
const die = (m: string): never => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

async function main() {
  if (!backupDir || !fs.existsSync(path.join(backupDir, "custom.db")) || !fs.existsSync(path.join(backupDir, "env.backup"))) {
    die("pass --backup-dir <folder> containing custom.db and env.backup made just before running");
  }
  const OLD = String(process.env.HALO_DATA_KEY ?? "").trim();
  if (!OLD) die("HALO_DATA_KEY is not set (run with --env-file=.env)");
  const NEW = crypto.randomBytes(32).toString("base64");
  console.log(`old key id ${keyId(OLD)} → new key id ${keyId(NEW)}`);

  const db = new PrismaClient({ log: ["error"] });
  // 1 · inventory + decrypt with OLD
  const tables = await db.$queryRawUnsafe<Array<{ name: string }>>("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_prisma%'");
  type Item = { table: string; col: string; rowid: number; oldVal: string; plain: string; newVal?: string };
  const items: Item[] = [];
  process.env.HALO_DATA_KEY = OLD;
  for (const { name: t } of tables) {
    const cols = await db.$queryRawUnsafe<Array<{ name: string; type: string }>>(`select name, type from pragma_table_info('${t.replace(/'/g, "''")}')`);
    for (const { name: c, type } of cols) {
      if (type && !/TEXT/i.test(type)) continue;
      const rows = await db.$queryRawUnsafe<Array<{ rid: bigint | number; v: string }>>(`select rowid as rid, "${c}" as v from "${t}" where "${c}" like 'enc:v1:%'`);
      for (const r of rows) {
        let plain: string;
        try {
          plain = open(r.v);
        } catch (e) {
          await db.$disconnect();
          return die(`${t}.${c} row ${r.rid} does not decrypt with the current key (${(e as Error).message}) — nothing changed`);
        }
        items.push({ table: t, col: c, rowid: Number(r.rid), oldVal: r.v, plain });
      }
    }
  }
  console.log(`found ${items.length} encrypted value(s): ${[...new Set(items.map((i) => `${i.table}.${i.col}`))].join(", ")}`);
  if (!items.length) {
    await db.$disconnect();
    return die("nothing to rotate");
  }

  // 2 · encrypt with NEW
  process.env.HALO_DATA_KEY = NEW;
  for (const it of items) {
    it.newVal = seal(it.plain);
    if (!isSealed(it.newVal) || open(it.newVal) !== it.plain) die("self-check of the new encryption failed — nothing changed");
  }

  // 3 · new key into .env (atomic)
  const envText = fs.readFileSync(ENV, "utf8");
  if (!/^HALO_DATA_KEY=.*$/m.test(envText)) die(".env has no HALO_DATA_KEY line — nothing changed");
  const tmp = `${ENV}.rotate-tmp`;
  fs.writeFileSync(tmp, envText.replace(/^HALO_DATA_KEY=.*$/m, `HALO_DATA_KEY="${NEW}"`), { mode: 0o600 });
  fs.renameSync(tmp, ENV);
  console.log("✔ new key written to .env");

  // 4 · database, one transaction
  try {
    await db.$transaction(
      items.map((it) => db.$executeRawUnsafe(`update "${it.table}" set "${it.col}" = ? where rowid = ? and "${it.col}" = ?`, it.newVal, it.rowid, it.oldVal))
    ).then((counts) => {
      if (counts.some((n) => n !== 1)) throw new Error("a row changed during rotation");
    });
  } catch (e) {
    fs.copyFileSync(path.join(backupDir, "env.backup"), ENV);
    fs.chmodSync(ENV, 0o600);
    await db.$disconnect();
    return die(`database update failed and was rolled back; .env restored to the old key (${(e as Error).message})`);
  }
  console.log(`✔ ${items.length} value(s) re-encrypted in one transaction`);

  // 5 · verify with NEW
  let bad = 0;
  for (const it of items) {
    const rows = await db.$queryRawUnsafe<Array<{ v: string }>>(`select "${it.col}" as v from "${it.table}" where rowid = ?`, it.rowid);
    const v = rows[0]?.v ?? "";
    let ok = false;
    try {
      ok = v.includes(keyId(NEW)) && open(v) === it.plain;
    } catch {
      ok = false;
    }
    if (!ok) bad++;
  }
  await db.$disconnect();
  if (bad) {
    fs.copyFileSync(path.join(backupDir, "custom.db"), DB);
    fs.copyFileSync(path.join(backupDir, "env.backup"), ENV);
    fs.chmodSync(ENV, 0o600);
    return die(`${bad} value(s) failed verification — database and .env RESTORED from backup`);
  }
  console.log(`✔ verified: all ${items.length} value(s) decrypt with the new key to exactly the original`);
  console.log("Next: copy the new HALO_DATA_KEY from .env into your password manager (replace the old entry).");
}

main().catch((e) => die((e as Error).message));
