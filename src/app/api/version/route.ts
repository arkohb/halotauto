// ══════════════════════════════════════════════════════════════════════════
//  DEPLOYMENT VERSION PROBE · powers the dashboard "update available" alert
//
//  GET /api/version → { ok, version, channel, deployedAt }
//
//  `version` is an opaque id bound to the *server process boot* (plus the
//  Next build id when a production build exists). Whenever the server is
//  restarted or rebuilt to effect an update, the id changes and every open
//  dashboard that polls this endpoint raises the "reload to update" alert.
//
//  · no user data, no app secrets — just an opaque hash + boot timestamp;
//    anonymous access is already blocked by the middleware login gate in
//    commercial mode, so no requireUser round-trip is needed here.
//  · the value is computed ONCE per process and stashed on globalThis so
//    dev HMR module re-evaluation can never flap the id.
//  · always Cache-Control: no-store — a cached "old" answer would defeat
//    the whole purpose. The service worker already exempts /api/*.
// ══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

interface HaloBoot {
  bootId: string;
  buildId: string | null;
  channel: "production" | "development";
  bootedAt: string;
}

const g = globalThis as typeof globalThis & { __haloBoot?: HaloBoot };

/** Where a next build leaves its BUILD_ID (standalone copies keep ../). */
async function detectBuildId(): Promise<string | null> {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".next", "BUILD_ID"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", ".next", "BUILD_ID"),
  ];
  for (const p of candidates) {
    try {
      const s = await stat(/*turbopackIgnore: true*/ p);
      if (!s.isFile()) continue;
      const id = (await readFile(/*turbopackIgnore: true*/ p, "utf8")).trim();
      if (id) return id;
    } catch {
      // no build id here — dev server or unusual layout, fall through
    }
  }
  return null;
}

async function boot(): Promise<HaloBoot> {
  if (g.__haloBoot) return g.__haloBoot;
  const buildId = await detectBuildId();
  const bootInfo: HaloBoot = {
    bootId: randomUUID(),
    buildId,
    channel: process.env.NODE_ENV === "production" ? "production" : "development",
    bootedAt: new Date().toISOString(),
  };
  g.__haloBoot = bootInfo;
  return bootInfo;
}

export async function GET() {
  const b = await boot();
  const version = createHash("sha1")
    .update(`${b.buildId ?? "dev"}|${b.bootId}`)
    .digest("hex")
    .slice(0, 16);

  return NextResponse.json(
    { ok: true, version, channel: b.channel, buildId: b.buildId, deployedAt: b.bootedAt },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
