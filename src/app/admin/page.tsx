"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /admin · HALO ADMINISTRATION COMMAND CENTRE
//  Separate, secure administration dashboard using the HALO visual identity.
//  Role-aware navigation (server-side RBAC re-checked on every API call):
//    Overview · Users · Licenses · Generate · Plans · Transactions ·
//    Execution · Audit · Settings · Administrators
//  Non-admins / signed-out visitors are redirected to /login.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { CommerceBackdrop, CreatorLine, HaloMark, Wordmark } from "@/components/commerce/brand";
import { AdminOverview } from "@/components/commerce/admin/overview";
import { AdminUsers } from "@/components/commerce/admin/users";
import { AdminLicenses } from "@/components/commerce/admin/licenses";
import { AdminGenerate } from "@/components/commerce/admin/generate";
import { AdminPlans } from "@/components/commerce/admin/plans";
import { AdminTransactions } from "@/components/commerce/admin/transactions";
import { AdminAudit } from "@/components/commerce/admin/audit";
import { AdminSettings } from "@/components/commerce/admin/settings";
import { AdminAdmins } from "@/components/commerce/admin/admins";
import { AdminExecution } from "@/components/commerce/admin/execution";

type Section = "overview" | "users" | "licenses" | "generate" | "plans" | "transactions" | "execution" | "audit" | "settings" | "admins";

const NAV: { key: Section; label: string; superOnly?: boolean }[] = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "licenses", label: "Licenses" },
  { key: "generate", label: "Generate" },
  { key: "plans", label: "Plans", superOnly: true },
  { key: "transactions", label: "Transactions" },
  { key: "execution", label: "Execution" },
  { key: "audit", label: "Audit" },
  { key: "settings", label: "Settings", superOnly: true },
  { key: "admins", label: "Administrators", superOnly: true },
];

interface Me {
  authenticated: boolean;
  user?: { fullName: string; email: string; role: string };
}

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [refreshKey, setRefreshKey] = useState(0);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Me) => {
        if (!j.authenticated || !j.user?.role || j.user.role === "CUSTOMER") {
          router.replace("/login?next=/admin");
          return;
        }
        setMe(j);
      })
      .catch(() => router.replace("/login?next=/admin"));
  }, [router]);

  if (!me) {
    return (
      <main className="relative flex min-h-screen items-center justify-center">
        <CommerceBackdrop />
        <div className="relative z-10 flex items-center gap-3 text-[11px] tracking-[0.24em]" style={{ color: C.muted }}>
          <Loader2 size={16} className="animate-spin" style={{ color: C.cyan }} />
          VERIFYING ADMINISTRATOR SESSION…
        </div>
      </main>
    );
  }

  const role = me.user?.role ?? "";
  const isSuper = role === "SUPER_ADMIN";
  const visibleNav = NAV.filter((n) => !n.superOnly || isSuper);
  const activeSection: Section = section === "plans" || section === "settings" || section === "admins" ? (isSuper ? section : "overview") : section;

  return (
    <main className="relative min-h-screen">
      <CommerceBackdrop />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 py-5 sm:px-6">
        {/* top bar */}
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <HaloMark size={38} />
            <div>
              <Wordmark size={13} />
              <div className="mt-1 flex items-center gap-2 text-[8.5px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>
                ADMIN COMMAND CENTRE
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: C.green, boxShadow: `0 0 8px ${C.green}` }} />
                <span style={{ color: C.green }}>ONLINE</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-right">
              <div className="text-[11px] font-bold" style={{ color: C.txt }}>{me.user?.fullName || "Administrator"}</div>
              <div className="text-[9px] font-bold tracking-[0.14em]" style={{ color: role === "SUPER_ADMIN" ? C.goldHover : C.cyan }}>{role.replaceAll("_", " ")}</div>
            </div>
            <a href="/" className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>TRADING APP</a>
            <a href="/account" className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>ACCOUNT</a>
            <button type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125" style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>
              <LogOut size={11} />SIGN OUT
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-5 lg:flex-row">
          {/* side navigation */}
          <nav className="lg:w-52 lg:shrink-0" aria-label="Admin sections">
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {visibleNav.map((n) => {
                const on = activeSection === n.key;
                return (
                  <button key={n.key} type="button" onClick={() => setSection(n.key)}
                    className="whitespace-nowrap rounded-lg px-3.5 py-2.5 text-left text-[10px] font-extrabold tracking-[0.14em] transition-all lg:w-full"
                    style={on
                      ? { background: `linear-gradient(135deg, ${A.blue(0.16)}, ${A.cyan(0.08)})`, color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.4)}` }
                      : { background: A.white(0.03), color: C.muted, boxShadow: `inset 0 0 0 1px ${A.white(0.08)}` }}>
                    {n.label.toUpperCase()}
                    {n.key === "generate" ? <span className="ml-1.5 text-[8px]" style={{ color: C.goldHover }}>＋</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 hidden rounded-xl p-3.5 lg:block" style={{ background: A.white(0.02), border: `1px solid ${C.lineInner}` }}>
              <div className="text-[8.5px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>MT5 PROTECTION</div>
              <p className="mt-1.5 text-[9.5px] leading-relaxed" style={{ color: C.muted }}>
                Licensing never touches open positions, protective SL/TP or the EA. Restrictions apply to new commands only.
              </p>
            </div>
          </nav>

          {/* section body */}
          <section className="min-w-0 flex-1">
            {activeSection === "overview" ? <AdminOverview go={(s) => setSection(s as Section)} /> : null}
            {activeSection === "users" ? <AdminUsers key={`u${refreshKey}`} onChanged={bump} /> : null}
            {activeSection === "licenses" ? <AdminLicenses key={`l${refreshKey}`} onChanged={bump} goToGenerate={() => setSection("generate")} /> : null}
            {activeSection === "generate" ? <AdminGenerate onChanged={bump} /> : null}
            {activeSection === "plans" ? <AdminPlans key={`p${refreshKey}`} /> : null}
            {activeSection === "transactions" ? <AdminTransactions key={`t${refreshKey}`} onChanged={bump} /> : null}
            {activeSection === "execution" ? <AdminExecution isSuper={isSuper} /> : null}
            {activeSection === "audit" ? <AdminAudit /> : null}
            {activeSection === "settings" ? <AdminSettings /> : null}
            {activeSection === "admins" ? <AdminAdmins /> : null}
          </section>
        </div>

        <CreatorLine className="mt-8 pb-2" />
      </div>
    </main>
  );
}
