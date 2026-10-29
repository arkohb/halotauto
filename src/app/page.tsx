"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL AUTOTRADER · main PWA page — command-center edition
//
//  SHELL    : left nav rail (desktop) / chip bar (mobile) + top bar
//  DASHBOARD: market pulse · AI core · risk guardian · chart · activity
//             · strategy explanation · performance · briefing · AI chat rail
//  VIEWS    : market(scanner) · activity · risk · strategy lab(backtest)
//             · performance · brokers · alerts · settings
//
//  Every card reads the same real BotStateRes / live-account / trade book
//  feeds as before. Trading behaviour, engine and endpoints untouched.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { Candle } from "@/lib/halo/types";
import type { HaloConfig } from "@/lib/halo/types";
import { C, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { Header } from "@/components/halo/header";
import { ControlDeck } from "@/components/halo/control-deck";
import { StatusBanner } from "@/components/halo/status-banner";
import ChartPanel from "@/components/halo/chart-panel";
import { EaAttachCard } from "@/components/halo/ea-attach";
import { TradeCard } from "@/components/halo/trade-card";
import { LevelsCard } from "@/components/halo/levels-card";
import { DashboardPanel } from "@/components/halo/dashboard-panel";
import { Mt5MobileApp } from "@/components/halo/mt5-mobile";
import { SettingsPanel } from "@/components/halo/settings-panel";
import { BotPanel } from "@/components/halo/bot-panel";
import { ExecutionPanel } from "@/components/halo/execution-panel";
import { HistoryPanel } from "@/components/halo/history-panel";
import { BacktestPanel } from "@/components/halo/backtest-panel";
import { BacktestLive } from "@/components/halo/backtest-live";
import { ScannerPanel } from "@/components/halo/scanner-panel";
import { BrokersPanel } from "@/components/halo/brokers-panel";
import { AlertsPanel } from "@/components/halo/alerts-panel";
import { PwaRegister } from "@/components/halo/pwa";
import { FxLayer } from "@/components/halo/fx-layer";
import { BootSequence } from "@/components/halo/boot-sequence";
import { RobotAssistant } from "@/components/halo/robot-assistant";
import { HaloCore } from "@/components/halo/halo-core";
import { JarvisConsole } from "@/components/halo/jarvis-console";
import { HaloVoiceProvider } from "@/components/halo/voice-provider";
import { WelcomeGreeting } from "@/components/halo/welcome-greeting";
import { VoiceSettingsCard } from "@/components/halo/voice-settings-card";
import { MarketPulse } from "@/components/halo/market-pulse";
import { RiskGuardian } from "@/components/halo/risk-guardian";
import { TradingActivity } from "@/components/halo/trading-activity";
import { StrategyExplainer } from "@/components/halo/strategy-explainer";
import { PerformanceIntel } from "@/components/halo/performance-intel";
import { DailyBriefing } from "@/components/halo/daily-briefing";
import { NavRail, NavChips, type HaloView } from "@/components/halo/nav-rail";
import { FxProvider } from "@/lib/halo/fx";
import { FxSettingsCard } from "@/components/halo/fx-settings-card";
import { ActionBridge, type BridgeHandlers } from "@/components/halo/action-bridge";
import type { HistoryPeriod, ViewId } from "@/lib/halo/actions";
import { useMediaQuery } from "@/hooks/use-media-query";

export default function Page() {
  const [state, setState] = useState<BotStateRes | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candleSource, setCandleSource] = useState("—");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<HaloView>("terminal");
  const navHistRef = useRef<ViewId | null>(null);
  const [histFilter, setHistFilter] = useState<HistoryPeriod>("all");
  const [candleNonce, setCandleNonce] = useState(0);
  const statsRef = useRef<string>("");
  const [histKey, setHistKey] = useState(0);
  const { toast } = useToast();

  // voice-operator navigation wrapper — remembers the previous view for go_back
  const gotoView = useCallback((nv: ViewId) => {
    setView((prev) => {
      if (prev !== nv) navHistRef.current = prev;
      return nv;
    });
  }, []);
  const previousView = useCallback((): ViewId | null => navHistRef.current, []);

  // dock the AI assistant as a right rail on xl dashboard screens
  const isXl = useMediaQuery("(min-width: 1280px)");
  const dockAssistant = view === "terminal" && isXl;

  const notify = useCallback(
    (title: string, desc?: string, bad?: boolean) => {
      toast({ title, description: desc, variant: bad ? "destructive" : "default" });
    },
    [toast]
  );

  // ── poll bot state every 2s (also drives the server-side engine) ──
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/bot/state", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as BotStateRes;
          if (alive) setState(j);
        }
      } catch {
        // keep last state on network hiccups
      }
    };
    void tick();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void tick();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ── poll candles every 3s for the chart ──
  const symbol = state?.symbol ?? "PAXGUSDT";
  const tf = state?.tf ?? "5m";
  useEffect(() => {
    let alive = true;
    setCandles([]);
    const tick = async () => {
      try {
        const r = await fetch(`/api/market/candles?symbol=${symbol}&tf=${tf}&limit=260`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { candles: Candle[]; source: string; symbol: string; tf: string };
          if (alive && Array.isArray(j.candles) && j.symbol === symbol && j.tf === tf) {
            setCandles(j.candles);
            setCandleSource(j.source);
          }
        }
      } catch {
        // ignore
      }
    };
    void tick();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void tick();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, tf, candleNonce]);

  // refresh history when a trade closes
  useEffect(() => {
    if (!state) return;
    const s = state.engine.stats;
    const key = `${s.wins}:${s.losses}`;
    if (statsRef.current && statsRef.current !== key) setHistKey((k) => k + 1);
    statsRef.current = key;
  }, [state]);

  // ── actions ──
  const control = useCallback(
    async (action: "start" | "stop" | "reset" | "close") => {
      setBusy(action);
      try {
        const r = await fetch("/api/bot/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) setState(j.state);
        if (!j.ok) toast({ title: `Cannot ${action}`, description: j.error, variant: "destructive" });
        if (j.ok && action === "start")
          toast({ title: "EA BOT STARTED", description: "Scanning for C1/C2 equal levels · auto-executing C3 fires." });
        if (j.ok && action === "stop")
          toast({ title: "EA BOT STOPPED", description: "Engine keeps watching — no new executions." });
        if (j.ok && action === "reset")
          toast({ title: "ENGINE RESET", description: "Fresh levels and counters cleared, engine re-warmed." });
        if (j.ok && action === "close")
          toast({ title: "POSITION CLOSED", description: "Trade flattened at market and result booked." });
      } catch (e) {
        toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  const setExecMode = useCallback(
    async (mode: "paper" | "live") => {
      setBusy("exec");
      try {
        const r = await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exec: { executionMode: mode } }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) setState(j.state);
        if (j.ok)
          toast({
            title: mode === "live" ? "LIVE ORDER ROUTING ON" : "PAPER MODE ON",
            description:
              mode === "live"
                ? "C3 fires now go to the active broker with real SL/TP."
                : "All fills simulated — safe to experiment.",
            variant: mode === "live" ? "destructive" : "default",
          });
        else toast({ title: "Mode change rejected", description: j.error, variant: "destructive" });
      } catch (e) {
        toast({ title: "Mode change failed", description: (e as Error).message, variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  const saveConfig = useCallback(
    async (cfg: HaloConfig) => {
      setSaving(true);
      try {
        const r = await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cfg }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) setState(j.state);
        if (!j.ok) toast({ title: "Settings rejected", description: j.error, variant: "destructive" });
      } catch (e) {
        toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
      } finally {
        setSaving(false);
      }
    },
    [toast]
  );

  const changeSymbol = useCallback(
    async (s: string): Promise<{ ok: boolean; symbol?: string; error?: string }> => {
      setBusy("symbol");
      try {
        const r = await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: s }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) {
          setState(j.state);
          // verify the runtime actually reports the requested symbol
          return j.state.symbol === s ? { ok: true, symbol: j.state.symbol } : { ok: false, error: `engine reports ${j.state.symbol} instead of ${s}` };
        }
        return { ok: false, error: j.error ?? "the server rejected the switch" };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  const changeTf = useCallback(
    async (t: string): Promise<{ ok: boolean; tf?: string; error?: string }> => {
      setBusy("tf");
      try {
        const r = await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tf: t }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) {
          setState(j.state);
          return j.state.tf === t ? { ok: true, tf: j.state.tf } : { ok: false, error: `engine reports ${j.state.tf} instead of ${t}` };
        }
        return { ok: false, error: j.error ?? "the server rejected the switch" };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  // voice operator: force a fresh bot-state + candle pull right now
  const refreshData = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch("/api/bot/state", { cache: "no-store" });
      if (r.ok) setState((await r.json()) as BotStateRes);
      setCandleNonce((n) => n + 1);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, []);

  const jumpToSymbol = useCallback(
    (sym: string) => {
      gotoView("terminal");
      void changeSymbol(sym);
    },
    [changeSymbol, gotoView]
  );

  // voice-operator client executor (registry → real app functions)
  const bridgeHandlers: BridgeHandlers = {
    gotoView,
    previousView,
    changeSymbol,
    changeTf,
    refreshData,
    setHistFilter,
  };

  if (!state) {
    return (
      <FxProvider>
        <div className="flex min-h-screen flex-col text-[#E8ECF4]">
          <FxLayer />
          <div className="mx-auto flex w-full max-w-[1720px] flex-1 flex-col gap-4 px-4 py-8">
            <Skeleton className="h-14 w-full rounded-xl bg-[#101C33]" />
            <Skeleton className="h-10 w-72 rounded-lg bg-[#101C33]" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)_350px]">
              <Skeleton className="h-96 rounded-xl bg-[#101C33]" />
              <Skeleton className="h-[540px] rounded-xl bg-[#101C33]" />
              <Skeleton className="h-96 rounded-xl bg-[#101C33]" />
            </div>
          </div>
        </div>
      </FxProvider>
    );
  }

  return (
    <FxProvider>
      <HaloVoiceProvider snapshot={state}>
      <ActionBridge handlers={bridgeHandlers} />
      <div className="flex min-h-screen flex-col text-[#E8ECF4]">
        <FxLayer />
        <BootSequence />
        <PwaRegister />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header state={state} busy={busy} onSymbol={changeSymbol} onTf={changeTf} />
          <NavChips view={view} onView={gotoView} />

          <div className="flex min-w-0 flex-1 items-start">
            <NavRail view={view} onView={gotoView} />

            <main key={view} className="halo-view-in min-w-0 flex-1 px-3 py-4 lg:px-4">
              {/* ════════ DASHBOARD (command center) ════════ */}
              {view === "terminal" && (
                <div className="grid grid-cols-12 gap-3">
                  {/* row 0 · personalized welcome + assistant status */}
                  <div className="col-span-12">
                    <WelcomeGreeting />
                  </div>

                  {/* row 1 · market pulse / AI core / risk guardian / assistant rail */}
                  <div className="col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3">
                    <MarketPulse state={state} candles={candles} />
                  </div>
                  <div className="col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3">
                    <HaloCore state={state} />
                  </div>
                  <div className="col-span-12 lg:col-span-4 xl:col-span-3">
                    <RiskGuardian state={state} />
                  </div>
                  {dockAssistant && (
                    <div className="col-span-12 min-h-0 xl:col-span-3 xl:row-span-2">
                      <JarvisConsole variant="docked" />
                    </div>
                  )}

                {/* row 2 · chart + trading activity */}
                <div className="col-span-12 min-w-0 space-y-3 xl:col-span-6">
                  <StatusBanner state={state} />
                  <ChartPanel
                    candles={candles}
                    drawings={state.engine.drawings}
                    log={state.engine.log}
                    trade={state.engine.trade}
                    mintick={state.mintick}
                    symbol={state.symbol}
                    tf={state.tf}
                    source={candleSource}
                    statusLine={statusOf(state).text}
                    routing={
                      state.exec.executionMode === "live"
                        ? `LIVE → ${state.exec.broker?.label ?? "broker"}`
                        : "PAPER"
                    }
                    enabled={state.enabled}
                    autoAttach={state.autoAttach}
                    busy={busy}
                    onToggleBot={() => void control(state.enabled ? "stop" : "start")}
                    onSymbol={(s) => void changeSymbol(s)}
                    onTf={(t) => void changeTf(t)}
                    cfg={state.config}
                    atr={state.engine.atr}
                    price={state.feed.price}
                  />
                </div>
                <div className="col-span-12 min-h-[320px] md:col-span-6 xl:col-span-3">
                  <TradingActivity state={state} histKey={histKey} />
                </div>

                {/* row 3 · explanation / performance / briefing */}
                <div className="col-span-12 min-h-[300px] xl:col-span-6">
                  <StrategyExplainer state={state} />
                </div>
                <div className="col-span-12 sm:col-span-6 xl:col-span-3">
                  <PerformanceIntel refreshKey={histKey} />
                </div>
                <div className="col-span-12 sm:col-span-6 xl:col-span-3">
                  <DailyBriefing state={state} />
                </div>

                {/* row 4 · quick actions deck */}
                <div className="col-span-12">
                  <ControlDeck
                    state={state}
                    busy={busy}
                    view={view}
                    onView={(v) => gotoView(v)}
                    onControl={control}
                    onExecMode={setExecMode}
                  />
                </div>
              </div>
            )}

            {/* ════════ MARKET · multi-symbol scanner ════════ */}
            {view === "scanner" && <ScannerPanel notify={notify} onJumpToSymbol={jumpToSymbol} />}

            {/* ════════ TRADING ACTIVITY ════════ */}
            {view === "activity" && (
              <div className="space-y-4">
                <TradeCard state={state} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Mt5MobileApp notify={notify} />
                  <HistoryPanel mintick={state.mintick} refreshKey={histKey} filter={histFilter} />
                </div>
              </div>
            )}

            {/* ════════ RISK GUARDIAN ════════ */}
            {view === "risk" && (
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <RiskGuardian state={state} />
                  <LevelsCard state={state} />
                </div>
                <div className="space-y-4">
                  <BotPanel
                    state={state}
                    busy={busy}
                    onStart={() => control("start")}
                    onStop={() => control("stop")}
                    onReset={() => control("reset")}
                  />
                  <ExecutionPanel state={state} onSaved={(m) => notify(m)} onError={(t, d) => notify(t, d, true)} />
                </div>
              </div>
            )}

            {/* ════════ STRATEGY LAB · real-data backtests ════════ */}
            {view === "backtest" && (
              <div className="space-y-6">
                <BacktestLive symbol={state.symbol} tf={state.tf} config={state.config} />
                <BacktestPanel symbol={state.symbol} tf={state.tf} config={state.config} />
              </div>
            )}

            {/* ════════ PERFORMANCE ════════ */}
            {view === "performance" && (
              <div className="grid items-start gap-4 lg:grid-cols-3">
                <DashboardPanel state={state} />
                <PerformanceIntel refreshKey={histKey} />
                <HistoryPanel mintick={state.mintick} refreshKey={histKey} filter={histFilter} />
              </div>
            )}

            {/* ════════ BROKERS ════════ */}
            {view === "brokers" && <BrokersPanel notify={notify} />}

            {/* ════════ ALERTS ════════ */}
            {view === "alerts" && <AlertsPanel notify={notify} />}

            {/* ════════ SETTINGS ════════ */}
            {view === "settings" && (
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
                <SettingsPanel config={state.config} saving={saving} onSave={saveConfig} />
                <div className="space-y-4">
                  <FxSettingsCard />
                  <VoiceSettingsCard />
                  <EaAttachCard
                    state={state}
                    notify={notify}
                    busy={busy}
                    onToggleBot={() => void control(state.enabled ? "stop" : "start")}
                  />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* HALO-B — the robotic face of the EA, present on every view */}
      <RobotAssistant state={state} candles={candles} />

      {/* JARVIS console — floating on non-dashboard / sub-xl screens */}
      {!dockAssistant && <JarvisConsole variant="floating" />}

      <footer className="mt-auto border-t border-[#1C2A47] py-3">
        <div className="mx-auto flex w-full max-w-[1800px] flex-col items-center justify-between gap-1 px-4 text-[10px] tracking-wider text-[#8C98AE] sm:flex-row">
          <span>
            HALO SUITE · 3EL v1.2 · {state.config.sigMode === "instant" ? "INSTANT" : "BAR CLOSE"} MODE ·{" "}
            <span style={{ color: state.exec.executionMode === "live" ? C.red : C.green }}>
              {state.exec.executionMode === "live" ? "LIVE ORDERS" : "PAPER"}
            </span>
          </span>
          <span>
            {state.exec.executionMode === "live"
              ? "Real orders armed — trade at your own risk. Not financial advice."
              : "Paper trading only — not financial advice."}
          </span>
        </div>
      </footer>
      </div>
    </HaloVoiceProvider>
    </FxProvider>
  );
}
