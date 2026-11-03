import { NextResponse } from "next/server";
import { eaPoll, type EaAccount, type EaResult } from "@/lib/brokers/mt5-ea";

// HALO Bridge EA poll endpoint (mt5/HALO_Bridge.mq5). No browser session:
// the EA authenticates with its pairing key (X-HALO-EA-KEY). A wrong key
// only ever reaches an empty channel — commands are queued per key by the
// broker adapter, never handed to a key that was not configured.
export const dynamic = "force-dynamic";

const MAX_BODY = 64_000;

export async function POST(req: Request) {
  const key = (req.headers.get("x-halo-ea-key") ?? "").trim();
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "body too large" }, { status: 413 });
  let body: { account?: EaAccount; results?: EaResult[] } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const results = Array.isArray(body.results) ? body.results.slice(0, 50) : [];
  const lines = eaPoll(key, body.account ?? null, results);
  if (!lines) return new Response("ERR pairing key missing or too short\n", { status: 401 });
  return new Response(lines.length ? `${lines.join("\n")}\n` : "", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
