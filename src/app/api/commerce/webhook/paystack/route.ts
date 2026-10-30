// ══════════════════════════════════════════════════════════════════════════
//  /api/commerce/webhook/paystack · server-side payment verification
//  Signature: HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY) == x-paystack-signature
//  Idempotent: duplicate charge.success events are recorded once in
//  PaymentEvent and never double-issue a license.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PAYMENT_STATUSES } from "@/lib/commerce/constants";
import { processVerifiedPayment, recordPaymentEvent, verifyPaystackSignature } from "@/lib/commerce/payments";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

interface PaystackEvent {
  event?: string;
  data?: { reference?: string; amount?: number; currency?: string; id?: number; status?: string };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!verifyPaystackSignature(raw, signature)) {
    await logAudit({ action: "WEBHOOK_SIGNATURE_INVALID", actorId: "system", targetType: "payment", outcome: "denied", meta: { provider: "PAYSTACK" } });
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }

  let evt: PaystackEvent;
  try {
    evt = JSON.parse(raw) as PaystackEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed payload." }, { status: 400 });
  }

  const eventId = `${evt.event ?? "unknown"}:${evt.data?.reference ?? evt.data?.id ?? Math.random().toString(36).slice(2)}`;
  const firstTime = await recordPaymentEvent("PAYSTACK", eventId, evt.event ?? "unknown", evt);
  if (!firstTime) return NextResponse.json({ ok: true, duplicate: true });

  if (evt.event === "charge.success" && evt.data?.reference) {
    const r = await processVerifiedPayment({
      reference: evt.data.reference,
      provider: "PAYSTACK",
      expectedAmountCents: evt.data.amount ?? null,
      expectedCurrency: evt.data.currency ?? null,
      providerRef: String(evt.data.id ?? ""),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
    return NextResponse.json({ ok: true, duplicate: !!r.duplicate });
  }

  if (evt.event === "charge.failed" && evt.data?.reference) {
    await db.payment.updateMany({
      where: { reference: evt.data.reference, status: PAYMENT_STATUSES.PENDING },
      data: { status: PAYMENT_STATUSES.FAILED, providerRef: String(evt.data.id ?? "") },
    });
  }
  return NextResponse.json({ ok: true });
}
