// ══════════════════════════════════════════════════════════════════════════
//  SYSTEM SETTINGS · approval mode, registration availability, policies
//  Super-Administrator editable; safe defaults so a fresh install works.
// ══════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";

export const SETTING_KEYS = {
  approvalMode: "approvalMode", // AUTOMATIC (default) | MANUAL
  registrationOpen: "registrationOpen", // boolean, default true
  maintenanceMode: "maintenanceMode", // boolean, default false
  paymentChannels: "paymentChannels", // manual-payment instructions shown at checkout
  supportEmail: "supportEmail",
  transferApprovalRequired: "transferApprovalRequired", // exceptional device transfers
} as const;

export interface CommerceSettings {
  approvalMode: "AUTOMATIC" | "MANUAL";
  registrationOpen: boolean;
  maintenanceMode: boolean;
  paymentChannels: string;
  supportEmail: string;
  transferApprovalRequired: boolean;
}

const DEFAULTS: CommerceSettings = {
  approvalMode: "AUTOMATIC",
  registrationOpen: true,
  maintenanceMode: false,
  paymentChannels:
    "Mobile Money (MoMo) · Bank Transfer · International Card. After paying, your payment is verified by an administrator and your license is issued automatically.",
  supportEmail: "",
  transferApprovalRequired: false,
};

export async function getSettings(): Promise<CommerceSettings> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.values(SETTING_KEYS) } } });
  const out: CommerceSettings = { ...DEFAULTS };
  for (const r of rows) {
    try {
      const v = JSON.parse(r.valueJson);
      switch (r.key) {
        case SETTING_KEYS.approvalMode:
          if (v === "AUTOMATIC" || v === "MANUAL") out.approvalMode = v;
          break;
        case SETTING_KEYS.registrationOpen:
          out.registrationOpen = !!v;
          break;
        case SETTING_KEYS.maintenanceMode:
          out.maintenanceMode = !!v;
          break;
        case SETTING_KEYS.paymentChannels:
          if (typeof v === "string") out.paymentChannels = v;
          break;
        case SETTING_KEYS.supportEmail:
          if (typeof v === "string") out.supportEmail = v;
          break;
        case SETTING_KEYS.transferApprovalRequired:
          out.transferApprovalRequired = !!v;
          break;
      }
    } catch {
      // corrupted value → keep default
    }
  }
  return out;
}

export async function setSetting(key: string, value: unknown, updatedById: string): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    create: { key, valueJson: JSON.stringify(value), updatedById },
    update: { valueJson: JSON.stringify(value), updatedById },
  });
}
