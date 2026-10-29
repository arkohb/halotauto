import { NextResponse } from "next/server";
import { getCalendar, type CalendarDay } from "@/lib/halo/intel";

export const dynamic = "force-dynamic";

const DAYS: CalendarDay[] = ["today", "tomorrow", "this_week", "next_week"];

// GET /api/intel/calendar?day=today&impact=high|med_high|all&currency=USD
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dayRaw = url.searchParams.get("day") ?? "today";
  const day = (DAYS as string[]).includes(dayRaw) ? (dayRaw as CalendarDay) : "today";
  const impactRaw = url.searchParams.get("impact") ?? "all";
  const impact = impactRaw === "high" || impactRaw === "med_high" ? impactRaw : "all";
  const currency = (url.searchParams.get("currency") ?? "").slice(0, 4) || undefined;
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "60", 10) || 60));

  try {
    const res = await getCalendar(day, impact, currency);
    return NextResponse.json({ ...res, day, impact, currency: currency ?? null, events: res.events.slice(0, limit) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
