"use client";

// ══════════════════════════════════════════════════════════════════════════
//  COMMERCE BRAND KIT · shared visual language for the commercial pages
//  Matches the concept mockup: deep navy, electric cyan, metallic gold,
//  glass cards, subtle glows. Uses the existing HALO design tokens (C / A).
// ══════════════════════════════════════════════════════════════════════════

import { ReactNode } from "react";
import { A, C } from "@/lib/halo/ui-helpers";
import { CREATOR_LINE } from "@/lib/commerce/constants";

export function HaloMark({ size = 34 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, ${A.gold(0.16)}, ${A.cyan(0.1)})`,
        boxShadow: `inset 0 0 0 1px ${A.gold(0.45)}, 0 0 18px ${A.gold(0.12)}`,
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3.2" stroke={C.gold} strokeWidth="1.6" />
        <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8" stroke={C.gold} strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <div className="leading-none" style={{ letterSpacing: "0.22em", fontWeight: 800, fontSize: size }}>
      <span style={{ color: C.gold }}>HALO&nbsp;3EL&nbsp;</span>
      <span style={{ color: C.cyan }}>AUTOTRADER</span>
    </div>
  );
}

/** Full-bleed futuristic backdrop: deep navy + aurora glows + grid. */
export function CommerceBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden" style={{ background: C.navy }}>
      <div
        className="absolute"
        style={{
          width: 720, height: 720, left: "50%", top: "-42%", transform: "translateX(-50%)",
          background: `radial-gradient(circle, ${A.blue(0.16)} 0%, transparent 62%)`,
        }}
      />
      <div
        className="absolute"
        style={{
          width: 560, height: 560, right: "-12%", bottom: "-22%",
          background: `radial-gradient(circle, ${A.cyan(0.12)} 0%, transparent 60%)`,
        }}
      />
      <div
        className="absolute"
        style={{
          width: 480, height: 480, left: "-14%", bottom: "-10%",
          background: `radial-gradient(circle, ${A.gold(0.07)} 0%, transparent 58%)`,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.13]"
        style={{
          backgroundImage: `linear-gradient(${A.cyan(0.22)} 1px, transparent 1px), linear-gradient(90deg, ${A.cyan(0.22)} 1px, transparent 1px)`,
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 90% 70% at 50% 38%, black 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 70% at 50% 38%, black 30%, transparent 78%)",
        }}
      />
    </div>
  );
}

/** Glass card used across auth/commerce pages. */
export function GlassCard({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: `linear-gradient(165deg, ${"#041428"} 0%, ${"#021229"} 100%)`,
        border: `1px solid ${C.line}`,
        boxShadow: `0 24px 80px 0 ${A.blue(0.16)}, inset 0 1px 0 0 ${A.white(0.05)}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-[9px] font-extrabold tracking-[0.18em]" style={{ color: C.label }}>{children}</label>;
}

export const inputStyle: React.CSSProperties = {
  background: C.deep,
  border: `1px solid ${C.line2}`,
  color: C.txt,
};

export function GoldButton({ children, onClick, disabled, type = "button", className = "" }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl text-[11px] font-extrabold tracking-[0.2em] transition-all duration-200 hover:brightness-110 active:scale-[0.99] disabled:opacity-40 disabled:hover:brightness-100 ${className}`}
      style={{
        background: `linear-gradient(135deg, ${C.gold} 0%, ${C.goldHover} 100%)`,
        color: "#1A1205",
        boxShadow: `0 8px 28px ${A.gold(0.28)}, inset 0 1px 0 ${"rgba(255,255,255,0.35)"}`,
        padding: "13px 22px",
      }}
    >
      {children}
    </button>
  );
}

export function CyanButton({ children, onClick, disabled, type = "button", className = "" }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl text-[11px] font-extrabold tracking-[0.2em] transition-all duration-200 hover:brightness-110 active:scale-[0.99] disabled:opacity-40 ${className}`}
      style={{
        background: `linear-gradient(135deg, ${A.blue(0.9)}, ${A.cyan(0.75)})`,
        color: "#FFFFFF",
        boxShadow: `0 8px 28px ${A.blue(0.25)}`,
        padding: "13px 22px",
      }}
    >
      {children}
    </button>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg px-3 py-2.5 text-[11.5px] leading-snug" style={{ background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` }}>
      {error}
    </div>
  );
}

