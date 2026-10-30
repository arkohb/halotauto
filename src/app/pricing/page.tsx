"use client";

// ══════════════════════════════════════════════════════════════════════════
//  /pricing · "CHOOSE YOUR PLAN" — one-time payment · lifetime access
//  Matches the concept mockup: 4 cards, Pro highlighted gold "Most
//  Popular", cyan Get Started CTAs, bottom trust strip.
// ══════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { FEATURE_LABEL } from "@/lib/commerce/constants";
import { CommerceBackdrop, CreatorLine, HaloMark, Wordmark } from "@/components/commerce/brand";

interface Plan {
  id: string;
  code: string;
  name: string;
  tagline: string;
  description: string;
  priceCents: number;
  promoPriceCents: number | null;
  currency: string;
  deviceLimit: number;
  icon: string;
  features: string[];
}

const ICONS: Record<string, string> = {
  shield: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z",
  crown: "M3 17h18M4 17 3 7l5 4 4-7 4 7 5-4-1 10M9 21h6",
  gem: "M6 3h12l4 6-10 12L2 9l4-6Zm-4 6h20M9 3l3 6 3-6M12 9v12",
  infinity: "M6.5 15.5C4.6 15.5 3 13.9 3 12s1.6-3.5 3.5-3.5c3.5 0 7.5 7 11 7 1.9 0 3.5-1.6 3.5-3.5S19.4 8.5 17.5 8.5c-3.5 0-7.5 7-11 7Z",
};

