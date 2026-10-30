// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/settings · system settings (Super Administrator only)
//  Approval mode, registration availability, maintenance mode, manual
//  payment channel instructions, support contacts, transfer policy.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { requireSuper } from "@/lib/commerce/auth";
import { SETTING_KEYS, getSettings, setSetting } from "@/lib/commerce/settings";
import { logAudit } from "@/lib/commerce/audit";
import { providerStatus } from "@/lib/commerce/payments";
import { isCommercialEnabled } from "@/lib/license";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const g = await requireSuper();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const s = await getSettings();
    return NextResponse.json({ ok: true, settings: s, system: { commerceMode: isCommercialEnabled(), paymentProvider: providerStatus() } });
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
      approvalMode?: string;
      registrationOpen?: boolean;
      maintenanceMode?: boolean;
      paymentChannels?: string;
      supportEmail?: string;
      transferApprovalRequired?: boolean;
    };

    const changes: Record<string, unknown> = {};
    if (body.approvalMode === "AUTOMATIC" || body.approvalMode === "MANUAL") {
      await setSetting(SETTING_KEYS.approvalMode, body.approvalMode, actor.id);
      changes.approvalMode = body.approvalMode;
    }
    if (typeof body.registrationOpen === "boolean") {
      await setSetting(SETTING_KEYS.registrationOpen, body.registrationOpen, actor.id);
      changes.registrationOpen = body.registrationOpen;
    }
    if (typeof body.maintenanceMode === "boolean") {
      await setSetting(SETTING_KEYS.maintenanceMode, body.maintenanceMode, actor.id);
      changes.maintenanceMode = body.maintenanceMode;
    }
    if (typeof body.paymentChannels === "string") {
      await setSetting(SETTING_KEYS.paymentChannels, body.paymentChannels.slice(0, 2000), actor.id);
      changes.paymentChannels = true;
    }
    if (typeof body.supportEmail === "string") {
      await setSetting(SETTING_KEYS.supportEmail, body.supportEmail.slice(0, 200), actor.id);
      changes.supportEmail = true;
    }
    if (typeof body.transferApprovalRequired === "boolean") {
      await setSetting(SETTING_KEYS.transferApprovalRequired, body.transferApprovalRequired, actor.id);
      changes.transferApprovalRequired = body.transferApprovalRequired;
    }

    await logAudit({ action: "SETTINGS_UPDATED", actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, targetType: "settings", targetId: "system", meta: changes });
    const s = await getSettings();
    return NextResponse.json({ ok: true, settings: s });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
