"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN · LICENSE GENERATION — dedicated generation interface (concept
//  mockup: plan / license type / customer / features / expiry). The full key
//  is shown EXACTLY ONCE in the preview panel with copy + download. Paid
//  generation needs a payment reference; complimentary is SUPER_ADMIN-only
//  with a mandatory reason. RBAC is enforced server-side.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { CREATOR_LINE } from "@/lib/commerce/constants";
import { ActBtn, api, KV, Note, SectionHead } from "./kit";

interface PlanRow { id: string; code: string; name: string; priceCents: number; currency: string; deviceLimit: number; active?: boolean; }
interface GenResult {
  id: string; key: string; planCode: string; planName: string; deviceLimit: number;
  kind: string; isComplimentary: boolean; expiresAt: string | null; lifetime: boolean;
  customerEmail: string; emailed: boolean;
}

const fieldLabel = "mb-1.5 block text-[9px] font-extrabold tracking-[0.18em]";
const fieldCss: React.CSSProperties = { background: "#000714", border: "1px solid #1C4478", color: "#EAF3FF" };

export function AdminGenerate({ onChanged }: { onChanged?: () => void }) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [kind, setKind] = useState<"SINGLE_USER" | "MULTI_USER">("SINGLE_USER");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [lifetime, setLifetime] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");
  const [deviceLimit, setDeviceLimit] = useState(0); // 0 = plan default
  const [complimentary, setComplimentary] = useState(false);
  const [compReason, setCompReason] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [result, setResult] = useState<GenResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api<{ plans: PlanRow[] }>("/api/commerce/plans").then((j) => {
      if (j.ok) {
        // the public endpoint already returns only active plans
        setPlans(j.plans);
        if (j.plans[0]) setPlanCode(j.plans[0].code);
      }
    }).catch(() => {});
  }, []);

  const plan = plans.find((p) => p.code === planCode) ?? null;

  const generate = useCallback(async () => {
    setBusy(true);
    setNote(null);
    setResult(null);
    const j = await api<{ license: GenResult }>("/api/admin/licenses/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planCode, kind, customerName, customerEmail, lifetime,
        expiresAt: lifetime ? undefined : expiresAt || undefined,
        deviceLimit: deviceLimit > 0 ? deviceLimit : undefined,
        complimentary, compReason, paymentReference, notes, sendEmail,
      }),
    });
    setBusy(false);
    if (j.ok) {
      setResult(j.license ?? null);
      setNote({ text: "License generated. The key is shown once — copy or download it now." });
      onChanged?.();
    } else {
      setNote({ text: j.error ?? "Generation failed.", bad: true });
    }
  }, [planCode, kind, customerName, customerEmail, lifetime, expiresAt, deviceLimit, complimentary, compReason, paymentReference, notes, sendEmail, onChanged]);

  const download = () => {
    if (!result) return;
    const cert = [
      "════════════════════════════════════════════════════",
      "  HALO 3EL AUTOTRADER — SOFTWARE LICENSE CERTIFICATE",
      "════════════════════════════════════════════════════",
      "",
      `License Key    : ${result.key}`,
      `Plan           : ${result.planName} (${result.planCode})`,
      `Type           : ${result.kind === "MULTI_USER" ? "Multi-user" : "Single-user"}`,
      `Term           : ${result.lifetime ? "LIFETIME" : `Expires ${result.expiresAt ?? "—"}`}`,
      `Device Allowance: ${result.deviceLimit}`,
      `Issued To      : ${result.customerEmail || "bind-on-activation"}`,
      `Complimentary  : ${result.isComplimentary ? "YES — not a paid transaction" : "No"}`,
      "",
      "Activation: sign in at /login → open License Activation → enter this key.",
      "",
      CREATOR_LINE,
    ].join("\n");
    const blob = new Blob([cert], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `HALO-license-${result.key.slice(5, 9)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <SectionHead title="Generate License" sub="Issue a new lifetime (or custom-expiry) license — keys are CSPRNG-generated on the trusted backend" />
      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        {/* form */}
        <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
          <div className={fieldLabel} style={{ color: C.label }}>PLAN</div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {plans.map((p) => (
              <button key={p.code} type="button" onClick={() => setPlanCode(p.code)}
                className="rounded-lg px-2 py-2.5 text-center transition-all"
                style={p.code === planCode
                  ? { background: A.gold(0.12), boxShadow: `inset 0 0 0 1px ${A.gold(0.5)}`, color: C.goldHover }
                  : { background: A.white(0.04), boxShadow: `inset 0 0 0 1px ${A.white(0.1)}`, color: C.txt2 }}>
                <div className="text-[11px] font-extrabold tracking-[0.08em]">{p.name}</div>
                <div className="mt-0.5 text-[9.5px] opacity-75">{(p.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: p.currency, maximumFractionDigits: 0 })}</div>
              </button>
            ))}
          </div>

          <div className={fieldLabel} style={{ color: C.label }}>LICENSE TYPE</div>
          <div className="mb-4 grid grid-cols-2 gap-2">
            {(["SINGLE_USER", "MULTI_USER"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className="rounded-lg px-2 py-2 text-[10.5px] font-extrabold tracking-[0.08em] transition-all"
                style={k === kind
                  ? { background: A.cyan(0.12), boxShadow: `inset 0 0 0 1px ${A.cyan(0.45)}`, color: C.cyan }
                  : { background: A.white(0.04), boxShadow: `inset 0 0 0 1px ${A.white(0.1)}`, color: C.txt2 }}>
                {k === "SINGLE_USER" ? "Single-user" : "Multi-user (5 seats)"}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className={fieldLabel} style={{ color: C.label }}>CUSTOMER NAME (OPTIONAL)</div>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Bind on activation if empty" className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
            </div>
            <div>
              <div className={fieldLabel} style={{ color: C.label }}>CUSTOMER E-MAIL (OPTIONAL)</div>
              <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="trader@email.com" className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className={fieldLabel} style={{ color: C.label }}>TERM</div>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: C.txt2 }}>
                  <input type="radio" checked={lifetime} onChange={() => setLifetime(true)} className="accent-[#2ECCFF]" /> Lifetime
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: C.txt2 }}>
                  <input type="radio" checked={!lifetime} onChange={() => setLifetime(false)} className="accent-[#2ECCFF]" /> Custom expiry
                </label>
              </div>
              {!lifetime && <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-2 w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />}
            </div>
            <div>
              <div className={fieldLabel} style={{ color: C.label }}>DEVICE ALLOWANCE</div>
              <select value={deviceLimit} onChange={(e) => setDeviceLimit(Number(e.target.value))} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss}>
                <option value={0}>Plan default{plan ? ` (${plan.deviceLimit})` : ""}</option>
                {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <div className={fieldLabel} style={{ color: C.label }}>PAYMENT REFERENCE (PAID LICENSE)</div>
            <input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="HALOPAY-… — links an existing verified payment" className="w-full rounded-lg px-3 py-2 font-mono text-[12px]" style={fieldCss} />
          </div>

          <div className="mt-4 rounded-lg p-3" style={{ background: A.gold(0.05), boxShadow: `inset 0 0 0 1px ${A.gold(0.2)}` }}>
            <label className="flex cursor-pointer items-center gap-2 text-[11.5px] font-bold" style={{ color: C.goldHover }}>
              <input type="checkbox" checked={complimentary} onChange={(e) => setComplimentary(e.target.checked)} className="accent-[#E9B94E]" />
              Complimentary license (Super Administrator only)
            </label>
            {complimentary && (
              <input value={compReason} onChange={(e) => setCompReason(e.target.value)} placeholder="Reason for complimentary issuance (required, audit-recorded)" className="mt-2 w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
            )}
            <p className="mt-1.5 text-[9.5px]" style={{ color: C.muted }}>Complimentary licenses are clearly separated from paid sales in revenue reports — never recorded as a payment transaction.</p>
          </div>

          <div className="mt-4">
            <div className={fieldLabel} style={{ color: C.label }}>INTERNAL NOTES (OPTIONAL)</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg px-3 py-2 text-[12px]" style={fieldCss} />
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: C.txt2 }}>
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="accent-[#2ECCFF]" />
            E-mail the license to the customer (when e-mail service is configured)
          </label>

          <div className="mt-5">
            <Note note={note} />
          </div>
          <div className="mt-3">
            <button type="button" onClick={() => void generate()} disabled={busy || !planCode || (complimentary && !compReason.trim())}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-extrabold tracking-[0.2em] transition-all hover:brightness-110 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, #E9B94E 0%, #F5CD6B 100%)`, color: "#1A1205", boxShadow: `0 8px 28px rgba(233,185,78,0.28)` }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {busy ? "GENERATING…" : "GENERATE LICENSE KEY"}
            </button>
          </div>
        </div>

        {/* preview panel */}
        <div className="rounded-xl p-5" style={{ background: `linear-gradient(165deg, rgba(233,185,78,0.06), transparent 55%), ${C.navy4}`, border: `1px solid ${A.gold(0.25)}` }}>
          <div className="mb-3 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.goldHover }}>LICENSE PREVIEW</div>
          {result ? (
            <div>
              <div className="rounded-lg p-4 text-center" style={{ background: "#000714", border: `1px dashed ${A.gold(0.4)}` }}>
                <div className="text-[9px] font-extrabold tracking-[0.3em]" style={{ color: C.label }}>LICENSE KEY — SHOWN ONCE</div>
                <div className="mt-2 select-all font-mono text-[16px] font-bold tracking-wider" style={{ color: C.goldHover }}>{result.key}</div>
              </div>
              <div className="mt-4">
                <KV k="PLAN" v={result.planName} />
                <KV k="TYPE" v={result.kind === "MULTI_USER" ? "Multi-user" : "Single-user"} />
                <KV k="TERM" v={result.lifetime ? "Lifetime" : `Expires ${result.expiresAt?.slice(0, 10) ?? "—"}`} />
                <KV k="DEVICES" v={String(result.deviceLimit)} />
                <KV k="E-MAILED" v={result.emailed ? "Yes" : "Not sent / no address"} />
                {result.isComplimentary && <KV k="COMPLIMENTARY" v="Yes — audit recorded" />}
              </div>
              <div className="mt-4 flex gap-2">
                <ActBtn tone="gold" onClick={() => { void navigator.clipboard.writeText(result.key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? "Copied" : "Copy key"}
                </ActBtn>
                <ActBtn tone="cyan" onClick={download}><Download size={11} />Download certificate</ActBtn>
              </div>
            </div>
          ) : (
            <p className="py-10 text-center text-[11.5px] leading-relaxed" style={{ color: C.muted }}>
              Fill the form and generate — the freshly minted key appears here for a one-time copy or certificate download.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
