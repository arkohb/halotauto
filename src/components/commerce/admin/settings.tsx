"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · SYSTEM SETTINGS — approval mode (automatic after verified
//  payment, or manual review), registration availability, maintenance mode,
//  manual payment channel instructions, support contact, transfer policy.
//  Super Administrator only (enforced server-side).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { ActBtn, api, Note, SectionHead, StatusPill } from "./kit";

interface SettingsRes {
  approvalMode: "AUTOMATIC" | "MANUAL";
  registrationOpen: boolean;
  maintenanceMode: boolean;
  paymentChannels: string;
  supportEmail: string;
  transferApprovalRequired: boolean;
}

const fieldCss: React.CSSProperties = { background: "#000714", border: "1px solid #1C4478", color: "#EAF3FF" };

export function AdminSettings() {
  const [s, setS] = useState<SettingsRes | null>(null);
  const [system, setSystem] = useState<{ commerceMode: boolean; paymentProvider: string | { provider: string; paystack: boolean; flutterwave: boolean } } | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const j = await api<{ settings: SettingsRes; system: { commerceMode: boolean; paymentProvider: string } }>("/api/admin/settings");
    if (j.ok) { setS(j.settings); setSystem(j.system); }
    else setNote({ text: j.error ?? "Failed to load settings.", bad: true });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async (patch: Partial<SettingsRes>) => {
    setBusy(true);
    const j = await api<{ settings: SettingsRes }>("/api/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    setBusy(false);
    if (j.ok) { setS(j.settings); setNote({ text: "Settings saved." }); }
    else setNote({ text: j.error ?? "Save failed.", bad: true });
  };

  if (!s) return <div className="py-16 text-center text-[11px] tracking-[0.2em]" style={{ color: C.muted }}>LOADING SETTINGS…</div>;

  return (
    <div>
      <SectionHead title="System Settings" sub="Approval policy, registration, maintenance and payment configuration" />
      <div className="mb-3"><Note note={note} /></div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* approval + registration */}
        <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
          <div className="mb-4 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>APPROVAL POLICY</div>
          <div className="grid grid-cols-2 gap-2">
            {(["AUTOMATIC", "MANUAL"] as const).map((m) => (
              <button key={m} type="button" disabled={busy} onClick={() => void save({ approvalMode: m })}
                className="rounded-lg px-3 py-3 text-left transition-all"
                style={s.approvalMode === m
                  ? { background: A.cyan(0.12), boxShadow: `inset 0 0 0 1px ${A.cyan(0.45)}` }
                  : { background: A.white(0.04), boxShadow: `inset 0 0 0 1px ${A.white(0.1)}` }}>
                <div className="text-[11px] font-extrabold tracking-[0.08em]" style={{ color: s.approvalMode === m ? C.cyan : C.txt2 }}>
                  {m === "AUTOMATIC" ? "Automatic" : "Manual"}
                </div>
                <div className="mt-0.5 text-[9.5px]" style={{ color: C.muted }}>
                  {m === "AUTOMATIC" ? "Approved right after verified payment + e-mail verification" : "An administrator reviews every new registration"}
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[9.5px]" style={{ color: C.muted }}>Manual approve/reject is always available regardless of mode. Customers can never approve their own account.</p>

          <div className="mt-5 mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>ACCESS SWITCHES</div>
          <div className="space-y-2.5">
            {([
              ["registrationOpen", "Registration open", "New customers can create accounts"],
              ["maintenanceMode", "Maintenance mode", "Show a maintenance notice on public pages"],
              ["transferApprovalRequired", "Approval required for device transfers", "Exceptional device transfer requests need an administrator"],
            ] as const).map(([key, label, desc]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: A.white(0.03) }}>
                <span>
                  <span className="block text-[11.5px] font-bold" style={{ color: C.txt2 }}>{label}</span>
                  <span className="block text-[9.5px]" style={{ color: C.muted }}>{desc}</span>
                </span>
                <input type="checkbox" checked={s[key]} disabled={busy} onChange={(e) => void save({ [key]: e.target.checked })} className="accent-[#2ECCFF]" />
              </label>
            ))}
          </div>
        </div>

        {/* payments + support */}
        <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
          <div className="mb-4 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>PAYMENT CONFIGURATION</div>
          <div className="mb-3 flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: A.white(0.03) }}>
            <div>
              <div className="text-[11.5px] font-bold" style={{ color: C.txt2 }}>Provider integration</div>
              <div className="text-[9.5px]" style={{ color: C.muted }}>Configured via environment (PAYSTACK_SECRET_KEY / FLUTTERWAVE_SECRET_KEY)</div>
            </div>
            <StatusPill status={system ? (typeof system.paymentProvider === "string" ? system.paymentProvider : system.paymentProvider?.provider ?? "offline") : "offline"} />
          </div>
          <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>MANUAL PAYMENT CHANNELS (SHOWN AT CHECKOUT)</div>
          <textarea value={s.paymentChannels} rows={4} onChange={(e) => setS({ ...s, paymentChannels: e.target.value })}
            onBlur={() => void save({ paymentChannels: s.paymentChannels })} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />

          <div className="mt-4 mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>SUPPORT E-MAIL</div>
          <input value={s.supportEmail} onChange={(e) => setS({ ...s, supportEmail: e.target.value })}
            onBlur={() => void save({ supportEmail: s.supportEmail })} placeholder="support@yourdomain.com" className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />

          <div className="mt-5 rounded-lg p-3" style={{ background: A.gold(0.05), boxShadow: `inset 0 0 0 1px ${A.gold(0.2)}` }}>
            <div className="text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C.goldHover }}>LIFETIME LICENSE POLICY</div>
            <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: C.muted }}>
              One-time payment · no compulsory recurring software billing. Third-party operating costs (market data, AI usage, VPS) may be billed separately and must be disclosed before purchase.
            </p>
          </div>
          <div className="mt-3">
            <ActBtn tone="ghost" onClick={() => void load()}>RELOAD SETTINGS</ActBtn>
          </div>
        </div>
      </div>
    </div>
  );
}
