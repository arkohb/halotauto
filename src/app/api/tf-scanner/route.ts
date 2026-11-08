// ════════════════════════════════════════════════════════════════════════
//  /api/tf-scanner · TIMEFRAME SCANNER BOT
//
//  GET  → full scanner-bot state (status, markets, last scan, messages,
//         latest qualifying opportunity) — the chat card polls this.
//  POST → { action: "start" | "pause" | "resume" } — the ONLY controls.
//
//  Gated by the middleware login gate like every /api endpoint. This route
//  Fires execute through the shared execution layer (tf-scanner.ts) — this
//  route is state read + start/pause/resume controls only.
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { configTfScanner, tfScannerState } from "@/lib/tf-scanner";
import { guardLicensed, guardTrading } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const state = await tfScannerState();
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const body = (await req.json()) as { action?: string };
    const action = body.action;
    if (action !== "start" && action !== "pause" && action !== "resume") {
      return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
    }
    await configTfScanner(action);
    const state = await tfScannerState();
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
