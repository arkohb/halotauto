// ════════════════════════════════════════════════════════════════════════
//  SYSTEM HEALTH MONITOR · watches what can silently stop HALO trading
//  safely, every 30 s, and tells the administrator when it changes:
//    bot heartbeat · price data · execution lock · broker connection ·
//    database · backups · alert channels
//  Each check is a pure evaluate*() function (tested); runHealthChecks()
//  gathers the inputs. Alerts go out on a CHANGE (problem → raised,
//  problem cleared → "recovered") and are repeated every 6 h while a
//  critical problem lasts. They bypass the alert-type filter (force) so
//  they cannot be switched off by accident. Read-only: nothing here
//  places, closes or changes a trade.
// ════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { sendAlert } from "@/lib/alerts";
import { tfSec, getSymbolMeta } from "@/lib/market-symbols";

export type HealthLevel = "ok" | "warn" | "crit" | "off";
export interface HealthCheck {
  id: string;
  label: string;
  level: HealthLevel;
  detail: string;
}

const TICK_STALE_MS = 60_000;
const STUCK_SUBMIT_MS = 2 * 60_000;
const BACKUP_MAX_AGE_MS = 7 * 24 * 3_600_000;
const DB_SLOW_MS = 2_000;
const REALERT_MS = 6 * 3_600_000;

// ───────────────────────── pure evaluators ─────────────────────────

export function evaluateBotTick(i: { enabled: boolean; bootstrapped: boolean; lastTickAt: number; now: number }): HealthCheck {
  const base = { id: "bot", label: "Bot heartbeat" };
  if (!i.enabled) return { ...base, level: "off", detail: "bot is stopped (EA OFF)" };
  if (!i.bootstrapped) return { ...base, level: "warn", detail: "bot is starting up" };
  const age = i.now - i.lastTickAt;
  if (age > TICK_STALE_MS) return { ...base, level: "crit", detail: `bot has not ticked for ${Math.round(age / 1000)} s — the engine may have stopped` };
  return { ...base, level: "ok", detail: `last tick ${Math.round(age / 1000)} s ago` };
}

/** FX / metals / indices are closed from Friday 22:00 to Sunday 22:00 UTC */
export function marketOpen(symbol: string, now: number): boolean {
  const g = getSymbolMeta(symbol).group;
  if (g === "CRYPTO" || g === "SYNTHETICS") return true;
  const d = new Date(now);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 5 && h >= 22) return false;
  if (day === 0 && h < 22) return false;
  return true;
}

export function evaluateFeed(i: { enabled: boolean; symbol: string; tf: string; source: string; lastBarTime: number | null; now: number }): HealthCheck {
  const base = { id: "feed", label: "Price data" };
  if (!i.enabled) return { ...base, level: "off", detail: "bot is stopped" };
  if (i.source === "simulator") return { ...base, level: "crit", detail: `${i.symbol} is on SIMULATED prices — the live feed is unreachable (new orders are refused)` };
  if (!marketOpen(i.symbol, i.now)) return { ...base, level: "ok", detail: `${i.symbol} market closed (weekend) · source ${i.source}` };
  if (i.lastBarTime === null) return { ...base, level: "warn", detail: "no candles yet" };
  const age = i.now - i.lastBarTime;
  const allowed = tfSec(i.tf) * 1000 * 2 + 5 * 60_000;
  if (age > allowed) return { ...base, level: "warn", detail: `${i.symbol} ${i.tf}: newest candle is ${Math.round(age / 60_000)} min old (source ${i.source})` };
  return { ...base, level: "ok", detail: `${i.symbol} ${i.tf} · source ${i.source} · newest candle ${Math.round(age / 60_000)} min old` };
}

export function evaluateLock(i: { intents: Array<{ state: string; updatedAt: number; symbol: string }>; now: number }): HealthCheck {
  const base = { id: "lock", label: "Execution lock" };
  const unc = i.intents.filter((x) => x.state === "UNCERTAIN");
  if (unc.length) return { ...base, level: "crit", detail: `${unc.length} order(s) with an UNCERTAIN broker outcome (${unc.map((u) => u.symbol).join(", ")}) — new orders paused; see Admin → Execution` };
  const stuck = i.intents.filter((x) => (x.state === "SUBMITTING" || x.state === "PENDING") && i.now - x.updatedAt > STUCK_SUBMIT_MS);
  if (stuck.length) return { ...base, level: "crit", detail: `${stuck.length} order(s) stuck in ${stuck[0].state} for over 2 min (${stuck.map((u) => u.symbol).join(", ")})` };
  return { ...base, level: "ok", detail: "no uncertain or stuck orders" };
}

