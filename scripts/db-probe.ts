// db-probe · read-only snapshot of users / plans / licenses (no secrets printed)
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const users = await db.user.findMany({
    select: { id: true, email: true, username: true, role: true, status: true, emailVerifiedAt: true, mustChangePassword: true, createdAt: true, lastLoginAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`── users (${users.length}) ──`);
  for (const u of users) {
    console.log(`${u.email} · role=${u.role} · status=${u.status} · verified=${!!u.emailVerifiedAt} · mustChange=${u.mustChangePassword} · lastLogin=${u.lastLoginAt?.toISOString() ?? "never"}`);
  }
  const plans = await db.plan.findMany({ select: { code: true, name: true, priceCents: true, deviceLimit: true, currency: true } });
  console.log(`── plans (${plans.length}) ──`);
  for (const p of plans) console.log(`${p.code} · $${(p.priceCents / 100).toFixed(0)} · ${p.deviceLimit} device(s) · ${p.currency}`);
  const lic = await db.license.findMany({ select: { key: true, planCode: true, status: true, userId: true, isComplimentary: true } });
  console.log(`── licenses (${lic.length}) ──`);
  for (const l of lic) console.log(`${l.key.slice(0, 9)}… · ${l.planCode} · ${l.status} · userId=${l.userId ?? "-"} · comp=${l.isComplimentary}`);
  const sessions = await db.session.count();
  console.log(`── sessions: ${sessions} ──`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
