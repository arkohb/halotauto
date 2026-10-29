// Probe: can Node's built-in fetch reach api.metaapi.cloud with an insecure undici Agent?
// Read-only GET /users/current/accounts — no side effects.
const url = "https://api.metaapi.cloud/users/current/accounts";
const token = process.env.METAAPI_TOKEN || "";

async function probe(label, init) {
  try {
    const res = await fetch(url, { headers: { "auth-token": token }, ...init });
    const text = await res.text();
    console.log(`${label} → HTTP ${res.status} · ${text.slice(0, 80)}`);
    return true;
  } catch (e) {
    const cause = e.cause ? String(e.cause.message ?? e.cause) : "";
    console.log(`${label} → FAIL ${e.message} · cause: ${cause}`);
    return false;
  }
}

const plain = await probe("plain fetch        ", {});
let undici = null;
try {
  undici = await import("undici");
  const agent = new undici.Agent({ connect: { rejectUnauthorized: false } });
  await probe("fetch + dispatcher  ", { dispatcher: agent });
  const pagent = new undici.ProxyAgent ? "ProxyAgent available" : "ProxyAgent missing";
  console.log("undici:", pagent);
} catch (e) {
  console.log("undici import failed:", e.message);
}
console.log(plain ? "RESULT: plain OK (unexpected)" : "RESULT: plain blocked → dispatcher path needed");