export function OkBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg px-3 py-2.5 text-[11.5px] leading-snug" style={{ background: A.green(0.1), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.35)}` }}>
      {message}
    </div>
  );
}

/** Trust indicator row (Secure Login · SSL Encrypted · Trusted Platform). */
export function TrustRow() {
  const items = [
    { label: "Secure Login", d: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" },
    { label: "SSL Encrypted", d: "M6 10V8a6 6 0 0 1 12 0v2m-13 0h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" },
    { label: "Trusted Platform", d: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-3 11 2.2 2.2L16 10" },
  ];
  return (
    <div className="flex items-center justify-center gap-5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d={it.d} />
          </svg>
          <span className="text-[9px] font-bold tracking-[0.1em]" style={{ color: C.muted }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function CreatorLine({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[9.5px] leading-relaxed ${className}`} style={{ color: C.dim }}>
      {CREATOR_LINE}
    </p>
  );
}

/** Left hero panel of the auth screens (desktop). */
export function AuthHero() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between overflow-hidden rounded-none" style={{ background: `linear-gradient(160deg, #03102a 0%, #020b1a 55%, #000714 100%)`, borderRight: `1px solid ${C.line}` }}>
      <div
        aria-hidden
        className="absolute rounded-full"
        style={{ width: 560, height: 560, left: -180, top: "22%", background: `radial-gradient(circle, ${A.gold(0.13)} 0%, transparent 60%)` }}
      />
      <div
        aria-hidden
        className="absolute rounded-full"
        style={{ width: 640, height: 640, left: -80, bottom: "-30%", background: `radial-gradient(circle, ${A.cyan(0.12)} 0%, transparent 62%)` }}
      />
      {/* stylised AI core */}
      <div aria-hidden className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2">
        <div className="relative flex items-center justify-center rounded-full" style={{ width: 210, height: 210, boxShadow: `inset 0 0 0 1.5px ${A.gold(0.5)}, 0 0 70px ${A.gold(0.14)}, inset 0 0 60px ${A.cyan(0.08)}` }}>
          <div className="rounded-full" style={{ width: 150, height: 150, boxShadow: `inset 0 0 0 1px ${A.cyan(0.55)}, inset 0 0 34px ${A.cyan(0.12)}` }} />
          <div className="absolute rounded-full" style={{ width: 84, height: 84, background: `radial-gradient(circle at 38% 34%, ${A.ice(0.5)}, ${A.blue(0.22)} 55%, transparent 75%)`, filter: "blur(1px)" }} />
          <div className="absolute rounded-full" style={{ width: 210, height: 210, border: `1px dashed ${A.cyan(0.28)}`, animation: "spin 26s linear infinite" }} />
        </div>
      </div>
      <div className="relative z-10 p-10">
        <div className="flex items-center gap-3">
          <HaloMark size={40} />
          <Wordmark size={17} />
        </div>
        <div className="mt-3 text-[10px] font-bold tracking-[0.3em]" style={{ color: C.muted }}>
          TRADE SMARTER&nbsp;&nbsp;·&nbsp;&nbsp;TRADE SAFER&nbsp;&nbsp;·&nbsp;&nbsp;TRADE WITH AI
        </div>
      </div>
      <div className="relative z-10 p-10 pt-0">
        <div className="text-[11px] font-extrabold leading-[1.9] tracking-[0.26em]" style={{ color: C.goldHover }}>
          AI POWERED<br />PRECISION TRADING<br />BUILT FOR SUCCESS
        </div>
      </div>
    </div>
  );
}
