// ══════════════════════════════════════════════════════════════════════════
//  /api/commerce/checkout · start a one-time purchase
//  Creates a PENDING payment transaction server-side, then initializes the
//  configured provider (Paystack/Flutterwave) or returns manual-payment
//  instructions. A browser redirect is NEVER treated as proof of payment.
// ══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { USER_STATUSES, clientIp, rateLimit } from "@/lib/commerce/constants";
import { requireUser } from "@/lib/commerce/auth";
import { getSettings } from "@/lib/commerce/settings";
import { initCheckout, newReference, providerStatus } from "@/lib/commerce/payments";
import { logAudit } from "@/lib/commerce/audit";

export const dynamic = "force-dynamic";

function baseUrlFrom(req: NextRequest): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  try {
    const g = await requireUser();
    if (!g.ok) return NextResponse.json({ ok: false, error: g.error }, { status: g.status });
    const user = g.user;

    if (user.status !== USER_STATUSES.ACTIVE) {
      return NextResponse.json({ ok: false, error: "Your account must be active (e-mail verified and approved) before purchasing." }, { status: 403 });
    }

    const rl = rateLimit(`checkout:${clientIp(req)}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ ok: false, error: `Too many checkout attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });

    const { planCode } = (await req.json()) as { planCode?: string };
    const plan = await db.plan.findFirst({ where: { code: String(planCode ?? ""), active: true } });
    if (!plan) return NextResponse.json({ ok: false, error: "That plan is not available." }, { status: 404 });

    const s = await getSettings();
    if (s.maintenanceMode && user.role === "CUSTOMER") {
      return NextResponse.json({ ok: false, error: "The store is temporarily in maintenance mode. Please try again shortly." }, { status: 503 });
    }

    const effectiveCents = plan.promoPriceCents ?? plan.priceCents;
    const reference = newReference();
    const payment = await db.payment.create({
      data: {
        reference,
        userId: user.id,
        planId: plan.id,
        amountCents: effectiveCents,
        currency: plan.currency,
        provider: providerStatus().provider,
        status: "PENDING",
      },
    });
    await logAudit({ action: "CHECKOUT_STARTED", actorId: user.id, actorEmail: user.email, targetType: "payment", targetId: payment.id, meta: { reference, plan: plan.code, amount: effectiveCents, currency: plan.currency } });

    try {
      const init = await initCheckout({
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        reference,
        amountCents: effectiveCents,
        currency: plan.currency,
        origin: baseUrlFrom(req),
      });
      await db.payment.update({ where: { id: payment.id }, data: { provider: init.provider } });
      return NextResponse.json({ ok: true, reference, ...init, amountCents: effectiveCents, currency: plan.currency });
    } catch (e) {
      // Provider init failed — payment stays PENDING, customer can retry or pay manually.
      await db.payment.update({ where: { id: payment.id }, data: { adminNote: `Provider init failed: ${(e as Error).message}` } });
      const ps = providerStatus();
      return NextResponse.json({
        ok: true,
        reference,
        provider: "MANUAL" as const,
        redirectUrl: null,
        instructions: s.paymentChannels,
        amountCents: effectiveCents,
        currency: plan.currency,
        warning: `Online checkout could not be initialized (${(e as Error).message}). You can pay manually and an administrator will verify your payment.`,
        configured: ps.paystack || ps.flutterwave,
      });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
