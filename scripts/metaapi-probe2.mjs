// Probe 2: which management domain answers for this platform key? (read-only GET)
import { readFileSync } from "node:fs";
const env = readFileSync("/home/z/my-project/.env", "utf8");
const token = env.match(/^METAAPI_TOKEN=(.+)$/m)?.[1]?.trim() || "";
console.log("token from .env:", token ? `${token.slice(0, 24)}… (${token.length} chars)` : "MISSING");

const { Agent } = await import("undici");
const agent = new Agent({ connect: { rejectUnauthorized: false } });

for (const base of ["https://api.metaapi.cloud", "https://api.ln.ln.ai"]) {
  try {
    const res = await fetch(`${base}/users/current/accounts`, {
      headers: { "auth-token": token },
      dispatcher: agent,
    });
    const text = await res.text();
    console.log(`${base} → HTTP ${res.status} · ${text.slice(0, 120).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`${base} → FAIL ${e.message} · cause: ${e.cause?.message ?? ""}`);
  }
}
