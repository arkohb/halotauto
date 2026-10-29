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
    switch (a.id) {
      case "navigate_to_view": {
        const view = String(params.view ?? "");
        const label = VIEW_LABEL[view];
        if (!label) return { ok: false, detail: `"${view}" is not a section of this app` };
        h.gotoView(view as ViewId);
        return { ok: true, detail: `${label} is open` };
      }
      case "go_back": {
        const prev = h.previousView();
        if (!prev) return { ok: false, detail: "no previous section to return to" };
        h.gotoView(prev);
        return { ok: true, detail: `back to ${VIEW_LABEL[prev] ?? prev}` };
      }
      case "select_symbol": {
        const sym = String(params.symbol ?? "");
        const res = await h.changeSymbol(sym);
        return res.ok ? { ok: true, detail: `chart and engine switched to ${res.symbol ?? sym}` } : { ok: false, detail: res.error ?? `could not switch to ${sym}` };
      }
      case "set_chart_timeframe": {
        const tf = String(params.tf ?? "");
        const res = await h.changeTf(tf);
        return res.ok ? { ok: true, detail: `timeframe set to ${res.tf ?? tf}` } : { ok: false, detail: res.error ?? `could not set ${tf}` };
      }
      case "refresh_market_data": {
        const res = await h.refreshData();
        return res.ok ? { ok: true, detail: "market data refreshed" } : { ok: false, detail: res.error ?? "refresh failed" };
      }
      case "open_trade_details": {
        h.gotoView("activity");
        return { ok: true, detail: "Trading Activity is open" };
      }
      case "filter_trade_history": {
        const period = String(params.period ?? "all") as HistoryPeriod;
        h.setHistFilter(period);
        return { ok: true, detail: `trade history filtered to ${FILTER_LABEL[period] ?? period}` };
      }
      case "export_trade_history": {
        return downloadTradeCsv();
      }
      case "set_voice_muted": {
        const muted = params.muted === true || params.muted === "true";
        setPrefs({ muted });
        return { ok: true, detail: muted ? "spoken replies muted" : "spoken replies unmuted" };
      }
      default:
        return { ok: false, detail: `"${a.id}" has no client executor` };
    }
  }, [setPrefs]);

  useEffect(() => {
    registerActionRunner(run);
    return () => registerActionRunner(null);
  }, [registerActionRunner, run]);

  return null;
}
