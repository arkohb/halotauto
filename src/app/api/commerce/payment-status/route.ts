// ══════════════════════════════════════════════════════════════════════════
//  /api/commerce/payment-status · customer polling for their own payment
//  When an online provider is configured and the webhook was missed, this
//  self-heals by verifying the transaction directly with the provider API.
//  Without a provider, status only changes via ADMIN manual verification.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/commerce/auth";
import { providerStatus, verifyWithProvider } from "@/lib/commerce/payments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const g = await requireUser();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });

    const reference = req.nextUrl.searchParams.get("ref") ?? "";
    const payment = await db.payment.findUnique({ where: { reference }, include: { plan: true } });
    if (!payment || payment.userId !== g.user.id) {
      return NextResponse.json({ ok: false, error: "Payment not found." }, { status: 404 });
    }

    let status = payment.status;
    let licenseKey = payment.licenseRef ?? null;
    let providerNote = "";

    if (payment.status === "PENDING" && (providerStatus().paystack || providerStatus().flutterwave)) {
      const r = await verifyWithProvider(reference);
      if (r.ok) {
        status = "VERIFIED";
        licenseKey = r.licenseKey ?? licenseKey;
      } else {
        providerNote = r.error ?? "";
      }
    }

    return NextResponse.json({
      ok: true,
      reference: payment.reference,
      status,
      planName: payment.plan.name,
      amountCents: payment.amountCents,
      currency: payment.currency,
      provider: payment.provider,
      licenseKey,
      note: providerNote,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
