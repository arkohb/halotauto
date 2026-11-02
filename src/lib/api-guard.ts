// ════════════════════════════════════════════════════════════════════════
//  API GUARD · server-side access check for route handlers
//
//  src/proxy.ts only checks that a session cookie EXISTS (fast outer ring);
//  it never validates it. Every non-public route must therefore call one of
//  these before touching data:
//    • guardLicensed() — a valid session with an active licence (reads of
//                        the installation's trading data, AI, market data)
//    • guardTrading()  — the same plus the trading entitlement (anything
//                        that changes trading, brokers, alerts or exposes a
//                        secret such as the TradingView webhook secret)
//  Owner mode (HALO_COMMERCE=off) passes, exactly like the proxy. Admin
//  roles pass (they manage the installation).
//
//  Usage:  const deny = await guardLicensed(); if (deny) return deny;
// ════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { requireLicensed, requireTradingAccess } from "@/lib/license";

type GuardResult = { ok: true } | { ok: false; error: string; status: number };

function deny(g: GuardResult): NextResponse | null {
  if (g.ok) return null;
  return NextResponse.json({ ok: false, error: g.error, code: g.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: g.status });
}

export async function guardLicensed(): Promise<NextResponse | null> {
  return deny(await requireLicensed());
}

export async function guardTrading(): Promise<NextResponse | null> {
  return deny(await requireTradingAccess());
}
