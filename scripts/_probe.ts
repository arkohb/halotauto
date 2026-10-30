import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const BASE = "http://localhost:3100";
const jar: Record<string, string> = {};
async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(jar.cookie ? { Cookie: jar.cookie } : {}) }, redirect: "manual" });
  const sc = r.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  let j: unknown = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
(async () => {
  await call("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier: (await db.user.findFirst({ where: { email: { contains: "acc-super-" } } }))?.email, password: "AccSuper#2026", remember: false }) });
  // 15) reset-activation on the acceptance customer's license
  const cust = await db.user.findFirst({ where: { email: { contains: "acc-cust-@".replace("@", ".") } ?? { email: { contains: "acc-cust-" } } } });
  const custRow = await db.user.findFirst({ where: { email: { startsWith: "acc-cust-", endsWith: "@halotest.local" } } });
  const lic = await db.license.findFirst({ where: { userId: custRow?.id, status: "ACTIVE" } });
  console.log("cust license:", lic?.key, lic?.status, "activations:", (await db.licenseActivation.count({ where: { licenseId: lic?.id ?? "" } })));
  const rr = await call(`/api/admin/licenses/${lic?.id}`, { method: "POST", body: JSON.stringify({ action: "reset-activation" }) });
  console.log("RESET:", rr.status, JSON.stringify(rr.j).slice(0, 200));
  // 17) replay verify response shape
  const pay = await db.payment.findFirst({ where: { status: "VERIFIED" }, orderBy: { createdAt: "desc" } });
  const rv = await call("/api/admin/transactions", { method: "POST", body: JSON.stringify({ paymentId: pay?.id, action: "verify" }) });
  console.log("REPLAY:", rv.status, JSON.stringify(rv.j).slice(0, 200));
  // 24) audit action names
  const ra = await call("/api/admin/audit");
  const logs = (ra.j as { logs?: { action: string }[]; entries?: { action: string }[] }).logs ?? (ra.j as { entries?: { action: string }[] }).entries ?? [];
  console.log("AUDIT keys:", Object.keys(ra.j), "count:", logs.length);
  console.log("AUDIT actions:", JSON.stringify([...new Set(logs.map((l) => l.action))].slice(0, 20)));
  await db.$disconnect();
})();
