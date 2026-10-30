"use client";

// ════════════════════════════════════════════════════════════════════════
//  LICENSE GATE · the one-time-payment activation screen
//  Shown only when the seller enabled commercial enforcement
//  (HALO_LICENSE_SECRET set) and this installation is not activated yet.
//  Owner mode (no secret) → renders nothing, exactly as before.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { A, C } from "@/lib/halo/ui-helpers";

type LicenseInfo = { licensing: boolean; activated: boolean; mode: string; holder?: string };

export function LicenseGate() {
  const [info, setInfo] = useState<LicenseInfo | null>(null);
  const [key, setKey] = useState("");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/license", { cache: "no-store" });
        const j = (await r.json()) as LicenseInfo;
        if (alive) setInfo(j);
      } catch {
        if (alive) setInfo({ licensing: false, activated: true, mode: "owner" });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, []);

  const activate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, holder }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string } & LicenseInfo;
      if (j.ok) setInfo({ licensing: true, activated: true, mode: "licensed" });
      else setError(j.error ?? "Activation failed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [key, holder]);

  if (!info || info.activated || !info.licensing) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#020B1A]/97 backdrop-blur-sm px-4">
      <div
        className="w-full max-w-md rounded-2xl p-7"
        style={{ background: "linear-gradient(160deg, #041428 0%, #021229 100%)", border: `1px solid ${C.line}`, boxShadow: `0 24px 80px 0 ${A.blue(0.18)}` }}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: A.gold(0.12), boxShadow: `inset 0 0 0 1px ${A.gold(0.4)}` }}>
            <KeyRound size={20} style={{ color: C.gold }} />
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-[0.18em]" style={{ color: C.txt }}>
              ACTIVATE HALO
            </div>
            <div className="text-[10px] font-semibold tracking-[0.14em]" style={{ color: C.label }}>
              ONE-TIME PAYMENT · LIFETIME LICENSE
            </div>
          </div>
        </div>

        <p className="mb-5 text-[12px] leading-relaxed" style={{ color: C.muted }}>
          Enter the license key you received after purchase, together with the e-mail it was issued to. Activation is permanent on this installation.
        </p>

        <label className="mb-1.5 block text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
          LICENSE KEY
        </label>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="HALO-XXXX-XXXX-XXXX-XXXX"
          spellCheck={false}
          className="mb-4 w-full rounded-lg px-3 py-2.5 font-mono text-[13px] tracking-wider outline-none transition-colors"
          style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}
        />

        <label className="mb-1.5 block text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>
          E-MAIL THE KEY WAS ISSUED TO
        </label>
        <input
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder="trader@email.com"
          type="email"
          className="mb-4 w-full rounded-lg px-3 py-2.5 text-[13px] outline-none transition-colors"
          style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }}
        />

        {error && (
          <div className="mb-4 rounded-lg px-3 py-2 text-[11px] leading-snug" style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void activate()}
          disabled={busy || !key.trim() || !holder.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[11px] font-extrabold tracking-[0.2em] transition-all disabled:opacity-40"
          style={{ background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`, color: "#FFFFFF" }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {busy ? "ACTIVATING…" : "ACTIVATE — UNLOCK TRADING"}
        </button>

        <p className="mt-4 text-center text-[9.5px] leading-relaxed" style={{ color: C.dim }}>
          Haven&apos;t purchased a key yet? Contact the seller — HALO 3EL Autotrader is a one-time-payment product.
        </p>
      </div>
    </div>
  );
}
