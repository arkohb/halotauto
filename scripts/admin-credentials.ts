// ══════════════════════════════════════════════════════════════════════════
//  admin-credentials · (re)provision the Super Administrator login
//
//  The initial admin password was generated and shown once during
//  commerce provisioning and is not recoverable. This script sets a NEW
//  password for the Super Admin account (same scrypt format as
//  src/lib/commerce/auth.ts), keeps/ensures role=SUPER_ADMIN, ACTIVE,
//  e-mail verified, and clears the must-change flag so the owner can
//  sign in straight away.
//
//  Usage:
//    bun scripts/admin-credentials.ts                       → generates a strong password, prints ONCE
//    bun scripts/admin-credentials.ts --password 'S3cret!'  → sets the given password (not printed)
//    ADMIN_EMAIL / ADMIN_PASSWORD env vars also honoured.
//    … --reset-2fa --email you@x → BREAK-GLASS: turn off two-factor sign-in
//                                   for that account only (password untouched).
//                                   Needs server access; recorded in the audit log.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function generatePassword(): string {
  // readable strong scheme: HALO-XXXX-XXXX-26 (mixed case + digits)
  const AL = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const block = (n: number) =>
    [...crypto.randomBytes(n)].map((b) => AL[b % AL.length]).join("");
  return `HALO-${block(4)}-${block(4)}-26`;
}

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const email = (argOf("--email") || process.env.ADMIN_EMAIL || "beamark54@gmail.com").trim().toLowerCase();

  if (args.includes("--reset-2fa")) {
    // lost phone AND recovery codes: only someone with server access can do this
    const u = await db.user.findUnique({ where: { email } });
    if (!u) {
      console.error(`✗ no account ${email}`);
      process.exit(1);
    }
    const r = await db.systemSetting.deleteMany({ where: { key: `2fa:${u.id}` } });
    await db.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.auditLog.create({ data: { action: "2FA_RESET_BREAK_GLASS", actorEmail: "server-script", actorRole: "SERVER", targetType: "user", targetId: u.id, outcome: "success", metaJson: JSON.stringify({ email }) } });
    console.log(r.count ? `✔ two-factor sign-in turned OFF for ${email}; all its sessions signed out. Set it up again from Account.` : `• ${email} had no two-factor set up — nothing changed.`);
    return;
  }
  let password = argOf("--password") || process.env.ADMIN_PASSWORD || "";
  const generated = !password;
  if (generated) password = generatePassword();

  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    console.error("✗ password rejected: needs 8+ chars with a letter and a number");
    process.exit(1);
  }

  const data = {
    passwordHash: hashPassword(password),
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    mustChangePassword: false,
  };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data });
    console.log(`✔ super admin password RESET: ${email} (role=${data.role}, status=${data.status})`);
  } else {
    await db.user.create({
      data: { email, fullName: process.env.ADMIN_NAME || "HALO Owner", username: "halo-admin", ...data },
    });
    console.log(`✔ super admin CREATED: ${email} (role=${data.role}, status=${data.status})`);
  }

  if (generated) {
    console.log("");
    console.log("══════════════════════════════════════════════════");
    console.log("  NEW SUPER-ADMIN PASSWORD (shown ONCE):");
    console.log(`  ${password}`);
    console.log("  Store it in a password manager.");
    console.log("══════════════════════════════════════════════════");
    console.log("");
  } else {
    console.log("  (password taken from arguments/env — not printed)");
  }
}

main()
  .catch((e) => { console.error("failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
