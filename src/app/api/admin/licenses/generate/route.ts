// ══════════════════════════════════════════════════════════════════════════
//  /api/admin/licenses/generate · dedicated license-generation page API
//  RBAC:
//   · paid/authorized generation → SUPER_ADMIN, LICENSE_ADMIN
//   · COMPLIMENTARY licenses → SUPER_ADMIN only, with a mandatory reason
//     and audit record — never faked as a payment transaction.
//  Returns the FULL key exactly once (preview/copy/download/email).
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/commerce/constants";
import { requireAdmin } from "@/lib/commerce/auth";
import { generateLicense } from "@/lib/commerce/license-engine";
import { logAudit } from "@/lib/commerce/audit";
import { licenseIssuedEmail, sendMail } from "@/lib/commerce/mailer";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const g = await requireAdmin();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const actor = g.user;

    const body = (await req.json()) as {
      planCode?: string;
      userId?: string;
      customerName?: string;
      customerEmail?: string;
      kind?: "SINGLE_USER" | "MULTI_USER";
      deviceLimit?: number;
      lifetime?: boolean;
      expiresAt?: string;
      complimentary?: boolean;
      compReason?: string;
      paymentReference?: string;
      notes?: string;
      sendEmail?: boolean;
    };

    if (!body.planCode) return NextResponse.json({ ok: false, error: "Select a plan." }, { status: 400 });
    const plan = await db.plan.findUnique({ where: { code: body.planCode } });
    if (!plan) return NextResponse.json({ ok: false, error: "Unknown plan." }, { status: 404 });

    const isComp = !!body.complimentary;
    if (isComp && actor.role !== ROLES.SUPER_ADMIN) {
      return NextResponse.json({ ok: false, error: "Only a Super Administrator may issue complimentary licenses." }, { status: 403 });
    }
    if (isComp && !body.compReason?.trim()) {
      return NextResponse.json({ ok: false, error: "A reason is required for complimentary licenses." }, { status: 400 });
    }
    if (!isComp && !body.paymentReference?.trim() && !body.userId) {
      return NextResponse.json({ ok: false, error: "A paid license requires a payment reference or a linked customer with a verified payment." }, { status: 400 });
    }

    // Resolve the customer account (optional — license can bind on activation).
    let userId: string | null = null;
    let customerEmail = body.customerEmail?.trim().toLowerCase() ?? "";
    let customerName = body.customerName?.trim() ?? "";
    if (body.userId) {
      const u = await db.user.findUnique({ where: { id: body.userId } });
      if (!u) return NextResponse.json({ ok: false, error: "Selected customer not found." }, { status: 404 });
      userId = u.id;
      customerEmail = u.email;
      customerName = u.fullName;
    }

    // Payment reference sanity check: if it matches a payment, link for the record.
    let linkedPaymentId: string | null = null;
    if (body.paymentReference?.trim()) {
      const p = await db.payment.findUnique({ where: { reference: body.paymentReference.trim() } });
      if (p) linkedPaymentId = p.id;
    }

    const expiresAt = body.lifetime === false && body.expiresAt ? new Date(body.expiresAt) : null;

    const license = await generateLicense({
      planCode: plan.code,
      planName: plan.name,
      deviceLimit: body.deviceLimit && body.deviceLimit > 0 ? body.deviceLimit : plan.deviceLimit,
      userId,
      customerLabel: userId ? undefined : [customerName, customerEmail].filter(Boolean).join(" · ") || undefined,
      kind: body.kind ?? "SINGLE_USER",
      seatLimit: body.kind === "MULTI_USER" ? 5 : 1,
      expiresAt,
      isComplimentary: isComp,
      compReason: body.compReason ?? "",
      paymentId: linkedPaymentId,
      issuedBy: actor,
      notes: body.notes ?? "",
    });

    let emailed = false;
    if (customerEmail && body.sendEmail !== false) {
      const r = await sendMail({ ...licenseIssuedEmail(customerName, license.key, plan.name, isComp), to: customerEmail });
      emailed = r.ok;
    }

    return NextResponse.json({
      ok: true,
      license: {
        id: license.id,
        key: license.key, // full key — shown once in the preview panel
        planCode: plan.code,
        planName: plan.name,
        deviceLimit: license.deviceLimit,
        kind: license.kind,
        isComplimentary: license.isComplimentary,
        expiresAt: license.expiresAt?.toISOString() ?? null,
        lifetime: !license.expiresAt,
        customerEmail,
        emailed,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
