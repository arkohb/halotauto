// Capital Guardian status + Monte Carlo risk-of-ruin from the user's own book
import { NextResponse } from "next/server";
import { guardianCheck, loadGuardianHistory, monteCarlo } from "@/lib/edge/guardian";
import { loadEdge } from "@/lib/edge/settings";
import { guardLicensed } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const deny = await guardLicensed();
  if (deny) return deny;
  const edge = await loadEdge();
  const hist = await loadGuardianHistory();
  const verdict = guardianCheck(hist, Date.now(), edge.guardian);
  const rs = hist.filter((t) => t.r !== null).map((t) => t.r!);
  const mc = monteCarlo(rs, { ruinR: edge.guardian.ruinR });
  return NextResponse.json({ ok: true, settings: edge.guardian, verdict, monteCarlo: mc, sample: rs.length });
}
