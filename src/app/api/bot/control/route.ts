import { NextResponse } from "next/server";
import { botState, resetBot, startBot, stopBot, closeOpenTrade, setPauseNew } from "@/lib/bot";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { action } = (await req.json()) as { action: string };
    if (action === "start") await startBot();
    else if (action === "stop") await stopBot();
    else if (action === "reset") await resetBot();
    else if (action === "close") await closeOpenTrade();
    else if (action === "pauseNew") await setPauseNew(true);
    else if (action === "resumeNew") await setPauseNew(false);
    else return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    const state = await botState();
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
