// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/logout · secure sign-out (revokes the DB session)
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { destroyCurrentSession } from "@/lib/commerce/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await destroyCurrentSession();
  } catch {
    // even on error the cookie is cleared client-side
  }
  return NextResponse.json({ ok: true });
}
