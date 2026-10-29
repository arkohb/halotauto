// Server-side broker account service (shared by API routes)

import { db } from "@/lib/db";
import { getAdapter, isBrokerKind, parseCreds } from "@/lib/brokers";
import { sendAlert } from "@/lib/alerts";

export async function testBrokerAccount(id: string): Promise<{ ok: boolean; status?: string; statusMsg?: string }> {
  const row = await db.brokerAccount.findUnique({ where: { id } });
  if (!row) return { ok: false, statusMsg: "not found" };
  if (!isBrokerKind(row.kind)) return { ok: false, statusMsg: "unknown kind" };
  const adapter = getAdapter(row.kind);
  const res = await adapter.testConnection(parseCreds(row.credsJson));
  const status = res.ok ? "ok" : "error";
  const extra =
    res.raw && typeof res.raw === "object" && "broker" in (res.raw as Record<string, unknown>)
      ? ` · ${String((res.raw as Record<string, unknown>).broker)}`
      : "";
  const statusMsg = res.ok
    ? `${res.currency ?? ""} bal ${res.balance != null ? Number(res.balance).toLocaleString("en-US") : "—"}${extra}`.trim()
    : (res.error ?? "failed").slice(0, 280);
  await db.brokerAccount.update({
    where: { id },
    data: { status, statusMsg, lastCheckAt: new Date() },
  });
  if (!res.ok) {
    void sendAlert({
      kind: "broker",
      title: `HALO 3EL · ${row.label} TEST FAILED`,
      body: statusMsg,
    });
  }
  return { ok: true, status, statusMsg };
}
