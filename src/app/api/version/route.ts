// ══════════════════════════════════════════════════════════════════════════
//  RELEASE PROBE · powers the dashboard "new version available" alert
//
//  GET /api/version → { ok, version, channel }
//
//  `version` is the OFFICIAL RELEASE — the "version" field of package.json,
//  baked in at build time (next.config.ts → NEXT_PUBLIC_HALO_RELEASE).
//  Routine deploys, cold starts and the several server instances Firebase
//  runs side by side all answer the same release, so open dashboards only
//  raise the alert when a new release is published (package.json bumped).
//
//  · no user data, no secrets — just the release string;
//  · always Cache-Control: no-store (the service worker exempts /api/*).
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      version: process.env.NEXT_PUBLIC_HALO_RELEASE ?? "0.0.0",
      channel: process.env.NODE_ENV === "production" ? "production" : "development",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
