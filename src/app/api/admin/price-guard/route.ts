// Live-quote deviation threshold for the price guard (Decision B).
// GET: any administrator. PUT: Super Admin only, audit-logged.
// While unset (null) every LIVE order is refused — the check is a mandatory
// prerequisite for live trading. Paper trading is unaffected by this value.
import { NextResponse } from "next/server";
import { requireAdmin, requireSuper } from "@/lib/commerce/auth";
import { logAudit } from "@/lib/commerce/audit";
import { setSetting } from "@/lib/commerce/settings";
import { getMaxDeviationAtr, MAX_QUOTE_AGE_MS, PRICE_GUARD_SETTING_KEY } from "@/lib/price-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  const v = await getMaxDeviationAtr();
  return NextResponse.json({ ok: true, maxDeviationAtr: v, liveTradingAllowed: v !== null, maxQuoteAgeSec: MAX_QUOTE_AGE_MS / 1000 });
}

export async function PUT(req: Request) {
  const g = await requireSuper();
  if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
  let body: { maxDeviationAtr?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const raw = body.maxDeviationAtr;
  let value: number | null;
  if (raw === null) value = null;
  else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0.05 || n > 5) {
      return NextResponse.json({ ok: false, error: "maxDeviationAtr must be between 0.05 and 5 (× ATR), or null to block live trading." }, { status: 400 });
    }
    value = Math.round(n * 100) / 100;
  }
  const before = await getMaxDeviationAtr();
  await setSetting(PRICE_GUARD_SETTING_KEY, value, g.user.id);
  await logAudit({ action: "PRICE_GUARD_THRESHOLD_SET", actorId: g.user.id, actorEmail: g.user.email, actorRole: g.user.role, targetType: "setting", targetId: PRICE_GUARD_SETTING_KEY, meta: { before, after: value } });
  return NextResponse.json({ ok: true, maxDeviationAtr: value, liveTradingAllowed: value !== null });
}
