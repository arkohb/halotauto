// ══════════════════════════════════════════════════════════════════════════
//  PAYMENTS · one-time purchase with server-side verification
//
//  PROVIDERS
//  - PAYSTACK   : primary recommendation for Ghana + international
//                 (cards, Mobile Money, bank transfer). HMAC-SHA512 signed
//                 webhook + server-side transaction verify.
//  - FLUTTERWAVE: alternate pan-African provider. sha256 signature check.
//  - MANUAL     : always available fallback — an authorized administrator
//                 records & verifies an offline payment (reference, amount,
//                 currency, admin identity, audit record).
//
//  RULES
//  - A browser redirect or frontend success message is NEVER proof of payment.
//  - Raw card details are never stored — only provider references.
//  - Duplicate webhooks are deduplicated via PaymentEvent (idempotent).
//  - Payment verified → license issued idempotently → approval policy applied.
//  - E-mail/notification failure never fails a payment.
// ══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";
import { db } from "@/lib/db";
import { PAYMENT_STATUSES, ROLES, USER_STATUSES } from "./constants";
import { getSettings } from "./settings";
import { issueLicenseForPayment } from "./license-engine";
import { logAudit } from "./audit";
import { notify, paymentVerifiedEmail, approvalEmail, sendMail, addressed } from "./mailer";

export type ProviderKind = "PAYSTACK" | "FLUTTERWAVE" | "MANUAL";

export function activeProvider(): ProviderKind {
  if (process.env.PAYSTACK_SECRET_KEY) return "PAYSTACK";
  if (process.env.FLUTTERWAVE_SECRET_KEY) return "FLUTTERWAVE";
  return "MANUAL";
}

export function providerStatus(): { provider: ProviderKind; paystack: boolean; flutterwave: boolean } {
  return {
    provider: activeProvider(),
    paystack: !!process.env.PAYSTACK_SECRET_KEY,
    flutterwave: !!process.env.FLUTTERWAVE_SECRET_KEY,
  };
}

export function newReference(): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear().toString().slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `HALOPAY-${ymd}-${rand}`;
}

// ── Checkout initialization ───────────────────────────────────────────────

export interface CheckoutInit {
  provider: ProviderKind;
  redirectUrl: string | null;
  instructions: string;
}

export async function initCheckout(opts: {
  userId: string;
  userEmail: string;
  userName: string;
  reference: string;
  amountCents: number;
  currency: string;
  origin: string;
}): Promise<CheckoutInit> {
  const provider = activeProvider();
  if (provider === "PAYSTACK") {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: opts.userEmail,
        amount: opts.amountCents, // smallest currency unit (pesewas/kobo) — matches our cents
        currency: opts.currency,
        reference: opts.reference,
        callback_url: `${opts.origin}/checkout?ref=${encodeURIComponent(opts.reference)}`,
        metadata: { product: "HALO 3EL Autotrader — one-time license" },
      }),
    });
    const j = (await res.json()) as { status?: boolean; message?: string; data?: { authorization_url?: string } };
    if (j.status && j.data?.authorization_url) {
      return { provider, redirectUrl: j.data.authorization_url, instructions: "" };
    }
    throw new Error(j.message || "Paystack initialization failed.");
  }
  if (provider === "FLUTTERWAVE") {
    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: opts.reference,
        amount: opts.amountCents / 100,
        currency: opts.currency,
        redirect_url: `${opts.origin}/checkout?ref=${encodeURIComponent(opts.reference)}`,
        customer: { email: opts.userEmail, name: opts.userName },
        customizations: { title: "HALO 3EL Autotrader", description: "One-time lifetime license" },
      }),
    });
    const j = (await res.json()) as { status?: string; message?: string; data?: { link?: string } };
    if (j.status === "success" && j.data?.link) {
      return { provider, redirectUrl: j.data.link, instructions: "" };
    }
    throw new Error(j.message || "Flutterwave initialization failed.");
  }
  const s = await getSettings();
  return { provider: "MANUAL", redirectUrl: null, instructions: s.paymentChannels };
}

// ── Webhook signature verification ────────────────────────────────────────

export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Flutterwave (v3) webhooks carry the "secret hash" you set in the
 * Flutterwave dashboard — verbatim — in the `verif-hash` header
 * (developer.flutterwave.com/docs/webhooks). It is NOT the API secret key
 * and NOT an HMAC: compare it in constant time with FLUTTERWAVE_WEBHOOK_HASH.
 * The payload itself is never trusted for amounts — see verifyFlutterwaveTransaction.
 */
