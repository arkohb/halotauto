// ══════════════════════════════════════════════════════════════════════════
//  commerce-setup · one-time provisioning for the commercial platform
//
//  1. Seeds the four configurable plans (Starter/Pro/Elite/Ultimate).
//  2. Provisions the initial Super Administrator — NO shared hardcoded
//     password: pass ADMIN_EMAIL + ADMIN_PASSWORD env vars, or the script
//     generates a strong password and prints it ONCE.
//  3. Ports the legacy owner license row (single-row gate) into a
//     complimentary ULTIMATE license so the owner keeps full access.
//
//  Usage: bun scripts/commerce-setup.ts [--admin-email you@x.com --admin-password 'pw']
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(16);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  const g = (n: number) => chars.slice(n * 4, n * 4 + 4).join("");
  return `HALO-${g(0)}-${g(1)}-${g(2)}-${g(3)}`;
}

// Mirrors src/lib/commerce/constants.ts (script-safe copy)
const PLANS = [
  { code: "STARTER", name: "Starter", tagline: "Essential Trading Tools", description: "Everything a disciplined trader needs to run the HALO engine on one instrument.", priceCents: 19900, deviceLimit: 1, icon: "shield", displayOrder: 1 },
  { code: "PRO", name: "Pro", tagline: "Advanced Trading", description: "Advanced AI assistance, multi-instrument trading and custom strategy configuration.", priceCents: 39900, deviceLimit: 2, icon: "crown", displayOrder: 2 },
  { code: "ELITE", name: "Elite", tagline: "Professional Trader", description: "Full Strategy Lab, advanced Risk Guardian, trade replay and advanced voice control.", priceCents: 69900, deviceLimit: 3, icon: "gem", displayOrder: 3 },
  { code: "ULTIMATE", name: "Ultimate", tagline: "Institutional Grade", description: "Advanced administration tools, white-label options, custom integrations and API access.", priceCents: 119900, deviceLimit: 5, icon: "infinity", displayOrder: 4 },
];

const RANKS: Record<string, number> = { STARTER: 1, PRO: 2, ELITE: 3, ULTIMATE: 4 };
const FEATURES: { key: string; minPlan: number }[] = [
  { key: "dashboard_standard", minPlan: 1 }, { key: "market_data", minPlan: 1 }, { key: "assistant_basic", minPlan: 1 },
  { key: "trading_manual", minPlan: 1 }, { key: "trading_auto", minPlan: 1 }, { key: "instrument_single", minPlan: 1 },
  { key: "history_basic", minPlan: 1 }, { key: "alerts_standard", minPlan: 1 }, { key: "support_standard", minPlan: 1 },
  { key: "assistant_advanced", minPlan: 2 }, { key: "instrument_multi", minPlan: 2 }, { key: "strategy_tools_advanced", minPlan: 2 },
  { key: "strategy_custom", minPlan: 2 }, { key: "analytics_performance", minPlan: 2 }, { key: "alerts_advanced", minPlan: 2 },
  { key: "reporting_enhanced", minPlan: 2 }, { key: "support_priority", minPlan: 2 },
  { key: "strategy_lab_full", minPlan: 3 }, { key: "risk_guardian_advanced", minPlan: 3 }, { key: "trade_replay", minPlan: 3 },
  { key: "analytics_advanced", minPlan: 3 }, { key: "voice_advanced", minPlan: 3 }, { key: "multi_account", minPlan: 3 },
  { key: "support_dedicated", minPlan: 3 },
  { key: "admin_tools", minPlan: 4 }, { key: "white_label", minPlan: 4 }, { key: "integrations_custom", minPlan: 4 },
  { key: "api_access", minPlan: 4 }, { key: "support_vip", minPlan: 4 },
];

