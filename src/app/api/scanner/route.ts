import { NextResponse } from "next/server";
import {
  scannerAdd,
  scannerPatch,
  scannerRemove,
  scannerScanNow,
  scannerState,
} from "@/lib/scanner";
import { configSweep, sweepNow, sweepState } from "@/lib/sweep";
import { SYMBOLS, TIMEFRAMES } from "@/lib/market";
import { guardLicensed, guardTrading } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const state = await scannerState();
    const sweep = await sweepState();
    return NextResponse.json({ ok: true, ...state, sweep });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const body = (await req.json()) as {
      action: "add" | "remove" | "patch" | "scan" | "sweep" | "sweepNow";
      symbol?: string;
      tf?: string;
      autoTrade?: boolean;
      id?: string;
      enabled?: boolean;
    };

    if (body.action === "scan") {
      await scannerScanNow();
    } else if (body.action === "sweep") {
      // all-pairs sweep switches (enabled / auto-trade)
      await configSweep({ enabled: body.enabled, autoTrade: body.autoTrade });
    } else if (body.action === "sweepNow") {
      await sweepNow();
    } else if (body.action === "add") {
      const symbol = SYMBOLS.some((s) => s.id === body.symbol) ? String(body.symbol) : "";
      const tf = (TIMEFRAMES as readonly string[]).includes(String(body.tf)) ? String(body.tf) : "5m";
      if (!symbol) return NextResponse.json({ ok: false, error: "unknown symbol" }, { status: 400 });
      // AUTO-FIRE by default — the bot executes every scan signal on any
      // pair + timeframe; the per-row switch can still opt a row out.
      await scannerAdd(symbol, tf, body.autoTrade !== undefined ? Boolean(body.autoTrade) : true);
    } else if (body.action === "patch" && body.id) {
      await scannerPatch(body.id, {
        enabled: body.enabled,
        autoTrade: body.autoTrade,
        tf: body.tf && (TIMEFRAMES as readonly string[]).includes(body.tf) ? body.tf : undefined,
      });
    } else if (body.action === "remove" && body.id) {
      await scannerRemove(body.id);
    } else {
      return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
    }

    const state = await scannerState();
    const sweep = await sweepState();
    return NextResponse.json({ ok: true, ...state, sweep });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
