import { NextResponse } from "next/server";
import { botState } from "@/lib/bot";
import { ensureSweep } from "@/lib/sweep";
import { ensureTfScanner } from "@/lib/tf-scanner";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const state = await botState();
    void ensureSweep().catch(() => {}); // keep the all-pairs sweep ticker alive (1h–4h window)
    void ensureTfScanner().catch(() => {}); // keep the Timeframe Scanner Bot ticker alive (signal-only)
    return NextResponse.json(state);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
