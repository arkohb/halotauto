"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · AUDIT LOG — read-only, append-only trail of every security-
//  sensitive action: license lifecycle, approvals, plan changes, manual
//  payment verification, settings changes. No endpoint can alter records.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { SearchInput, SectionHead, StatusPill, TableWrap, Td, Th, when, api } from "./kit";

interface LogRow {
  id: string; action: string; actor: string; actorRole: string;
  targetType: string; targetId: string; outcome: string;
  meta: Record<string, unknown>; createdAt: string;
}

export function AdminAudit() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [rows, setRows] = useState<LogRow[] | null>(null);

  const load = useCallback(async () => {
    const j = await api<{ logs: LogRow[] }>(`/api/admin/audit?q=${encodeURIComponent(q)}&action=${encodeURIComponent(action)}`);
    if (j.ok) setRows(j.logs);
  }, [q, action]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <SectionHead title="Audit Logs" sub="Append-only · every consequential administrative action is recorded with actor, target and outcome" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search actor / target…" />
        <SearchInput value={action} onChange={setAction} placeholder="Filter by action e.g. LICENSE" />
      </div>
      <TableWrap maxH={620}>
        <table className="w-full border-collapse">
          <thead>
            <tr><Th>When</Th><Th>Action</Th><Th>Actor</Th><Th>Role</Th><Th>Target</Th><Th>Outcome</Th><Th>Details</Th></tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><Td>loading…</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.length === 0 ? (
              <tr><Td>—</Td><Td>—</Td><Td>—</Td><Td>—</Td><Td>no audit records match</Td><Td>—</Td><Td>—</Td></tr>
            ) : rows.map((l) => (
              <tr key={l.id} className="transition-colors hover:bg-[#041a36]">
                <Td>{when(l.createdAt)}</Td>
                <Td mono>{l.action.replaceAll("_", " ")}</Td>
                <Td>{l.actor}</Td>
                <Td>{l.actorRole ? <StatusPill status={l.actorRole} /> : "—"}</Td>
                <Td>{l.targetType ? `${l.targetType}${l.targetId ? ` · ${l.targetId.slice(0, 12)}…` : ""}` : "—"}</Td>
                <Td><StatusPill status={l.outcome === "success" ? "ACTIVE" : l.outcome.toUpperCase()} label={l.outcome} /></Td>
                <Td>
                  {Object.keys(l.meta ?? {}).length === 0 ? "—" : (
                    <span className="font-mono text-[9.5px]" style={{ color: C_DIM }}>
                      {Object.entries(l.meta).filter(([, v]) => v !== null && v !== "").slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(" · ")}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

const C_DIM = "rgba(82,103,138,1)";
