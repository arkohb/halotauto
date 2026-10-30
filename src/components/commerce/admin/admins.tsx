"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · ADMINISTRATORS — Super-Administrator management of admin
//  accounts: create (unique generated password shown once, mustChangePassword
//  enforced) and role changes. No shared hardcoded passwords anywhere.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { ActBtn, api, ConfirmState, ConfirmDialog, Note, SectionHead, StatusPill, TableWrap, Td, Th, when } from "./kit";

interface AdminRow { id: string; fullName: string; email: string; role: string; status: string; createdAt: string; lastLoginAt: string | null }

const ROLES = [
  { key: "SUPER_ADMIN", label: "Super Administrator", desc: "Full system control" },
  { key: "LICENSE_ADMIN", label: "License Administrator", desc: "Licenses + approvals, no security settings" },
  { key: "SUPPORT_ADMIN", label: "Support Administrator", desc: "View + assist, no financial actions" },
] as const;

const fieldCss: React.CSSProperties = { background: "#000714", border: "1px solid #1C4478", color: "#EAF3FF" };

export function AdminAdmins() {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<string>("LICENSE_ADMIN");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    const j = await api<{ admins: AdminRow[] }>("/api/admin/admins");
    if (j.ok) setRows(j.admins);
    else setNote({ text: j.error ?? "Failed to load administrators.", bad: true });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const create = async () => {
    setBusy(true);
    const j = await api<{ admin: { email: string }; generatedPassword?: string }>("/api/admin/admins", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", email, fullName, role }),
    });
    setBusy(false);
    if (j.ok) {
      setNote({ text: `Administrator created${j.generatedPassword ? " — hand over the one-time password securely." : "."}` });
      if (j.generatedPassword) setCreated({ email: j.admin.email, password: j.generatedPassword });
      setEmail(""); setFullName("");
      await load();
    } else setNote({ text: j.error ?? "Creation failed.", bad: true });
  };

  const setRoleFor = (a: AdminRow, newRole: string) =>
    setConfirm({
      title: "Change administrator role",
      body: `Change ${a.email} from ${a.role} to ${newRole}? The change takes effect immediately and is audit-logged.`,
      tone: "gold", confirmLabel: "CHANGE ROLE",
      onConfirm: async () => {
        const j = await api("/api/admin/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set-role", email: a.email, role: newRole }) });
        setNote({ text: j.ok ? "Role updated." : j.error ?? "Failed.", bad: !j.ok });
        await load();
      },
    });

  return (
    <div>
      <SectionHead title="Administrators" sub="Role-based access control — Super Administrator only. Every admin gets a unique password; none are shared." />

      <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        {/* create */}
        <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>PROVISION NEW ADMINISTRATOR</div>
          <div className="mb-3">
            <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>FULL NAME</div>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ama Mensah" className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
          </div>
          <div className="mb-3">
            <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>E-MAIL</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@yourdomain.com" className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
          </div>
          <div className="mb-4">
            <div className="mb-1.5 text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>ROLE</div>
            <div className="space-y-1.5">
              {ROLES.map((r) => (
                <label key={r.key} className="flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2" style={{ background: A.white(0.03) }}>
                  <input type="radio" checked={role === r.key} onChange={() => setRole(r.key)} className="mt-0.5 accent-[#2ECCFF]" />
                  <span>
                    <span className="block text-[11px] font-bold" style={{ color: C.txt2 }}>{r.label}</span>
                    <span className="block text-[9.5px]" style={{ color: C.muted }}>{r.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Note note={note} />
          <button type="button" onClick={() => void create()} disabled={busy || !email.trim() || !fullName.trim()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[10.5px] font-extrabold tracking-[0.18em] transition-all hover:brightness-110 disabled:opacity-40"
            style={{ background: A.gold(0.14), color: C.goldHover, boxShadow: `inset 0 0 0 1px ${A.gold(0.4)}` }}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}CREATE ADMINISTRATOR
          </button>
          {created ? (
            <div className="mt-3 rounded-lg p-3" style={{ background: A.green(0.07), boxShadow: `inset 0 0 0 1px ${A.green(0.3)}` }}>
              <div className="text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C_GREEN }}>ONE-TIME PASSWORD — COPY NOW</div>
              <div className="mt-1 select-all font-mono text-[13px]" style={{ color: C.txt }}>{created.password}</div>
              <div className="mt-1 text-[9.5px]" style={{ color: C.muted }}>For {created.email} · they must change it at first sign-in.</div>
            </div>
          ) : null}
        </div>

        {/* list */}
        <TableWrap maxH={420}>
          <table className="w-full border-collapse">
            <thead>
              <tr><Th>Administrator</Th><Th>Role</Th><Th>Status</Th><Th>Created</Th><Th>Last Login</Th><Th w="1%">Actions</Th></tr>
            </thead>
            <tbody>
              {rows === null ? (
                <tr><Td>loading…</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
              ) : rows.length === 0 ? (
                <tr><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
              ) : rows.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-[#041a36]">
                  <Td>{a.fullName || "—"}<div className="text-[9.5px]" style={{ color: C_DIM }}>{a.email}</div></Td>
                  <Td>
                    <select value={a.role} onChange={(e) => setRoleFor(a, e.target.value)} disabled={a.role === "SUPER_ADMIN"}
                      className="rounded-lg px-2 py-1 text-[10px]" style={fieldCss} title={a.role === "SUPER_ADMIN" ? "Super Administrators can only be edited by another Super Admin session" : ""}>
                      {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      {a.role === "CUSTOMER" ? <option value="CUSTOMER">Customer</option> : null}
                    </select>
                  </Td>
                  <Td><StatusPill status={a.status} /></Td>
                  <Td>{when(a.createdAt)}</Td>
                  <Td>{when(a.lastLoginAt)}</Td>
                  <Td>—</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>

      <div className="rounded-xl p-4" style={{ background: A.white(0.02), border: `1px solid ${C.lineInner}` }}>
        <div className="mb-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>ROLE PERMISSION MATRIX</div>
        <div className="grid gap-2 text-[10px] sm:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.key} className="rounded-lg p-3" style={{ background: A.white(0.03) }}>
              <StatusPill status={r.key} />
              <ul className="mt-2 space-y-1" style={{ color: C.muted }}>
                {r.key === "SUPER_ADMIN" && (<><li>✓ Manage administrators, users, plans</li><li>✓ Generate & revoke licenses</li><li>✓ Complimentary issuance</li><li>✓ Payment verification + refunds</li><li>✓ System policies & integrations</li><li>✓ Full audit access</li></>)}
                {r.key === "LICENSE_ADMIN" && (<><li>✓ Generate authorized licenses</li><li>✓ Approve registrations</li><li>✓ Manage activations</li><li>✓ Verify manual payments</li><li>✗ Security settings, plans, admins</li><li>✗ Payment credentials</li></>)}
                {r.key === "SUPPORT_ADMIN" && (<><li>✓ View customer accounts</li><li>✓ View license status</li><li>✓ Assist device activation</li><li>✓ Escalate cases</li><li>✗ Prices, comp licenses</li><li>✗ Verify payments, revoke</li></>)}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

const C_GREEN = "#00D68F";
const C_DIM = "rgba(82,103,138,1)";
