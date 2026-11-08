"use client";

// ══════════════════════════════════════════════════════════════════════════
//  TWO-FACTOR SIGN-IN card (Account page, administrator accounts only)
//  Setup: password → setup key (+ otpauth link) → first code → recovery
//  codes shown ONCE. Manage: new recovery codes / turn off (password + code).
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";
import { ErrorBox, FieldLabel, GoldButton, inputStyle } from "@/components/commerce/brand";

interface Status {
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryRemaining: number;
}

async function post<T>(body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const r = await fetch("/api/auth/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as T & { ok: boolean; error?: string };
}

export function TwoFactorCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [stage, setStage] = useState<"idle" | "password" | "scan" | "codes" | "manage">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/auth/2fa", { cache: "no-store" });
    const j = (await r.json().catch(() => null)) as (Status & { ok: boolean }) | null;
    if (j?.ok) setSt(j);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!st || !st.available) return null;

  const card = (children: React.ReactNode) => (
    <div className="rounded-xl p-5" style={{ background: C.navy4, border: `1px solid ${C.line}` }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
          <KeyRound size={12} style={{ color: C.goldHover }} />TWO-FACTOR SIGN-IN
        </div>
        <span
          className="rounded-full px-2 py-[3px] text-[9px] font-extrabold"
          style={st.enabled ? { color: C.green, background: A.green(0.1) } : { color: C.warn, background: A.warn(0.1) }}
        >
          {st.enabled ? "ON" : "OFF"}
        </span>
      </div>
      {children}
    </div>
  );

  // recovery codes — shown once
  if (stage === "codes" && codes) {
    return card(
      <>
        <p className="mb-3 text-[11px] leading-relaxed" style={{ color: C.txt2 }}>
          Save these recovery codes in your password manager <b>now</b> — they are shown only once. Each works one time if you lose your phone.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-lg p-3 font-mono text-[12px]" style={{ background: "#000714", color: C.txt }}>
          {codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <GoldButton
          className="w-full"
          onClick={() => {
            setCodes(null);
            setStage("idle");
            void load();
          }}
        >
          I HAVE SAVED THEM
        </GoldButton>
      </>
    );
  }

  if (!st.enabled) {
    if (stage === "password") {
      return card(
        <>
          <FieldLabel>CONFIRM YOUR PASSWORD</FieldLabel>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mb-3 w-full rounded-lg px-3 py-2.5 text-[13px]" style={inputStyle} />
          <ErrorBox error={err} />
          <GoldButton
            className="mt-2 w-full"
            disabled={busy || !password}
            onClick={() =>
              void run(async () => {
                const j = await post<{ secret: string; uri: string }>({ action: "setup", password });
                if (!j.ok) throw new Error(j.error ?? "Setup failed.");
                setSetup({ secret: j.secret, uri: j.uri });
                setPassword("");
                setStage("scan");
              })
            }
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}CONTINUE
          </GoldButton>
        </>
      );
    }
    if (stage === "scan" && setup) {
      return card(
        <>
          <p className="mb-2 text-[11px] leading-relaxed" style={{ color: C.txt2 }}>
            In your authenticator app (Google or Microsoft Authenticator, Authy, 1Password, Apple Passwords…) add an account and type this setup key — or open the link on this device:
          </p>
          <div className="mb-2 break-all rounded-lg p-3 text-center font-mono text-[13px] tracking-[0.12em]" style={{ background: "#000714", color: C.goldHover }}>
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </div>
          <a href={setup.uri} className="mb-3 block text-center text-[10.5px] font-bold hover:underline" style={{ color: C.cyan }}>
            Open in authenticator app
          </a>
          <FieldLabel>ENTER THE 6-DIGIT CODE IT SHOWS</FieldLabel>
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="mb-3 w-full rounded-lg px-3 py-2.5 text-center text-[16px] tracking-[0.3em]" style={inputStyle} />
          <ErrorBox error={err} />
          <GoldButton
            className="mt-2 w-full"
            disabled={busy || code.replace(/\s/g, "").length !== 6}
            onClick={() =>
              void run(async () => {
                const j = await post<{ recovery: string[]; otherSessionsRevoked: number }>({ action: "enable", code });
                if (!j.ok) throw new Error(j.error ?? "That code did not work.");
                setCode("");
                setSetup(null);
                setCodes(j.recovery);
                setSt({ ...st, enabled: true, recoveryRemaining: j.recovery.length });
                setStage("codes");
              })
            }
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : null}TURN ON TWO-FACTOR
          </GoldButton>
        </>
      );
    }
    return card(
      <>
        <p className="mb-3 text-[10.5px] leading-relaxed" style={{ color: C.muted }}>
          Protect this administrator account with a code from your phone at every sign-in. Turning it on signs out your other sessions.
        </p>
        <GoldButton className="w-full" onClick={() => setStage("password")}>SET UP TWO-FACTOR</GoldButton>
      </>
    );
  }

  // enabled
  return card(
    <>
      <p className="mb-3 text-[10.5px] leading-relaxed" style={{ color: C.muted }}>
        On since {st.enabledAt ? new Date(st.enabledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"} · {st.recoveryRemaining} recovery code{st.recoveryRemaining === 1 ? "" : "s"} left.
      </p>
      {msg ? <div className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: A.green(0.1), color: C.green }}>{msg}</div> : null}
      {stage === "manage" ? (
        <>
          <FieldLabel>PASSWORD</FieldLabel>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mb-2 w-full rounded-lg px-3 py-2 text-[13px]" style={inputStyle} />
          <FieldLabel>AUTHENTICATOR OR RECOVERY CODE</FieldLabel>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="mb-3 w-full rounded-lg px-3 py-2 text-center text-[14px] tracking-[0.2em]" style={inputStyle} />
          <ErrorBox error={err} />
          <div className="mt-2 flex flex-wrap gap-2">
            <GoldButton
              disabled={busy || !password || !code}
              onClick={() =>
                void run(async () => {
                  const j = await post<{ recovery: string[] }>({ action: "regenerate", password, code });
                  if (!j.ok) throw new Error(j.error ?? "Failed.");
                  setPassword("");
                  setCode("");
                  setCodes(j.recovery);
                  setStage("codes");
                })
              }
            >
              NEW RECOVERY CODES
            </GoldButton>
            <button
              type="button"
              disabled={busy || !password || !code}
              onClick={() =>
                void run(async () => {
                  if (!window.confirm("Turn off two-factor sign-in for this administrator account?")) return;
                  const j = await post({ action: "disable", password, code });
                  if (!j.ok) throw new Error(j.error ?? "Failed.");
                  setPassword("");
                  setCode("");
                  setStage("idle");
                  setMsg("Two-factor sign-in is off.");
                  await load();
                })
              }
              className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em] disabled:opacity-40"
              style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}
            >
              TURN OFF
            </button>
            <button type="button" onClick={() => setStage("idle")} className="text-[10px] font-semibold hover:underline" style={{ color: C.cyan }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => setStage("manage")} className="rounded-lg px-3 py-2 text-[9.5px] font-extrabold tracking-[0.12em]" style={{ background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` }}>
          MANAGE
        </button>
      )}
    </>
  );
}
