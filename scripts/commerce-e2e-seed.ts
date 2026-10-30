// ══════════════════════════════════════════════════════════════════════════
//  commerce-e2e-seed · creates clearly-marked TEST accounts for browser
//  verification of the commercial dashboards. NEVER touches the owner's
//  real account. Safe to re-run (upsert). Remove with --cleanup.
//
//  bun scripts/commerce-e2e-seed.ts            → seed test accounts
//  bun scripts/commerce-e2e-seed.ts --cleanup  → remove them again
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { FEATURE_CATALOG } from "../src/lib/commerce/constants";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const ACCOUNTS = [
  { email: "e2e-super@halotest.local", fullName: "E2E Super Admin", role: "SUPER_ADMIN", password: "E2eSuper#2026" },
  { email: "e2e-license@halotest.local", fullName: "E2E License Admin", role: "LICENSE_ADMIN", password: "E2eLicense#2026" },
  { email: "e2e-customer@halotest.local", fullName: "E2E Test Customer", role: "CUSTOMER", password: "E2eCustomer#2026" },
];

async function main() {
  const cleanup = process.argv.includes("--cleanup");
  if (cleanup) {
    for (const a of ACCOUNTS) {
      await db.user.deleteMany({ where: { email: a.email } });
      console.log(`removed ${a.email}`);
    }
    await db.$disconnect();
    return;
  }
  for (const a of ACCOUNTS) {
    const user = await db.user.upsert({
      where: { email: a.email },
      create: {
        email: a.email,
        fullName: a.fullName,
        passwordHash: hashPassword(a.password),
        role: a.role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        country: "Ghana",
      },
      update: { role: a.role, status: "ACTIVE", passwordHash: hashPassword(a.password) },
    });
    console.log(`ready: ${user.email} (${user.role})`);
  }

  // Give the test customer a complimentary Starter license (marked test).
  const cust = await db.user.findUnique({ where: { email: ACCOUNTS[2].email } });
  if (cust) {
    const existing = await db.license.findFirst({ where: { userId: cust.id } });
    if (!existing) {
      const lic = await db.license.create({
        data: {
          key: `HALO-E2E2-${crypto.randomBytes(2).toString("hex").toUpperCase().slice(0, 4)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}-TEST`,
          userId: cust.id,
          planCode: "STARTER",
          planName: "Starter",
          entitlementsJson: JSON.stringify(FEATURE_CATALOG.filter((f) => f.minPlan <= 1).map((f) => f.key)),
          status: "UNACTIVATED",
          isComplimentary: true,
          compReason: "E2E browser verification — test account (remove with scripts/commerce-e2e-seed.ts --cleanup)",
          notes: "TEST LICENSE — created by commerce-e2e-seed",
        },
      });
      console.log(`test license issued: ${lic.key}`);
    }
  }
  await db.$disconnect();
}

void main();
