import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mergeCreds, parseCreds, maskCreds } from "@/lib/brokers";
import { testBrokerAccount } from "@/lib/brokers/service";
import { sendAlert } from "@/lib/alerts";
import { guardTrading } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      action: "activate" | "test" | "update";
      label?: string;
      creds?: Record<string, unknown>;
      andGoLive?: boolean;
    };

    const row = await db.brokerAccount.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    if (body.action === "test") {
      const r = await testBrokerAccount(id);
      return NextResponse.json({ ok: r.ok, status: r.status, statusMsg: r.statusMsg });
    }

    if (body.action === "activate") {
      await db.brokerAccount.updateMany({ data: { active: false } });
      const updated = await db.brokerAccount.update({ where: { id }, data: { active: true } });

      // one-click GO LIVE: activate + arm the EA's live order routing here
      let liveArmed = false;
      if (body.andGoLive) {
        if (updated.status !== "ok") {
          return NextResponse.json({
            ok: true,
            status: updated.status,
            statusMsg: updated.statusMsg,
            liveArmed: false,
            warn: "Account activated, but the last TEST failed — run TEST first, then GO LIVE.",
          });
        }
        await db.botConfig.updateMany({
          where: { id: "main" },
          data: { executionMode: "live", brokerAccountId: id },
        });
        liveArmed = true;
        void sendAlert({
          kind: "broker",
          title: "HALO 3EL · LIVE ROUTING ARMED",
          body: `EA orders now route to ${updated.label}. Every C3 fire is sent as a real market order with SL/TP.`,
        });
      }

      return NextResponse.json({
        ok: true,
        status: updated.status,
        statusMsg: updated.statusMsg,
        liveArmed,
        warn:
          updated.status !== "ok"
            ? "Account is active but the last test failed — live orders may be rejected."
            : undefined,
      });
    }

    if (body.action === "update") {
      const credsJson = body.creds ? mergeCreds(row.credsJson, body.creds) : row.credsJson;
      await db.brokerAccount.update({
        where: { id },
        data: {
          credsJson,
          label: body.label?.trim() || row.label,
          status: "untested",
          statusMsg: "",
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const { id } = await ctx.params;
    const row = await db.brokerAccount.findUnique({ where: { id } });
    await db.brokerAccount.delete({ where: { id } }).catch(() => {});
    // if the deleted account was wired for live execution, fall back to paper
    if (row?.active) {
      await db.botConfig.updateMany({
        where: { brokerAccountId: id },
        data: { executionMode: "paper", brokerAccountId: "" },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const deny = await guardTrading();
  if (deny) return deny;
  try {
    const { id } = await ctx.params;
    const row = await db.brokerAccount.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const creds = parseCreds(row.credsJson);
    return NextResponse.json({
      ok: true,
      broker: {
        id: row.id,
        kind: row.kind,
        label: row.label,
        status: row.status,
        statusMsg: row.statusMsg,
        active: row.active,
        masked: maskCreds(creds),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
