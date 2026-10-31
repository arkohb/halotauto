// E2E probe: voice fast-path latency + scanner feed health (local dev only).
// Registers a throwaway user, logs in, then times deterministic fast-path
// brain turns vs. the LLM path, and GETs the scanner feed. Cleans up after.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const base = "http://127.0.0.1:3000";
const email = `probe-fastpath-${Date.now()}@halotest.local`;
const password = "ProbeTest#2026!";

let cookie = "";

async function timedBrain(label: string, body: Record<string, unknown>) {
  const t0 = Date.now();
  const r = await fetch(`${base}/api/halo/brain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok: boolean; say?: string; error?: string };
  const ms = Date.now() - t0;
  console.log(`\n[${label}] ${ms} ms · ok=${j.ok}`);
  console.log(`  say: ${(j.say ?? j.error ?? "").slice(0, 220)}`);
  return { ms, j };
}

try {
  // 1) register + verify + login
  const reg = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "FastPath Probe",
      email,
      password,
      confirmPassword: password,
      country: "GH",
      acceptTerms: true,
      acceptLicense: true,
    }),
  });
  const regj = (await reg.json()) as { ok: boolean; error?: string };
  if (!regj.ok) throw new Error(`register failed: ${regj.error}`);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("user missing after register");
  if (user.verifyToken) {
    const v = await fetch(`${base}/api/auth/verify-email?token=${encodeURIComponent(user.verifyToken)}`);
    console.log("verify-email:", v.status);
  }

  const l = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: email, password }),
  });
  cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error("no session cookie");
  console.log("login ok, cookie received");

  // 2) scanner feed reachable with a session
  const tFeed = Date.now();
  const feed = await fetch(`${base}/api/tf-scanner`, { headers: { cookie } });
  const feedj = (await feed.json()) as { ok: boolean; status?: string; marketsTotal?: number };
  console.log(`\n[feed GET] ${feed.status} in ${Date.now() - tFeed} ms · ok=${feedj.ok} status=${feedj.status} rows=${feedj.marketsTotal}`);

  // 3) fast-path turns (voice, scanner surface)
  await timedBrain("fast: start scanning", { message: "start scanning", mode: "voice", source: "voice", surface: "scanner-bot" });
  await timedBrain("fast: status", { message: "what's your scanner status", mode: "voice", source: "voice", surface: "scanner-bot" });
  await timedBrain("fast: latest opportunity", { message: "what's the latest opportunity you found", mode: "voice", source: "voice", surface: "scanner-bot" });
  await timedBrain("fast: pause scanning", { message: "pause scanning", mode: "voice", source: "voice", surface: "scanner-bot" });
  await timedBrain("fast: resume (carry on with the scan)", { message: "carry on with the scan", mode: "voice", source: "voice", surface: "scanner-bot" });
  await timedBrain("fast: joke", { message: "tell me a joke", mode: "voice", source: "voice", surface: "scanner-bot" });

  // 4) pause again to leave the runtime idle for the LLM test
  await fetch(`${base}/api/halo/brain`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ message: "pause scanning", mode: "voice", source: "voice", surface: "scanner-bot" }),
  });

  // 5) LLM fallback path — general question must still work
  const llm = await timedBrain("llm: general question", { message: "In one short line, what can you help me with on this dashboard?", mode: "voice", source: "voice", surface: "scanner-bot" });
  console.log(`  (llm path latency ${llm.ms} ms — expected slower, that is the grounding trade-off)`);

  // 6) wake+command phrasing from another surface must still fast-path
  await timedBrain("fast: start the sweep (no surface)", { message: "start the sweep", mode: "voice", source: "voice" });
} finally {
  // cleanup — remove the throwaway user + its license
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    await db.license.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.traderProfile.deleteMany({ where: { id: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log("\ncleanup: probe user removed");
  }
  await db.$disconnect();
}
