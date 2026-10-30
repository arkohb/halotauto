// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/plans · plan configuration (Super Administrator only)
//  Changing a plan affects NEW purchases only — existing licenses keep the
//  entitlement snapshot captured at issuance.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuper } from "@/lib/commerce/auth";
import { FEATURE_CATALOG, PLAN_RANK } from "@/lib/commerce/constants";
import { logAudit } from "@/lib/commerce/audit";
import { entitlementSnapshot } from "@/lib/commerce/entitlements";
import { planCodeForRank } from "@/lib/commerce/entitlements";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const g = await requireSuper();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const plans = await db.plan.findMany({ orderBy: { displayOrder: "asc" } });
    return NextResponse.json({
      ok: true,
      plans: plans.map((p) => ({
        ...p,
        features: (() => {
          try {
            return JSON.parse(p.featuresJson) as string[];
          } catch {
            return [];
          }
        })(),
        featuresJson: undefined,
      })),
      catalog: FEATURE_CATALOG,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const g = await requireSuper();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const actor = g.user;

    const body = (await req.json()) as {
      id?: string;
      name?: string;
      tagline?: string;
      description?: string;
      priceCents?: number;
      currency?: string;
      promoPriceCents?: number | null;
      deviceLimit?: number;
      featureKeys?: string[];
      active?: boolean;
      displayOrder?: number;
      icon?: string;
    };
    if (!body.id) return NextResponse.json({ ok: false, error: "Plan id required." }, { status: 400 });

    const existing = await db.plan.findUnique({ where: { id: body.id } });
    if (!existing) return NextResponse.json({ ok: false, error: "Plan not found." }, { status: 404 });

    // Feature keys must exist in the catalog and be consistent with the plan rank
    // (a plan grants its rank and below). Custom per-plan feature sets are allowed
    // only by choosing catalog keys valid for the plan's rank.
    let featuresJson: string | undefined;
    if (body.featureKeys) {
      const rank = PLAN_RANK[existing.code] ?? 1;
      const valid = new Set(FEATURE_CATALOG.filter((f) => f.minPlan <= rank).map((f) => f.key));
      const clean = body.featureKeys.filter((k) => valid.has(k));
      featuresJson = JSON.stringify(clean);
    }

    const updated = await db.plan.update({
      where: { id: body.id },
      data: {
        name: body.name?.trim() || existing.name,
        tagline: body.tagline ?? existing.tagline,
        description: body.description ?? existing.description,
        priceCents: typeof body.priceCents === "number" && body.priceCents >= 0 ? Math.round(body.priceCents) : existing.priceCents,
        currency: body.currency?.trim().toUpperCase().slice(0, 4) || existing.currency,
        promoPriceCents: body.promoPriceCents === null ? null : typeof body.promoPriceCents === "number" ? Math.round(body.promoPriceCents) : existing.promoPriceCents,
        deviceLimit: typeof body.deviceLimit === "number" && body.deviceLimit >= 0 ? Math.round(body.deviceLimit) : existing.deviceLimit,
        ...(featuresJson ? { featuresJson } : {}),
        active: typeof body.active === "boolean" ? body.active : existing.active,
        displayOrder: typeof body.displayOrder === "number" ? Math.round(body.displayOrder) : existing.displayOrder,
        icon: body.icon?.trim() || existing.icon,
      },
    });

    await logAudit({
      action: "PLAN_UPDATED",
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      targetType: "plan",
      targetId: updated.id,
      meta: { code: updated.code, priceCents: updated.priceCents, active: updated.active },
    });
    void planCodeForRank; // reserved for future per-rank rebuilds

    return NextResponse.json({ ok: true, note: "Plan updated. Existing licenses keep their original entitlement snapshot — only new purchases use the new configuration." });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// entitlementSnapshot is used when NEW plans are created by seeding only.
void entitlementSnapshot;
