import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAlertSettings, parseEvents, vapidPublicKey } from "@/lib/alerts";

export const dynamic = "force-dynamic";

function mask(s: string): string {
  if (!s) return "";
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}

export async function GET() {
  try {
    const s = await getAlertSettings();
    const pub = s.vapidPublicKey || (await vapidPublicKey().catch(() => ""));
    return NextResponse.json({
      ok: true,
      settings: {
        telegramEnabled: s.telegramEnabled,
        telegramBotToken: mask(s.telegramBotToken),
        telegramChatId: s.telegramChatId,
        emailEnabled: s.emailEnabled,
        smtpHost: s.smtpHost,
        smtpPort: s.smtpPort,
        smtpSecure: s.smtpSecure,
        smtpUser: s.smtpUser,
        smtpPass: mask(s.smtpPass),
        smtpFrom: s.smtpFrom,
        smtpTo: s.smtpTo,
        pushEnabled: s.pushEnabled,
        events: parseEvents(s.eventsJson),
        vapidPublicKey: pub,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const s = await getAlertSettings();
    const keep = (v: unknown, old: string): string => {
      const str = String(v ?? "");
      return str.includes("•") ? old : str; // masked → keep stored secret
    };
    const events = body.events as Record<string, boolean> | undefined;
    const data = {
      telegramEnabled: Boolean(body.telegramEnabled),
      telegramBotToken: body.telegramBotToken !== undefined ? keep(body.telegramBotToken, s.telegramBotToken) : s.telegramBotToken,
      telegramChatId: body.telegramChatId !== undefined ? String(body.telegramChatId ?? "") : s.telegramChatId,
      emailEnabled: Boolean(body.emailEnabled),
      smtpHost: body.smtpHost !== undefined ? String(body.smtpHost ?? "") : s.smtpHost,
      smtpPort: body.smtpPort !== undefined ? Math.min(65535, Math.max(1, Number(body.smtpPort) || 587)) : s.smtpPort,
      smtpSecure: body.smtpSecure !== undefined ? Boolean(body.smtpSecure) : s.smtpSecure,
      smtpUser: body.smtpUser !== undefined ? String(body.smtpUser ?? "") : s.smtpUser,
      smtpPass: body.smtpPass !== undefined ? keep(body.smtpPass, s.smtpPass) : s.smtpPass,
      smtpFrom: body.smtpFrom !== undefined ? String(body.smtpFrom ?? "") : s.smtpFrom,
      smtpTo: body.smtpTo !== undefined ? String(body.smtpTo ?? "") : s.smtpTo,
      pushEnabled: body.pushEnabled !== undefined ? Boolean(body.pushEnabled) : s.pushEnabled,
      eventsJson: events ? JSON.stringify(events) : s.eventsJson,
    };
    await db.alertSettings.update({ where: { id: s.id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
