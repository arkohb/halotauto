// ══════════════════════════════════════════════════════════════════════════
//  /api/license/devices/[id] · deactivate one of YOUR devices
//  Customers may free a slot to activate a replacement; admins use the
//  admin API for exceptional transfers (audit-logged).
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/commerce/auth";
import { deactivateDevice } from "@/lib/commerce/license-engine";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
    const { id } = await ctx.params;

    const activation = await db.licenseActivation.findUnique({ where: { id }, include: { license: true } });
    if (!activation) return NextResponse.json({ ok: false, error: "Device not found." }, { status: 404 });
    if (activation.license.userId !== user.id) {
      return NextResponse.json({ ok: false, error: "This device belongs to another license." }, { status: 403 });
    }

    const ok = await deactivateDevice(id, { id: user.id, email: user.email, role: user.role });
    if (!ok) return NextResponse.json({ ok: false, error: "Device is already deactivated." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
