import { NextResponse } from "next/server";
import { getKlines, getSymbolMeta, SYMBOLS, TIMEFRAMES } from "@/lib/market";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const url = new URL(req.url);
  const symbol = SYMBOLS.some((s) => s.id === url.searchParams.get("symbol"))
    ? (url.searchParams.get("symbol") as string)
    : "PAXGUSDT";
  const tfRaw = url.searchParams.get("tf") ?? "5m";
  const tf = (TIMEFRAMES as readonly string[]).includes(tfRaw) ? tfRaw : "5m";
  const limit = Math.min(720, Math.max(20, parseInt(url.searchParams.get("limit") ?? "240", 10) || 240));

  try {
    const { candles, source, stale } = await getKlines(symbol, tf, limit, { fresh: true });
    const meta = getSymbolMeta(symbol);
    return NextResponse.json({
      symbol,
      tf,
      mintick: meta.mintick,
      source,
      stale: Boolean(stale),
      candles,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
