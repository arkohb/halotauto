// ══════════════════════════════════════════════════════════════════════════
//  /api/auth/me · current session + license status (used by every page)
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { licenseStatus } from "@/lib/license";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const st = await licenseStatus();
    return NextResponse.json({ ok: true, ...st });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
