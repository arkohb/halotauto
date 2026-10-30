"use client";

// ══════════════════════════════════════════════════════════════════════════
//  AUTH GATE · commercial-mode access overlay for the trading app
//
//  OWNER MODE (HALO_COMMERCE unset) → renders nothing; the app behaves
//  exactly as it always has for the owner's own installation.
//
//  COMMERCIAL MODE (HALO_COMMERCE=on):
//   · signed out            → premium sign-in / create-account overlay
//   · account without a
//     valid license         → license activation overlay (device-bound),
//                             with precise server reasons (suspended /
//                             revoked / expired / not activated / none)
//   · valid license         → renders nothing; the dashboard is fully live
//
//  License validity is ALWAYS established server-side (/api/auth/me →
//  licenseStatus()); browser storage is never trusted. This gate guards UI
//  access only — consequential trading endpoints enforce the same rules
//  server-side, and NOTHING here touches open MT5 positions or protective
//  SL/TP management.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import {
  CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, HaloMark, TrustRow, Wordmark, inputStyle,
} from "@/components/commerce/brand";

type Me = {
  ok: boolean;
  commerce: boolean;
  authenticated: boolean;
  activated: boolean;
  mode: "owner" | "licensed" | "unactivated";
  user: { fullName: string; email: string; role: string } | null;
  license: { keyMasked?: string; planName: string; planCode: string } | null;
  reason: string;
};

