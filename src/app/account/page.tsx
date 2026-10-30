"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /account · CUSTOMER ACCOUNT DASHBOARD
//  Personal command deck: profile, purchased plan + license status
//  (lifetime/expiry), feature entitlements, device usage + self-deactivation,
//  purchase history, notifications and secure sign-out. Only ever shows the
//  signed-in customer's OWN data (server-enforced).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import {
  CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, GlassCard, GoldButton,
  HaloMark, inputStyle, TrustRow, Wordmark,
} from "@/components/commerce/brand";

interface AccountRes {
  ok: boolean;
  error?: string;
  user: { fullName: string; email: string; username: string | null; country: string; role: string; status: string; emailVerified: boolean; createdAt: string; lastLoginAt: string | null };
  license: { key: string; keyMasked: string; planCode: string; planName: string; status: string; deviceLimit: number; deviceCount: number; activatedAt: string | null; expiresAt: string | null; lifetime: boolean; isComplimentary?: boolean } | null;
  licenseReason: string;
  entitlements: string[];
  upgrades: { planCode: string; features: string[] }[];
  devices: { id: string; deviceLabel: string; planName: string; licenseKeyMasked: string; activatedAt: string }[];
  licenses: { id: string; keyMasked: string; planName: string; status: string; deviceLimit: number; deviceCount: number; isComplimentary: boolean; activatedAt: string | null; expiresAt: string | null; lifetime: boolean }[];
  payments: { id: string; reference: string; planName: string; amountCents: number; currency: string; provider: string; status: string; createdAt: string; verifiedAt: string | null; licenseKeyMasked: string | null }[];
  notifications: { id: string; kind: string; title: string; body: string; readAt: string | null; createdAt: string }[];
}

const kv = "flex items-baseline justify-between gap-3 border-b py-2";

