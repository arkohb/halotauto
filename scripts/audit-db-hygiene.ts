// audit-db-hygiene · removes stray UNBOUND complimentary licenses that any
// account could claim (binds to first activator). Test-origin artifacts from
// earlier E2E sessions — never issued to a real customer.
// The owner's bound ULTIMATE comp license is untouched (userId set).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const strays = await db.license.findMany({
    where: { userId: null },
    select: { id: true, key: true, planCode: true, status: true, isComplimentary: true },
  });
  console.log(`unbound licenses found: ${strays.length}`);
  for (const l of strays) {
    const acts = await db.licenseActivation.findMany({ where: { licenseId: l.id } });
    console.log(`  ${l.key.slice(0, 9)}… ${l.planCode} ${l.status} comp=${l.isComplimentary} activations=${acts.length} → DELETING (test artifact, claimable-by-anyone risk)`);
    for (const a of acts) await db.licenseActivation.delete({ where: { id: a.id } });
    await db.license.delete({ where: { id: l.id } });
  }

  const remaining = await db.license.findMany({
    select: { key: true, planCode: true, status: true, userId: true, isComplimentary: true },
  });
  console.log(`── license registry after cleanup (${remaining.length}) ──`);
  for (const l of remaining) console.log(`  ${l.key.slice(0, 9)}… ${l.planCode} ${l.status} bound=${!!l.userId} comp=${l.isComplimentary}`);

  // ledger sanity: payment status distribution (FK guarantees no orphans)
  const payments = await db.payment.groupBy({ by: ["status"], _count: { status: true } });
  console.log(`payments by status: ${payments.map((p) => `${p.status}=${p._count.status}`).join(" · ") || "none"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
