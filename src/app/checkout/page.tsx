"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /checkout · complete the one-time purchase
//  Online provider → secure redirect (Paystack/Flutterwave).
//  No provider configured → manual-payment instructions + live status
//  polling; the license appears after ADMIN verification (never from a
//  browser redirect).
// ══════════════════════════════════════════════════════════════════════════

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Copy, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { CommerceBackdrop, CreatorLine, ErrorBox, GlassCard, GoldButton, HaloMark, Wordmark } from "@/components/commerce/brand";

interface CheckoutState {
  reference: string;
  provider: string;
  redirectUrl: string | null;
  instructions: string;
  amountCents: number;
  currency: string;
  planName: string;
  warning?: string;
}

function money(cents: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "GHS" ? "GH₵" : currency + " ";
  return `${symbol}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function CheckoutInner() {
  const router = useRouter();
  const params = useSearchParams();
  const planCode = params.get("plan");
  const refParam = params.get("ref"); // return visit from a hosted provider checkout
  const [state, setState] = useState<CheckoutState | null>(null);
  const [status, setStatus] = useState<string>("PENDING");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCheckout = useCallback(async () => {
    if (!planCode) { router.replace("/pricing"); return; } // no plan chosen yet → pick one
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/commerce/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string } & CheckoutState;
      if (!j.ok) {
        if (r.status === 404) { router.replace("/pricing"); return; } // unknown/deactivated plan → choose again
        setError(j.error ?? "Could not start checkout.");
        if (r.status === 401) setTimeout(() => router.push("/login?next=/checkout?plan=" + planCode), 900);
        return;
      }
      // Fetch plan name for display
      const pr = await fetch("/api/commerce/plans", { cache: "no-store" });
      const pj = (await pr.json()) as { plans: { code: string; name: string }[] };
      const plan = pj.plans?.find((p) => p.code === planCode);
      setState({ ...j, planName: plan?.name ?? planCode ?? "" });
      setStatus("PENDING");
      if (j.redirectUrl) {
        // Online provider — go to the secure hosted checkout.
        window.location.href = j.redirectUrl;
        return;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [planCode, router]);

  useEffect(() => {
    if (refParam) return; // provider-return visit — the resume flow below owns it
    void startCheckout();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [startCheckout, refParam]);

  // Resume the EXISTING payment after the hosted provider redirect (?ref=…).
  // Never creates a second transaction — status polling (with provider
  // self-healing verification on the server) takes over from here.
  useEffect(() => {
    if (!refParam || planCode) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(`/api/commerce/payment-status?ref=${encodeURIComponent(refParam)}`, { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; status?: string; planName?: string; amountCents?: number; currency?: string; provider?: string; error?: string };
        if (cancelled) return;
        if (!j.ok) {
          setError(j.error ?? "Payment not found. Start again from the plans page.");
          return;
        }
        setState({
          reference: refParam,
          provider: j.provider ?? "MANUAL",
          redirectUrl: null,
          instructions: "",
          amountCents: j.amountCents ?? 0,
          currency: j.currency ?? "USD",
          planName: j.planName ?? "",
        });
        setStatus(j.status ?? "PENDING");
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refParam, planCode]);

  // Poll payment status while pending (manual verification or provider check).
  useEffect(() => {
    if (!state || status === "VERIFIED") return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/commerce/payment-status?ref=${encodeURIComponent(state.reference)}`, { cache: "no-store" });
        const j = (await r.json()) as { ok: boolean; status?: string };
        if (j.ok && j.status) setStatus(j.status);
      } catch {
        /* keep polling */
      }
    }, 8000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state, status]);

  if (status === "VERIFIED") {
    return (
      <GlassCard className="w-full max-w-[460px] p-8 text-center">
        <CheckCircle2 size={44} className="mx-auto mb-4" color={C.green} />
        <h1 className="text-[20px] font-extrabold" style={{ color: C.txt }}>Payment Verified!</h1>
        <p className="mb-6 mt-2 text-[12px] leading-relaxed" style={{ color: C.muted }}>
          Your <b style={{ color: C.goldHover }}>{state?.planName}</b> lifetime license has been issued. Activate it now to unlock your features.
        </p>
        <GoldButton onClick={() => router.push("/activate")}>ACTIVATE LICENSE</GoldButton>
        <div className="mt-3">
          <button onClick={() => router.push("/account")} className="text-[11px] font-semibold hover:underline" style={{ color: C.cyan }}>View my account</button>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="w-full max-w-[480px] p-7">
      <div className="mb-5 flex items-center gap-3">
        <HaloMark size={38} />
        <div>
          <Wordmark size={13} />
          <div className="mt-1 text-[8.5px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>SECURE CHECKOUT</div>
        </div>
      </div>

      {busy ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin" color={C.cyan} /></div>
      ) : error ? (
        <div className="space-y-4">
          <ErrorBox error={error} />
          <GoldButton onClick={() => void startCheckout()}>TRY AGAIN</GoldButton>
        </div>
      ) : state ? (
        <div className="space-y-5">
          <div className="rounded-xl p-4" style={{ background: A.white(0.03), border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-extrabold" style={{ color: C.txt }}>{state.planName} Plan</div>
                <div className="text-[10px]" style={{ color: C.muted }}>One-time payment · Lifetime license</div>
              </div>
              <div className="text-[20px] font-extrabold" style={{ color: C.goldHover }}>{money(state.amountCents, state.currency)}</div>
            </div>
            <p className="mt-2 text-[9.5px] leading-relaxed" style={{ color: C.dim }}>
              Lifetime licences grant access to the purchased software features under the applicable licence agreement. They do not guarantee unlimited free access to third-party services that may carry separate operating costs.
            </p>
          </div>

          {state.warning && (
            <div className="rounded-lg px-3 py-2.5 text-[11px] leading-snug" style={{ background: A.warn(0.1), color: C.warn, boxShadow: `inset 0 0 0 1px ${A.warn(0.4)}` }}>
              {state.warning}
            </div>
          )}

          {state.redirectUrl ? (
            <a href={state.redirectUrl} className="flex items-center justify-center gap-2 rounded-xl py-3.5 text-[11px] font-extrabold tracking-[0.2em]"
              style={{ background: `linear-gradient(135deg, #1E90FF, #2ECCFF)`, color: "#fff", boxShadow: `0 10px 30px ${A.blue(0.3)}` }}>
              <ExternalLink size={13} /> CONTINUE TO SECURE PAYMENT
            </a>
          ) : (
            <>
              {state.provider === "MANUAL" ? (
                <div className="rounded-xl p-4" style={{ background: A.cyan(0.05), border: `1px solid ${A.cyan(0.3)}` }}>
                  <div className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C.cyan }}>
                    <ShieldCheck size={13} /> MANUAL PAYMENT — VERIFIED BY AN ADMINISTRATOR
                  </div>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: C.txt2 }}>{state.instructions}</p>
                </div>
              ) : (
                <div className="rounded-xl p-4" style={{ background: A.blue(0.06), border: `1px solid ${A.blue(0.3)}` }}>
                  <div className="mb-1.5 flex items-center gap-2 text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C.cyan }}>
                    <ShieldCheck size={13} /> {state.provider} PAYMENT — VERIFYING
                  </div>
                  <p className="text-[11.5px] leading-relaxed" style={{ color: C.txt2 }}>
                    This page updates automatically as soon as your {state.provider} payment is confirmed.
                  </p>
                </div>
              )}

              <div className="rounded-xl p-4" style={{ background: A.white(0.03), border: `1px solid ${C.line}` }}>
                <div className="mb-1 text-[9px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>YOUR PAYMENT REFERENCE</div>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-[12.5px] tracking-wider" style={{ color: C.ice }}>{state.reference}</code>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(state.reference);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[9.5px] font-bold"
                    style={{ border: `1px solid ${C.line2}`, color: copied ? C.green : C.txt2 }}
                  >
                    <Copy size={11} /> {copied ? "COPIED" : "COPY"}
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-relaxed" style={{ color: C.dim }}>
                  Quote this reference with your payment. Once the administrator verifies it, your license is issued automatically — this page updates by itself.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: C.muted }}>
                <Loader2 size={12} className="animate-spin" /> Waiting for payment verification…
              </div>
            </>
          )}
        </div>
      ) : null}
    </GlassCard>
  );
}

export default function CheckoutPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <CommerceBackdrop />
      <div className="relative z-10 flex w-full flex-col items-center">
        <Suspense fallback={<div className="h-80 w-full max-w-[480px] animate-pulse rounded-2xl" style={{ background: "#041428" }} />}>
          <CheckoutInner />
        </Suspense>
        <CreatorLine className="mt-8" />
      </div>
    </main>
  );
}
