"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /register · customer account creation
//  Full name · e-mail · username · password + confirmation · country ·
//  T&C + Software License Agreement acceptance (both mandatory).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { C } from "@/lib/halo/ui-helpers";
import {
  AuthHero, CommerceBackdrop, CreatorLine, ErrorBox, FieldLabel, GlassCard,
  GoldButton, HaloMark, OkBox, TrustRow, Wordmark, inputStyle,
} from "@/components/commerce/brand";

const COUNTRIES = [
  "Ghana", "Nigeria", "Kenya", "South Africa", "United Kingdom", "United States", "Canada", "Germany",
  "Netherlands", "France", "United Arab Emirates", "Saudi Arabia", "Singapore", "Australia", "Other",
];

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [country, setCountry] = useState("Ghana");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptLicense, setAcceptLicense] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, username, password, confirmPassword, country, acceptTerms, acceptLicense }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; message?: string };
      if (!j.ok) {
        setError(j.error ?? "Registration failed.");
        return;
      }
      setDone(true);
      setOkMsg(j.message ?? "Account created.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [fullName, email, username, password, confirmPassword, country, acceptTerms, acceptLicense]);

  return (
    <main className="relative flex min-h-screen">
      <CommerceBackdrop />
      <div className="relative z-10 grid w-full lg:grid-cols-[1.1fr_1fr]">
        <AuthHero />
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
          <GlassCard className="w-full max-w-[430px] p-7">
            <div className="mb-5 flex items-center gap-3">
              <HaloMark size={38} />
              <div>
                <Wordmark size={13} />
                <div className="mt-1 text-[8.5px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>CREATE YOUR ACCOUNT</div>
              </div>
            </div>

            {done ? (
              <div className="space-y-4">
                <h1 className="text-[20px] font-extrabold" style={{ color: C.txt }}>Almost there!</h1>
                <OkBox message={okMsg} />
                <p className="text-[11.5px] leading-relaxed" style={{ color: C.muted }}>
                  Next: choose your plan on the pricing page, complete the one-time payment, and your lifetime license is issued automatically after verification.
                </p>
                <div className="flex gap-3">
                  <GoldButton onClick={() => router.push("/pricing")}>VIEW PLANS</GoldButton>
                  <button
                    onClick={() => router.push("/login")}
                    className="rounded-xl px-5 text-[11px] font-extrabold tracking-[0.2em]"
                    style={{ border: `1px solid ${C.line2}`, color: C.txt2, padding: "13px 22px" }}
                  >
                    SIGN IN
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void submit();
                }}
                className="space-y-3.5"
              >
                <h1 className="text-[20px] font-extrabold tracking-tight" style={{ color: C.txt }}>Create Account</h1>
                <p className="mb-1 text-[11px]" style={{ color: C.muted }}>One-time payment. Lifetime access. No monthly fees.</p>

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <FieldLabel>FULL NAME</FieldLabel>
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Kwame Mensah" className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
                  </div>
                  <div>
                    <FieldLabel>USERNAME (OPTIONAL)</FieldLabel>
                    <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. kwame_fx" className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
                  </div>
                </div>

                <FieldLabel>EMAIL ADDRESS</FieldLabel>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@email.com" className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="relative">
                    <FieldLabel>PASSWORD</FieldLabel>
                    <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"} placeholder="Min. 8 chars, letter + number" className="w-full rounded-lg px-3 py-2.5 pr-9 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
                    <button type="button" onClick={() => setShowPw((v) => !v)} aria-label="Toggle password visibility" className="absolute right-3 top-[26px] opacity-70 hover:opacity-100">
                      {showPw ? <EyeOff size={13} color={C.muted} /> : <Eye size={13} color={C.muted} />}
                    </button>
                  </div>
                  <div>
                    <FieldLabel>CONFIRM PASSWORD</FieldLabel>
                    <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type={showPw ? "text" : "password"} placeholder="Repeat password" className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle} />
                  </div>
                </div>

                <FieldLabel>COUNTRY</FieldLabel>
                <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-[13px] outline-none focus:border-[#2ECCFF]" style={inputStyle}>
                  {COUNTRIES.map((c) => <option key={c} value={c} style={{ background: "#041428" }}>{c}</option>)}
                </select>

                <div className="space-y-2 pt-1 text-[11px] leading-snug" style={{ color: C.txt2 }}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[#2ECCFF]" />
                    <span>I accept the <b style={{ color: C.txt3 }}>Terms &amp; Conditions</b>.</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" checked={acceptLicense} onChange={(e) => setAcceptLicense(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[#2ECCFF]" />
                    <span>I accept the <b style={{ color: C.txt3 }}>Software License Agreement</b> (one-time payment, lifetime license, plan-based features).</span>
                  </label>
                </div>

                <ErrorBox error={error} />
                <GoldButton type="submit" disabled={busy || !fullName || !email || !password || !acceptTerms || !acceptLicense} className="flex w-full items-center justify-center gap-2">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  {busy ? "CREATING ACCOUNT…" : "Create Account"}
                </GoldButton>
                <p className="text-center text-[11.5px]" style={{ color: C.muted }}>
                  Already have an account? <a href="/login" className="font-bold hover:underline" style={{ color: C.goldHover }}>Sign In</a>
                </p>
              </form>
            )}
          </GlassCard>
          <CreatorLine className="mt-8" />
        </div>
      </div>
    </main>
  );
}
