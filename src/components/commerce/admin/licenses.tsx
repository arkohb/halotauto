"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · LICENSE MANAGEMENT — registry with masked keys and the full
//  consequential action set: suspend / reactivate / revoke / transfer /
//  replace / adjust devices. Every action requires an explicit confirmation
//  and is audit-logged server-side.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { ActBtn, api, ConfirmState, ConfirmDialog, FilterChips, Note, SearchInput, SectionHead, StatusPill, TableWrap, Td, Th, when } from "./kit";

interface LicRow {
  id: string; keyMasked: string; customer: string; customerEmail: string;
  planCode: string; planName: string; status: string; kind: string;
  deviceLimit: number; deviceCount: number; isComplimentary: boolean;
  paymentStatus: string | null; paymentReference: string | null;
  activatedAt: string | null; expiresAt: string | null; lifetime: boolean; createdAt: string;
}

const FILTERS = [
  { key: "all", label: "All" }, { key: "ACTIVE", label: "Active" }, { key: "UNACTIVATED", label: "Unactivated" },
  { key: "SUSPENDED", label: "Suspended" }, { key: "REVOKED", label: "Revoked" },
] as const;

interface Pending {
  license: LicRow;
  action: "suspend" | "reactivate" | "revoke" | "replace" | "adjust-devices" | "transfer";
  title: string; body: string;
  tone?: ConfirmState["tone"]; confirmLabel?: string;
}

const inputCss: React.CSSProperties = { background: "#000714", border: "1px solid #1C4478", color: "#EAF3FF" };

