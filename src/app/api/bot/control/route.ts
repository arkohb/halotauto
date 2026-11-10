import { NextResponse } from "next/server";
import { botState, resetBot, startBot, stopBot, closeAnyRunningTrade, setPauseNew } from "@/lib/bot";
import { requireTradingAccess } from "@/lib/license";

export const dynamic = "force-dynamic";

// ── MT5 PROTECTION (commercial mandate §6) ─────────────────────────────
// Only actions that INITIATE new protected trading (or destructively reset
// the engine) require a valid license. Protective actions — stopping the
// engine, closing the open position, pausing new entries — stay available
// even when a license is suspended/revoked/expired or license validation is
// down: the licensing layer may never disable the emergency stop or any
// risk-reducing control, and it never closes positions by itself.
const GATED_ACTIONS = new Set(["start", "resumeNew", "reset"]);

export async function POST(req: Request) {
  try {
    const { action } = (await req.json()) as { action: string };
    if (GATED_ACTIONS.has(action)) {
      const gate = await requireTradingAccess();
      if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    }
    if (action === "start") await startBot();
    else if (action === "stop") await stopBot();
    else if (action === "reset") await resetBot();
    else if (action === "close") await closeAnyRunningTrade();
    else if (action === "pauseNew") await setPauseNew(true);
    else if (action === "resumeNew") await setPauseNew(false);
    else return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    const state = await botState();
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
