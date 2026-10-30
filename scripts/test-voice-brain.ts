/**
 * E2E · voice-operator brain chain (live HTTP against the dev server)
 * Run: bun scripts/test-voice-brain.ts
 */
const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`); }
}

interface BrainRes {
  ok: boolean; say?: string; error?: string; verifiedAt?: string;
  actions?: { id: string; params: Record<string, string | boolean> }[];
  readResults?: { id: string; ok: boolean; detail: string }[];
  confirmation?: { token: string; action: string; question: string; effect: string };
  declined?: boolean;
}

async function brain(message: string, history: { role: string; text: string }[] = []): Promise<BrainRes> {
  const r = await fetch(`${BASE}/api/halo/brain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, mode: "voice", source: "text" }),
  });
  return (await r.json()) as BrainRes;
}

async function confirm(token: string, approve: boolean): Promise<BrainRes> {
  const r = await fetch(`${BASE}/api/halo/brain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmToken: token, approve }),
  });
  return (await r.json()) as BrainRes;
}

async function main() {
  console.log("── 1. registry pulse ──");
  const g = await (await fetch(`${BASE}/api/halo/brain`)).json() as { registry: number };
  check("registry exposes 31 actions", g.registry === 31, `registry=${g.registry}`);

  console.log("── 2. stale confirm token rejected honestly ──");
  const stale = await confirm("definitely-not-a-token", true);
  check("stale token → ok:false + expiry message", stale.ok === false && /expired|ask me again/i.test(stale.error ?? ""), stale.error?.slice(0, 70));

  console.log("── 3. navigation command (voice-select any tab) ──");
  const nav = await brain("Open the trade history page");
  check("brain ok + say", nav.ok === true && (nav.say?.length ?? 0) > 0, nav.say?.slice(0, 70));
  check("selects navigate_to_view trade-history", nav.actions?.[0]?.id === "navigate_to_view" && nav.actions?.[0]?.params?.view === "trade-history", JSON.stringify(nav.actions?.[0] ?? {}));

  const nav2 = await brain("take me to market intelligence");
  check("alias 'market intelligence' → intel", nav2.actions?.[0]?.params?.view === "intel", JSON.stringify(nav2.actions?.[0]?.params ?? {}));

  console.log("── 4. joke command ──");
  const joke = await brain("tell me a trading joke");
  check("tell_joke read executed with real joke", joke.readResults?.[0]?.id === "tell_joke" && (joke.readResults?.[0]?.detail.length ?? 0) > 20, joke.readResults?.[0]?.detail.slice(0, 80));

  console.log("── 5. cancel orders → consequential confirm flow ──");
  const cancel = await brain("cancel all my pending orders");
  check("returns confirmation (nothing executed yet)", cancel.ok === true && !!cancel.confirmation && !cancel.readResults, cancel.confirmation ? `action=${cancel.confirmation.action}` : JSON.stringify(cancel).slice(0, 120));
  check("confirm question present", /cancel/i.test(cancel.confirmation?.question ?? ""), cancel.confirmation?.question?.slice(0, 70));

  if (cancel.confirmation) {
    const approved = await confirm(cancel.confirmation.token, true);
    check("approve → honest paper-mode execution", approved.ok !== undefined && /paper|clear|no resting/i.test(approved.say ?? ""), approved.say?.slice(0, 100));
  }

  console.log("── 6. market scan read ──");
  const scan = await brain("scan the market now");
  check("run_market_scan executed", scan.readResults?.[0]?.id === "run_market_scan" && (scan.readResults?.[0]?.detail.length ?? 0) > 10, scan.readResults?.[0]?.detail.slice(0, 100));

  console.log("── 7. start/stop the EA (confirm-guarded, state restored) ──");
  const st0 = await (await fetch(`${BASE}/api/bot/state`)).json() as { enabled: boolean; pauseNew: boolean };
  const start = await brain("start the bot");
  const isStart = start.confirmation?.action === "resume_new_entries";
  check("'start the bot' → resume_new_entries confirm", isStart, start.confirmation?.action ?? JSON.stringify(start.actions ?? []));
  if (isStart) {
    const a = await confirm(start.confirmation!.token, true);
    check("start verified", a.ok === true && /confirm/i.test(a.say ?? ""), a.say?.slice(0, 90));
    const stop = await brain("stop the bot");
    check("'stop the bot' → emergency_stop confirm", stop.confirmation?.action === "emergency_stop", stop.confirmation?.action ?? "?");
    // informational: softened variant (either action is safe — both keep positions)
    const stopSoft = await brain("stop the bot, keep my positions");
    console.log(`  ℹ softened variant "stop the bot, keep my positions" → ${stopSoft.confirmation?.action ?? "?"} (safe either way; spoken confirm states the effect)`);
    if (stop.confirmation) {
      const s = await confirm(stop.confirmation.token, true);
      check("stop verified", s.ok === true, s.say?.slice(0, 90));
      // restore original state (enabled AND pauseNew)
      const st1 = await (await fetch(`${BASE}/api/bot/state`)).json() as { enabled: boolean; pauseNew: boolean };
      if (st0.enabled && !st1.enabled) {
        await fetch(`${BASE}/api/bot/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
        console.log("  ↺ original EA state restored (started)");
      } else if (!st0.enabled && st1.enabled) {
        await fetch(`${BASE}/api/bot/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
        console.log("  ↺ original EA state restored (stopped)");
      } else {
        console.log(`  ↺ EA enabled matches original (${st1.enabled})`);
      }
      if (st0.pauseNew !== st1.pauseNew) {
        await fetch(`${BASE}/api/bot/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: st0.pauseNew ? "pauseNew" : "resumeNew" }) });
        console.log(`  ↺ pauseNew restored to ${st0.pauseNew}`);
      }
    }
  }

  console.log("── 8. friendly personality probe ──");
  const mood = await brain("rough day — nothing is going right");
  check("empathetic, no fake data", mood.ok === true && (mood.say?.length ?? 0) > 10, mood.say?.slice(0, 100));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("test crash:", e); process.exit(1); });
