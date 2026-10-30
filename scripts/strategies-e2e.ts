// ════════════════════════════════════════════════════════════════════════
//  STRATEGY STUDIO E2E · run: bun scripts/strategies-e2e.ts
//  Exercises the REAL running app on :3000 — API + runtime + selection
//  semantics + license library — no mocks, honest results only.
// ════════════════════════════════════════════════════════════════════════

const BASE = "http://localhost:3000";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

interface J {
  ok: boolean;
  [k: string]: unknown;
}
async function api(path: string, init?: RequestInit): Promise<{ status: number; j: J }> {
  const r = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  let j: J = { ok: false };
  try {
    j = (await r.json()) as J;
  } catch {
    // non-JSON
  }
  return { status: r.status, j };
}

const EMA_CROSS = `//@version=5
strategy("E2E EMA Cross", overlay=true)
fast = ta.ema(close, 8)
slow = ta.ema(close, 19)
longCond  = ta.crossover(fast, slow)
shortCond = ta.crossunder(fast, slow)
if longCond
    strategy.entry("L", strategy.long)
if shortCond
    strategy.entry("S", strategy.short)
plot(fast, "Fast", color=color.lime)
plot(slow, "Slow", color=color.red)`;

const BROKEN = `//@version=5
strategy("Broken", overlay=true)
x = ta.nope(close, 14)`;

console.log("\n═══ ① baseline state ═══");
{
  const { status, j } = await api("/api/bot/state");
  ok(status === 200, "bot/state reachable");
  const sel = (j.strategy as { selected: { kind: string; name: string } } | undefined)?.selected;
  ok(!!sel, "bot state exposes the strategy field", JSON.stringify(j.strategy ?? {}).slice(0, 80));
  ok(sel?.kind === "builtin", "default selection is the built-in 3EL engine", JSON.stringify(sel));
}

console.log("\n═══ ② create + compile a Pine strategy ═══");
let id = "";
{
  const { status, j } = await api("/api/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E EMA Cross", description: "e2e", pineSource: EMA_CROSS }),
  });
  ok(status === 200 && j.ok === true, "POST /api/strategies compiles", JSON.stringify(j).slice(0, 140));
  const s = j.strategy as { id: string; status: string; kind: string; hasLong: boolean; hasShort: boolean; plotCount: number } | undefined;
  ok(s?.status === "compiled", "status=compiled");
  ok(s?.kind === "strategy", "kind=strategy");
  ok(s?.hasLong === true && s?.hasShort === true, "long+short detected");
  ok((s?.plotCount ?? 0) === 2, "2 plots");
  id = s?.id ?? "";
}
{
  const { j } = await api("/api/strategies");
  const list = j.strategies as { id: string }[];
  ok(Array.isArray(list) && list.some((s) => s.id === id), "strategy appears in the list");
}

console.log("\n═══ ③ preview over REAL history ═══");
{
  const { status, j } = await api(`/api/strategies/${id}/preview?symbol=XAUUSD&tf=5m&limit=400`);
  ok(status === 200 && j.ok === true, "preview 200", JSON.stringify(j).slice(0, 160));
  const plots = (j.plots as { title: string; data: unknown[] }[]) ?? [];
  ok(plots.length === 2 && plots.every((p) => p.data.length > 20), `plots rendered over real candles (${plots.map((p) => `${p.title}:${p.data.length}`).join(", ")})`);
  const stats = j.stats as { trades: number; closed: number; netPips: number } | undefined;
  ok((stats?.trades ?? 0) >= 1, `simulated trades on XAUUSD 5m: ${stats?.trades}`);
  ok(typeof j.source === "string" && (j.source as string).length > 0, "feed source stamped", String(j.source));
  ok(j.symbol === "XAUUSD" && j.tf === "5m", "preview honors symbol/tf");
}

