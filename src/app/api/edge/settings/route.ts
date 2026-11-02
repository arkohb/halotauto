import { NextResponse } from "next/server";
import { loadEdge, saveEdge } from "@/lib/edge/settings";
import { requireTradingAccess } from "@/lib/license";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  return NextResponse.json({ ok: true, settings: await loadEdge() });
}

export async function POST(req: Request) {
  try {
    const gate = await requireTradingAccess();
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const body = (await req.json()) as Parameters<typeof saveEdge>[0];
    return NextResponse.json({ ok: true, settings: await saveEdge(body ?? {}) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
