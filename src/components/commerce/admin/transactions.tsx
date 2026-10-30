"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · TRANSACTIONS — the payment ledger. Manual verification (SUPER +
//  LICENSE admin) records the verifier identity and fires the idempotent
//  license-issuance path. mark-failed / refund / dispute → SUPER only.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { ActBtn, api, ConfirmState, ConfirmDialog, FilterChips, money, Note, SearchInput, SectionHead, StatusPill, TableWrap, Td, Th, when } from "./kit";

interface TxRow {
  id: string; reference: string; customer: string; customerEmail: string;
  planName: string; planCode: string; amountCents: number; currency: string;
  provider: string; status: string; licenseKeyMasked: string | null;
  manualVerifiedAt: string | null; createdAt: string; verifiedAt: string | null;
}

const FILTERS = [
  { key: "all", label: "All" }, { key: "PENDING", label: "Pending" }, { key: "VERIFIED", label: "Verified" },
  { key: "FAILED", label: "Failed" }, { key: "REFUNDED", label: "Refunded" }, { key: "DISPUTED", label: "Disputed" },
] as const;

export function AdminTransactions({ onChanged }: { onChanged?: () => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    const j = await api<{ transactions: TxRow[] }>(`/api/admin/transactions?q=${encodeURIComponent(q)}&status=${status}`);
    if (j.ok) setRows(j.transactions);
    else setErr(j.error ?? "Failed to load transactions.");
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const act = (p: TxRow, action: string, title: string, body: string, tone: ConfirmState["tone"] = "gold", confirmLabel = "CONFIRM") =>
    setConfirm({
      title, body, tone, confirmLabel,
      onConfirm: async () => {
        setBusyId(p.id);
        const j = await api<{ licenseKey?: string; duplicate?: boolean }>("/api/admin/transactions", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: p.id, action }),
        });
        setNote({ text: j.ok ? `${title} — done.${j.licenseKey ? ` License issued: ${j.licenseKey}` : ""}${j.duplicate ? " (duplicate event — no double issuance)" : ""}` : j.error ?? "Action failed.", bad: !j.ok });
        setBusyId(null);
        await load();
        onChanged?.();
      },
    });

  const totalVerified = (rows ?? []).filter((r) => r.status === "VERIFIED").reduce((n, r) => n + r.amountCents, 0);

  return (
    <div>
      <SectionHead title="Transactions & Revenue" sub="Only VERIFIED payments count as revenue · manual verification records your admin identity" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search reference or customer e-mail…" />
        <FilterChips options={[...FILTERS]} value={status} onChange={setStatus} />
        <div className="ml-auto text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C_GREEN }}>
          VERIFIED (FILTERED): {money(totalVerified, rows?.[0]?.currency ?? "USD")}
        </div>
      </div>
      {err ? <div className="mb-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: "rgba(255,77,94,0.1)", color: C_RED }}>{err}</div> : null}
      <div className="mb-3"><Note note={note} /></div>

      <TableWrap>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Reference</Th><Th>Customer</Th><Th>Plan</Th><Th>Amount</Th><Th>Provider</Th><Th>Status</Th><Th>License</Th><Th>Date</Th><Th w="1%">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><Td>loading…</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.length === 0 ? (
              <tr><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>no transactions match</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-[#041a36]">
                <Td mono>{p.reference}</Td>
                <Td>{p.customer}<div className="text-[9.5px]" style={{ color: C_DIM }}>{p.customerEmail}</div></Td>
                <Td>{p.planName}</Td>
                <Td mono>{money(p.amountCents, p.currency)}</Td>
                <Td>{p.provider}</Td>
                <Td><StatusPill status={p.status} /></Td>
                <Td>{p.licenseKeyMasked ? <span className="font-mono text-[10px]">{p.licenseKeyMasked}</span> : "—"}</Td>
                <Td>{when(p.createdAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {p.status === "PENDING" && (
                      <>
                        <ActBtn tone="cyan" busy={busyId === p.id} onClick={() => act(p, "verify", "Verify payment", `Manually verify ${p.reference} (${money(p.amountCents, p.currency)})? Your admin identity and today's date are recorded in the audit trail, and the license is issued automatically.`, "cyan", "VERIFY")}>Verify</ActBtn>
                        <ActBtn tone="danger" onClick={() => act(p, "mark-failed", "Mark payment failed", `Mark ${p.reference} as FAILED? (Super Administrator only)`, "danger", "MARK FAILED")}>Fail</ActBtn>
                      </>
                    )}
                    {p.status === "VERIFIED" && (
                      <>
                        <ActBtn tone="ghost" onClick={() => act(p, "mark-refunded", "Record refund", `Record ${p.reference} as REFUNDED? (Super Administrator only)`, "gold", "REFUND")}>Refund</ActBtn>
                        <ActBtn tone="gold" onClick={() => act(p, "mark-disputed", "Flag dispute", `Flag ${p.reference} as DISPUTED? (Super Administrator only)`, "gold", "FLAG DISPUTE")}>Dispute</ActBtn>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

const C_RED = "#FF4D5E";
const C_GREEN = "#00D68F";
const C_DIM = "rgba(82,103,138,1)";
