// ════════════════════════════════════════════════════════════════════════
//  ALERT DISPATCHER · Telegram · Email (SMTP) · Browser Web-Push
//  Every signal, fill, SL/TP, scanner hit and broker error fans out to all
//  enabled channels and is logged to AlertLog for the in-app history.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import type { AlertSettings } from "@prisma/client";
import nodemailer from "nodemailer";
import webpush from "web-push";

export type AlertKind = "fire" | "win" | "loss" | "scanner" | "broker" | "status" | "test";

export interface AlertPayload {
  kind: AlertKind;
  title: string;
  body: string;
}

export interface EventsCfg {
  fire: boolean;
  win: boolean;
  loss: boolean;
  scanner: boolean;
  broker: boolean;
  status: boolean;
}

const DEFAULT_EVENTS: EventsCfg = {
  fire: true,
  win: true,
  loss: true,
  scanner: true,
  broker: true,
  status: false,
};

export function parseEvents(json: string): EventsCfg {
  try {
    return { ...DEFAULT_EVENTS, ...(JSON.parse(json) as Partial<EventsCfg>) };
  } catch {
    return { ...DEFAULT_EVENTS };
  }
}

export async function getAlertSettings(): Promise<AlertSettings> {
  const rows = await db.alertSettings.findMany({ take: 1 });
  if (rows[0]) return rows[0];
  return db.alertSettings.create({ data: { id: "main" } });
}

// ─── in-memory dedupe: same title within 20s sends once ────────────────
const seen = new Map<string, number>();
function deduped(title: string): boolean {
  const now = Date.now();
  const last = seen.get(title) ?? 0;
  if (now - last < 20_000) return false;
  seen.set(title, now);
  if (seen.size > 300) {
    for (const [k, t] of seen) if (now - t > 120_000) seen.delete(k);
  }
  return true;
}

// ─── channels ───────────────────────────────────────────────────────────

async function sendTelegram(s: AlertSettings, title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!s.telegramEnabled || !s.telegramBotToken || !s.telegramChatId) {
    return { ok: false, error: "telegram not configured" };
  }
  const url = `https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: s.telegramChatId,
        text: `<b>${esc(title)}</b>\n${esc(body)}`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, error: `HTTP ${r.status} ${txt.slice(0, 140)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendEmail(s: AlertSettings, title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!s.emailEnabled || !s.smtpHost || !s.smtpTo) {
    return { ok: false, error: "email not configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: s.smtpHost,
      port: s.smtpPort,
      secure: s.smtpSecure,
      auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
      connectionTimeout: 12000,
    });
    await transporter.sendMail({
      from: s.smtpFrom || s.smtpUser || "halo3el@localhost",
      to: s.smtpTo,
      subject: title,
      text: body,
      html: `<div style="font-family:monospace;background:#0B1426;color:#E8ECF4;padding:16px;border-radius:8px">
        <h2 style="color:#D4AF37;margin:0 0 8px">${esc(title)}</h2>
        <pre style="white-space:pre-wrap;margin:0;font-size:13px">${esc(body)}</pre>
      </div>`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function ensureVapid(s: AlertSettings): Promise<{ pub: string; priv: string }> {
  if (s.vapidPublicKey && s.vapidPrivateKey) return { pub: s.vapidPublicKey, priv: s.vapidPrivateKey };
  const keys = webpush.generateVAPIDKeys();
  await db.alertSettings.update({
    where: { id: s.id },
    data: { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey },
  });
  return { pub: keys.publicKey, priv: keys.privateKey };
}

async function sendPush(s: AlertSettings, title: string, body: string): Promise<{ ok: boolean; error?: string; sent: number }> {
  if (!s.pushEnabled) return { ok: false, error: "push disabled", sent: 0 };
  const subs = await db.pushSubscription.findMany();
  if (subs.length === 0) return { ok: false, error: "no devices subscribed", sent: 0 };
  const { pub, priv } = await ensureVapid(s);
  webpush.setVapidDetails("mailto:halo3el@alerts.local", pub, priv);
  const payload = JSON.stringify({ title, body, kind: "halo", ts: Date.now() });
  let sent = 0;
  let lastErr = "";
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        TTL: 120,
      });
      sent += 1;
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      lastErr = err.message ?? "push failed";
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }
  return sent > 0 ? { ok: true, sent } : { ok: false, error: lastErr || "all pushes failed", sent: 0 };
}

async function log(kind: string, channel: string, title: string, body: string, ok: boolean, error: string): Promise<void> {
  try {
    await db.alertLog.create({ data: { kind, channel, title: title.slice(0, 120), body: body.slice(0, 600), ok, error: error.slice(0, 300) } });
  } catch {
    // logging must never break trading
  }
}

// ─── public API ─────────────────────────────────────────────────────────

export interface DispatchResult {
  gated?: boolean;
  telegram?: { ok: boolean; error?: string };
  email?: { ok: boolean; error?: string };
  push?: { ok: boolean; error?: string; sent: number };
}

/** Fan an alert out to every enabled channel (event gate + dedupe apply). */
export async function sendAlert(p: AlertPayload, opts?: { force?: boolean }): Promise<DispatchResult> {
  const s = await getAlertSettings();
  if (!opts?.force) {
    const ev = parseEvents(s.eventsJson);
    if (!ev[p.kind as keyof EventsCfg]) return { gated: true };
    if (!deduped(`${p.kind}:${p.title}`)) return { gated: true };
  }

  const [tg, em, pu] = await Promise.all([
    sendTelegram(s, p.title, p.body),
    sendEmail(s, p.title, p.body),
    sendPush(s, p.title, p.body).catch((e) => ({ ok: false, error: (e as Error).message, sent: 0 })),
  ]);
  void log(p.kind, "telegram", p.title, p.body, tg.ok, tg.error ?? "");
  void log(p.kind, "email", p.title, p.body, em.ok, em.error ?? "");
  void log(p.kind, "push", p.title, p.body, pu.ok, pu.error ?? "");
  return { telegram: tg, email: em, push: pu };
}

/** Send a test to one or all channels regardless of the event gate. */
export async function testAlert(channel: "telegram" | "email" | "push" | "all"): Promise<DispatchResult> {
  const s = await getAlertSettings();
  const title = "HALO 3EL · TEST ALERT";
  const body = `Test fired ${new Date().toISOString()} — if you read this, ${channel === "all" ? "your channels" : channel} are wired correctly.`;
  const out: DispatchResult = {};
  if (channel === "all" || channel === "telegram") {
    out.telegram = await sendTelegram(s, title, body);
    void log("test", "telegram", title, body, out.telegram.ok, out.telegram.error ?? "");
  }
  if (channel === "all" || channel === "email") {
    out.email = await sendEmail(s, title, body);
    void log("test", "email", title, body, out.email.ok, out.email.error ?? "");
  }
  if (channel === "all" || channel === "push") {
    out.push = await sendPush(s, title, body).catch((e) => ({ ok: false, error: (e as Error).message, sent: 0 }));
    void log("test", "push", title, body, out.push.ok, out.push.error ?? "");
  }
  return out;
}

export async function vapidPublicKey(): Promise<string> {
  const s = await getAlertSettings();
  const { pub } = await ensureVapid(s);
  return pub;
}
