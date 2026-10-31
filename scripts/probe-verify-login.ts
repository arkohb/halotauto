// Probe-session bootstrap: verify email via DB token (if pending), then login and save cookie.
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const db = new PrismaClient();
const base = "http://127.0.0.1:3000";
const email = readFileSync("/tmp/probe_email.txt", "utf8").trim();

const user = await db.user.findUnique({ where: { email } });
if (!user) throw new Error("probe user not found");

if (user.verifyToken) {
  const v = await fetch(`${base}/api/auth/verify-email?token=${encodeURIComponent(user.verifyToken)}`);
  console.log("verify:", v.status);
} else {
  console.log("verify: already verified");
}

const l = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: email, password: "ProbeTest#2026!" }),
});
const setCookie = l.headers.get("set-cookie") ?? "";
const cookie = setCookie.split(";")[0];
console.log("login:", l.status, "cookie:", cookie ? "received" : "MISSING");
writeFileSync("/tmp/probe_cookie.txt", cookie);
await db.$disconnect();