export function verifyFlutterwaveSignature(_rawBody: string, signature: string | null): boolean {
  const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH;
  if (!expected || !signature) return false;
  const a = crypto.createHash("sha256").update(expected, "utf8").digest();
  const b = crypto.createHash("sha256").update(signature, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

/** Flutterwave API base (overridable for test stubs only) */
export function flutterwaveApiBase(): string {
  return (process.env.FLUTTERWAVE_API_BASE || "https://api.flutterwave.com").replace(/\/$/, "");
}

export interface FlwTransaction {
  status?: string;
  amount?: number;
  currency?: string;
  tx_ref?: string;
  id?: number;
}

/**
 * Independently re-query a transaction by its Flutterwave id
 * (GET /v3/transactions/{id}/verify — the documented verification call).
 * Returns null when the call fails or the transaction is unknown.
 */
export async function verifyFlutterwaveTransaction(id: number | string): Promise<FlwTransaction | null> {
  const key = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!key || id === undefined || id === null || id === "") return null;
  try {
    const res = await fetch(`${flutterwaveApiBase()}/v3/transactions/${encodeURIComponent(String(id))}/verify`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const j = (await res.json()) as { status?: string; data?: FlwTransaction | null };
    if (!res.ok || j.status !== "success" || !j.data) return null;
    return j.data;
  } catch {
    return null;
  }
}

// ── Successful-payment processing (webhook + API-verify + manual share this) ──

export interface ProcessResult {
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  licenseKey?: string;
}

export async function recordPaymentEvent(provider: string, eventId: string, type: string, payload: unknown): Promise<boolean> {
  try {
    await db.paymentEvent.create({ data: { provider, eventId, type, payloadJson: JSON.stringify(payload).slice(0, 20000) } });
    return true; // first time seeing this event
  } catch {
    return false; // unique violation → duplicate delivery, already processed
  }
}

/**
 * Verify a payment by reference, enforce amount/currency when the provider
 * supplies them, mark VERIFIED, auto-issue the license idempotently and
 * apply the configured approval policy. Shared by webhooks, the recovery
 * API-verify path and authorized manual verification.
 */
export async function processVerifiedPayment(opts: {
  reference: string;
  provider: ProviderKind;
  expectedAmountCents?: number | null;
  expectedCurrency?: string | null;
  providerRef?: string;
  actor?: { id: string; email: string; role: string };
  manual?: boolean;
}): Promise<ProcessResult> {
  const payment = await db.payment.findUnique({ where: { reference: opts.reference }, include: { user: true, plan: true } });
  if (!payment) return { ok: false, error: "Unknown payment reference." };

  if (payment.status === PAYMENT_STATUSES.VERIFIED) {
    // Idempotent replay — make sure the license exists (recovery), then stop.
    if (payment.licenseRef) return { ok: true, duplicate: true, licenseKey: payment.licenseRef };
    const { license } = await issueLicenseForPayment(payment.id, opts.actor);
    return { ok: true, duplicate: true, licenseKey: license.key };
  }
  if (payment.status === PAYMENT_STATUSES.REFUNDED || payment.status === PAYMENT_STATUSES.DISPUTED) {
    return { ok: false, error: `Payment is ${payment.status.toLowerCase()} — cannot verify.` };
  }

  // Amount / currency / reference integrity checks (server-side, trusted data only).
  if (opts.expectedAmountCents != null && opts.expectedAmountCents !== payment.amountCents) {
    await db.payment.update({ where: { id: payment.id }, data: { status: PAYMENT_STATUSES.DISPUTED, adminNote: `Amount mismatch: expected ${payment.amountCents}, provider reported ${opts.expectedAmountCents}` } });
    await logAudit({ action: "PAYMENT_AMOUNT_MISMATCH", actorId: opts.actor?.id ?? "system", targetType: "payment", targetId: payment.id, outcome: "failed", meta: { expected: payment.amountCents, got: opts.expectedAmountCents } });
    return { ok: false, error: "Payment amount does not match the order — flagged for review." };
  }
  if (opts.expectedCurrency && opts.expectedCurrency.toUpperCase() !== payment.currency.toUpperCase()) {
    await db.payment.update({ where: { id: payment.id }, data: { status: PAYMENT_STATUSES.DISPUTED, adminNote: `Currency mismatch: expected ${payment.currency}, provider reported ${opts.expectedCurrency}` } });
    return { ok: false, error: "Payment currency does not match the order — flagged for review." };
  }

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: PAYMENT_STATUSES.VERIFIED,
      verifiedAt: new Date(),
      providerRef: opts.providerRef || payment.providerRef,
      manualVerifiedById: opts.manual ? opts.actor?.id ?? null : null,
      manualVerifiedAt: opts.manual ? new Date() : null,
    },
  });

  // License issuance (idempotent — recovery-safe).
  const { license } = await issueLicenseForPayment(payment.id, opts.actor);

  // Approval policy.
  const s = await getSettings();
  if (payment.user.status === USER_STATUSES.PENDING_APPROVAL && s.approvalMode === "AUTOMATIC") {
    await db.user.update({ where: { id: payment.user.id }, data: { status: USER_STATUSES.ACTIVE } });
    await logAudit({ action: "USER_AUTO_APPROVED", actorId: "system", targetType: "user", targetId: payment.user.id, meta: { reason: "verified payment + automatic approval mode" } });
    void sendMail(addressed(approvalEmail(payment.user.fullName), payment.user.email));
  }

  await notify(payment.userId, "payment", "Payment verified", `Your ${payment.plan.name} license is ready for activation.`);
  void sendMail(addressed(paymentVerifiedEmail(payment.user.fullName, payment.plan.name, payment.reference), payment.user.email));

  await logAudit({
    action: opts.manual ? "PAYMENT_MANUALLY_VERIFIED" : "PAYMENT_VERIFIED",
    actorId: opts.actor?.id ?? "system",
    actorEmail: opts.actor?.email ?? "",
    actorRole: opts.actor?.role ?? "",
    targetType: "payment",
    targetId: payment.id,
    meta: { reference: payment.reference, amount: payment.amountCents, currency: payment.currency, provider: opts.provider, licenseKeyMasked: license.key.slice(0, 9) + "…" },
  });

  return { ok: true, licenseKey: license.key };
}

