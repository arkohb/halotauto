// ════════════════════════════════════════════════════════════════════════
//  LICENSE MINT · the seller's tool (owner only)
//  Mint a one-time-payment lifetime key for a buyer:
//    HALO_LICENSE_SECRET=your-secret bun scripts/license-mint.ts --holder "buyer@email.com"
//  Keys are deterministic per holder: the SAME holder always gets the SAME
//  key (re-minting is idempotent — a lost key can be re-issued identically).
//  The buyer pastes key + e-mail once in the app's activation screen.
// ════════════════════════════════════════════════════════════════════════

import { mintKey } from "../src/lib/license";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const holder = arg("--holder");
if (!holder) {
  console.error("Usage: HALO_LICENSE_SECRET=<secret> bun scripts/license-mint.ts --holder \"buyer@email.com\"");
  process.exit(1);
}
try {
  const key = mintKey(holder);
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  HALO 3EL AUTOTRADER · LIFETIME LICENSE              ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Holder : ${holder.trim()}`);
  console.log(`  Key    : ${key}`);
  console.log("\n  Send both to the buyer. They enter key + e-mail once");
  console.log("  in the app's activation screen — the app unlocks forever.");
  process.exit(0);
} catch (e) {
  console.error("✗", (e as Error).message);
  process.exit(1);
}
