// Browser-E2E probe bootstrap: register + verify + login + comp license.
// Prints the credentials for the agent-browser session. Cleanup is separate.
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const db = new PrismaClient();
const base = "http://127.0.0.1:3000";
const stamp = Date.now();
const email = `probe-ui-${stamp}@halotest.local`;
const password = "ProbeTest#2026!";

const reg = await fetch(`${base}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fullName: "UI Probe",
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
if (!user) throw new Error("user missing");
if (user.verifyToken) {
  await fetch(`${base}/api/auth/verify-email?token=${encodeURIComponent(user.verifyToken)}`);
}

const l = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: email, password }),
});
const cookie = (l.headers.get("set-cookie") ?? "").split(";")[0];
if (!cookie) throw new Error("no cookie");

// license gate — the UI requires a real license line even for the probe
const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const g = () => Array.from(crypto.getRandomValues(new Uint8Array(4))).map((b) => ABC[b % ABC.length]).join("");
await db.license.create({
  data: {
    key: `HALO-${g()}-${g()}-${g()}-${g()}`,
    userId: user.id,
    planCode: "PRO_LIFETIME",
    planName: "E2E Probe Comp",
    entitlementsJson: JSON.stringify(["*"]),
    status: "ACTIVE",
    isComplimentary: true,
    compReason: "Local browser E2E probe (voice fast-path)",
    issuedById: "system",
    notes: "Throwaway probe — delete after verification",
  },
});

writeFileSync("/tmp/probe_ui_email.txt", email);
writeFileSync("/tmp/probe_ui_cookie.txt", cookie);
console.log("EMAIL:", email);
console.log("PASSWORD:", password);
console.log("COOKIE:", cookie.slice(0, 40) + "…");
await db.$disconnect();
