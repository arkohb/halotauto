"use client";

// client-side formatting helpers for the Performance Journal (HALO palette)

import { C } from "@/lib/halo/ui-helpers";

export function money(v: number | null | undefined, ccy = "USD", dp = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const sign = v < 0 ? "−" : "+";
  const sym = ccy === "USD" ? "$" : ccy === "EUR" ? "€" : ccy === "GBP" ? "£" : ccy === "JPY" ? "¥" : "";
  return `${v < 0 ? sign : "+"}${sym}${abs}${sym ? "" : ` ${ccy}`}`;
}

export function moneyPlain(v: number | null | undefined, ccy = "USD"): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${v < 0 ? "−" : ""}${ccy === "USD" ? "$" : `${ccy} `}${abs}`;
}

export function pnlColor(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return C.muted;
  return v > 0 ? C.green : C.red;
}

export function pct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${v.toFixed(dp)}%`;
}

export function num(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function price(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const dp = a >= 500 ? 2 : a >= 20 ? 3 : a >= 2 ? 4 : a >= 0.5 ? 5 : 8;
  return v.toLocaleString("en-US", { maximumFractionDigits: dp });
}

export function dt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!isFinite(+d)) return "—";
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function dOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isFinite(+d) ? d.toISOString().slice(0, 10) : "—";
}

export function dur(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
