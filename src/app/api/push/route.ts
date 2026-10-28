import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { vapidPublicKey } from "@/lib/alerts";

export const dynamic = "force-dynamic";

/** GET → VAPID public key for push subscription */
export async function GET() {
  try {
    const pub = await vapidPublicKey();
    return NextResponse.json({ ok: true, publicKey: pub });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

/** POST → save this device's push subscription */
export async function POST(req: Request) {
  try {
    const sub = (await req.json()) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return NextResponse.json({ ok: false, error: "invalid subscription" }, { status: 400 });
    }
    await db.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

/** DELETE → unsubscribe a device */
export async function DELETE(req: Request) {
  try {
    const { endpoint } = (await req.json()) as { endpoint?: string };
    if (endpoint) await db.pushSubscription.deleteMany({ where: { endpoint } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