function featuresFor(code: string): string {
  const rank = RANKS[code] ?? 1;
  return JSON.stringify(FEATURES.filter((f) => f.minPlan <= rank).map((f) => f.key));
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  // ── 1. Plans ──
  for (const p of PLANS) {
    await db.plan.upsert({
      where: { code: p.code },
      create: { ...p, currency: "USD", featuresJson: featuresFor(p.code) },
      update: {}, // admin-configured plans are never overwritten on re-run
    });
  }
  console.log("✔ plans seeded (4)");

  // ── 2. Super Administrator ──
  const adminEmail = (argOf("--admin-email") || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const adminPassword = argOf("--admin-password") || process.env.ADMIN_PASSWORD || "";
  const existingOwner = await db.user.findFirst({ where: { email: "bismark@halotrader.com" } });

  if (adminEmail) {
    let password = adminPassword;
    let generated = false;
    if (!password) {
      password = crypto.randomBytes(9).toString("base64url") + "7A";
      generated = true;
    }
    const existing = await db.user.findUnique({ where: { email: adminEmail } });
    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: { role: "SUPER_ADMIN", status: "ACTIVE", emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), mustChangePassword: generated },
      });
      console.log(`✔ super admin updated: ${adminEmail}`);
    } else {
      await db.user.create({
        data: {
          email: adminEmail,
          fullName: existingOwner?.fullName || "HALO Owner",
          passwordHash: hashPassword(password),
          role: "SUPER_ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          mustChangePassword: generated,
        },
      });
      console.log(`✔ super admin created: ${adminEmail}`);
    }
    if (generated) {
      console.log("");
      console.log("══════════════════════════════════════════════════");
      console.log("  GENERATED SUPER-ADMIN PASSWORD (shown ONCE):");
      console.log(`  ${password}`);
      console.log("  Store it in a password manager. You will be");
      console.log("  prompted to change it on first sign-in.");
      console.log("══════════════════════════════════════════════════");
      console.log("");
    } else {
      console.log("  (password taken from arguments/env — not printed)");
    }
  } else {
    console.log("ℹ no ADMIN_EMAIL provided — skip super-admin provisioning (run with --admin-email you@domain.com)");
  }

  // ── 3. Port the legacy owner license (preserves owner access) ──
  // The legacy single-row gate key is REUSED verbatim so the owner's records
  // stay consistent; it becomes a complimentary ULTIMATE license.
  const LEGACY = { key: "HALO-98C4-R4T6-4R5P-DHD6", holder: "bismark@halotrader.com" };
  const ownerUser = await db.user.findUnique({ where: { email: LEGACY.holder } });
  const existingLegacy = await db.license.findUnique({ where: { key: LEGACY.key } });
  if (!existingLegacy) {
    const ultimate = PLANS.find((p) => p.code === "ULTIMATE")!;
    await db.license.create({
      data: {
        key: LEGACY.key,
        userId: ownerUser?.id ?? null,
        planCode: "ULTIMATE",
        planName: ultimate.name,
        entitlementsJson: featuresFor("ULTIMATE"),
        status: "ACTIVE",
        activatedAt: new Date(),
        isComplimentary: true,
        compReason: "Ported from the legacy owner-mode license gate (full retained access).",
        issuedById: "system",
        notes: "ported from legacy owner gate",
      },
    });
    console.log(`✔ legacy owner license ported as complimentary ULTIMATE ${LEGACY.key.slice(0, 9)}… (bound to ${ownerUser ? LEGACY.holder : "first account activation"})`);
  } else {
    console.log("ℹ legacy owner license already ported");
  }

  // ── 4. Default settings ──
  await db.systemSetting.upsert({
    where: { key: "approvalMode" },
    create: { key: "approvalMode", valueJson: JSON.stringify("AUTOMATIC") },
    update: {},
  });
  await db.systemSetting.upsert({
    where: { key: "registrationOpen" },
    create: { key: "registrationOpen", valueJson: JSON.stringify(true) },
    update: {},
  });
  console.log("✔ default system settings ensured (approvalMode=AUTOMATIC, registrationOpen=true)");
}

main()
  .catch((e) => {
    console.error("setup failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
