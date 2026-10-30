// ══════════════════════════════════════════════════════════════════════════
//  AUDIT · append-only administrative audit trail
//  Records license generation/revocation/suspension, account approvals,
//  plan changes, manual payment verification, device changes, admin logins
//  and security-sensitive changes. No API mutates or deletes audit rows.
// ══════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";

export interface AuditEntry {
  action: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  targetType?: string;
  targetId?: string;
  outcome?: "success" | "denied" | "failed";
  meta?: Record<string, unknown>;
}

export async function logAudit(e: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: e.action,
        actorId: e.actorId ?? "",
        actorEmail: e.actorEmail ?? "",
        actorRole: e.actorRole ?? "",
        targetType: e.targetType ?? "",
        targetId: e.targetId ?? "",
        outcome: e.outcome ?? "success",
        metaJson: JSON.stringify(e.meta ?? {}),
      },
    });
  } catch (err) {
    // Audit must never break the primary flow — but surface it in server logs.
    console.error("[halo-audit] failed to record", e.action, (err as Error).message);
  }
}
