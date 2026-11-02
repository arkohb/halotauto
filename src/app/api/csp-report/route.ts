// Browser CSP violation reports (report-uri). Public — browsers send them
// without cookies. Size-capped and rate-limited; logged for review, never
// echoed back. Nothing here can change application state.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8_000;
const g = globalThis as unknown as { __haloCspHits?: { at: number; n: number } };

export async function POST(req: Request) {
  const now = Date.now();
  const w = (g.__haloCspHits ??= { at: now, n: 0 });
  if (now - w.at > 60_000) Object.assign(w, { at: now, n: 0 });
  if (++w.n > 120) return new NextResponse(null, { status: 429 });
  const text = (await req.text().catch(() => "")).slice(0, MAX_BYTES);
  try {
    const body = JSON.parse(text) as { "csp-report"?: Record<string, unknown> };
    const r = body["csp-report"] ?? {};
    console.warn(
      `[csp] ${String(r["effective-directive"] ?? r["violated-directive"] ?? "?")} blocked ${String(r["blocked-uri"] ?? "?").slice(0, 200)} on ${String(r["document-uri"] ?? "?").slice(0, 120)}`
    );
  } catch {
    // malformed report — ignore
  }
  return new NextResponse(null, { status: 204 });
}
