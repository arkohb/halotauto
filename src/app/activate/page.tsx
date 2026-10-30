"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /activate · customer license activation
//  1. register/log in  2. enter the HALO key  3. validate  4. activate on
//  this device (privacy-preserving random device token, no fingerprinting)
//  5. view device usage 6. access features. Clear messages for every
//  failure mode (invalid/revoked/suspended/expired/limit/unverified).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { FEATURE_LABEL } from "@/lib/commerce/constants";
import { CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, GlassCard, GoldButton, HaloMark, OkBox, Wordmark, inputStyle } from "@/components/commerce/brand";

const DEVICE_KEY = "halo-device-token.v1";

function getDeviceToken(): string {
  let t = "";
  try {
    t = localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    /* storage unavailable */
  }
  if (!t) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    t = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    try {
      localStorage.setItem(DEVICE_KEY, t);
    } catch {
      /* keep in-memory only */
    }
  }
  return t;
}

function deviceLabelFromUA(): string {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|Mac/.test(ua) ? "Apple device" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

interface LicenseView {
  planName: string;
  planCode: string;
  key: string;
  status: string;
  entitlements: string[];
  deviceLimit: number;
  deviceCount: number;
  lifetime: boolean;
  expiresAt: string | null;
}

interface DeviceView {
  id: string;
  deviceLabel: string;
  planName: string;
  licenseKeyMasked: string;
  activatedAt: string;
}

export default function ActivatePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [meName, setMeName] = useState("");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseView | null>(null);
  const [devices, setDevices] = useState<DeviceView[]>([]);

  const loadState = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      const j = (await r.json()) as { authenticated: boolean; user?: { fullName: string } };
      setAuthed(j.authenticated);
      setMeName(j.user?.fullName ?? "");
      if (!j.authenticated) return;
      const [a, d] = await Promise.all([
        fetch("/api/account", { cache: "no-store" }).then((x) => x.json()),
        fetch("/api/license/devices", { cache: "no-store" }).then((x) => x.json()),
      ]);
      if (a.ok) setLicense(a.license);
      if (d.ok) setDevices(d.devices ?? []);
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    setLabel(deviceLabelFromUA());
    void loadState();
  }, [loadState]);

  const activate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, deviceToken: getDeviceToken(), deviceLabel: label }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; license?: LicenseView };
      if (!j.ok) {
        setError(j.error ?? "Activation failed.");
        return;
      }
      setLicense(j.license ?? null);
      setOkMsg("License activated on this device — welcome aboard!");
      await loadState();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [key, label, loadState]);

  const deactivate = async (id: string) => {
    await fetch(`/api/license/devices/${id}`, { method: "DELETE" });
    await loadState();
  };

  if (authed === false) {
    return (
      <main className="relative flex min-h-screen items-center justify-center px-4">
        <CommerceBackdrop />
        <GlassCard className="relative z-10 w-full max-w-[420px] p-8 text-center">
          <ShieldCheck size={40} className="mx-auto mb-4" color={C.gold} />
          <h1 className="text-[18px] font-extrabold" style={{ color: C.txt }}>Sign in to activate your license</h1>
          <p className="mb-6 mt-2 text-[12px] leading-relaxed" style={{ color: C.muted }}>
            License activation is tied to your HALO account. Sign in — or create an account — and paste the key from your purchase.
          </p>
          <div className="flex justify-center gap-3">
            <GoldButton onClick={() => router.push("/login?next=/activate")}>SIGN IN</GoldButton>
            <button onClick={() => router.push("/register")} className="rounded-xl px-5 text-[11px] font-extrabold tracking-[0.2em]" style={{ border: `1px solid ${C.line2}`, color: C.txt2, padding: "13px 22px" }}>CREATE ACCOUNT</button>
          </div>
        </GlassCard>
        <CreatorLine className="absolute bottom-6 left-0 right-0" />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen px-4 py-10">
      <CommerceBackdrop />
      <div className="relative z-10 mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HaloMark size={40} />
            <div>
              <Wordmark size={14} />
              <div className="mt-1 text-[9px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>LICENSE ACTIVATION</div>
            </div>
          </div>
          <a href="/account" className="text-[11px] font-semibold hover:underline" style={{ color: C.cyan }}>My Account</a>
        </div>

        <GlassCard className="p-7">
          {license ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={34} color={C.green} />
                <div>
                  <h1 className="text-[17px] font-extrabold" style={{ color: C.txt }}>{license.planName} license is active</h1>
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    {license.lifetime ? "Lifetime license" : `Expires ${license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : ""}`} · {devices.length}/{license.deviceLimit} devices
                  </p>
                </div>
              </div>
              <div className="rounded-xl p-4" style={{ background: A.green(0.05), border: `1px solid ${A.green(0.3)}` }}>
                <div className="mb-2 text-[9px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>YOUR INCLUDED FEATURES</div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {license.entitlements.slice(0, 12).map((f) => (
                    <div key={f} className="flex items-center gap-1.5 text-[10.5px]" style={{ color: C.txt2 }}>
                      <CheckCircle2 size={10} color={C.teal} /> {FEATURE_LABEL[f] ?? f}
                    </div>
                  ))}
                  {license.entitlements.length > 12 && <div className="text-[10px]" style={{ color: C.dim }}>+ {license.entitlements.length - 12} more</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <GoldButton onClick={() => router.push("/")}>OPEN TRADING COMMAND CENTRE</GoldButton>
                <button onClick={() => router.push("/account")} className="rounded-xl px-5 text-[11px] font-extrabold tracking-[0.2em]" style={{ border: `1px solid ${C.line2}`, color: C.txt2, padding: "13px 22px" }}>ACCOUNT DASHBOARD</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <MonitorSmartphone size={30} color={C.cyan} />
                <div>
                  <h1 className="text-[17px] font-extrabold" style={{ color: C.txt }}>Activate HALO {meName ? `— welcome, ${meName.split(" ")[0]}` : ""}</h1>
                  <p className="text-[11px]" style={{ color: C.muted }}>Paste the license key from your purchase to unlock this device.</p>
                </div>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); if (!busy) void activate(); }} className="space-y-4">
                <div>
                  <FieldLabel>LICENSE KEY</FieldLabel>
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value.toUpperCase())}
                    placeholder="HALO-XXXX-XXXX-XXXX-XXXX"
                    spellCheck={false}
                    className="w-full rounded-lg px-3 py-3 font-mono text-[14px] tracking-wider outline-none focus:border-[#2ECCFF]"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <FieldLabel>DEVICE NAME</FieldLabel>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Chrome on Windows" className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
                </div>
                <ErrorBox error={error} />
                <OkBox message={okMsg} />
                <GoldButton type="submit" disabled={busy || !key.trim()} className="flex w-full items-center justify-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  {busy ? "ACTIVATING…" : "ACTIVATE — UNLOCK TRADING"}
                </GoldButton>
              </form>
              <p className="text-center text-[10.5px] leading-relaxed" style={{ color: C.dim }}>
                Haven&apos;t purchased a key yet? <a href="/pricing" className="font-bold hover:underline" style={{ color: C.cyan }}>Choose your plan</a> — one-time payment, lifetime access.
              </p>
            </div>
          )}
        </GlassCard>

        {/* device usage */}
        {devices.length > 0 && (
          <GlassCard className="mt-5 p-6">
            <div className="mb-3 text-[9px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>YOUR ACTIVE DEVICES</div>
            <div className="space-y-2">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg px-3 py-2.5" style={{ background: A.white(0.03), border: `1px solid ${C.lineInner}` }}>
                  <div>
                    <div className="text-[12px] font-bold" style={{ color: C.txt }}>{d.deviceLabel}</div>
                    <div className="text-[9.5px]" style={{ color: C.dim }}>{d.licenseKeyMasked} · {d.planName} · since {new Date(d.activatedAt).toLocaleDateString()}</div>
                  </div>
                  <button onClick={() => void deactivate(d.id)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[9.5px] font-bold" style={{ border: `1px solid ${A.red(0.4)}`, color: C.red }}>
                    <Trash2 size={11} /> DEACTIVATE
                  </button>
                </div>
              ))}
            </div>
          </GlassCard>
        )}

        <CreatorLine className="mt-8" />
      </div>
    </main>
  );
}