export function AuthGate() {
  const [me, setMe] = useState<Me | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      const j = (await r.json()) as Me;
      setMe(j);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const deviceToken = (): string => {
    const k = "halo-device-token";
    let t = localStorage.getItem(k);
    if (!t) { t = crypto.randomUUID().replaceAll("-", "").slice(0, 32); localStorage.setItem(k, t); }
    return t;
  };

  const activate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, deviceToken: deviceToken(), deviceLabel: (typeof navigator !== "undefined" && navigator.platform) || "Web device" }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (j.ok) {
        setOkMsg("License activated on this device — unlocking your command centre…");
        await load();
      } else setError(j.error ?? "Activation failed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [key, load]);

  // owner mode · still loading · fully licensed → no overlay at all
  if (!me || !me.commerce || me.activated) return null;

  const signedInAs = me.user ? me.user.fullName || me.user.email : "";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-[#020B1A]/97 px-4 py-8 backdrop-blur-sm">
      <CommerceBackdrop />
      <div className="relative z-10 w-full max-w-md">
        <div
          className="rounded-2xl p-7"
          style={{ background: "linear-gradient(165deg, #041428 0%, #021229 100%)", border: `1px solid ${C.line}`, boxShadow: `0 24px 80px 0 ${A.blue(0.18)}` }}
        >
          <div className="mb-5 flex items-center gap-3">
            <HaloMark size={38} />
            <div>
              <Wordmark size={13} />
              <div className="mt-1 text-[8.5px] font-bold tracking-[0.26em]" style={{ color: C.muted }}>
                TRADE SMARTER · TRADE SAFER · TRADE WITH AI
              </div>
            </div>
          </div>

          {!me.authenticated ? (
            /* ── signed out ─────────────────────────────────────────── */
            <div>
              <h1 className="text-[20px] font-extrabold tracking-tight" style={{ color: C.txt }}>Welcome to HALO 3EL Autotrader</h1>
              <p className="mb-5 mt-1.5 text-[11.5px] leading-relaxed" style={{ color: C.muted }}>
                Your AI trading command centre. Sign in with your HALO account — or choose a one-time plan to get a lifetime license.
              </p>
              <div className="space-y-3">
                <a href="/login?next=/" className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-extrabold tracking-[0.2em] transition-all hover:brightness-110"
                  style={{ background: `linear-gradient(135deg, #E9B94E 0%, #F5CD6B 100%)`, color: "#1A1205", boxShadow: `0 8px 28px rgba(233,185,78,0.28)` }}>
                  <UserRound size={13} />SIGN IN TO CONTINUE
                </a>
                <div className="grid grid-cols-2 gap-2">
                  <a href="/register" className="rounded-xl py-2.5 text-center text-[10px] font-extrabold tracking-[0.16em]" style={{ background: A.cyan(0.1), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.35)}` }}>CREATE ACCOUNT</a>
                  <a href="/pricing" className="rounded-xl py-2.5 text-center text-[10px] font-extrabold tracking-[0.16em]" style={{ background: A.gold(0.1), color: C.goldHover, boxShadow: `inset 0 0 0 1px ${A.gold(0.35)}` }}>VIEW PLANS</a>
                </div>
              </div>
              <div className="mt-6 border-t pt-5" style={{ borderColor: C.lineInner }}>
                <TrustRow />
              </div>
            </div>
          ) : (
            /* ── signed in, license missing / not activated ─────────── */
            <div>
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: A.gold(0.12), boxShadow: `inset 0 0 0 1px ${A.gold(0.4)}` }}>
                  <KeyRound size={18} style={{ color: C.gold }} />
                </div>
                <div>
                  <div className="text-[15px] font-extrabold tracking-[0.14em]" style={{ color: C.txt }}>ACTIVATE HALO</div>
                  <div className="text-[9px] font-semibold tracking-[0.14em]" style={{ color: C.label }}>ONE-TIME PAYMENT · LIFETIME LICENSE</div>
                </div>
              </div>

              <p className="mb-4 text-[11.5px] leading-relaxed" style={{ color: C.muted }}>
                {me.reason === "No license found for this account." ? (
                  <>You&apos;re signed in as <span className="font-bold" style={{ color: C.txt2 }}>{signedInAs}</span> but this account has no license yet. Enter the key you received after purchase, or view the plans to get one.</>
                ) : (
                  <>Signed in as <span className="font-bold" style={{ color: C.txt2 }}>{signedInAs}</span> — {me.reason} Enter your license key to activate this device.</>
                )}
              </p>

              {me.reason === "License suspended — contact support." || me.reason === "License revoked." ? (
                <div className="mb-4 rounded-lg px-3 py-2.5 text-[11.5px] leading-snug" style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>
                  {me.reason} Premium access is restricted until the license is restored. Your broker-side position protection is never affected.
                </div>
              ) : null}

              <FieldLabel>LICENSE KEY</FieldLabel>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="HALO-XXXX-XXXX-XXXX-XXXX"
                spellCheck={false}
                className="mb-4 w-full rounded-lg px-3 py-2.5 font-mono text-[13px] tracking-wider outline-none transition-colors"
                style={inputStyle}
              />

              <ErrorBox error={error} />
              {okMsg ? (
                <div className="mb-4 rounded-lg px-3 py-2.5 text-[11.5px]" style={{ background: A.green(0.1), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.35)}` }}>{okMsg}</div>
              ) : null}

              <button
                type="button"
                onClick={() => void activate()}
                disabled={busy || !key.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-extrabold tracking-[0.2em] transition-all hover:brightness-110 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`, color: "#FFFFFF" }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                {busy ? "ACTIVATING…" : "ACTIVATE — UNLOCK TRADING"}
              </button>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                {me.reason === "No license found for this account." ? (
                  <a href="/pricing" className="font-bold hover:underline" style={{ color: C.goldHover }}>No key yet? View plans →</a>
                ) : (
                  <a href="/account" className="font-bold hover:underline" style={{ color: C.cyan }}>Account & devices →</a>
                )}
                <button type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); await load(); }}
                  className="inline-flex items-center gap-1.5 font-bold hover:underline" style={{ color: C.muted }}>
                  <LogOut size={11} />Sign out
                </button>
              </div>
            </div>
          )}
        </div>
        <CreatorLine className="mt-5" />
      </div>
    </div>
  );
}
