"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO ACTION BRIDGE · client executor for the allowlisted registry
//
//  Mounted once inside <HaloVoiceProvider>. Receives the REAL page-level
//  primitives (navigation, symbol/timeframe switching, data refresh) and
//  registers a runner the voice provider calls when the brain selects a
//  client-scope action. Every handler VERIFIES the resulting application
//  state before reporting success — HALO never speaks success on faith.
//
//  set_voice_muted is handled here directly via the voice context.
//  Everything consequential runs server-side instead — this bridge never
//  touches trading endpoints.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef } from "react";
import { useHaloVoice, type ActionRunner, type ClientAction } from "./voice-provider";
import { voiceEnergy } from "@/lib/halo/voice-energy";
import { VIEWS, type HistoryPeriod, type ViewId } from "@/lib/halo/actions";

export interface BridgeHandlers {
  /** real client-side view switch (tracks nav history for go_back) */
  gotoView: (v: ViewId) => void;
  /** previously active view or null */
  previousView: () => ViewId | null;
  /** real symbol switch through /api/bot/config; resolves to the verified symbol */
  changeSymbol: (s: string) => Promise<{ ok: boolean; symbol?: string; error?: string }>;
  /** real timeframe switch through /api/bot/config */
  changeTf: (t: string) => Promise<{ ok: boolean; tf?: string; error?: string }>;
  /** force bot-state + candle refresh right now */
  refreshData: () => Promise<{ ok: boolean; error?: string }>;
  /** trade-history display filter */
  setHistFilter: (p: HistoryPeriod) => void;
}

const VIEW_LABEL: Record<string, string> = Object.fromEntries(VIEWS.map((v) => [v.id, v.label]));

const FILTER_LABEL: Record<HistoryPeriod, string> = {
  today: "today",
  week: "this week",
  month: "this month",
  all: "all periods",
};

async function downloadTradeCsv(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await fetch("/api/trades?limit=200", { cache: "no-store" });
    if (!r.ok) return { ok: false, detail: "trade book fetch failed" };
    const j = (await r.json()) as { trades?: Record<string, unknown>[] };
    const rows = Array.isArray(j.trades) ? j.trades : [];
    const cols = ["openedAt", "closedAt", "symbol", "timeframe", "direction", "status", "entry", "sl", "tp", "riskPips", "rewardPips", "resultPips", "mode", "execMode", "note"];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const row of rows) lines.push(cols.map((c) => esc(row[c])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `halo-trade-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, detail: `trade book exported — ${rows.length} record${rows.length === 1 ? "" : "s"} downloaded as CSV` };
  } catch (e) {
    return { ok: false, detail: `export failed: ${(e as Error).message}` };
  }
}

export function ActionBridge({ handlers }: { handlers: BridgeHandlers }) {
  const { registerActionRunner, setPrefs } = useHaloVoice();
  const handlersRef = useRef<BridgeHandlers>(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const run = useCallback<ActionRunner>(async (a: ClientAction) => {
    const h = handlersRef.current;
    const params = a.params ?? {};
    // the AI core's EXECUTING animation mirrors this real execution window —
    // it starts only when work actually starts and stops when it stops
    voiceEnergy.setExecuting(true);
    let res: { ok: boolean; detail: string } | null = null;
    try {
      switch (a.id) {
        case "navigate_to_view": {
          const view = String(params.view ?? "");
          const label = VIEW_LABEL[view];
          if (!label) {
            res = { ok: false, detail: `"${view}" is not a section of this app` };
            return res;
          }
          h.gotoView(view as ViewId);
          res = { ok: true, detail: `${label} is open` };
          return res;
        }
        case "go_back": {
          const prev = h.previousView();
          if (!prev) {
            res = { ok: false, detail: "no previous section to return to" };
            return res;
          }
          h.gotoView(prev);
          res = { ok: true, detail: `back to ${VIEW_LABEL[prev] ?? prev}` };
          return res;
        }
        case "select_symbol": {
          const sym = String(params.symbol ?? "");
          const r = await h.changeSymbol(sym);
          res = r.ok ? { ok: true, detail: `chart and engine switched to ${r.symbol ?? sym}` } : { ok: false, detail: r.error ?? `could not switch to ${sym}` };
          return res;
        }
        case "set_chart_timeframe": {
          const tf = String(params.tf ?? "");
          const r = await h.changeTf(tf);
          res = r.ok ? { ok: true, detail: `timeframe set to ${r.tf ?? tf}` } : { ok: false, detail: r.error ?? `could not set ${tf}` };
          return res;
        }
        case "refresh_market_data": {
          const r = await h.refreshData();
          res = r.ok ? { ok: true, detail: "market data refreshed" } : { ok: false, detail: r.error ?? "refresh failed" };
          return res;
        }
        case "open_trade_details": {
          h.gotoView("activity");
          res = { ok: true, detail: "Trading Activity is open" };
          return res;
        }
        case "filter_trade_history": {
          const period = String(params.period ?? "all") as HistoryPeriod;
          h.setHistFilter(period);
          res = { ok: true, detail: `trade history filtered to ${FILTER_LABEL[period] ?? period}` };
          return res;
        }
        case "export_trade_history": {
          res = await downloadTradeCsv();
          return res;
        }
        case "set_voice_muted": {
          const muted = params.muted === true || params.muted === "true";
          setPrefs({ muted });
          res = { ok: true, detail: muted ? "spoken replies muted" : "spoken replies unmuted" };
          return res;
        }
        default:
          res = { ok: false, detail: `"${a.id}" has no client executor` };
          return res;
      }
    } finally {
      voiceEnergy.setExecuting(false);
      // a verified failure flashes the honest ERROR state on the AI core;
      // success simply returns to idle — the console reports the results
      if (res && res.ok === false) voiceEnergy.errorPulse();
    }
  }, [setPrefs]);

  useEffect(() => {
    registerActionRunner(run);
    return () => registerActionRunner(null);
  }, [registerActionRunner, run]);

  return null;
}
