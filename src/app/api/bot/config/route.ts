import { NextResponse } from "next/server";
import { botState, updateBotConfig } from "@/lib/bot";
import { SYMBOLS, TIMEFRAMES } from "@/lib/market";
import type { HaloConfig } from "@/lib/halo/types";

export const dynamic = "force-dynamic";

interface Body {
  cfg?: Partial<HaloConfig>;
  symbol?: string;
  tf?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const symbol =
      body.symbol && SYMBOLS.some((s) => s.id === body.symbol) ? body.symbol : undefined;
    const tf = body.tf && (TIMEFRAMES as readonly string[]).includes(body.tf) ? body.tf : undefined;
    await updateBotConfig({ cfg: body.cfg, symbol, tf });
    const state = await botState();
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
