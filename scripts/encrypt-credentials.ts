// ════════════════════════════════════════════════════════════════════════
//  One-off migration: encrypt credentials stored in plain text.
//    DATABASE_URL=… HALO_DATA_KEY=… npx tsx scripts/encrypt-credentials.ts          → dry run (counts only)
//    DATABASE_URL=… HALO_DATA_KEY=… npx tsx scripts/encrypt-credentials.ts --apply  → encrypt
//  Covers BrokerAccount.credsJson, AlertSettings.telegramBotToken / smtpPass /
//  vapidPrivateKey, WebhookConfig.secret. Idempotent (already-encrypted
//  values are skipped). Every value is decrypted again and compared with
//  the original BEFORE the transaction commits — any mismatch aborts the
//  whole migration and nothing is changed. Never prints a secret.
//  Back up the database first (see docs/MIGRATION-RUNBOOK-2026-11-02.md).
// ════════════════════════════════════════════════════════════════════════
import { PrismaClient } from "@prisma/client";
import { dataKey, isSealed, open, seal } from "../src/lib/secret-box";

const apply = process.argv.includes("--apply");
const db = new PrismaClient();

async function main(): Promise<void> {
  if (!dataKey()) throw new Error("HALO_DATA_KEY is not set — nothing done.");

  const brokers = await db.brokerAccount.findMany({ select: { id: true, credsJson: true } });
  const alerts = await db.alertSettings.findMany({ select: { id: true, telegramBotToken: true, smtpPass: true, vapidPrivateKey: true } });
  const hooks = await db.webhookConfig.findMany({ select: { id: true, secret: true } });

  type Job = { table: string; id: string; field: string; plain: string };
  const jobs: Job[] = [];
  for (const b of brokers) if (b.credsJson && !isSealed(b.credsJson)) jobs.push({ table: "BrokerAccount", id: b.id, field: "credsJson", plain: b.credsJson });
  for (const a of alerts)
    for (const f of ["telegramBotToken", "smtpPass", "vapidPrivateKey"] as const)
      if (a[f] && !isSealed(a[f])) jobs.push({ table: "AlertSettings", id: a.id, field: f, plain: a[f] });
  for (const h of hooks) if (h.secret && !isSealed(h.secret)) jobs.push({ table: "WebhookConfig", id: h.id, field: "secret", plain: h.secret });

  const already =
    brokers.filter((b) => isSealed(b.credsJson)).length +
    alerts.reduce((n, a) => n + [a.telegramBotToken, a.smtpPass, a.vapidPrivateKey].filter(isSealed).length, 0) +
    hooks.filter((h) => isSealed(h.secret)).length;
  const byTable = jobs.reduce<Record<string, number>>((m, j) => ((m[`${j.table}.${j.field}`] = (m[`${j.table}.${j.field}`] ?? 0) + 1), m), {});
  console.log(`plaintext values to encrypt: ${jobs.length}  ${JSON.stringify(byTable)}`);
  console.log(`already encrypted: ${already}`);
  if (!apply) {
    console.log("dry run — re-run with --apply to encrypt.");
    return;
  }

  const sealed = jobs.map((j) => ({ ...j, sealed: seal(j.plain) }));
  for (const j of sealed) {
    if (open(j.sealed) !== j.plain) throw new Error(`verification failed for ${j.table}.${j.field} (${j.id}) — nothing changed.`);
  }
  await db.$transaction(
    sealed.map((j) => {
      if (j.table === "BrokerAccount") return db.brokerAccount.update({ where: { id: j.id }, data: { credsJson: j.sealed } });
      if (j.table === "AlertSettings") return db.alertSettings.update({ where: { id: j.id }, data: { [j.field]: j.sealed } });
      return db.webhookConfig.update({ where: { id: j.id }, data: { secret: j.sealed } });
    })
  );
  // read back from the database and verify every value once more
  let ok = 0;
  for (const j of sealed) {
    const row =
      j.table === "BrokerAccount"
        ? (await db.brokerAccount.findUnique({ where: { id: j.id } }))?.credsJson
        : j.table === "AlertSettings"
          ? ((await db.alertSettings.findUnique({ where: { id: j.id } })) as Record<string, unknown> | null)?.[j.field]
          : (await db.webhookConfig.findUnique({ where: { id: j.id } }))?.secret;
    if (typeof row === "string" && isSealed(row) && open(row) === j.plain) ok += 1;
  }
  console.log(`encrypted and verified: ${ok}/${sealed.length}`);
  if (ok !== sealed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("migration aborted:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