export function evaluateBroker(i: { live: boolean; label: string; ok: boolean | null; error: string }): HealthCheck {
  const base = { id: "broker", label: "Broker connection" };
  if (!i.live) return { ...base, level: "off", detail: "paper mode — no live broker in use" };
  if (i.ok === null) return { ...base, level: "warn", detail: `${i.label}: not checked yet` };
  if (!i.ok) return { ...base, level: "crit", detail: `${i.label} unreachable: ${i.error || "no account data"}` };
  return { ...base, level: "ok", detail: `${i.label} connected` };
}

export function evaluateDb(i: { ok: boolean; ms: number; error: string }): HealthCheck {
  const base = { id: "db", label: "Database" };
  if (!i.ok) return { ...base, level: "crit", detail: `database error: ${i.error}` };
  if (i.ms > DB_SLOW_MS) return { ...base, level: "warn", detail: `slow: ${i.ms} ms for a simple query` };
  return { ...base, level: "ok", detail: `${i.ms} ms` };
}

export function evaluateBackups(i: { newest: number | null; now: number; where: string }): HealthCheck {
  const base = { id: "backup", label: "Backups" };
  if (i.newest === null) return { ...base, level: "warn", detail: `no database backup found (${i.where}) — automated backups are not set up` };
  const age = i.now - i.newest;
  if (age > BACKUP_MAX_AGE_MS) return { ...base, level: "warn", detail: `newest backup is ${Math.round(age / 86_400_000)} days old — automated backups are not set up` };
  return { ...base, level: "ok", detail: `newest backup ${Math.round(age / 3_600_000)} h old` };
}

/** a channel is only "working" if it is set up AND its latest delivery (last 24 h) did not fail */
export function evaluateChannels(i: {
  telegram: boolean;
  email: boolean;
  push: boolean;
  lastResult?: Partial<Record<"telegram" | "email" | "push", { ok: boolean; error: string }>>;
}): HealthCheck {
  const base = { id: "alerts", label: "Alert channels" };
  const names = { telegram: "Telegram", email: "e-mail", push: "push" } as const;
  const working: string[] = [];
  const failing: string[] = [];
  for (const k of ["telegram", "email", "push"] as const) {
    if (!i[k]) continue;
    const last = i.lastResult?.[k];
    if (last && !last.ok) failing.push(`${names[k]} (${last.error.slice(0, 60) || "delivery failed"})`);
    else working.push(names[k]);
  }
  if (!working.length && failing.length) return { ...base, level: "crit", detail: `alerts are NOT being delivered — ${failing.join("; ")}` };
  if (!working.length) return { ...base, level: "warn", detail: "no alert channel is set up (Alerts tab) — problems can only be seen on this page" };
  if (failing.length) return { ...base, level: "warn", detail: `delivering to ${working.join(", ")}; failing: ${failing.join("; ")}` };
  return { ...base, level: "ok", detail: `delivering to ${working.join(", ")}` };
}

// ───────────────────────── gathering + alerting ─────────────────────────

interface Memory {
  checks: HealthCheck[];
  at: number;
  lastAlert: Map<string, { level: HealthLevel; at: number }>;
  brokerCache: { at: number; ok: boolean | null; error: string; label: string; live: boolean };
  timer?: ReturnType<typeof setInterval>;
  busy?: boolean;
}
const gm = globalThis as unknown as { __haloHealth?: Memory };
const mem: Memory = (gm.__haloHealth ??= { checks: [], at: 0, lastAlert: new Map(), brokerCache: { at: 0, ok: null, error: "", label: "", live: false } });

function newestBackup(): { newest: number | null; where: string } {
  const dirs = [path.join(process.cwd(), "db"), path.join(os.homedir(), "HALO-backups")];
  let newest: number | null = null;
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (!/backup|\.bundle$|^HALO-/i.test(f)) continue;
        const t = fs.statSync(path.join(d, f)).mtimeMs;
        if (newest === null || t > newest) newest = t;
      }
    } catch {
      // folder missing — fine
    }
  }
  return { newest, where: "db/ and ~/HALO-backups" };
}

async function brokerHealth(): Promise<{ live: boolean; label: string; ok: boolean | null; error: string }> {
  const cfg = await db.botConfig.findUnique({ where: { id: "main" } });
  if (!cfg || cfg.executionMode !== "live" || !cfg.brokerAccountId) return { live: false, label: "", ok: null, error: "" };
  // a broker round-trip once a minute is plenty
  if (Date.now() - mem.brokerCache.at < 60_000 && mem.brokerCache.live) return mem.brokerCache;
  const row = await db.brokerAccount.findUnique({ where: { id: cfg.brokerAccountId } });
  if (!row) return { live: true, label: "configured broker", ok: false, error: "the broker account no longer exists" };
  const { getAdapter, parseCreds } = await import("@/lib/brokers");
  let ok = false;
  let error = "";
  try {
    const a = await getAdapter(row.kind as Parameters<typeof getAdapter>[0]).getAccount(parseCreds(row.credsJson));
    ok = a.ok;
    error = a.error ?? "";
  } catch (e) {
    error = (e as Error).message;
  }
  mem.brokerCache = { at: Date.now(), ok, error, label: row.label, live: true };
  return mem.brokerCache;
}

