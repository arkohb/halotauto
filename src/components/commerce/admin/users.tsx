"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · USER MANAGEMENT — searchable/filterable customer table with the
//  full approval lifecycle. RBAC is enforced SERVER-SIDE; the UI merely
//  reflects it (denied actions surface the server's 403 message).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { A, C } from "@/lib/halo/ui-helpers";
import { ActBtn, api, ConfirmState, ConfirmDialog, Drawer, FilterChips, KV, Note, SearchInput, SectionHead, StatusPill, TableWrap, Td, Th, when } from "./kit";

interface UserRow {
  id: string; fullName: string; email: string; username: string | null; country: string; role: string; status: string;
  emailVerified: boolean; createdAt: string; lastLoginAt: string | null;
  planCode: string | null; planName: string | null; licenseStatus: string | null; licenseKeyMasked: string | null;
  deviceCount: number; lastPaymentStatus: string | null;
}
interface UserDetail {
  user: UserRow & { activeSessions: number };
  licenses: { id: string; keyMasked: string; planName: string; status: string; deviceLimit: number; deviceCount: number; isComplimentary: boolean; lifetime: boolean; expiresAt: string | null; activations: { id: string; deviceLabel: string; active: boolean; activatedAt: string }[] }[];
  payments: { id: string; reference: string; planName: string; amountCents: number; currency: string; provider: string; status: string; createdAt: string }[];
}

