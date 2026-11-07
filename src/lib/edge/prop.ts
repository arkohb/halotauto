// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · prop-firm risk rules
//
//  Watches the LIVE execution account's balance + equity (every 15 s while
//  enabled) against two floors:
//    • daily floor — today's reference (start-of-day balance, or the higher
//      of start-of-day balance/equity) minus dailyLossPct of the initial
//      balance or of today's reference
//    • total floor — initial × (1 − maxLossPct), or trailing: peak − maxLoss,
//      never above the initial balance
//  Hitting a floor (minus a safety buffer): new entries are refused and —
//  when closeAtLimit — every open position is closed at the broker and in
//  HALO's book. A daily breach clears at the next prop-firm day; a total
//  breach stays until a Super Admin resets it.
//  Paper mode has no real balance, so these rules apply to live accounts.
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { sendAlert } from "@/lib/alerts";
import { getAdapter, parseCreds } from "@/lib/brokers";
import { forceCloseRunningTrades } from "@/lib/trade-lock";
import { loadEdge, type PropSettings } from "./settings";

const STATE_KEY = "edge.prop.state";
const TICK_MS = 15_000;
const FRESH_MS = 10_000;

export interface PropState {
  accountId: string; // broker account the numbers belong to
  initialBalance: number;
  dayKey: string;
  dayStartBalance: number;
  dayStartEquity: number;
  peak: number; // highest balance/equity seen (trailing max loss)
  breachDay: string | null; // dayKey of a daily breach
  breachTotal: boolean;
  breachNote: string;
  lastBalance: number;
  lastEquity: number;
  at: number;
}

export interface PropReading {
  balance: number;
  equity: number;
}

export interface PropEval {
  state: PropState;
  dailyFloor: number | null;
  totalFloor: number | null;
  /** a NEW breach on this reading */
  breach: "daily" | "total" | null;
}

/** the prop firm's trading day for `now` */
export function propDayKey(now: number, resetHourUtc: number): string {
  return new Date(now - resetHourUtc * 3_600_000).toISOString().slice(0, 10);
}

/** pure: fold one balance/equity reading into the state and check the floors */
export function evaluateProp(p: PropSettings, prev: PropState | null, r: PropReading, accountId: string, now: number): PropEval {
  const day = propDayKey(now, p.resetHourUtc);
  const fresh = !prev || prev.accountId !== accountId;
  const initial = p.initialBalance > 0 ? p.initialBalance : fresh ? r.balance : prev!.initialBalance || r.balance;
  const s: PropState = fresh
    ? { accountId, initialBalance: initial, dayKey: day, dayStartBalance: r.balance, dayStartEquity: r.equity, peak: Math.max(r.balance, r.equity), breachDay: null, breachTotal: false, breachNote: "", lastBalance: r.balance, lastEquity: r.equity, at: now }
    : { ...prev!, initialBalance: initial };
  if (s.dayKey !== day) {
    s.dayKey = day;
    s.dayStartBalance = r.balance;
    s.dayStartEquity = r.equity;
  }
  s.peak = Math.max(s.peak, r.balance, r.equity);
  s.lastBalance = r.balance;
  s.lastEquity = r.equity;
  s.at = now;

  const buffer = (p.bufferPct / 100) * initial;
  let dailyFloor: number | null = null;
  if (p.dailyLossPct > 0) {
    const ref = p.dayRef === "equity" ? Math.max(s.dayStartBalance, s.dayStartEquity) : s.dayStartBalance;
    const base = p.dailyBase === "initial" ? initial : ref;
    dailyFloor = ref - (p.dailyLossPct / 100) * base;
  }
  let totalFloor: number | null = null;
  if (p.maxLossPct > 0) {
    const allowed = (p.maxLossPct / 100) * initial;
    totalFloor = p.maxLossMode === "trailing" ? Math.min(initial, s.peak - allowed) : initial - allowed;
  }

  let breach: PropEval["breach"] = null;
  if (totalFloor !== null && !s.breachTotal && r.equity <= totalFloor + buffer) {
    s.breachTotal = true;
    s.breachNote = `total loss limit: equity ${r.equity.toFixed(2)} ≤ ${(totalFloor + buffer).toFixed(2)} (floor ${totalFloor.toFixed(2)})`;
    breach = "total";
  } else if (dailyFloor !== null && s.breachDay !== day && r.equity <= dailyFloor + buffer) {
    s.breachDay = day;
    s.breachNote = `daily loss limit: equity ${r.equity.toFixed(2)} ≤ ${(dailyFloor + buffer).toFixed(2)} (floor ${dailyFloor.toFixed(2)})`;
    breach = "daily";
  }
  return { state: s, dailyFloor, totalFloor, breach };
}

/** pure: may a new order open under the stored state? */
export function propAllows(p: PropSettings, s: PropState | null, now: number): { allow: boolean; reason: string } {
  if (!s) return { allow: true, reason: "" };
  if (s.breachTotal) return { allow: false, reason: `prop rules: ${s.breachNote} — trading stopped until a Super Admin resets it` };
  if (s.breachDay && s.breachDay === propDayKey(now, p.resetHourUtc)) {
    return { allow: false, reason: `prop rules: ${s.breachNote} — new trades resume at the next prop-firm day (${String(p.resetHourUtc).padStart(2, "0")}:00 UTC)` };
  }
  return { allow: true, reason: "" };
}

// ───────────────────────── persistence ─────────────────────────

