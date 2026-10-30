// ════════════════════════════════════════════════════════════════════════
//  /api/license · commercial activation status + one-time activation
// ════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { activateLicense, licenseStatus } from "@/lib/license";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const st = await licenseStatus();
    return NextResponse.json(st);
  } catch (e) {
    return NextResponse.json({ licensing: false, activated: true, mode: "owner", error: (e as Error).message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; holder?: string };
    const r = await activateLicense(String(body.key ?? ""), String(body.holder ?? ""));
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    const st = await licenseStatus();
    return NextResponse.json({ ok: true, ...st });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