export default function AccountPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountRes | null>(null);
  const [state, setState] = useState<"loading" | "anon" | "ready">("loading");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const [actOk, setActOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/account", { cache: "no-store" });
    if (r.status === 401) { setState("anon"); return; }
    const j = (await r.json()) as AccountRes;
    setData(j);
    setState("ready");
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deviceToken = useCallback((): string => {
    const k = "halo-device-token";
    let t = localStorage.getItem(k);
    if (!t) { t = crypto.randomUUID().replaceAll("-", "").slice(0, 32); localStorage.setItem(k, t); }
    return t;
  }, []);

  const activate = async () => {
    setBusy(true); setActErr(null); setActOk(null);
    try {
      const r = await fetch("/api/license/activate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, deviceToken: deviceToken(), deviceLabel: navigator.platform || "Web device" }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (j.ok) {
        setActOk("License activated on this device — premium features are unlocked.");
        setKey("");
        await load();
      } else setActErr(j.error ?? "Activation failed.");
    } catch (e) {
      setActErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deactivateDevice = async (id: string) => {
    await fetch(`/api/license/devices/${id}`, { method: "DELETE" });
    await load();
  };

  if (state === "loading") {
    return (
      <main className="relative flex min-h-screen items-center justify-center">
        <CommerceBackdrop />
        <div className="relative z-10 flex items-center gap-3 text-[11px] tracking-[0.24em]" style={{ color: C.muted }}>
          <Loader2 size={16} className="animate-spin" style={{ color: C.cyan }} />LOADING YOUR ACCOUNT…
        </div>
      </main>
    );
  }

  if (state === "anon") {
    return (
      <main className="relative flex min-h-screen items-center justify-center px-4">
        <CommerceBackdrop />
        <GlassCard className="relative z-10 w-full max-w-[400px] p-7">
          <div className="mb-5 flex items-center gap-3">
            <HaloMark size={38} />
            <div><Wordmark size={13} /></div>
          </div>
          <h1 className="text-[20px] font-extrabold" style={{ color: C.txt }}>Your Account Awaits</h1>
          <p className="mb-5 mt-1 text-[11.5px]" style={{ color: C.muted }}>Sign in to view your plan, license, devices and purchases.</p>
          <div className="space-y-3">
            <GoldButton className="w-full" onClick={() => router.replace("/login?next=/account")}>Sign In</GoldButton>
            <a href="/register" className="block rounded-xl py-3 text-center text-[11px] font-extrabold tracking-[0.2em]" style={{ background: A.cyan(0.1), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.35)}` }}>CREATE ACCOUNT</a>
          </div>
          <div className="mt-6 border-t pt-5" style={{ borderColor: C.lineInner }}><TrustRow /></div>
        </GlassCard>
      </main>
    );
  }

  const u = data!.user;
  const lic = data!.license;
  const entitlements = data!.entitlements ?? [];

  return (
    <main className="relative min-h-screen">
      <CommerceBackdrop />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1200px] flex-col px-4 py-6 sm:px-6">
        {/* header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <HaloMark size={38} />
            <div>
              <Wordmark size={13} />
              <div className="mt-1 text-[8.5px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>MY ACCOUNT · PERSONAL COMMAND DECK</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {u.role !== "CUSTOMER" ? (
              <a href="/admin" className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125" style={{ background: A.gold(0.1), color: C.goldHover, boxShadow: `inset 0 0 0 1px ${A.gold(0.35)}` }}>ADMIN</a>
            ) : null}
            <a href="/" className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>TRADING APP</a>
            <button type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125" style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>
              <LogOut size={11} />SIGN OUT
            </button>
          </div>
        </header>

        <div className="grid flex-1 gap-4 lg:grid-cols-3">
          {/* left: profile + license */}
          <div className="space-y-4">
            <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full text-[15px] font-extrabold" style={{ background: `linear-gradient(140deg, ${A.blue(0.35)}, ${A.cyan(0.2)})`, color: "#fff" }}>
                  {(u.fullName || u.email).slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="text-[14px] font-extrabold" style={{ color: C.txt }}>{u.fullName || "HALO Trader"}</div>
                  <div className="text-[10.5px]" style={{ color: C.muted }}>{u.email}</div>
                </div>
              </div>
              <div className="mt-4 text-[11px]">
                <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>USERNAME</span><span style={{ color: C.txt2 }}>{u.username ?? "—"}</span></div>
                <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>COUNTRY</span><span style={{ color: C.txt2 }}>{u.country || "—"}</span></div>
                <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>E-MAIL VERIFIED</span><span style={{ color: u.emailVerified ? C.green : C.warn }}>{u.emailVerified ? "Yes" : "Pending"}</span></div>
                <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>MEMBER SINCE</span><span style={{ color: C.txt2 }}>{new Date(u.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span></div>
                <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>LAST SIGN-IN</span><span style={{ color: C.txt2 }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</span></div>
              </div>
            </div>

            {/* plan + license status */}
            <div className="rounded-xl p-5" style={{ background: `linear-gradient(165deg, ${A.gold(0.06)}, transparent 55%), ${C.navy4}`, border: `1px solid ${A.gold(0.25)}` }}>
              <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.goldHover }}>YOUR PLAN</div>
              {lic ? (
                <div className="text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[18px] font-extrabold" style={{ color: C.txt }}>{lic.planName}</span>
                    <span className="rounded-full px-2 py-[3px] text-[9px] font-extrabold tracking-[0.12em]" style={{ color: C.green, background: A.green(0.13), boxShadow: `inset 0 0 0 1px ${A.green(0.35)}` }}>{lic.status}</span>
                  </div>
                  <div className="mt-3 space-y-0">
                    <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>TERM</span><span style={{ color: C.goldHover }}>{lic.lifetime ? "LIFETIME" : `Expires ${lic.expiresAt?.slice(0, 10)}`}</span></div>
                    <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>LICENSE</span><span className="font-mono text-[10px]" style={{ color: C.txt2 }}>{lic.keyMasked}</span></div>
                    <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>ACTIVATED</span><span style={{ color: C.txt2 }}>{lic.activatedAt ? new Date(lic.activatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not yet"}</span></div>
                    <div className={kv} style={{ borderColor: C.divider }}><span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>DEVICES</span><span style={{ color: C.txt2 }}>{lic.deviceCount} / {lic.deviceLimit}</span></div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: C.muted }}>No active license yet. Choose a one-time plan — pay once, trade for life.</p>
                  <a href="/pricing" className="mt-3 inline-block rounded-xl px-4 py-2.5 text-[10px] font-extrabold tracking-[0.18em]" style={{ background: `linear-gradient(135deg, #E9B94E, #F5CD6B)`, color: "#1A1205" }}>VIEW PLANS & PRICING</a>
                </div>
              )}
            </div>

            {/* license activation */}
            <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
              <div className="mb-1 flex items-center gap-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
                <ShieldCheck size={12} style={{ color: C.cyan }} />LICENSE ACTIVATION
              </div>
              <p className="mb-3 text-[10.5px]" style={{ color: C.muted }}>Received a key? Activate it on this device (counts against the plan&apos;s device allowance).</p>
              <FieldLabel>LICENSE KEY</FieldLabel>
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="HALO-XXXX-XXXX-XXXX-XXXX" spellCheck={false}
                className="mb-3 w-full rounded-lg px-3 py-2.5 font-mono text-[12.5px]" style={inputStyle} />
              <ErrorBox error={actErr} />
              {actOk ? <div className="rounded-lg px-3 py-2 text-[11px]" style={{ background: A.green(0.1), color: C.green }}>{actOk}</div> : null}
              <GoldButton className="mt-3 w-full" disabled={busy || !key.trim()} onClick={() => void activate()}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : null}{busy ? "ACTIVATING…" : "ACTIVATE ON THIS DEVICE"}
              </GoldButton>
              <a href="/activate" className="mt-2 block text-center text-[10px] hover:underline" style={{ color: C.cyan }}>Full activation & device management →</a>
            </div>
          </div>

          {/* middle + right */}
          <div className="space-y-4 lg:col-span-2">
            {/* features */}
            <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
              <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>INCLUDED IN YOUR PLAN ({entitlements.length} FEATURES)</div>
              <div className="flex flex-wrap gap-1.5">
                {entitlements.map((f) => (
                  <span key={f} className="rounded-full px-2.5 py-1 text-[9.5px] font-bold" style={{ background: A.green(0.08), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.25)}` }}>{f.replaceAll("_", " ")}</span>
                ))}
              </div>
              {data!.upgrades.length > 0 ? (
                <div className="mt-4 rounded-lg p-3" style={{ background: A.cyan(0.05), boxShadow: `inset 0 0 0 1px ${A.cyan(0.2)}` }}>
                  <div className="text-[9.5px] font-extrabold tracking-[0.16em]" style={{ color: C.cyan }}>UNLOCK MORE</div>
                  <p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: C.muted }}>
                    {data!.upgrades.map((g) => `${g.planCode.charAt(0) + g.planCode.slice(1).toLowerCase()} unlocks: ${g.features.slice(0, 3).map((f) => f.replaceAll("_", " ")).join(", ")}${g.features.length > 3 ? ` +${g.features.length - 3} more` : ""}`).join(" · ")}
                  </p>
                  <a href="/pricing" className="mt-2 inline-block text-[10px] font-bold hover:underline" style={{ color: C.goldHover }}>Compare plans →</a>
                </div>
              ) : null}
            </div>

            {/* devices */}
            <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>ACTIVE DEVICES</div>
                <a href="/activate" className="text-[9.5px] font-bold hover:underline" style={{ color: C.cyan }}>Manage →</a>
              </div>
              {data!.devices.length === 0 ? (
                <p className="text-[11px]" style={{ color: C.muted }}>No devices activated yet.</p>
              ) : (
                <div className="space-y-2">
                  {data!.devices.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: A.white(0.03) }}>
                      <div>
                        <div className="text-[11.5px] font-bold" style={{ color: C.txt2 }}>{d.deviceLabel || "Device"}</div>
                        <div className="text-[9.5px]" style={{ color: C_DIM }}>{d.planName} · activated {new Date(d.activatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                      </div>
                      <button type="button" onClick={() => void deactivateDevice(d.id)} className="rounded-lg px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.1em]" style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>DEACTIVATE</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[9.5px]" style={{ color: C.muted }}>Privacy-first: devices are identified by a local random token — no invasive fingerprinting.</p>
            </div>

            {/* purchases */}
            <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
              <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>PURCHASE HISTORY</div>
              {data!.payments.length === 0 ? (
                <p className="text-[11px]" style={{ color: C.muted }}>No purchases yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        {["Reference", "Plan", "Amount", "Provider", "Status", "Date"].map((h) => (
                          <th key={h} className="px-2 py-2 text-left text-[8.5px] font-extrabold tracking-[0.14em]" style={{ color: C.label, borderBottom: `1px solid ${C.line}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data!.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-2 py-2 font-mono text-[10px]" style={{ color: C.txt2, borderBottom: `1px solid ${C.divider}` }}>{p.reference}</td>
                          <td className="px-2 py-2" style={{ color: C.txt2, borderBottom: `1px solid ${C.divider}` }}>{p.planName}</td>
                          <td className="px-2 py-2 font-mono" style={{ color: C.txt2, borderBottom: `1px solid ${C.divider}` }}>{(p.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 })}</td>
                          <td className="px-2 py-2" style={{ color: C.txt2, borderBottom: `1px solid ${C.divider}` }}>{p.provider}</td>
                          <td className="px-2 py-2" style={{ borderBottom: `1px solid ${C.divider}` }}>
                            <span className="rounded-full px-2 py-[3px] text-[9px] font-extrabold" style={{
                              color: p.status === "VERIFIED" ? C.green : p.status === "PENDING" ? C.warn : C.red,
                              background: p.status === "VERIFIED" ? A.green(0.1) : p.status === "PENDING" ? A.warn(0.1) : A.red(0.1),
                            }}>{p.status}</span>
                          </td>
                          <td className="px-2 py-2" style={{ color: C.txt2, borderBottom: `1px solid ${C.divider}` }}>{new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* notifications + support */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
                <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>NOTIFICATIONS</div>
                {data!.notifications.length === 0 ? (
                  <p className="text-[11px]" style={{ color: C.muted }}>Nothing new — you&apos;re all caught up.</p>
                ) : (
                  <div className="space-y-2">
                    {data!.notifications.slice(0, 6).map((n) => (
                      <div key={n.id} className="rounded-lg px-3 py-2" style={{ background: A.white(0.03) }}>
                        <div className="text-[11px] font-bold" style={{ color: C.txt2 }}>{n.title}</div>
                        <div className="mt-0.5 text-[10px]" style={{ color: C.muted }}>{n.body}</div>
                        <div className="mt-1 text-[9px]" style={{ color: C_DIM }}>{new Date(n.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
                <div className="mb-3 flex items-center gap-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
                  <Bot size={12} style={{ color: C.teal }} />SUPPORT & SECURITY
                </div>
                <p className="text-[10.5px] leading-relaxed" style={{ color: C.muted }}>
                  Password resets are available from the sign-in page. Sessions are revoked instantly when an account is restricted. For license or device help, contact support with your license reference.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/forgot-password" className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em]" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>RESET PASSWORD</a>
                  <a href="/activate" className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em]" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>DEVICES & ACTIVATION</a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <CreatorLine className="mt-8 pb-2" />
      </div>
    </main>
  );
}

const C_DIM = "rgba(82,103,138,1)";