function money(cents: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "GHS" ? "GH₵" : currency + " ";
  return `${symbol}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
}

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [me, setMe] = useState<{ authenticated: boolean; user?: { role: string; status: string } } | null>(null);

  useEffect(() => {
    fetch("/api/commerce/plans", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      setPlans(j.plans ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((j) => setMe(j)).catch(() => setMe({ authenticated: false }));
  }, []);

  const start = async (planCode: string) => {
    if (!me?.authenticated) {
      router.push(`/register?plan=${planCode}`);
      return;
    }
    setStarting(planCode);
    router.push(`/checkout?plan=${planCode}`);
  };

  return (
    <main className="relative min-h-screen">
      <CommerceBackdrop />
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-12">
        {/* header */}
        <div className="mb-10 flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-3">
            <HaloMark size={40} />
            <div>
              <Wordmark size={14} />
              <div className="mt-1 text-[9px] font-bold tracking-[0.28em]" style={{ color: C.muted }}>CHOOSE YOUR PLAN</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href="/login" className="rounded-lg px-4 py-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ border: `1px solid ${C.line2}`, color: C.txt2 }}>SIGN IN</a>
          </div>
        </div>

        <div className="mb-2 text-center">
          <h1 className="text-[26px] font-extrabold tracking-tight sm:text-[32px]" style={{ color: C.txt }}>
            CHOOSE <span style={{ color: C.gold }}>YOUR PLAN</span>
          </h1>
          <p className="mt-2 text-[13px]" style={{ color: C.muted }}>One-time payment. Lifetime access. No monthly fees.</p>
          <p className="mx-auto mt-2 max-w-2xl text-[10.5px] leading-relaxed" style={{ color: C.dim }}>
            Lifetime licences grant access to the purchased software features under the applicable licence agreement. They do not guarantee unlimited free access to third-party services that may carry separate operating costs.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5" style={{ border: `1px solid ${A.gold(0.5)}`, background: A.gold(0.08) }}>
            <span className="text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C.goldHover }}>ONE-TIME PAYMENT</span>
            <span className="text-[10px]" style={{ color: C.dim }}>|</span>
            <span className="text-[10px] font-semibold tracking-[0.14em]" style={{ color: C.muted }}>NO SUBSCRIPTION</span>
          </div>
        </div>

        {/* plan cards */}
        {loading ? (
          <div className="mt-10 flex justify-center"><Loader2 className="animate-spin" color={C.cyan} /></div>
        ) : (
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => {
              const isPro = p.code === "PRO";
              const featured = isPro; // "Most Popular" per mockup
              const price = p.promoPriceCents ?? p.priceCents;
              return (
                <div
                  key={p.id}
                  className="relative flex flex-col rounded-2xl p-6 transition-transform duration-200"
                  style={{
                    background: `linear-gradient(170deg, ${featured ? "#07203F" : "#041428"} 0%, #021229 100%)`,
                    border: `1px solid ${featured ? A.gold(0.65) : C.line}`,
                    boxShadow: featured ? `0 22px 70px ${A.gold(0.14)}, inset 0 1px 0 ${A.gold(0.3)}` : `0 18px 50px ${A.blue(0.1)}`,
                  }}
                >
                  {featured && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[8.5px] font-extrabold tracking-[0.18em]"
                      style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.goldHover})`, color: "#1A1205" }}>
                      MOST POPULAR
                    </div>
                  )}
                  <div className="mb-4 flex flex-col items-center gap-2 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full"
                      style={{ background: featured ? A.gold(0.12) : A.cyan(0.1), boxShadow: `inset 0 0 0 1.5px ${featured ? A.gold(0.6) : A.cyan(0.5)}` }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={featured ? C.gold : C.cyan} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d={ICONS[p.icon] ?? ICONS.shield} />
                      </svg>
                    </div>
                    <div className="text-[15px] font-extrabold tracking-[0.2em]" style={{ color: featured ? C.goldHover : C.cyan }}>{p.name.toUpperCase()}</div>
                    <div className="text-[9px] font-semibold tracking-[0.08em]" style={{ color: C.muted }}>{p.tagline}</div>
                  </div>
                  <div className="mb-1 text-center text-[30px] font-extrabold" style={{ color: C.txt }}>{money(price, p.currency)}</div>
                  <div className="mb-5 text-center text-[9.5px] font-bold tracking-[0.16em]" style={{ color: C.muted }}>ONE-TIME PAYMENT</div>

                  <ul className="mb-6 flex-1 space-y-2.5">
                    {p.features.slice(0, 7).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[11px] leading-snug" style={{ color: C.txt2 }}>
                        <Check size={12} className="mt-0.5 shrink-0" color={featured ? C.gold : C.teal} />
                        {FEATURE_LABEL[f] ?? f}
                      </li>
                    ))}
                    {p.features.length > 7 && (
                      <li className="pl-5 text-[10px] font-semibold" style={{ color: C.dim }}>+ {p.features.length - 7} more features</li>
                    )}
                  </ul>

                  <button
                    onClick={() => void start(p.code)}
                    disabled={starting !== null}
                    className="w-full rounded-xl py-3 text-[10.5px] font-extrabold tracking-[0.2em] transition-all hover:brightness-110 disabled:opacity-50"
                    style={
                      featured
                        ? { background: `linear-gradient(135deg, ${C.gold}, ${C.goldHover})`, color: "#1A1205", boxShadow: `0 10px 30px ${A.gold(0.3)}` }
                        : { border: `1px solid ${A.cyan(0.6)}`, color: C.cyan, background: A.cyan(0.06) }
                    }
                  >
                    {starting === p.code ? <Loader2 size={13} className="mx-auto animate-spin" /> : "Get Started"}
                  </button>
                  <div className="mt-3 text-center text-[9px]" style={{ color: C.dim }}>
                    {p.deviceLimit} active {p.deviceLimit === 1 ? "device" : "devices"} included
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* trust strip */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Lifetime Access", d: "One-time payment, forever.", dPath: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" },
            { t: "Secure & Encrypted", d: "Your data is protected.", dPath: "M6 10V8a6 6 0 0 1 12 0v2m-13 0h14v11H5V10Z" },
            { t: "Instant Activation", d: "Get started in minutes.", dPath: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z" },
            { t: "30-Day Guarantee", d: "Full refund if not satisfied.", dPath: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5" },
          ].map((x) => (
            <div key={x.t} className="flex items-center gap-3 rounded-xl px-4 py-3.5" style={{ background: A.white(0.03), border: `1px solid ${C.line}` }}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: A.cyan(0.1), boxShadow: `inset 0 0 0 1px ${A.cyan(0.45)}` }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.cyan} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={x.dPath} /></svg>
              </div>
              <div>
                <div className="text-[11px] font-extrabold" style={{ color: C.txt }}>{x.t}</div>
                <div className="text-[9.5px]" style={{ color: C.muted }}>{x.d}</div>
              </div>
            </div>
          ))}
        </div>

        {/* disclosure + footer */}
        <div className="mx-auto mt-10 max-w-3xl rounded-xl p-5 text-[10.5px] leading-relaxed" style={{ background: A.white(0.02), border: `1px solid ${C.line}`, color: C.muted }}>
          <b style={{ color: C.txt3 }}>Lifetime software license — what it covers.</b> Your one-time payment is a lifetime license to the HALO 3EL Autotrader software features included in your purchased plan. Third-party operating costs — premium market-data feeds, AI API usage, broker services, VPS hosting — are separate and may change with their providers; any such charges are always disclosed before purchase. No compulsory monthly subscription and no automatic recurring software billing.
        </div>

        <CreatorLine className="mt-8" />
      </div>
    </main>
  );
}
