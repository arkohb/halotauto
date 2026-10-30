"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /forgot-password · request a secure password-reset link
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";
import { CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, GlassCard, GoldButton, HaloMark, OkBox, Wordmark, inputStyle } from "@/components/commerce/brand";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; message?: string };
      if (!j.ok) setError(j.error ?? "Request failed.");
      else setOkMsg(j.message ?? "Check your inbox.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [email]);

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <CommerceBackdrop />
      <div className="relative z-10 flex w-full flex-col items-center">
        <GlassCard className="w-full max-w-[400px] p-7">
          <div className="mb-5 flex items-center gap-3">
            <HaloMark size={38} />
            <Wordmark size={13} />
          </div>
          <h1 className="text-[20px] font-extrabold" style={{ color: C.txt }}>Forgot Password</h1>
          <p className="mb-5 text-[11.5px] leading-relaxed" style={{ color: C.muted }}>
            Enter the e-mail on your account and we&apos;ll send a secure reset link (valid for 1 hour).
          </p>
          <form onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }} className="space-y-4">
            <div>
              <FieldLabel>EMAIL ADDRESS</FieldLabel>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@email.com" className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
            </div>
            <ErrorBox error={error} />
            <OkBox message={okMsg} />
            <GoldButton type="submit" disabled={busy || !email.trim()} className="flex w-full items-center justify-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {busy ? "SENDING…" : "Send Reset Link"}
            </GoldButton>
            <p className="text-center text-[11.5px]" style={{ color: C.muted }}>
              Remembered it? <a href="/login" className="font-bold hover:underline" style={{ color: C.goldHover }}>Sign In</a>
            </p>
          </form>
        </GlassCard>
        <CreatorLine className="mt-8" />
      </div>
    </main>
  );
}
