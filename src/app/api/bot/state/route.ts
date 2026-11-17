import { NextResponse } from "next/server";
import { botState } from "@/lib/bot";
import { ensureSweep } from "@/lib/sweep";
import { armedSetupFor, ensureTfScanner } from "@/lib/tf-scanner";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const state = await botState();
    void ensureSweep().catch(() => {}); // keep the all-pairs sweep ticker alive (1h–4h window)
    void ensureTfScanner().catch(() => {}); // keep the Timeframe Scanner Bot ticker alive (signal-only)
    // the timeframe with a freshly armed level on this symbol — the chart follows it
    return NextResponse.json({ ...state, armedSetup: armedSetupFor(state.symbol) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
