// Liveness + keep-alive tick for hosted deployments (Cloud Run / Firebase
// App Hosting). GET is a plain health check. With ?tick=1 and the
// x-halo-cron header matching HALO_CRON_SECRET it also advances the bot,
// so a Cloudflare Cron Worker keeps the engine running between visits.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  let dbOk = false;
  try {
    await db.botConfig.count();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let ticked = false;
  const secret = process.env.HALO_CRON_SECRET;
  if (url.searchParams.get("tick") === "1" && secret && req.headers.get("x-halo-cron") === secret) {
    const { botState } = await import("@/lib/bot");
    await botState().catch(() => null);
    ticked = true;
  }
  return NextResponse.json({ ok: dbOk, db: dbOk, ticked, time: new Date().toISOString() }, { status: dbOk ? 200 : 503 });
}
