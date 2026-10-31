import { NextResponse } from "next/server";
import { botState, updateBotConfig } from "@/lib/bot";
import { SYMBOLS, TIMEFRAMES } from "@/lib/market";
import type { HaloConfig } from "@/lib/halo/types";
import { requireTradingAccess } from "@/lib/license";

export const dynamic = "force-dynamic";

interface Body {
  cfg?: Partial<HaloConfig>;
  symbol?: string;
  tf?: string;
  exec?: {
    executionMode?: "paper" | "live";
    brokerAccountId?: string;
    sizingMode?: "fixed" | "percent";
    sizeFixed?: number;
    sizePercent?: number;
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const gate = await requireTradingAccess();
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    // explicit validation — an unknown pair/timeframe must fail loudly,
    // never silently keep the current one (that read as "selection ignored")
    let symbol: string | undefined;
    if (body.symbol !== undefined) {
      if (!body.symbol || !SYMBOLS.some((s) => s.id === body.symbol)) {
        return NextResponse.json({ ok: false, error: `Unknown symbol "${body.symbol ?? ""}".` }, { status: 400 });
      }
      symbol = body.symbol;
    }
    let tf: string | undefined;
    if (body.tf !== undefined) {
      if (!body.tf || !(TIMEFRAMES as readonly string[]).includes(body.tf)) {
        return NextResponse.json({ ok: false, error: `Unknown timeframe "${body.tf ?? ""}".` }, { status: 400 });
      }
      tf = body.tf;
    }
    await updateBotConfig({ cfg: body.cfg, symbol, tf, exec: body.exec });
    const state = await botState();
    return NextResponse.json({ ok: true, state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