export function AdminLicenses({ onChanged, goToGenerate }: { onChanged?: () => void; goToGenerate?: () => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [rows, setRows] = useState<LicRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [devicePick, setDevicePick] = useState(1);
  const [transferEmail, setTransferEmail] = useState("");

  const load = useCallback(async () => {
    const j = await api<{ licenses: LicRow[] }>(`/api/admin/licenses?q=${encodeURIComponent(q)}&status=${status}`);
    if (j.ok) setRows(j.licenses);
    else setErr(j.error ?? "Failed to load licenses.");
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const run = useCallback(async (p: Pending) => {
    const payload: Record<string, unknown> = {};
    if (p.action === "adjust-devices") payload.deviceLimit = devicePick;
    if (p.action === "transfer") payload.newOwnerEmail = transferEmail.trim();
    setBusyId(p.license.id);
    const j = await api<{ replacementKey?: string }>(`/api/admin/licenses/${p.license.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: p.action, ...payload }) });
    setNote({
      text: j.ok
        ? `${p.title} — done for ${p.license.keyMasked}.${j.replacementKey ? ` New key: ${j.replacementKey} — copy it NOW, it is shown only once.` : ""}`
        : j.error ?? "Action failed.",
      bad: !j.ok,
    });
    setBusyId(null);
    await load();
    onChanged?.();
  }, [devicePick, transferEmail, load, onChanged]);

  const ask = (license: LicRow, action: Pending["action"], title: string, body: string, tone?: ConfirmState["tone"], confirmLabel?: string) =>
    setPending({ license, action, title, body, tone, confirmLabel });

  return (
    <div>
      <SectionHead
        title="License Management"
        sub="Suspend, revoke, transfer, replace or adjust device allowances — consequential actions need confirmation"
        right={goToGenerate ? <ActBtn tone="gold" onClick={goToGenerate}>+ GENERATE LICENSE</ActBtn> : undefined}
      />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search key fragment…" />
        <FilterChips options={[...FILTERS]} value={status} onChange={setStatus} />
      </div>
      {err ? <div className="mb-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: "rgba(255,77,94,0.1)", color: C_RED }}>{err}</div> : null}
      <div className="mb-3"><Note note={note} /></div>

      <TableWrap>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>License Key</Th><Th>Customer</Th><Th>Plan</Th><Th>Status</Th><Th>Payment</Th><Th>Devices</Th><Th>Type</Th><Th>Expiry</Th><Th w="1%">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><Td>loading…</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.length === 0 ? (
              <tr><Td>—</Td><Td>—</Td><Td>—</Td><Td>no licenses match</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.map((l) => (
              <tr key={l.id} className="transition-colors hover:bg-[#041a36]">
                <Td mono>{l.keyMasked}</Td>
                <Td>{l.customer}<div className="text-[9.5px]" style={{ color: C_DIM }}>{l.customerEmail}</div></Td>
                <Td>{l.planName}</Td>
                <Td><div className="flex flex-col items-start gap-1"><StatusPill status={l.status} />{l.isComplimentary ? <StatusPill status="COMP" label="COMPLIMENTARY" /> : null}</div></Td>
                <Td>{l.paymentStatus ? <StatusPill status={l.paymentStatus} /> : l.isComplimentary ? <span className="text-[10px]" style={{ color: C_DIM }}>not a payment</span> : "—"}</Td>
                <Td>{l.deviceCount}/{l.deviceLimit}</Td>
                <Td>{l.kind === "MULTI_USER" ? "Multi-user" : "Single-user"}</Td>
                <Td>{l.lifetime ? "Lifetime" : when(l.expiresAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {l.status === "ACTIVE" && (
                      <ActBtn tone="gold" busy={busyId === l.id} onClick={() => ask(l, "suspend", "Suspend license", `Suspend ${l.keyMasked}? The customer loses premium access until reactivated.`, "gold", "SUSPEND")}>Suspend</ActBtn>
                    )}
                    {(l.status === "SUSPENDED" || l.status === "UNACTIVATED") && (
                      <ActBtn tone="cyan" busy={busyId === l.id} onClick={() => ask(l, "reactivate", "Reactivate license", `Reactivate ${l.keyMasked}?`)}>Reactivate</ActBtn>
                    )}
                    {l.status !== "REVOKED" && (
                      <>
                        <ActBtn tone="danger" busy={busyId === l.id} onClick={() => ask(l, "revoke", "Revoke license", `Permanently revoke ${l.keyMasked}? All device activations are deactivated. A revoked license cannot be reactivated — use Replace to issue a new key.`, "danger", "REVOKE")}>Revoke</ActBtn>
                        <ActBtn tone="cyan" title="Issue a fresh key for the same entitlements" onClick={() => ask(l, "replace", "Replace license", `Issue a replacement key for ${l.keyMasked}? The old key is revoked. The replacement key is shown once after confirmation.`, "gold", "REPLACE")}>Replace</ActBtn>
                      </>
                    )}
                    <ActBtn tone="ghost" title="Adjust device allowance" onClick={() => { setDevicePick(l.deviceLimit); ask(l, "adjust-devices", "Adjust device allowance", `Set the device allowance for ${l.keyMasked} (currently ${l.deviceCount} active).`); }}>Devices</ActBtn>
                    <ActBtn tone="ghost" title="Transfer to another account" onClick={() => { setTransferEmail(""); ask(l, "transfer", "Transfer license", `Transfer ${l.keyMasked} to another registered customer. All current device activations are deactivated.`, "gold", "TRANSFER"); }}>Transfer</ActBtn>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {/* fresh state object each render → onConfirm reads current devicePick / transferEmail */}
      <ConfirmDialog
        state={pending ? {
          title: pending.title,
          body: pending.body,
          tone: pending.tone,
          confirmLabel: pending.confirmLabel,
          extra: pending.action === "adjust-devices" ? (
            <select value={devicePick} onChange={(e) => setDevicePick(Number(e.target.value))} className="mt-3 w-full rounded-lg px-3 py-2 text-[12px]" style={inputCss}>
              {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n} device{n > 1 ? "s" : ""}</option>)}
            </select>
          ) : pending.action === "transfer" ? (
            <input value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} placeholder="new-owner@email.com" spellCheck={false}
              className="mt-3 w-full rounded-lg px-3 py-2 text-[12px]" style={inputCss} />
          ) : undefined,
          onConfirm: () => run(pending),
        } : null}
        onClose={() => setPending(null)}
      />
    </div>
  );
}

const C_RED = "#FF4D5E";
const C_DIM = "rgba(82,103,138,1)";
