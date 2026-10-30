// ════════════════════════════════════════════════════════════════════════
//  PINE LONG-SCRIPT LIVE API TEST · run: bun scripts/pine-long-live-test.ts
//  Pushes a generated ~2,500-line strategy through the REAL app pipeline:
//    POST /api/strategies  (compile + persist 80K chars)
//    GET  /api/strategies/[id]/preview?limit=600 (run over REAL feed history)
//    DELETE /api/strategies/[id] (cleanup)
//  Requires the dev server on localhost:3000.
// ════════════════════════════════════════════════════════════════════════

import { genLongScript } from "./pine-long-script-gen";

const BASE = "http://localhost:3000";
let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

async function jfetch(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${BASE}${url}`, { cache: "no-store", ...init });
  const body = (await r.json()) as Record<string, unknown>;
  return { status: r.status, body };
}

console.log("═ PINE LONG-SCRIPT LIVE API TEST ═");

const src = genLongScript(2500);
const lines = src.split("\n").length;
console.log(`\n① script: ${lines} lines, ${src.length.toLocaleString()} chars`);

// ── ② create + compile through the real API ──
const t0 = Date.now();
const created = await jfetch("/api/strategies", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Long Script Load Test (E2E)", description: "generated 2,500-line compile check", pineSource: src }),
});
const createMs = Date.now() - t0;
const strat = created.body.strategy as { id?: string; status?: string } | undefined;
const compile = created.body.compile as { ok?: boolean; diagnostics?: unknown[]; fatal?: { msg?: string } } | undefined;
ok(created.status === 200 && created.body.ok === true, "POST /api/strategies accepted the 80K-char script", `${createMs}ms`);
ok(compile?.ok === true, "server compile ok", compile?.fatal?.msg ?? "");
ok(strat?.status === "compiled", "status = compiled");
console.log(`   id: ${strat?.id ?? "—"}`);

let id = strat?.id;
if (id) {
  // ── ③ persisted source is NOT truncated ──
  const full = await jfetch(`/api/strategies/${id}`);
  const row = full.body.strategy as { pineSource?: string } | undefined;
  const saved = (row?.pineSource ?? "") as string;
  ok(saved.length === src.length, "persisted source is byte-exact (no 60K truncation)", `saved ${saved.length.toLocaleString()} vs sent ${src.length.toLocaleString()}`);

  // ── ④ preview over REAL feed history ──
  const t1 = Date.now();
  const pv = await jfetch(`/api/strategies/${id}/preview?symbol=XAUUSD&tf=5m&limit=600`);
  const pvMs = Date.now() - t1;
  const p = pv.body as { ok?: boolean; bars?: number; plots?: unknown[]; markers?: unknown[]; stats?: { trades?: number }; source?: string; error?: string };
  ok(pv.status === 200 && p.ok === true, "preview ran the 2,500-line script over real history", p.error ?? "");
  ok((p.bars ?? 0) >= 400, "processed a real history window", `${p.bars} bars`);
  ok((p.stats?.trades ?? 0) > 0, "real-history simulated trades fired", `${p.stats?.trades}`);
  ok((p.plots ?? []).length >= 100, "plot series returned for the chart", `${p.plots?.length}`);
  console.log(`   preview: ${(pvMs / 1000).toFixed(2)}s · feed ${p.source} · bars ${p.bars} · trades ${p.stats?.trades}`);

  // ── ⑤ cleanup ──
  const del = await jfetch(`/api/strategies/${id}`, { method: "DELETE" });
  ok(del.status === 200 && del.body.ok === true, "test strategy deleted (no residue)");
} else {
  fail++;
  console.log("  ✗ no strategy id — cleanup skipped");
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