console.log("\n═══ ④ activate → the bot trades it ═══");
{
  const { status, j } = await api(`/api/strategies/${id}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  ok(status === 200 && j.ok === true, "activate 200", JSON.stringify(j).slice(0, 140));
  const bot = j.bot as { active: boolean; name: string; kind: string };
  ok(bot?.active === true && bot?.kind === "pine", "runtime reports the pine strategy active");
  const { j: st } = await api("/api/bot/state");
  const sel = (st.strategy as { selected: { kind: string; name: string } }).selected;
  ok(sel.kind === "pine" && /E2E EMA Cross/.test(sel.name), "bot/state selection switched", JSON.stringify(sel));
}

console.log("\n═══ ⑤ single-active semantics on a second strategy ═══");
let id2 = "";
{
  const { j } = await api("/api/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E RSI", pineSource: EMA_CROSS.replace("E2E EMA Cross", "E2E RSI") }),
  });
  id2 = (j.strategy as { id: string }).id;
  const { j: act } = await api(`/api/strategies/${id2}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  ok(act.ok === true, "second strategy activates");
  const { j: list } = await api("/api/strategies");
  const actives = (list.strategies as { id: string; active: boolean }[]).filter((s) => s.active);
  ok(actives.length === 1 && actives[0].id === id2, "exactly ONE active strategy", JSON.stringify(actives));
}

console.log("\n═══ ⑥ editing an ACTIVE strategy to broken source deactivates honestly ═══");
{
  const { j } = await api(`/api/strategies/${id2}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pineSource: BROKEN }),
  });
  ok(j.ok === true, "PATCH accepted");
  ok(j.deactivated === true, "broken source deactivates the active strategy", JSON.stringify({ deactivated: j.deactivated }));
  const { j: st } = await api("/api/bot/state");
  const sel = (st.strategy as { selected: { kind: string } }).selected;
  ok(sel.kind === "builtin", "bot back on the built-in engine", JSON.stringify(sel));
  const { j: get } = await api(`/api/strategies/${id2}`);
  ok((get.strategy as { status: string }).status === "error", "strategy row marked error");
  // fix it again
  const { j: fixed } = await api(`/api/strategies/${id2}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E RSI", pineSource: EMA_CROSS.replace("E2E EMA Cross", "E2E RSI") }),
  });
  ok((fixed.strategy as { status: string }).status === "compiled", "recompile after fix");
}

console.log("\n═══ ⑦ deactivate + delete ═══");
{
  const { j } = await api(`/api/strategies/${id2}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  ok(j.ok === true, "re-activate for the delete test");
  const { j: del } = await api(`/api/strategies/${id2}`, { method: "DELETE" });
  ok(del.ok === true, "DELETE works");
  const { j: st } = await api("/api/bot/state");
  const sel = (st.strategy as { selected: { kind: string } }).selected;
  ok(sel.kind === "builtin", "deleting the active strategy restores the built-in engine", JSON.stringify(sel));
  const { status } = await api(`/api/strategies/${id2}`);
  ok(status === 404, "deleted strategy is gone");
}

console.log("\n═══ ⑧ bad scripts compile honestly ═══");
{
  const { j } = await api("/api/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "E2E bad", pineSource: BROKEN }),
  });
  ok(j.ok === true, "broken script still SAVES (draft for fixing)");
  ok((j.compile as { ok: boolean }).ok === false, "compile honestly reports failure");
  const badId = (j.strategy as { id: string }).id;
  const { j: act } = await api(`/api/strategies/${badId}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  ok(act.ok === false && /compile/i.test(String(act.error)), "cannot activate an error strategy", String(act.error));
  await api(`/api/strategies/${badId}`, { method: "DELETE" });
  await api(`/api/strategies/${id}`, { method: "DELETE" });
}

console.log("\n═══ ⑨ license library (mint → verify → reject) ═══");
{
  process.env.HALO_LICENSE_SECRET = "e2e-test-secret-123";
  const { mintKey, verifyKey, canonicalKey } = await import("../src/lib/license");
  const key = mintKey("trader@example.com");
  ok(/^HALO-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(key), `key format ${key}`);
  ok(verifyKey(key, "trader@example.com"), "correct key + holder verifies");
  ok(verifyKey(canonicalKey(key.toLowerCase().replace(/-/g, " ")), "TRADER@EXAMPLE.COM"), "canonicalisation + case-insensitive holder");
  ok(!verifyKey(key, "other@example.com"), "wrong holder rejected");
  ok(!verifyKey(key.slice(0, 17) + (key.endsWith("A") ? "B" : "A"), "trader@example.com"), "tampered key rejected");
  const key2 = mintKey("trader@example.com");
  ok(key2 === key, "minting is deterministic (re-issue safe)");
  delete process.env.HALO_LICENSE_SECRET;
}
{
  // owner mode: licensing off → activation endpoint is a friendly no-op
  const { status, j } = await api("/api/license");
  ok(status === 200 && j.licensing === false && j.mode === "owner", "license status: owner mode", JSON.stringify(j));
  const { j: act } = await api("/api/license", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "HALO-TEST-TEST-TEST-TEST", holder: "x@y.com" }),
  });
  ok(act.ok === true, "activation no-op in owner mode");
}

console.log("\n═══ ⑩ voice registry wired ═══");
{
  const { ACTIONS, VIEWS } = await import("../src/lib/halo/actions");
  ok(ACTIONS.some((a) => a.id === "list_strategies"), "list_strategies action exists");
  ok(ACTIONS.some((a) => a.id === "select_strategy" && a.risk === "consequential"), "select_strategy is consequential (confirm flow)");
  ok(VIEWS.some((v) => v.id === "strategies" && v.aliases.includes("strategy studio")), "Strategy Studio navigable by voice");
}

console.log(`\n═══ RESULT: ${pass} passed · ${fail} failed ═══`);
process.exit(fail > 0 ? 1 : 0);

export {}; // module scope (bun script)
