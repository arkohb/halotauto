// Issue a complimentary ACTIVE license to the journal E2E user (local test
// only — same throwaway pattern as probe-issue-license.ts).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const db = new PrismaClient();
const email = readFileSync("/tmp/journal_e2e_email.txt", "utf8").trim();

const user = await db.user.findUnique({ where: { email } });
if (!user) throw new Error("journal e2e user not found");

const existing = await db.license.findFirst({ where: { userId: user.id } });
if (existing) {
  console.log("license exists:", existing.key, existing.status);
} else {
  const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const g = () => Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => ABC[b % ABC.length]).join("");
  const key = `HALO-${g()}-${g()}-${g()}-${g()}`;
  const lic = await db.license.create({
    data: {
      key,
      userId: user.id,
      planCode: "PRO_LIFETIME",
      planName: "PRO",
      entitlementsJson: JSON.stringify(["*"]),
      status: "ACTIVE",
      isComplimentary: true,
      compReason: "Journal E2E visual verification (throwaway account)",
      issuedById: "system",
      notes: "Throwaway probe for the Performance-Journal browser verification",
    },
  });
  console.log("license created:", lic.key, lic.status);
}
await db.$disconnect();