export async function loadPropState(): Promise<PropState | null> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key: STATE_KEY } });
    return row ? (JSON.parse(row.valueJson) as PropState) : null;
  } catch {
    return null;
  }
}

async function savePropState(s: PropState | null): Promise<void> {
  if (!s) {
    await db.systemSetting.deleteMany({ where: { key: STATE_KEY } });
    return;
  }
  const valueJson = JSON.stringify(s);
  await db.systemSetting.upsert({ where: { key: STATE_KEY }, create: { key: STATE_KEY, valueJson }, update: { valueJson } });
}

/** Super Admin: clear breaches (and re-anchor the day) after checking the account */
export async function resetPropState(): Promise<void> {
  await savePropState(null);
}

// ───────────────────────── live monitor ─────────────────────────

const g = globalThis as unknown as { __haloPropTimer?: ReturnType<typeof setInterval>; __haloPropBusy?: boolean; __haloPropLast?: number; __haloPropErr?: string };

async function liveAccount(): Promise<{ id: string; label: string; kind: string; credsJson: string } | null> {
  const cfg = await db.botConfig.findUnique({ where: { id: "main" } });
  if (!cfg || cfg.executionMode !== "live" || !cfg.brokerAccountId) return null;
  const row = await db.brokerAccount.findUnique({ where: { id: cfg.brokerAccountId } });
  return row ? { id: row.id, label: row.label, kind: row.kind, credsJson: row.credsJson } : null;
}

/** one monitor pass: read the account, update floors, act on a new breach */
export async function propTick(): Promise<PropEval | null> {
  if (g.__haloPropBusy) return null;
  g.__haloPropBusy = true;
  try {
    const edge = await loadEdge();
    if (!edge.prop.enabled) return null;
    const acct = await liveAccount();
    if (!acct) return null;
    const adapter = getAdapter(acct.kind as Parameters<typeof getAdapter>[0]);
    const creds = parseCreds(acct.credsJson);
    const info = await adapter.getAccount(creds);
    const balance = Number(info.balance);
    const equity = Number(info.equity ?? info.balance);
    if (!info.ok || !(balance > 0) || !(equity > 0)) {
      g.__haloPropErr = `cannot read ${acct.label}: ${info.error ?? "no balance"}`;
      return null;
    }
    g.__haloPropErr = undefined;
    const ev = evaluateProp(edge.prop, await loadPropState(), { balance, equity }, acct.id, Date.now());
    await savePropState(ev.state);
    g.__haloPropLast = Date.now();
    if (ev.breach) {
      let closed = "";
      if (edge.prop.closeAtLimit) {
        const r = await adapter.closePosition(creds).catch((e: Error) => ({ ok: false, error: e.message }));
        const n = await forceCloseRunningTrades();
        closed = r.ok ? ` All positions on ${acct.label} were closed${n ? ` (${n} HALO trade${n > 1 ? "s" : ""} booked)` : ""}.` : ` Closing positions FAILED: ${r.error ?? "unknown error"} — close them in the platform now.`;
      }
      void sendAlert({
        kind: "broker",
        title: `HALO · PROP ${ev.breach === "total" ? "TOTAL" : "DAILY"} LOSS LIMIT HIT — NEW TRADES STOPPED`,
        body: `${ev.state.breachNote}.${closed}`,
      });
    }
    return ev;
  } catch (e) {
    g.__haloPropErr = (e as Error).message;
    return null;
  } finally {
    g.__haloPropBusy = false;
  }
}

/** start the 15 s monitor once per process (it idles while prop rules are off) */
export function ensurePropMonitor(): void {
  if (g.__haloPropTimer) return;
  g.__haloPropTimer = setInterval(() => void propTick(), TICK_MS);
  (g.__haloPropTimer as unknown as { unref?: () => void }).unref?.();
}

/** order gate: refresh (≤10 s old) and decide */
export async function propGate(): Promise<{ allow: boolean; reason: string }> {
  const edge = await loadEdge();
  if (!edge.prop.enabled) return { allow: true, reason: "" };
  if (!(await liveAccount())) return { allow: true, reason: "" }; // paper: no real balance to protect
  if (!g.__haloPropLast || Date.now() - g.__haloPropLast > FRESH_MS) await propTick();
  if (g.__haloPropErr && (!g.__haloPropLast || Date.now() - g.__haloPropLast > 60_000)) {
    return { allow: false, reason: `prop rules: account balance unavailable (${g.__haloPropErr}) — cannot confirm the loss limits` };
  }
  return propAllows(edge.prop, await loadPropState(), Date.now());
}

/** UI status */
export async function propStatus(): Promise<{
  enabled: boolean;
  live: boolean;
  state: PropState | null;
  dailyFloor: number | null;
  totalFloor: number | null;
  error: string | null;
  lastCheck: number | null;
}> {
  const edge = await loadEdge();
  const live = !!(await liveAccount());
  const state = await loadPropState();
  let dailyFloor: number | null = null;
  let totalFloor: number | null = null;
  if (state) {
    const ev = evaluateProp(edge.prop, { ...state, breachTotal: true, breachDay: state.dayKey }, { balance: state.lastBalance, equity: state.lastEquity }, state.accountId, Date.now());
    dailyFloor = ev.dailyFloor;
    totalFloor = ev.totalFloor;
  }
  return { enabled: edge.prop.enabled, live, state, dailyFloor, totalFloor, error: g.__haloPropErr ?? null, lastCheck: g.__haloPropLast ?? null };
}
