// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · entry filters (new entries only — open trades are untouched)
//    • news blackout  — no new trade N minutes before / after a scheduled
//                       high-impact (or medium+high) release for a currency
//                       the instrument depends on (ForexFactory calendar)
//    • session filter — only open trades inside the chosen sessions
//  Sessions are fixed UTC windows (no daylight-saving shift):
//    Asia 00:00–09:00 · London 07:00–16:00 · New York 12:00–21:00
// ════════════════════════════════════════════════════════════════════════

import { getCalendar, type EconEvent } from "@/lib/halo/intel";
import { getSymbolMeta } from "@/lib/market-symbols";
import type { FilterSettings, SessionKey } from "./settings";

export const SESSION_HOURS: Record<SessionKey, { label: string; from: number; to: number }> = {
  asia: { label: "Asia", from: 0, to: 9 },
  london: { label: "London", from: 7, to: 16 },
  newYork: { label: "New York", from: 12, to: 21 },
};

const METAL_CODES = new Set(["XAU", "XAG", "XPT", "XPD", "XCU"]);
const INDEX_CCY: Record<string, string[]> = {
  US30: ["USD"], US100: ["USD"], US500: ["USD"], US2000: ["USD"], USOIL: ["USD"], UKOIL: ["USD"], NGAS: ["USD"],
  GER40: ["EUR"], FRA40: ["EUR"], EU50: ["EUR"], UK100: ["GBP"], JPN225: ["JPY"], AUS200: ["AUD"], HK50: ["HKD", "CNY"],
};

/** currencies whose news moves this instrument ([] = none, e.g. Deriv synthetics) */
export function newsCurrencies(symbol: string): string[] {
  const g = getSymbolMeta(symbol).group;
  if (g === "SYNTHETICS") return [];
  if (g === "INDICES") return INDEX_CCY[symbol] ?? ["USD"];
  if (g === "CRYPTO") return ["USD"];
  if (/^[A-Z]{6}$/.test(symbol)) {
    const out = [symbol.slice(0, 3), symbol.slice(3)].filter((c) => !METAL_CODES.has(c));
    return out.length ? out : ["USD"];
  }
  return ["USD"];
}

/** pure: is `now` inside a news blackout for these currencies? */
export function newsBlackout(
  events: EconEvent[],
  currencies: string[],
  now: number,
  beforeMin: number,
  afterMin: number,
  impact: "high" | "med_high"
): EconEvent | null {
  if (currencies.length === 0) return null;
  for (const e of events) {
    if (e.impact !== "high" && !(impact === "med_high" && e.impact === "medium")) continue;
    if (!currencies.includes(e.currency) && e.currency !== "ALL") continue;
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    if (now >= t - beforeMin * 60_000 && now <= t + afterMin * 60_000) return e;
  }
  return null;
}

/** pure: which enabled sessions are open at `now` (UTC) */
export function openSessions(now: number, sessions: Record<SessionKey, boolean>): SessionKey[] {
  const h = new Date(now).getUTCHours();
  return (Object.keys(SESSION_HOURS) as SessionKey[]).filter((k) => sessions[k] && h >= SESSION_HOURS[k].from && h < SESSION_HOURS[k].to);
}

export interface FilterVerdict {
  allow: boolean;
  reason: string;
  /** set when the calendar could not be read (blackout then cannot protect) */
  warning?: string;
}

export async function checkEntryFilters(symbol: string, f: FilterSettings, now = Date.now()): Promise<FilterVerdict> {
  if (f.sessionEnabled) {
    if (!(Object.values(f.sessions) as boolean[]).some(Boolean)) return { allow: false, reason: "session filter: no session is selected" };
    if (openSessions(now, f.sessions).length === 0) {
      const chosen = (Object.keys(SESSION_HOURS) as SessionKey[])
        .filter((k) => f.sessions[k])
        .map((k) => `${SESSION_HOURS[k].label} ${String(SESSION_HOURS[k].from).padStart(2, "0")}–${SESSION_HOURS[k].to}h UTC`)
        .join(", ");
      return { allow: false, reason: `session filter: outside the chosen sessions (${chosen})` };
    }
  }
  if (f.newsEnabled) {
    const currencies = newsCurrencies(symbol);
    if (currencies.length > 0) {
      const cal = await getCalendar("this_week", f.newsImpact).catch(() => null);
      if (!cal || !cal.ok) {
        // the calendar feed is down: say so, but do not silently stop all trading
        return { allow: true, reason: "", warning: `news blackout inactive — economic calendar unavailable${cal?.error ? ` (${cal.error})` : ""}` };
      }
      const hit = newsBlackout(cal.events, currencies, now, f.newsBeforeMin, f.newsAfterMin, f.newsImpact);
      if (hit) {
        const at = new Date(hit.date).toISOString().slice(11, 16);
        return { allow: false, reason: `news blackout: ${hit.currency} ${hit.title} (${hit.impact} impact) at ${at} UTC` };
      }
    }
  }
  return { allow: true, reason: "" };
}
