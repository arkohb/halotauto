// ══════════════════════════════════════════════════════════════════════════
//  /api/license/devices · the customer's activated devices (self-service)
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/commerce/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });

    const licenses = await db.license.findMany({
      where: { userId: user.id },
      include: { activations: { orderBy: { activatedAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    });

    const devices = licenses.flatMap((l) =>
      l.activations
        .filter((a) => a.active)
        .map((a) => ({
          id: a.id,
          licenseId: l.id,
          licenseKeyMasked: l.key.slice(0, 9) + "…" + l.key.slice(-4),
          planName: l.planName,
          deviceLabel: a.deviceLabel,
          activatedAt: a.activatedAt.toISOString(),
          lastValidatedAt: a.lastValidatedAt?.toISOString() ?? null,
        })),
    );
    return NextResponse.json({ ok: true, devices });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
