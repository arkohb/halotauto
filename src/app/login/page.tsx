"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /login · "Welcome Back" — premium customer sign-in (concept mockup)
//  Email/username + password · show/hide · Remember me · Forgot password ·
//  gold Sign In · Create Account · trust row · creator attribution.
// ══════════════════════════════════════════════════════════════════════════

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import {
  AuthHero, CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, GlassCard,
  GoldButton, HaloMark, TrustRow, Wordmark, inputStyle,
} from "@/components/commerce/brand";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const verified = params.get("verified");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Already signed in? Route to the right home.
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.authenticated) router.replace(j.user?.role?.startsWith("SUPER") || ["SUPER_ADMIN", "LICENSE_ADMIN", "SUPPORT_ADMIN"].includes(j.user?.role) ? "/admin" : "/account");
      })
      .catch(() => {});
  }, [router]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, remember }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; redirect?: string };
      if (!j.ok) {
        setError(j.error ?? "Sign-in failed.");
        return;
      }
      router.replace(next || j.redirect || "/account");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [identifier, password, remember, next, router]);

  return (
    <GlassCard className="w-full max-w-[400px] p-7">
      <div className="mb-5 flex items-center gap-3">
        <HaloMark size={38} />
        <div>
          <Wordmark size={13} />
          <div className="mt-1 text-[8.5px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>
            TRADE SMARTER · TRADE SAFER · TRADE WITH AI
          </div>
        </div>
      </div>

      <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: C.txt }}>Welcome Back</h1>
      <p className="mb-5 text-[11px]" style={{ color: C.muted }}>Your AI Trading Command Centre</p>

      {verified === "1" && (
        <div className="mb-4 rounded-lg px-3 py-2.5 text-[11.5px] leading-snug" style={{ background: A.green(0.1), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.35)}` }}>
          E-mail verified — sign in to continue.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit();
        }}
      >
        <FieldLabel>EMAIL OR USERNAME</FieldLabel>
        <div className="relative mb-4">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>
          </span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Email or Username"
            autoComplete="username"
            className="w-full rounded-lg py-2.5 pl-9 pr-3 text-[13px] outline-none transition-colors focus:border-[#2ECCFF]"
            style={inputStyle}
          />
        </div>

        <FieldLabel>PASSWORD</FieldLabel>
        <div className="relative mb-4">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.dim} strokeWidth="2"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          </span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            className="w-full rounded-lg py-2.5 pl-9 pr-10 text-[13px] outline-none transition-colors focus:border-[#2ECCFF]"
            style={inputStyle}
          />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100">
            {showPw ? <EyeOff size={14} color={C.muted} /> : <Eye size={14} color={C.muted} />}
          </button>
        </div>

        <div className="mb-5 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: C.txt2 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-3.5 w-3.5 accent-[#2ECCFF]" />
            Remember me
          </label>
          <a href="/forgot-password" className="text-[11px] font-semibold hover:underline" style={{ color: C.cyan }}>Forgot password?</a>
        </div>

        <div className="space-y-3">
          <ErrorBox error={error} />
          <GoldButton type="submit" disabled={busy || !identifier.trim() || !password} className="flex w-full items-center justify-center gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {busy ? "SIGNING IN…" : "Sign In"}
          </GoldButton>
        </div>
      </form>

      <p className="mt-5 text-center text-[11.5px]" style={{ color: C.muted }}>
        Don&apos;t have an account?{" "}
        <a href="/register" className="font-bold hover:underline" style={{ color: C.goldHover }}>Get Started</a>
      </p>

      <div className="mt-6 border-t pt-5" style={{ borderColor: C.lineInner }}>
        <TrustRow />
      </div>
    </GlassCard>
  );
}

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen">
      <CommerceBackdrop />
      <div className="relative z-10 grid w-full lg:grid-cols-[1.1fr_1fr]">
        <AuthHero />
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
          <Suspense fallback={<div className="h-96 w-full max-w-[400px] animate-pulse rounded-2xl" style={{ background: C.navy2 }} />}>
            <LoginForm />
          </Suspense>
          <CreatorLine className="mt-8" />
        </div>
      </div>
    </main>
  );
}
