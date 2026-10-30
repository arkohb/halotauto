// ══════════════════════════════════════════════════════════════════════════
//  LICENSE MINT (CLI) · superseded by the Admin Dashboard → Generate License
//  page, which is the primary way to issue keys (payment reference or
//  complimentary flow, audit-logged, e-mailed).
//
//  This CLI now mints a STANDALONE key in the official format for offline
//  hand-over. The key is registered in the license registry the first time
//  it is activated — unassigned keys bind to the activating account.
//  Prefer the admin dashboard for anything auditable.
//
//  Usage: bun scripts/license-mint.ts --count 1
// ══════════════════════════════════════════════════════════════════════════

import { generateLicenseKey } from "../src/lib/commerce/license-engine";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const count = Math.max(1, Math.min(50, Number(arg("--count") ?? "1")));
console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║  HALO 3EL AUTOTRADER · LIFETIME LICENSE KEY(S)       ║");
console.log("╚══════════════════════════════════════════════════════╝");
for (let i = 0; i < count; i++) {
  console.log(`  ${generateLicenseKey()}`);
}
console.log("\n  Keys are CSPRNG-generated in the official HALO-XXXX-…");
console.log("  format. A customer signs in at /login, opens License");
console.log("  Activation and enters the key — it binds to their");
console.log("  account and activates their device at that moment.");
console.log("  NOTE: for audit-compliance, prefer issuing licenses via");
console.log("  /admin → Generate License (payment/comp records kept).");
process.exit(0);
