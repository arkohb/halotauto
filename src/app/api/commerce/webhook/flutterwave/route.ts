// ══════════════════════════════════════════════════════════════════════════
//  /api/commerce/webhook/flutterwave · server-side payment verification
//  Signature: sha256(FLUTTERWAVE_SECRET_KEY + rawBody) == verif-hash header
//  Idempotent via PaymentEvent dedup.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PAYMENT_STATUSES } from "@/lib/commerce/constants";
import { processVerifiedPayment, recordPaymentEvent, verifyFlutterwaveSignature } from "@/lib/commerce/payments";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

interface FlutterwaveEvent {
  event?: string;
  data?: { tx_ref?: string; amount?: number; currency?: string; id?: number; status?: string };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("verif-hash");

  if (!verifyFlutterwaveSignature(raw, signature)) {
    await logAudit({ action: "WEBHOOK_SIGNATURE_INVALID", actorId: "system", targetType: "payment", outcome: "denied", meta: { provider: "FLUTTERWAVE" } });
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 401 });
  }

  let evt: FlutterwaveEvent;
  try {
    evt = JSON.parse(raw) as FlutterwaveEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Malformed payload." }, { status: 400 });
  }

  const eventId = `${evt.event ?? "unknown"}:${evt.data?.tx_ref ?? evt.data?.id ?? Math.random().toString(36).slice(2)}`;
  const firstTime = await recordPaymentEvent("FLUTTERWAVE", eventId, evt.event ?? "unknown", evt);
  if (!firstTime) return NextResponse.json({ ok: true, duplicate: true });

  if (evt.event === "completed" || evt.data?.status === "successful") {
    if (!evt.data?.tx_ref) return NextResponse.json({ ok: true });
    const r = await processVerifiedPayment({
      reference: evt.data.tx_ref,
      provider: "FLUTTERWAVE",
      expectedAmountCents: evt.data.amount != null ? Math.round(evt.data.amount * 100) : null,
      expectedCurrency: evt.data.currency ?? null,
      providerRef: String(evt.data.id ?? ""),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
    return NextResponse.json({ ok: true, duplicate: !!r.duplicate });
  }

  if (evt.data?.tx_ref) {
    await db.payment.updateMany({
      where: { reference: evt.data.tx_ref, status: PAYMENT_STATUSES.PENDING },
      data: { status: PAYMENT_STATUSES.FAILED, providerRef: String(evt.data.id ?? "") },
    });
  }
  return NextResponse.json({ ok: true });
}
