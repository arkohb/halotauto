// ══════════════════════════════════════════════════════════════════════════
//  /api/commerce/plans · public pricing (active plans, display order)
//  Feature lists are resolved from the FEATURE CATALOG by plan rank —
//  the frontend can never grant itself anything.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activeProvider } from "@/lib/commerce/payments";
import { PLAN_RANK, featureKeysForRank } from "@/lib/commerce/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const plans = await db.plan.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
    });
    return NextResponse.json({
      ok: true,
      provider: activeProvider(),
      plans: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        priceCents: p.priceCents,
        promoPriceCents: p.promoPriceCents,
        currency: p.currency,
        deviceLimit: p.deviceLimit,
        icon: p.icon,
        features: featureKeysForRank(PLAN_RANK[p.code] ?? 1),
      })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, plans: [] }, { status: 500 });
  }
}