// ── Provider-side verification (recovery when a webhook was missed) ───────

export async function verifyWithProvider(reference: string): Promise<ProcessResult> {
  const payment = await db.payment.findUnique({ where: { reference } });
  if (!payment) return { ok: false, error: "Unknown payment reference." };
  const provider = activeProvider();

  if (provider === "PAYSTACK") {
    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });
    const j = (await res.json()) as { data?: { status?: string; amount?: number; currency?: string; id?: number } };
    if (j.data?.status === "success") {
      return processVerifiedPayment({ reference, provider: "PAYSTACK", expectedAmountCents: j.data.amount ?? null, expectedCurrency: j.data.currency ?? null, providerRef: String(j.data.id ?? "") });
    }
    return { ok: false, error: `Provider reports status "${j.data?.status ?? "unknown"}" — payment not verified yet.` };
  }
  if (provider === "FLUTTERWAVE") {
    // documented verification is by Flutterwave transaction id (stored as
    // providerRef once a webhook arrived); without it we cannot verify
    if (!payment.providerRef) return { ok: false, error: "No Flutterwave transaction id recorded yet — wait for the webhook, then verify." };
    const tx = await verifyFlutterwaveTransaction(payment.providerRef);
    if (!tx) return { ok: false, error: "Flutterwave could not confirm this transaction." };
    if (tx.tx_ref !== reference) return { ok: false, error: "Flutterwave transaction does not belong to this order." };
    if (tx.status === "successful") {
      return processVerifiedPayment({ reference, provider: "FLUTTERWAVE", expectedAmountCents: tx.amount != null ? Math.round(Number(tx.amount) * 100) : null, expectedCurrency: tx.currency ?? null, providerRef: String(tx.id ?? "") });
    }
    return { ok: false, error: `Provider reports status "${tx.status ?? "unknown"}" — payment not verified yet.` };
  }
  return { ok: false, error: "No online payment provider is configured. Use manual verification by an administrator." };
}

// ── Manual verification (authorized administrators) ───────────────────────

export function canManuallyVerify(role: string): boolean {
  return role === ROLES.SUPER_ADMIN || role === ROLES.LICENSE_ADMIN;
}
