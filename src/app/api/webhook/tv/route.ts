import { NextResponse } from "next/server";
import {
  extractJson,
  getWebhookInfo,
  parseTvAlert,
  processTvAlert,
  secretMatches,
} from "@/lib/tv-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ════════════════════════════════════════════════════════════════════════
//  TRADINGVIEW ALERT WEBHOOK · the EA → linked account bridge
//  POST  /api/webhook/tv          ← paste this URL into the TradingView alert
//    • body: JSON (or text containing JSON) with {secret, action, symbol, sl, tp…}
//    • header X-HALO-SECRET also accepted
//  GET   /api/webhook/tv          → { secret, enabled, fireCount } for the UI
// ════════════════════════════════════════════════════════════════════════

export async function GET() {
  try {
    const info = await getWebhookInfo();
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    raw = "";
  }

  const payload = extractJson(raw);
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Body is not JSON and contains no JSON object — check the alert message format." },
      { status: 400 }
    );
  }

  // ── auth: X-HALO-SECRET header or payload.secret ──
  const info = await getWebhookInfo();
  const given = req.headers.get("x-halo-secret") ?? String(payload.secret ?? payload.passphrase ?? "");
  if (!secretMatches(given.trim(), info.secret)) {
    return NextResponse.json(
      { ok: false, error: "Bad or missing secret — paste the HALO webhook secret into the Pine EA settings (or X-HALO-SECRET header)." },
      { status: 401 }
    );
  }

  if (!info.enabled) {
    return NextResponse.json(
      { ok: false, error: "Webhook receiver is disabled in the HALO EA ATTACH card." },
      { status: 403 }
    );
  }

  const { alert, error } = parseTvAlert(payload);
  if (!alert) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const result = await processTvAlert(alert);
  return NextResponse.json(result, { status: result.status });
}
