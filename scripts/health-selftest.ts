// System health monitor — self-test of every check and the alert rules.
//   npx tsx scripts/health-selftest.ts
// Pure functions only: no DB, no broker, no alerts sent.
import {
  alertsFor,
  evaluateBackups,
  evaluateBotTick,
  evaluateBroker,
  evaluateChannels,
  evaluateDb,
  evaluateFeed,
  evaluateLock,
  marketOpen,
  type HealthCheck,
  type HealthLevel,
} from "../src/lib/health";

let fails = 0;
const ok = (cond: boolean, msg: string): void => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails += 1;
};
const now = Date.UTC(2026, 10, 10, 12, 0, 0); // Tuesday 12:00 UTC

// bot heartbeat
ok(evaluateBotTick({ enabled: true, bootstrapped: true, lastTickAt: now - 5_000, now }).level === "ok", "bot ticked 5 s ago → ok");
ok(evaluateBotTick({ enabled: true, bootstrapped: true, lastTickAt: now - 90_000, now }).level === "crit", "bot silent for 90 s → CRITICAL");
ok(evaluateBotTick({ enabled: false, bootstrapped: true, lastTickAt: 0, now }).level === "off", "bot switched off → off, not an alarm");

// price data
ok(evaluateFeed({ enabled: true, symbol: "XAUUSD", tf: "1h", source: "simulator", lastBarTime: now, now }).level === "crit", "simulated prices → CRITICAL");
ok(evaluateFeed({ enabled: true, symbol: "XAUUSD", tf: "1h", source: "yahoo", lastBarTime: now - 30 * 60_000, now }).level === "ok", "1h bar 30 min old → ok");
ok(evaluateFeed({ enabled: true, symbol: "XAUUSD", tf: "1h", source: "yahoo", lastBarTime: now - 4 * 3_600_000, now }).level === "warn", "1h bar 4 h old while the market is open → warning");
const saturday = Date.UTC(2026, 10, 7, 12, 0, 0);
ok(!marketOpen("XAUUSD", saturday) && marketOpen("BTCUSDT", saturday), "gold is closed on Saturday; crypto is not");
ok(evaluateFeed({ enabled: true, symbol: "XAUUSD", tf: "1h", source: "yahoo", lastBarTime: saturday - 40 * 3_600_000, now: saturday }).level === "ok", "old gold bar at the weekend is not an alarm");
ok(!marketOpen("EURUSD", Date.UTC(2026, 10, 6, 22, 30)) && marketOpen("EURUSD", Date.UTC(2026, 10, 8, 22, 30)), "FX closes Friday 22:00 and reopens Sunday 22:00 UTC");

// execution lock
ok(evaluateLock({ intents: [], now }).level === "ok", "no open intents → ok");
ok(evaluateLock({ intents: [{ state: "UNCERTAIN", updatedAt: now, symbol: "XAUUSD" }], now }).level === "crit", "uncertain order → CRITICAL");
ok(evaluateLock({ intents: [{ state: "SUBMITTING", updatedAt: now - 30_000, symbol: "XAUUSD" }], now }).level === "ok", "submitting for 30 s → still ok");
ok(evaluateLock({ intents: [{ state: "SUBMITTING", updatedAt: now - 3 * 60_000, symbol: "XAUUSD" }], now }).level === "crit", "stuck submitting for 3 min → CRITICAL");

// broker, db, backups, channels
ok(evaluateBroker({ live: false, label: "", ok: null, error: "" }).level === "off", "paper mode → broker check off");
ok(evaluateBroker({ live: true, label: "Exness demo", ok: false, error: "MT5 EA offline" }).level === "crit", "live broker unreachable → CRITICAL");
ok(evaluateBroker({ live: true, label: "Exness demo", ok: true, error: "" }).level === "ok", "live broker connected → ok");
ok(evaluateDb({ ok: false, ms: 0, error: "disk I/O" }).level === "crit" && evaluateDb({ ok: true, ms: 3000, error: "" }).level === "warn" && evaluateDb({ ok: true, ms: 4, error: "" }).level === "ok", "database: error → critical, slow → warning, fast → ok");
ok(evaluateBackups({ newest: null, now, where: "db/" }).level === "warn" && evaluateBackups({ newest: now - 10 * 86_400_000, now, where: "" }).level === "warn" && evaluateBackups({ newest: now - 3_600_000, now, where: "" }).level === "ok", "backups: none or 10 days old → warning, 1 h old → ok");
ok(evaluateChannels({ telegram: false, email: false, push: false }).level === "warn" && evaluateChannels({ telegram: true, email: false, push: false }).level === "ok", "alert channels: none → warning, Telegram → ok");
ok(evaluateChannels({ telegram: true, email: false, push: false, lastResult: { telegram: { ok: false, error: "HTTP 401" } } }).level === "crit", "Telegram set up but its last delivery failed (401) → CRITICAL: alerts not delivered");
ok(evaluateChannels({ telegram: true, email: true, push: false, lastResult: { telegram: { ok: false, error: "HTTP 401" }, email: { ok: true, error: "" } } }).level === "warn", "one channel failing, another working → warning");

// alert rules
const chk = (id: string, level: HealthLevel): HealthCheck => ({ id, label: id, level, detail: "" });
const mem = new Map<string, { level: HealthLevel; at: number }>();
const a1 = alertsFor([chk("bot", "crit"), chk("db", "ok")], mem, now);
ok(a1.length === 1 && a1[0].kind === "raised" && a1[0].check.id === "bot", "a new problem raises one alert; healthy checks send nothing");
mem.set("bot", { level: "crit", at: now });
mem.set("db", { level: "ok", at: now });
ok(alertsFor([chk("bot", "crit")], mem, now + 60_000).length === 0, "the same problem a minute later is not re-sent");
const a3 = alertsFor([chk("bot", "crit")], mem, now + 6 * 3_600_000);
ok(a3.length === 1 && a3[0].kind === "reminder", "still critical after 6 h → one reminder");
const a4 = alertsFor([chk("bot", "ok")], mem, now + 7 * 3_600_000);
ok(a4.length === 1 && a4[0].kind === "recovered", "problem cleared → 'recovered' alert");
mem.set("backup", { level: "warn", at: now });
ok(alertsFor([chk("backup", "warn")], mem, now + 7 * 3_600_000).length === 0, "standing warnings are not repeated");
ok(alertsFor([chk("backup", "crit")], mem, now).length === 1, "a warning that turns critical alerts again");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