const FILTERS = [
  { key: "all", label: "All" }, { key: "pending", label: "Pending" }, { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" }, { key: "blocked", label: "Blocked" },
] as const;

export function AdminUsers({ onChanged }: { onChanged?: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    const j = await api<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}&filter=${filter}`);
    if (j.ok) setRows(j.users);
    else setErr(j.error ?? "Failed to load users.");
  }, [q, filter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const act = (u: UserRow, action: string, title: string, body: string, tone: ConfirmState["tone"] = "cyan", confirmLabel = "CONFIRM") =>
    setConfirm({
      title, body, tone, confirmLabel,
      onConfirm: async () => {
        setBusyId(u.id);
        const j = await api(`/api/admin/users/${u.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        setNote({ text: j.ok ? `${title} — done.` : j.error ?? "Action failed.", bad: !j.ok });
        setBusyId(null);
        await load();
        onChanged?.();
      },
    });

  const openDetail = async (u: UserRow) => {
    setBusyId(u.id);
    const j = await api<UserDetail>(`/api/admin/users/${u.id}`);
    setBusyId(null);
    if (j.ok) setDetail(j);
    else setNote({ text: j.error ?? "Could not load account.", bad: true });
  };

  return (
    <div>
      <SectionHead title="User Management" sub="Approvals, suspensions, blocks and account review — every action is audit-logged" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, e-mail, username…" />
        <FilterChips options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      <div className="mb-3"><Note note={note} /></div>

      <TableWrap>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Customer</Th><Th>Country</Th><Th>Plan</Th><Th>License</Th><Th>Status</Th><Th>Devices</Th><Th>Registered</Th><Th>Last Login</Th><Th w="1%">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><Td>loading…</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.length === 0 ? (
              <tr><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>no users match</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.map((u) => (
              <tr key={u.id} className="transition-colors hover:bg-[#041a36]">
                <Td>
                  <button type="button" onClick={() => void openDetail(u)} className="text-left hover:underline" style={{ color: C.cyan }}>
                    {u.fullName || u.email}
                  </button>
                  <div className="text-[9.5px]" style={{ color: C.dim }}>{u.email}{u.username ? ` · @${u.username}` : ""}{u.role !== "CUSTOMER" ? ` · ${u.role}` : ""}</div>
                </Td>
                <Td>{u.country || "—"}</Td>
                <Td>{u.planName ?? "—"}</Td>
                <Td>{u.licenseKeyMasked ? <span className="font-mono text-[10px]">{u.licenseKeyMasked}</span> : "—"}</Td>
                <Td><div className="flex flex-col items-start gap-1"><StatusPill status={u.status} />{u.licenseStatus ? <StatusPill status={u.licenseStatus} /> : null}</div></Td>
                <Td>{u.deviceCount}</Td>
                <Td>{when(u.createdAt)}</Td>
                <Td>{when(u.lastLoginAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {(u.status === "PENDING_EMAIL" || u.status === "PENDING_APPROVAL") && (
                      <>
                        <ActBtn tone="cyan" busy={busyId === u.id} onClick={() => act(u, "approve", "Approve account", `Approve ${u.email}? They gain full sign-in access.`, "cyan", "APPROVE")}>Approve</ActBtn>
                        <ActBtn tone="danger" onClick={() => act(u, "reject", "Reject registration", `Reject ${u.email}? Their sessions are revoked and sign-in is denied.`, "danger", "REJECT")}>Reject</ActBtn>
                      </>
                    )}
                    {!u.emailVerified && <ActBtn tone="ghost" onClick={() => act(u, "verify-email", "Verify e-mail", `Mark ${u.email} as manually verified?`)}>Verify e-mail</ActBtn>}
                    {u.status === "ACTIVE" && u.role === "CUSTOMER" && (
                      <>
                        <ActBtn tone="gold" onClick={() => act(u, "suspend", "Suspend account", `Suspend ${u.email}? Active sessions are revoked immediately.`, "gold", "SUSPEND")}>Suspend</ActBtn>
                        <ActBtn tone="danger" onClick={() => act(u, "block", "Block access", `Block ${u.email}? This is the strongest non-revocation restriction.`, "danger", "BLOCK")}>Block</ActBtn>
                      </>
                    )}
                    {(u.status === "SUSPENDED" || u.status === "BLOCKED") && (
                      <ActBtn tone="cyan" onClick={() => act(u, "reactivate", "Reactivate account", `Reactivate ${u.email}?`)}>Reactivate</ActBtn>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {/* account detail drawer */}
      <Drawer open={!!detail} title={detail ? detail.user.fullName || detail.user.email : ""} onClose={() => setDetail(null)}>
        {detail ? (
          <div>
            <div className="mb-3"><StatusPill status={detail.user.status} /> <StatusPill status={detail.user.role} /></div>
            <KV k="E-MAIL" v={detail.user.email} />
            <KV k="USERNAME" v={detail.user.username ?? "—"} />
            <KV k="COUNTRY" v={detail.user.country || "—"} />
            <KV k="E-MAIL VERIFIED" v={detail.user.emailVerified ? "Yes" : "No"} />
            <KV k="ACTIVE SESSIONS" v={String(detail.user.activeSessions)} />
            <KV k="REGISTERED" v={when(detail.user.createdAt)} />
            <KV k="LAST LOGIN" v={when(detail.user.lastLoginAt)} />

            <div className="mt-5 mb-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>LICENSES</div>
            {detail.licenses.length === 0 ? <p className="text-[11px]" style={{ color: C.muted }}>No licenses issued to this account.</p> : detail.licenses.map((l) => (
              <div key={l.id} className="mb-2 rounded-lg p-3" style={{ background: A.white(0.03), border: `1px solid ${C.lineInner}` }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px]" style={{ color: C.txt2 }}>{l.keyMasked}</span>
                  <StatusPill status={l.status} />
                </div>
                <div className="mt-1.5 text-[10.5px]" style={{ color: C.muted }}>
                  {l.planName} · {l.lifetime ? "Lifetime" : `expires ${when(l.expiresAt)}`} · devices {l.deviceCount}/{l.deviceLimit}{l.isComplimentary ? " · complimentary" : ""}
                </div>
                {l.activations.filter((a) => a.active).map((a) => (
                  <div key={a.id} className="mt-1 text-[10px]" style={{ color: C.dim }}>▸ {a.deviceLabel || "device"} · {when(a.activatedAt)}</div>
                ))}
              </div>
            ))}

            <div className="mt-5 mb-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>PAYMENTS</div>
            {detail.payments.length === 0 ? <p className="text-[11px]" style={{ color: C.muted }}>No payments recorded.</p> : (
              <TableWrap maxH={220}>
                <table className="w-full border-collapse">
                  <thead><tr><Th>Reference</Th><Th>Plan</Th><Th>Amount</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {detail.payments.map((p) => (
                      <tr key={p.id}>
                        <Td mono>{p.reference}</Td><Td>{p.planName}</Td>
                        <Td mono>{(p.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 })}</Td>
                        <Td><StatusPill status={p.status} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}

            {detail.user.role === "CUSTOMER" && (
              <div className="mt-5 flex flex-wrap gap-2">
                {detail.user.status === "ACTIVE" ? (
                  <>
                    <ActBtn tone="gold" onClick={() => { const u = detail.user; setDetail(null); act(u, "suspend", "Suspend account", `Suspend ${u.email}?`, "gold", "SUSPEND"); }}>Suspend</ActBtn>
                    <ActBtn tone="danger" onClick={() => { const u = detail.user; setDetail(null); act(u, "block", "Block access", `Block ${u.email}?`, "danger", "BLOCK"); }}>Block</ActBtn>
                  </>
                ) : (
                  <ActBtn tone="cyan" onClick={() => { const u = detail.user; setDetail(null); act(u, "reactivate", "Reactivate account", `Reactivate ${u.email}?`); }}>Reactivate</ActBtn>
                )}
                <ActBtn tone="ghost" onClick={() => { const u = detail.user; setDetail(null); act(u, "reset-sessions", "Reset sessions", `Revoke all active sessions for ${u.email}? They must sign in again.`, "gold", "RESET SESSIONS"); }}>Reset sessions</ActBtn>
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
