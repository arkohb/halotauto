"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /reset-password · complete a password reset with the e-mailed token
// ══════════════════════════════════════════════════════════════════════════

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";
import { CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, GlassCard, GoldButton, HaloMark, OkBox, Wordmark, inputStyle } from "@/components/commerce/brand";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; message?: string };
      if (!j.ok) setError(j.error ?? "Reset failed.");
      else {
        setOkMsg(j.message ?? "Password updated.");
        setTimeout(() => router.push("/login"), 1600);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token, password, confirmPassword, router]);

  return (
    <GlassCard className="w-full max-w-[400px] p-7">
      <div className="mb-5 flex items-center gap-3">
        <HaloMark size={38} />
        <Wordmark size={13} />
      </div>
      <h1 className="text-[20px] font-extrabold" style={{ color: C.txt }}>Set a New Password</h1>
      <p className="mb-5 text-[11.5px]" style={{ color: C.muted }}>Choose a strong password — at least 8 characters with a letter and a number.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }} className="space-y-4">
        <div className="relative">
          <FieldLabel>NEW PASSWORD</FieldLabel>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"} className="w-full rounded-lg px-3 py-2.5 pr-9 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility" className="absolute right-3 top-[26px] opacity-70 hover:opacity-100">
            {showPw ? <EyeOff size={13} color={C.muted} /> : <Eye size={13} color={C.muted} />}
          </button>
        </div>
        <div>
          <FieldLabel>CONFIRM NEW PASSWORD</FieldLabel>
          <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type={showPw ? "text" : "password"} className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
        </div>
        <ErrorBox error={error} />
        <OkBox message={okMsg} />
        <GoldButton type="submit" disabled={busy || !password || !confirmPassword} className="flex w-full items-center justify-center gap-2">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? "UPDATING…" : "Update Password"}
        </GoldButton>
      </form>
    </GlassCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <CommerceBackdrop />
      <div className="relative z-10 flex w-full flex-col items-center">
        <Suspense fallback={<div className="h-80 w-full max-w-[400px] animate-pulse rounded-2xl" style={{ background: "#041428" }} />}>
          <ResetForm />
        </Suspense>
        <CreatorLine className="mt-8" />
      </div>
    </main>
  );
}