async function gather(now: number): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const t0 = Date.now();
  let dbOk = true;
  let dbErr = "";
  try {
    await db.botConfig.count();
  } catch (e) {
    dbOk = false;
    dbErr = (e as Error).message;
  }
  out.push(evaluateDb({ ok: dbOk, ms: Date.now() - t0, error: dbErr }));
  if (!dbOk) return out;

  const { getBot } = await import("@/lib/bot");
  const bot = getBot();
  out.push(evaluateBotTick({ enabled: bot.enabled, bootstrapped: bot.bootstrapped, lastTickAt: bot.lastTickAt, now }));
  const snap = bot.engine.snapshot();
  out.push(evaluateFeed({ enabled: bot.enabled, symbol: bot.symbol, tf: bot.tf, source: bot.feedSource, lastBarTime: snap.lastBarTime || null, now }));

  const intents = await db.executionIntent.findMany({ where: { state: { in: ["UNCERTAIN", "SUBMITTING", "PENDING"] } }, select: { state: true, updatedAt: true, symbol: true } });
  out.push(evaluateLock({ intents: intents.map((x) => ({ ...x, updatedAt: x.updatedAt.getTime() })), now }));

  out.push(evaluateBroker(await brokerHealth()));
  out.push(evaluateBackups({ ...newestBackup(), now }));

  const a = await db.alertSettings.findUnique({ where: { id: "main" } });
  const subs = await db.pushSubscription.count().catch(() => 0);
  const lastResult: Partial<Record<"telegram" | "email" | "push", { ok: boolean; error: string }>> = {};
  for (const ch of ["telegram", "email", "push"] as const) {
    const row = await db.alertLog.findFirst({
      where: { channel: ch, kind: { not: "test" }, createdAt: { gt: new Date(now - 24 * 3_600_000) } },
      orderBy: { createdAt: "desc" },
      select: { ok: true, error: true },
    });
    if (row) lastResult[ch] = { ok: row.ok, error: row.error };
  }
  out.push(
    evaluateChannels({
      telegram: !!a?.telegramEnabled && !!a.telegramBotToken && !!a.telegramChatId,
      email: !!a?.emailEnabled && !!a.smtpHost && !!a.smtpTo,
      push: (a?.pushEnabled ?? true) && subs > 0,
      lastResult,
    })
  );
  return out;
}

/** which alerts to send for a new set of results (pure: tested) */
export function alertsFor(
  checks: HealthCheck[],
  last: Map<string, { level: HealthLevel; at: number }>,
  now: number
): Array<{ check: HealthCheck; kind: "raised" | "reminder" | "recovered" }> {
  const out: Array<{ check: HealthCheck; kind: "raised" | "reminder" | "recovered" }> = [];
  for (const c of checks) {
    const prev = last.get(c.id);
    const bad = c.level === "crit" || c.level === "warn";
    const wasBad = prev && (prev.level === "crit" || prev.level === "warn");
    if (bad && (!prev || prev.level !== c.level)) out.push({ check: c, kind: "raised" });
    else if (bad && c.level === "crit" && prev && now - prev.at >= REALERT_MS) out.push({ check: c, kind: "reminder" });
    else if (!bad && wasBad) out.push({ check: c, kind: "recovered" });
  }
  return out;
}

export async function runHealthChecks(): Promise<HealthCheck[]> {
  if (mem.busy) return mem.checks;
  mem.busy = true;
  try {
    const now = Date.now();
    const checks = await gather(now);
    for (const a of alertsFor(checks, mem.lastAlert, now)) {
      const c = a.check;
      // backups / channels are standing warnings: shown on the page, alerted once
      const title =
        a.kind === "recovered"
          ? `HALO · RECOVERED · ${c.label.toUpperCase()}`
          : `HALO · ${c.level === "crit" ? "CRITICAL" : "WARNING"} · ${c.label.toUpperCase()}${a.kind === "reminder" ? " (STILL)" : ""}`;
      void sendAlert({ kind: "status", title, body: c.detail }, { force: true }).catch(() => {});
      mem.lastAlert.set(c.id, { level: c.level, at: now });
    }
    for (const c of checks) if (!mem.lastAlert.has(c.id)) mem.lastAlert.set(c.id, { level: c.level, at: now });
    mem.checks = checks;
    mem.at = now;
    return checks;
  } finally {
    mem.busy = false;
  }
}

export function healthSnapshot(): { at: number; checks: HealthCheck[] } {
  return { at: mem.at, checks: mem.checks };
}

/** start the 30 s monitor once per process */
export function ensureHealthMonitor(): void {
  if (mem.timer) return;
  mem.timer = setInterval(() => void runHealthChecks().catch(() => {}), 30_000);
  (mem.timer as unknown as { unref?: () => void }).unref?.();
  setTimeout(() => void runHealthChecks().catch(() => {}), 5_000);
}
