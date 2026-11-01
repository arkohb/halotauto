// Adaptive Autopilot — start a walk-forward run, list profiles, toggle a profile
import { NextResponse } from "next/server";
import { getBot, ensureBoot } from "@/lib/bot";
import { getJob, listProfiles, setProfileLive, startAutopilot } from "@/lib/edge/autopilot";
import { requireTradingAccess } from "@/lib/license";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, job: getJob(), profiles: await listProfiles() });
}

interface Body {
  action?: "run" | "live" | "off";
  symbol?: string;
  tf?: string;
  bars?: number;
  spreadPips?: number;
  id?: string;
}

export async function POST(req: Request) {
  try {
    const gate = await requireTradingAccess();
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const body = (await req.json()) as Body;
    if (body.action === "live" || body.action === "off") {
      if (!body.id) throw new Error("Profile id required.");
      await setProfileLive(body.id, body.action === "live");
      return NextResponse.json({ ok: true, profiles: await listProfiles() });
    }
    await ensureBoot();
    const bot = getBot();
    const job = startAutopilot({
      symbol: (body.symbol ?? bot.symbol).toUpperCase(),
      tf: body.tf ?? bot.tf,
      bars: Math.min(50_000, Math.max(1000, Math.round(Number(body.bars) || 6000))),
      baseCfg: bot.cfg, // the SAVED settings — the run never writes them
      spreadPips: Math.min(100, Math.max(0, Number(body.spreadPips) || 0)),
    });
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
