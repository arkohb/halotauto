import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guardLicensed, guardTrading } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════════════
//  HALO TRADER PROFILE · preferred name + voice-assistant preferences
//
//  Server-backed singleton (id = "main") so the personalized welcome and
//  voice consents survive across devices/sessions. Strictly presentational
//  data: nothing here is ever read by the trading engine, execution path,
//  risk controls or broker integration.
//
//  • displayName is heavily sanitized (unicode letters/digits/space and a
//    few safe punctuation marks, ≤24 chars). Empty → the UI falls back to
//    "Trader" and offers personalization. The name is never invented.
//  • wakePhrase is lowercase a-z digits/space/apostrophe, ≤24 chars.
// ════════════════════════════════════════════════════════════════════════

const ID = "main";

function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .replace(/[^\p{L}\p{M}\p{N}' .\-_]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 24);
}

function sanitizePhrase(raw: unknown): string {
  if (typeof raw !== "string") return "halo";
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return cleaned || "halo";
}

function shape(row: { displayName: string; voiceEnabled: boolean; wakeEnabled: boolean; wakePhrase: string; autoGreeting: boolean }) {
  const name = row.displayName.trim();
  return {
    displayName: name,
    hasName: name.length > 0,
    voiceEnabled: row.voiceEnabled,
    wakeEnabled: row.wakeEnabled,
    wakePhrase: row.wakePhrase,
    autoGreeting: row.autoGreeting,
  };
}

async function readRow() {
  return db.traderProfile.upsert({ where: { id: ID }, update: {}, create: { id: ID } });
}

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const row = await readRow();
    return NextResponse.json({ ok: true, profile: shape(row) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 160) }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const deny = await guardTrading();
  if (deny) return deny;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const patch: {
    displayName?: string;
    voiceEnabled?: boolean;
    wakeEnabled?: boolean;
    wakePhrase?: string;
    autoGreeting?: boolean;
  } = {};

  if ("displayName" in body) patch.displayName = sanitizeName(body.displayName);
  if (typeof body.voiceEnabled === "boolean") patch.voiceEnabled = body.voiceEnabled;
  if (typeof body.wakeEnabled === "boolean") patch.wakeEnabled = body.wakeEnabled;
  if ("wakePhrase" in body) patch.wakePhrase = sanitizePhrase(body.wakePhrase);
  if (typeof body.autoGreeting === "boolean") patch.autoGreeting = body.autoGreeting;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  }

  try {
    const row = await db.traderProfile.upsert({
      where: { id: ID },
      update: patch,
      create: { id: ID, ...patch },
    });
    return NextResponse.json({ ok: true, profile: shape(row) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 160) }, { status: 503 });
  }
}
