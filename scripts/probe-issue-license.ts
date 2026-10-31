// Issue a complimentary ACTIVE license to the probe user (local test only).
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const db = new PrismaClient();
const email = readFileSync("/tmp/probe_email.txt", "utf8").trim();

const user = await db.user.findUnique({ where: { email } });
if (!user) throw new Error("probe user not found");

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
      planName: "E2E Probe Comp",
      entitlementsJson: JSON.stringify(["*"]),
      status: "ACTIVE",
      isComplimentary: true,
      compReason: "Local browser E2E probe",
      issuedById: "system",
      notes: "Throwaway probe for agent-browser verification",
    },
  });
  console.log("license created:", lic.key, lic.status);
}
await db.$disconnect();
