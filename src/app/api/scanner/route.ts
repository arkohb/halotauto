import { NextResponse } from "next/server";
import {
  scannerAdd,
  scannerPatch,
  scannerRemove,
  scannerScanNow,
  scannerState,
} from "@/lib/scanner";
import { SYMBOLS, TIMEFRAMES } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await scannerState();
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: "add" | "remove" | "patch" | "scan";
      symbol?: string;
      tf?: string;
      autoTrade?: boolean;
      id?: string;
      enabled?: boolean;
    };

    if (body.action === "scan") {
      await scannerScanNow();
    } else if (body.action === "add") {
      const symbol = SYMBOLS.some((s) => s.id === body.symbol) ? String(body.symbol) : "";
      const tf = (TIMEFRAMES as readonly string[]).includes(String(body.tf)) ? String(body.tf) : "5m";
      if (!symbol) return NextResponse.json({ ok: false, error: "unknown symbol" }, { status: 400 });
      await scannerAdd(symbol, tf, Boolean(body.autoTrade));
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
    return NextResponse.json({ ok: true, ...state });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
