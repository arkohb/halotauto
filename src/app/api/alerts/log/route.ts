import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  try {
    const rows = await db.alertLog.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
    return NextResponse.json({ ok: true, log: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
