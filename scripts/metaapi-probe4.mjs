// Probe 4: real API hosts (read-only GETs with the platform key)
import { readFileSync } from "node:fs";
const env = readFileSync("/home/z/my-project/.env", "utf8");
const token = env.match(/^METAAPI_TOKEN=(.+)$/m)?.[1]?.trim() || "";
const { Agent } = await import("undici");
const agent = new Agent({ connect: { rejectUnauthorized: false } });

const tests = [
  ["mgmt agiliumtrade.agiliumtrade.ai", "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts"],
  ["client new-york agilium.agilium", "https://mt-client-api-v1.new-york.agiliumtrade.agiliumtrade.ai/health"],
  ["client new-york agiliumtrade.ai", "https://mt-client-api-v1.new-york.agiliumtrade.ai/health"],
];

for (const [label, url] of tests) {
  try {
    const res = await fetch(url, { headers: { "auth-token": token }, dispatcher: agent, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    console.log(`${label} → HTTP ${res.status} · ${text.slice(0, 160).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`${label} → FAIL ${e.message} · cause: ${e.cause?.message ?? ""}`);
  }
}
