import { NextResponse } from "next/server";
import { resolveQuoteTarget } from "@/lib/halo/actions";
import { getQuote } from "@/lib/halo/intel";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// GET /api/intel/quote?symbol=spx|gold|XAUUSD|oil|dxy...
export async function GET(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const url = new URL(req.url);
  const input = (url.searchParams.get("symbol") ?? "").slice(0, 40);
  if (!input) {
    return NextResponse.json({ ok: false, error: "symbol parameter is required" }, { status: 400 });
  }

  const resolved = resolveQuoteTarget(input);
  if (!resolved) {
    return NextResponse.json(
      { ok: false, error: `"${input}" is not a supported quote target — try gold, EURUSD, SPX, Nasdaq, Dow, DAX, oil or DXY.` },
      { status: 404 }
    );
  }

  try {
    const res = await getQuote(resolved.id, resolved.label);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
