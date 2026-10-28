import { NextResponse } from "next/server";
import { getWebhookInfo, regenerateWebhookSecret, setWebhookEnabled } from "@/lib/tv-webhook";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  WEBHOOK CONFIG · regenerate the shared secret / enable-disable receiver
//  POST { regenerate?: true, enabled?: boolean } → TvWebhookInfo
// ════════════════════════════════════════════════════════════════════════

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { regenerate?: boolean; enabled?: boolean };
    let info = await getWebhookInfo();
    if (b.regenerate) info = await regenerateWebhookSecret();
    if (typeof b.enabled === "boolean") info = await setWebhookEnabled(b.enabled);
    return NextResponse.json({ ok: true, ...info });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
