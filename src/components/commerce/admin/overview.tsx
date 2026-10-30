"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · OVERVIEW — real database-backed statistics, revenue by plan,
//  recent transactions, recent activity and live system status.
//  Revenue counts VERIFIED payments only · complimentary licenses reported
//  separately · never displays invented numbers.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { A, C } from "@/lib/halo/ui-helpers";
import { api, money, SectionHead, StatCard, StatusPill, TableWrap, Td, Th, when } from "./kit";

interface StatsRes {
  users: { total: number; active: number; pendingApprovals: number; suspended: number; blocked: number; rejected: number; pendingEmail: number };
  licenses: { total: number; active: number; revoked: number; complimentary: number; unactivated: number };
  revenue: { totalCents: number; currency: string; byPlan: { key: string; name: string; count: number; amountCents: number; currency: string }[] };
  recentPayments: { id: string; reference: string; customer: string; planName: string; amountCents: number; currency: string; status: string; createdAt: string }[];
  recentActivity: { id: string; action: string; actor: string; targetType: string; targetId: string; outcome: string; createdAt: string }[];
  system: { commerceMode: boolean; database: string; paymentProvider: string | { provider: string; paystack: boolean; flutterwave: boolean }; licenseService: string; application: string };
}

export function AdminOverview({ go }: { go: (s: string) => void }) {
  const [s, setS] = useState<StatsRes | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await api<StatsRes>("/api/admin/stats");
    if (j.ok) setS(j);
    else setErr(j.error ?? "Failed to load statistics.");
  }, []);

  useEffect(() => {
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 15000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [load]);

  if (err) return <div className="rounded-lg px-3 py-2.5 text-[11.5px]" style={{ background: A.red(0.1), color: C.red }}>{err}</div>;
  if (!s) return <div className="py-16 text-center text-[11px] tracking-[0.2em]" style={{ color: C.muted }}>LOADING COMMAND CENTRE…</div>;

  return (
    <div>
      <SectionHead
        title="Command Centre"
        sub={`Live platform telemetry · commercial enforcement ${s.system.commerceMode ? "ON" : "OFF (owner mode)"}`}
        right={<button type="button" onClick={() => void load()} className="rounded-lg px-3 py-1.5 text-[9.5px] font-extrabold tracking-[0.14em]" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>REFRESH</button>}
      />

      {/* top stat row — mirrors the concept mockup */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="TOTAL LICENSES" value={s.licenses.total} tone="gold" pulse sub={`${s.licenses.active} active · ${s.licenses.unactivated} unactivated`} />
        <StatCard label="ACTIVE USERS" value={s.users.active} tone="ok" pulse sub={`${s.users.total} registered`} />
        <StatCard label="PENDING APPROVALS" value={s.users.pendingApprovals} tone={s.users.pendingApprovals > 0 ? "warn" : "ok"} pulse={s.users.pendingApprovals > 0} sub="accounts awaiting review" />
        <StatCard label="REVENUE (VERIFIED)" value={money(s.revenue.totalCents, s.revenue.currency)} tone="ok" sub={`${s.licenses.complimentary} complimentary issued separately`} />
      </div>

      {/* secondary row */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="SUSPENDED" value={s.users.suspended} tone={s.users.suspended ? "warn" : "muted"} />
        <StatCard label="BLOCKED / REJECTED" value={s.users.blocked + s.users.rejected} tone={s.users.blocked + s.users.rejected ? "err" : "muted"} />
        <StatCard label="REVOKED LICENSES" value={s.licenses.revoked} tone={s.licenses.revoked ? "err" : "muted"} />
        <StatCard label="PENDING E-MAIL" value={s.users.pendingEmail} tone={s.users.pendingEmail ? "warn" : "muted"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {/* revenue by plan */}
        <div className="rounded-xl p-4" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
          <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>REVENUE BY PLAN · VERIFIED ONLY</div>
          {s.revenue.byPlan.length === 0 ? (
            <p className="py-6 text-center text-[11px]" style={{ color: C.muted }}>No verified sales yet — revenue appears here after the first verified payment.</p>
          ) : (
            <div className="space-y-2.5">
              {s.revenue.byPlan.map((p) => {
                const max = Math.max(...s.revenue.byPlan.map((x) => x.amountCents), 1);
                return (
                  <div key={p.key}>
                    <div className="mb-1 flex items-baseline justify-between text-[11px]">
                      <span style={{ color: C.txt2 }}>{p.name} <span style={{ color: C.label }}>× {p.count}</span></span>
                      <span className="font-bold" style={{ color: C.green }}>{money(p.amountCents, p.currency)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: A.white(0.06) }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (p.amountCents / max) * 100)}%`, background: `linear-gradient(90deg, ${A.blue(0.9)}, ${A.cyan(0.9)})` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* system status */}
          <div className="mt-4 border-t pt-3" style={{ borderColor: C.lineInner }}>
            <div className="mb-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>SYSTEM STATUS</div>
            <div className="grid grid-cols-2 gap-2 text-[10.5px]">
              {[
                ["Application", s.system.application],
                ["Database", s.system.database],
                ["License service", s.system.licenseService],
                [
                  "Payment provider",
                  typeof s.system.paymentProvider === "string"
                    ? s.system.paymentProvider
                    : `${s.system.paymentProvider?.provider ?? "offline"}${s.system.paymentProvider?.paystack ? " · Paystack ready" : ""}${s.system.paymentProvider?.flutterwave ? " · Flutterwave ready" : ""}`,
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-lg px-2.5 py-1.5" style={{ background: A.white(0.03) }}>
                  <span style={{ color: C.muted }}>{k}</span>
                  <StatusPill status={String(v)} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[10.5px]" style={{ background: A.gold(0.05) }}>
              <span style={{ color: C.muted }}>Trading engine / MT5</span>
              <span className="font-bold" style={{ color: C.teal }}>UNTOUCHED — protective management independent of licensing</span>
            </div>
          </div>
        </div>

        {/* recent payments + activity */}
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>RECENT TRANSACTIONS</div>
              <button type="button" onClick={() => go("transactions")} className="text-[9.5px] font-bold hover:underline" style={{ color: C.cyan }}>View all →</button>
            </div>
            <TableWrap maxH={210}>
              <table className="w-full border-collapse">
                <thead><tr><Th>Customer</Th><Th>Plan</Th><Th>Amount</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {s.recentPayments.length === 0 ? (
                    <tr><Td>—</Td><Td>—</Td><Td>—</Td><Td>no transactions yet</Td></tr>
                  ) : s.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <Td>{p.customer}</Td><Td>{p.planName}</Td>
                      <Td mono>{money(p.amountCents, p.currency)}</Td>
                      <Td><StatusPill status={p.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>RECENT ADMIN ACTIVITY</div>
              <button type="button" onClick={() => go("audit")} className="text-[9.5px] font-bold hover:underline" style={{ color: C.cyan }}>Full audit log →</button>
            </div>
            <TableWrap maxH={210}>
              <table className="w-full border-collapse">
                <thead><tr><Th>Action</Th><Th>Actor</Th><Th>When</Th></tr></thead>
                <tbody>
                  {s.recentActivity.length === 0 ? (
                    <tr><Td>—</Td><Td>—</Td><Td>no activity yet</Td></tr>
                  ) : s.recentActivity.map((a) => (
                    <tr key={a.id}>
                      <Td mono>{a.action.replaceAll("_", " ")}</Td>
                      <Td>{a.actor}</Td>
                      <Td>{when(a.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </div>
      </div>
    </div>
  );
}
