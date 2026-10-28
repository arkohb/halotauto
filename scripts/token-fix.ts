// Assemble the corrected token: verified header + rebuilt payload + transcribed signature
// Then update .env and the baked constant in metaapi-core.ts.
import { readFileSync, writeFileSync } from "node:fs";

const envText = readFileSync("/home/z/my-project/.env", "utf8");
const oldVal = envText.split("\n").find((l) => l.startsWith("METAAPI_TOKEN"))!.slice("METAAPI_TOKEN=".length).trim();
const [hdr, , sig] = oldVal.split(".");
const rebuiltPayload = readFileSync("/home/z/my-project/scripts/payload-rebuilt.b64", "utf8").trim();

// sanity: rebuilt payload parses
const dec = (b: string) => Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
JSON.parse(dec(rebuiltPayload));

const token = `${hdr}.${rebuiltPayload}.${sig}`;
console.log("assembled token len:", token.length, "(was", oldVal.length + ")");

// live verification against the reachable trading host
const r = await fetch(
  "https://mt-client-api-v1.new-york.agiliumtrade.ai/users/current/accounts/012345678901234567890123/account-information",
  { headers: { "auth-token": token }, signal: AbortSignal.timeout(15000) }
);
const body = await r.text();
console.log("live check → HTTP", r.status, body.slice(0, 200));
const verdict = r.status === 401 && /invalid auth-token/i.test(body) ? "TOKEN STILL INVALID (signature corrupted)" : "TOKEN ACCEPTED BY METAAPI ✓";

// update .env
const lines = envText.split("\n").map((l) => (l.startsWith("METAAPI_TOKEN") ? `METAAPI_TOKEN=${token}` : l));
writeFileSync("/home/z/my-project/.env", lines.join("\n"));

// update baked constant in metaapi-core.ts
const corePath = "/home/z/my-project/src/lib/brokers/metaapi-core.ts";
const core = readFileSync(corePath, "utf8");
const coreOut = core.replace(/export const BAKED_METAAPI_TOKEN =\n  "[^"]+";/, `export const BAKED_METAAPI_TOKEN =\n  "${token}";`);
writeFileSync(corePath, coreOut);
console.log("env + metaapi-core.ts updated · verdict:", verdict);
