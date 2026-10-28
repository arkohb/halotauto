// Probe 3: SNI matrix + servername-override bypass test (read-only GETs)
import { readFileSync } from "node:fs";
const env = readFileSync("/home/z/my-project/.env", "utf8");
const token = env.match(/^METAAPI_TOKEN=(.+)$/m)?.[1]?.trim() || "";
const { Agent } = await import("undici");

const url = "https://api.metaapi.cloud/users/current/accounts";

// 1) matrix: same IP, different SNI — who serves real certs?
import { execSync } from "node:child_process";
for (const sni of ["api.metaapi.cloud", "app.metaapi.cloud", "www.metaapi.cloud", "metaapi.cloud"]) {
  try {
    const out = execSync(
      `echo | openssl s_client -connect 51.89.234.71:443 -servername ${sni} 2>/dev/null | grep -m1 "subject="`,
      { timeout: 9000 }
    ).toString().trim();
    console.log(`SNI ${sni.padEnd(22)} → ${out.slice(0, 80)}`);
  } catch {
    console.log(`SNI ${sni.padEnd(22)} → no cert / timeout`);
  }
}

// 2) bypass: URL host = api.metaapi.cloud (HTTP Host header), TLS SNI = app.metaapi.cloud
const agent = new Agent({ connect: { servername: "app.metaapi.cloud" } });
try {
  const res = await fetch(url, { headers: { "auth-token": token }, dispatcher: agent });
  const text = await res.text();
  console.log(`\nsni=app + host=api → HTTP ${res.status} · ${text.slice(0, 140).replace(/\n/g, " ")}`);
} catch (e) {
  console.log(`\nsni=app + host=api → FAIL ${e.message} · cause: ${e.cause?.message ?? ""}`);
}

// 3) control: does app.metaapi.cloud itself serve the API path (SNI + Host both app)?
try {
  const res = await fetch("https://app.metaapi.cloud/users/current/accounts", {
    headers: { "auth-token": token },
  });
  const text = await res.text();
  console.log(`sni=app + host=app → HTTP ${res.status} · ${text.slice(0, 140).replace(/\n/g, " ")}`);
} catch (e) {
  console.log(`sni=app + host=app → FAIL ${e.message} · cause: ${e.cause?.message ?? ""}`);
}
