import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isBrokerKind, sealCreds } from "@/lib/brokers";
import { sendAlert } from "@/lib/alerts";
import { guardTrading } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const rows = await db.brokerAccount.findMany({ orderBy: { createdAt: "asc" } });
    const { maskCreds, parseCreds } = await import("@/lib/brokers");
    return NextResponse.json({
      ok: true,
      brokers: rows.map((r) => {
        const creds = parseCreds(r.credsJson);
        return {
          id: r.id,
          kind: r.kind,
          label: r.label,
          env: creds.environment ?? creds.env ?? "—",
          status: r.status,
          statusMsg: r.statusMsg,
          active: r.active,
          lastCheckAt: r.lastCheckAt,
          masked: maskCreds(creds),
        };
      }),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const body = (await req.json()) as {
      kind?: string;
      label?: string;
      creds?: Record<string, unknown>;
    };
    const kind = String(body.kind ?? "");
    if (!isBrokerKind(kind)) return NextResponse.json({ ok: false, error: "unknown broker kind" }, { status: 400 });
    if (kind === "paper") return NextResponse.json({ ok: false, error: "paper needs no account" }, { status: 400 });
    const label = String(body.label ?? "").trim() || kind.toUpperCase();
    const credsJson = sealCreds(body.creds ?? {});
    const row = await db.brokerAccount.create({ data: { kind, label, credsJson } });
    void sendAlert({
      kind: "broker",
      title: "HALO 3EL · BROKER ADDED",
      body: `${label} (${kind}) added — run TEST, then set ACTIVE to route live orders.`,
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
