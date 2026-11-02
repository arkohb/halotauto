import { NextResponse } from "next/server";
import { getNews } from "@/lib/halo/intel";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

// GET /api/intel/news?source=bloomberg|yahoo&topic=keyword&limit=20
export async function GET(req: Request) {
  const deny = await guardLicensed();
  if (deny) return deny;
  const url = new URL(req.url);
  const source = url.searchParams.get("source") === "yahoo" ? "yahoo" : "bloomberg";
  const topic = (url.searchParams.get("topic") ?? "").slice(0, 40) || undefined;
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));

  try {
    const res = await getNews(source, topic);
    return NextResponse.json({ ...res, items: res.items.slice(0, limit) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
