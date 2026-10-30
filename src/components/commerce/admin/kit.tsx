"use client";

// ══════════════════════════════════════════════════════════════════════════
//  ADMIN KIT · shared primitives for the HALO administration command centre
//  Stat cards with live status dots, glass data tables, status pills,
//  confirmation dialogs. Real database numbers only — never invented.
// ══════════════════════════════════════════════════════════════════════════

import { ReactNode, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { A, C, pillStyle, type PillTone } from "@/lib/halo/ui-helpers";

// ── fetch helper ──────────────────────────────────────────────────────────
export async function api<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as T & { ok: boolean; error?: string };
  return j;
}

export function money(cents: number, currency = "USD"): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
}

export function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── status pill ───────────────────────────────────────────────────────────
const STATUS_TONE: Record<string, PillTone> = {
  ACTIVE: "ok", VERIFIED: "ok", ONLINE: "ok", ok: "ok", success: "ok", AUTOMATIC: "ok",
  PENDING: "warn", PENDING_EMAIL: "warn", PENDING_APPROVAL: "warn", UNACTIVATED: "warn", warn: "warn", MANUAL: "warn",
  SUSPENDED: "warn", DISPUTED: "warn", FLUTTERWAVE: "info", PAYSTACK: "info",
  REVOKED: "err", BLOCKED: "err", REJECTED: "err", FAILED: "err", err: "err", CANCELLED: "muted", REFUNDED: "muted",
  SUPER_ADMIN: "gold", LICENSE_ADMIN: "info", SUPPORT_ADMIN: "info", CUSTOMER: "muted", offline: "err", error: "err",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const t = pillStyle(STATUS_TONE[status] ?? "muted");
  return (
    <span className="inline-flex items-center rounded-full px-2 py-[3px] text-[9px] font-extrabold tracking-[0.12em]" style={{ color: t.fg, background: t.bg, boxShadow: `inset 0 0 0 1px ${t.line}` }}>
      {label ?? status.replaceAll("_", " ")}
    </span>
  );
}

// ── section header ────────────────────────────────────────────────────────
export function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[16px] font-extrabold tracking-[0.08em]" style={{ color: C.txt }}>{title}</h2>
        {sub ? <p className="mt-0.5 text-[11px]" style={{ color: C.muted }}>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

// ── stat card ─────────────────────────────────────────────────────────────
export function StatCard({ label, value, tone = "info", pulse = false, sub }: { label: string; value: string | number; tone?: PillTone; pulse?: boolean; sub?: string }) {
  const t = pillStyle(tone === "info" ? "info" : tone);
  const dotColor = tone === "ok" ? C.green : tone === "warn" ? C.warn : tone === "err" ? C.red : tone === "gold" ? C.gold : C.cyan;
  return (
    <div className="rounded-xl p-4" style={{ background: `linear-gradient(160deg, ${A.blue(0.05)}, transparent 60%), ${C.navy4}`, border: `1px solid ${C.line}`, boxShadow: `inset 0 1px 0 ${A.white(0.04)}` }}>
      <div className="flex items-center gap-2">
        <span className="relative flex h-1.5 w-1.5">
          {pulse ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: dotColor }} /> : null}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
        </span>
        <span className="text-[9px] font-extrabold tracking-[0.16em]" style={{ color: C.label }}>{label}</span>
      </div>
      <div className="mt-2 text-[24px] font-extrabold leading-none tracking-tight" style={{ color: t.fg === C.muted ? C.txt : t.fg }}>{value}</div>
      {sub ? <div className="mt-1.5 text-[10px]" style={{ color: C.muted }}>{sub}</div> : null}
    </div>
  );
}

// ── glass table primitives ────────────────────────────────────────────────
export function TableWrap({ children, maxH = 560 }: { children: ReactNode; maxH?: number }) {
  return (
    <div className="halo-scroll overflow-auto rounded-xl" style={{ border: `1px solid ${C.line}`, background: C.navy4, maxHeight: maxH }}>
      {children}
    </div>
  );
}

export function Th({ children, w }: { children: ReactNode; w?: string }) {
  return (
    <th className="sticky top-0 z-10 whitespace-nowrap px-3 py-2.5 text-left text-[8.5px] font-extrabold tracking-[0.16em]" style={{ background: C.navy3, color: C.label, borderBottom: `1px solid ${C.line}`, width: w }}>
      {children}
    </th>
  );
}

