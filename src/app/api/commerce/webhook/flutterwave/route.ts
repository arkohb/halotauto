// ══════════════════════════════════════════════════════════════════════════
//  /api/commerce/webhook/flutterwave · server-side payment verification
//  Signature: `verif-hash` header == FLUTTERWAVE_WEBHOOK_HASH (the dashboard
//  "secret hash"), constant-time. The transaction is then re-queried with
//  GET /v3/transactions/{id}/verify — amount, currency, status and tx_ref
//  come from that call, never from the webhook body.
//  Idempotent via PaymentEvent dedup (event:id:status).
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PAYMENT_STATUSES } from "@/lib/commerce/constants";
import { processVerifiedPayment, recordPaymentEvent, verifyFlutterwaveSignature, verifyFlutterwaveTransaction } from "@/lib/commerce/payments";
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
  const id = evt.data?.id;
  const txRef = evt.data?.tx_ref;
  if (id === undefined || id === null || !txRef) return NextResponse.json({ ok: true, ignored: "no transaction id / tx_ref" });

  // idempotency per Flutterwave's guidance: event + transaction id + status
  // (a failed attempt and a later success for the same order are different events)
  const eventId = `${evt.event ?? "unknown"}:${id}:${evt.data?.status ?? ""}`;
  const firstTime = await recordPaymentEvent("FLUTTERWAVE", eventId, evt.event ?? "unknown", evt);
  if (!firstTime) return NextResponse.json({ ok: true, duplicate: true });

  // never trust the webhook body for money: re-query Flutterwave
  const tx = await verifyFlutterwaveTransaction(id);
  if (!tx) {
    // un-record the event so Flutterwave's retry (3×, 30 min apart) is processed
    await db.paymentEvent.deleteMany({ where: { provider: "FLUTTERWAVE", eventId } });
    await logAudit({ action: "PAYMENT_PROVIDER_VERIFY_FAILED", actorId: "system", targetType: "payment", outcome: "failed", meta: { provider: "FLUTTERWAVE", txRef } });
    return NextResponse.json({ ok: false, error: "Could not verify the transaction with Flutterwave." }, { status: 502 });
  }
  if (tx.tx_ref !== txRef) {
    await logAudit({ action: "PAYMENT_REFERENCE_MISMATCH", actorId: "system", targetType: "payment", outcome: "denied", meta: { provider: "FLUTTERWAVE", txRef } });
    return NextResponse.json({ ok: false, error: "Transaction reference mismatch." }, { status: 422 });
  }

  if (tx.status === "successful") {
    const r = await processVerifiedPayment({
      reference: txRef,
      provider: "FLUTTERWAVE",
      expectedAmountCents: tx.amount != null ? Math.round(Number(tx.amount) * 100) : null,
      expectedCurrency: tx.currency ?? null,
      providerRef: String(tx.id ?? id),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
    return NextResponse.json({ ok: true, duplicate: !!r.duplicate });
  }

  // verified as not successful → a pending order is marked failed (no licence)
  await db.payment.updateMany({
    where: { reference: txRef, status: PAYMENT_STATUSES.PENDING },
    data: { status: PAYMENT_STATUSES.FAILED, providerRef: String(id) },
  });
  return NextResponse.json({ ok: true, status: tx.status ?? "unknown" });
}
