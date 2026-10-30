// ══════════════════════════════════════════════════════════════════════════
//  commerce-acceptance-cleanup · removes the clearly-marked acceptance-test
//  rows (acc-*@halotest.local + acceptance comp licenses) after the §19 run.
//  Never touches real accounts.  bun scripts/commerce-acceptance-cleanup.ts
// ══════════════════════════════════════════════════════════════════════════
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

(async () => {
  const users = await db.user.findMany({ where: { email: { startsWith: "acc-", endsWith: "@halotest.local" } }, select: { id: true, email: true } });
  for (const u of users) {
    const licIds = (await db.license.findMany({ where: { userId: u.id } })).map((l) => l.id);
    if (licIds.length) {
      await db.licenseActivation.deleteMany({ where: { licenseId: { in: licIds } } });
      await db.license.deleteMany({ where: { id: { in: licIds } } });
    }
    await db.payment.deleteMany({ where: { userId: u.id } });
    await db.notification.deleteMany({ where: { userId: u.id } });
    await db.session.deleteMany({ where: { userId: u.id } });
    await db.user.delete({ where: { id: u.id } });
    console.log(`removed ${u.email}`);
  }
  // comp licenses issued to (now deleted) test e-mail addresses
  const comps = await db.license.findMany({ where: { OR: [{ compReason: { contains: "acceptance" } }, { notes: { contains: "acceptance" } }] } });
  for (const l of comps) {
    const owner = l.userId ? await db.user.findUnique({ where: { id: l.userId } }) : null;
    if (owner) continue; // still has a live owner (not test)
    await db.licenseActivation.deleteMany({ where: { licenseId: l.id } });
    await db.license.delete({ where: { id: l.id } });
    console.log(`removed comp ${l.key.slice(0, 9)}…`);
  }
  await db.$disconnect();
  console.log(`cleanup done — ${users.length} test account(s)`);
})();