export function Td({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-3 py-2.5 text-[11px] ${mono ? "font-mono tracking-wide" : ""}`} style={{ color: C.txt2, borderBottom: `1px solid ${C.divider}` }}>
      {children}
    </td>
  );
}

// ── buttons ───────────────────────────────────────────────────────────────
export function ActBtn({ children, onClick, busy, disabled, tone = "cyan", title }: { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; tone?: "cyan" | "gold" | "danger" | "ghost"; title?: string }) {
  const styles: Record<string, React.CSSProperties> = {
    cyan: { background: A.blue(0.14), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.35)}` },
    gold: { background: A.gold(0.12), color: C.goldHover, boxShadow: `inset 0 0 0 1px ${A.gold(0.4)}` },
    danger: { background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.4)}` },
    ghost: { background: A.white(0.05), color: C.txt2, boxShadow: `inset 0 0 0 1px ${A.white(0.12)}` },
  };
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled || busy} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.1em] transition-all hover:brightness-125 active:scale-[0.98] disabled:opacity-40" style={styles[tone]}>
      {busy ? <Loader2 size={10} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

// ── search input ──────────────────────────────────────────────────────────
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false}
      className="w-full rounded-lg px-3 py-2 text-[12px] outline-none transition-colors focus:border-[#2ECCFF] sm:w-64"
      style={{ background: C.deep, border: `1px solid ${C.line2}`, color: C.txt }} />
  );
}

export function FilterChips<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            className="rounded-full px-3 py-1.5 text-[9.5px] font-extrabold tracking-[0.12em] transition-all"
            style={on ? { background: A.cyan(0.14), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.45)}` } : { background: A.white(0.04), color: C.muted, boxShadow: `inset 0 0 0 1px ${A.white(0.1)}` }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── confirmation dialog ───────────────────────────────────────────────────
export interface ConfirmState {
  title: string;
  body: string;
  tone?: "cyan" | "gold" | "danger";
  confirmLabel?: string;
  extra?: ReactNode;
  onConfirm: () => Promise<void> | void;
}

export function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  // keyed remount resets internal busy state whenever a new confirmation opens
  if (!state) return null;
  return <ConfirmDialogInner key={`${state.title}::${state.body}`} state={state} onClose={onClose} />;
}

function ConfirmDialogInner({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const tone = state.tone ?? "cyan";
  const bg = tone === "danger" ? A.red(0.14) : tone === "gold" ? A.gold(0.14) : A.cyan(0.14);
  const fg = tone === "danger" ? C.red : tone === "gold" ? C.goldHover : C.cyan;
  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#020B1A]/80 px-4 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div className="w-full max-w-md rounded-2xl p-6" style={{ background: `linear-gradient(160deg, #041428 0%, #021229 100%)`, border: `1px solid ${C.line}`, boxShadow: `0 24px 80px 0 ${A.blue(0.2)}` }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-[14px] font-extrabold tracking-[0.06em]" style={{ color: C.txt }}>{state.title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100" disabled={busy}><X size={16} color={C.muted} /></button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.muted }}>{state.body}</p>
        {state.extra}
        <div className="mt-5 flex justify-end gap-2">
          <ActBtn tone="ghost" onClick={onClose} disabled={busy}>Cancel</ActBtn>
          <button type="button" disabled={busy} onClick={() => { setBusy(true); void Promise.resolve(state.onConfirm()).finally(onClose); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[9.5px] font-extrabold tracking-[0.1em] transition-all hover:brightness-125 disabled:opacity-40"
            style={{ background: bg, color: fg, boxShadow: `inset 0 0 0 1px ${fg}55` }}>
            {busy ? <Loader2 size={10} className="animate-spin" /> : null}
            {state.confirmLabel ?? "CONFIRM"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── inline note ───────────────────────────────────────────────────────────
export function Note({ note }: { note: { text: string; bad?: boolean } | null }) {
  if (!note) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-[11px] leading-snug" style={note.bad ? { background: A.red(0.1), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.35)}` } : { background: A.green(0.1), color: C.green, boxShadow: `inset 0 0 0 1px ${A.green(0.35)}` }}>
      {note.text}
    </div>
  );
}

// ── drawer (record detail) ────────────────────────────────────────────────
export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[210] flex justify-end bg-[#020B1A]/70 backdrop-blur-sm" onClick={onClose}>
      <div className="halo-scroll h-full w-full max-w-lg overflow-y-auto p-6" style={{ background: `linear-gradient(180deg, #041428 0%, #021229 100%)`, borderLeft: `1px solid ${C.line}`, boxShadow: `-24px 0 80px ${A.blue(0.15)}` }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[14px] font-extrabold tracking-[0.06em]" style={{ color: C.txt }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="opacity-60 hover:opacity-100"><X size={16} color={C.muted} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function KV({ k, v, mono = false }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2" style={{ borderColor: C.divider }}>
      <span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>{k}</span>
      <span className={`text-right text-[11.5px] ${mono ? "font-mono" : ""}`} style={{ color: C.txt2 }}>{v}</span>
    </div>
  );
}
