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
import { Activity, Bell, BookOpen, FlaskConical, Globe, Landmark, Mic, Radar, ScrollText, Settings, ShieldCheck, SunMedium, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { Candle } from "@/lib/halo/types";
import type { HaloConfig } from "@/lib/halo/types";
import { A, C, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PageHeader } from "@/components/halo/panel";
import { Header } from "@/components/halo/header";
import { ControlDeck } from "@/components/halo/control-deck";
import { StatusBanner } from "@/components/halo/status-banner";
import ChartPanel from "@/components/halo/chart-panel";
import { EaAttachCard } from "@/components/halo/ea-attach";
import { TradeCard } from "@/components/halo/trade-card";
import { QuickActions } from "@/components/halo/quick-actions";
import { LevelsCard } from "@/components/halo/levels-card";
import { MarketConditions } from "@/components/halo/market-conditions";
import { DashboardPanel } from "@/components/halo/dashboard-panel";
import { Mt5MobileApp } from "@/components/halo/mt5-mobile";
import { SettingsPanel } from "@/components/halo/settings-panel";
import { BotPanel } from "@/components/halo/bot-panel";
import { ExecutionPanel } from "@/components/halo/execution-panel";
import { HistoryPanel } from "@/components/halo/history-panel";
import { BacktestPanel } from "@/components/halo/backtest-panel";
import { BacktestLive } from "@/components/halo/backtest-live";
import { ScannerPanel } from "@/components/halo/scanner-panel";
import { IntelPanel } from "@/components/halo/intel-panel";
import { BrokersPanel } from "@/components/halo/brokers-panel";
import { AlertsPanel } from "@/components/halo/alerts-panel";
import { PwaRegister } from "@/components/halo/pwa";
import { UpdateAlert } from "@/components/halo/update-alert";
import { FxLayer } from "@/components/halo/fx-layer";
import { BootSequence } from "@/components/halo/boot-sequence";
import { RobotAssistant } from "@/components/halo/robot-assistant";
import { HaloCore } from "@/components/halo/halo-core";
import { JarvisConsole } from "@/components/halo/jarvis-console";
import { HaloVoiceProvider } from "@/components/halo/voice-provider";
import { BotAnnouncer } from "@/components/halo/bot-announcer";
import { WelcomeGreeting } from "@/components/halo/welcome-greeting";
import { WelcomeOverlay } from "@/components/halo/welcome-overlay";
import { VoiceSettingsCard } from "@/components/halo/voice-settings-card";
import { MarketPulse } from "@/components/halo/market-pulse";
import { RiskGuardian } from "@/components/halo/risk-guardian";
import { TradingActivity } from "@/components/halo/trading-activity";
import { StrategyExplainer } from "@/components/halo/strategy-explainer";
import { PerformanceIntel } from "@/components/halo/performance-intel";
import { DailyBriefing } from "@/components/halo/daily-briefing";
import { MarketOverview } from "@/components/halo/market-overview";
import { AccountSummary } from "@/components/halo/account-summary";
import { LatestSignal, MonitorStatus, RecentTrades } from "@/components/halo/dashboard-strip";
import { NavRail, NavChips, type HaloView } from "@/components/halo/nav-rail";
import { StrategyStudio } from "@/components/halo/strategy-studio";
import { AuthGate } from "@/components/halo/auth-gate";
import { FxProvider } from "@/lib/halo/fx";
import { FxSettingsCard } from "@/components/halo/fx-settings-card";
import { ActionBridge, type BridgeHandlers } from "@/components/halo/action-bridge";
import { HISTORY_PERIODS, type HistoryPeriod, type ViewId } from "@/lib/halo/actions";

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
  const notify = useCallback(
    (title: string, desc?: string, bad?: boolean) => {
      toast({ title, description: desc, variant: bad ? "destructive" : "default" });
    },
    [toast]
  );

  // ── poll bot state every 2s (also drives the server-side engine) ──
  // identical JSON → every card would render the exact same output, so the
  // React update is skipped (quiet markets / weekends stop the 2s churn;
  // price-driven re-renders still flow whenever the feed actually moves)
  const lastStateSig = useRef<string>("");
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/bot/state", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as BotStateRes;
          if (!alive) return;
          const sig = JSON.stringify(j);
          if (sig === lastStateSig.current) return;
          lastStateSig.current = sig;
          setState(j);
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
          if (j.state.symbol !== s) {
            const err = `engine reports ${j.state.symbol} instead of ${s}`;
            toast({ title: "Symbol switch failed", description: err, variant: "destructive" });
            return { ok: false, error: err };
          }
          return { ok: true, symbol: j.state.symbol };
        }
        const err = j.error ?? "the server rejected the switch";
        toast({ title: "Symbol switch failed", description: err, variant: "destructive" });
        return { ok: false, error: err };
      } catch (e) {
        const err = (e as Error).message;
        toast({ title: "Symbol switch failed", description: err, variant: "destructive" });
        return { ok: false, error: err };
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
          if (j.state.tf !== t) {
            const err = `engine reports ${j.state.tf} instead of ${t}`;
            toast({ title: "Timeframe switch failed", description: err, variant: "destructive" });
            return { ok: false, error: err };
          }
          return { ok: true, tf: j.state.tf };
        }
        const err = j.error ?? "the server rejected the switch";
        toast({ title: "Timeframe switch failed", description: err, variant: "destructive" });
        return { ok: false, error: err };
      } catch (e) {
        const err = (e as Error).message;
        toast({ title: "Timeframe switch failed", description: err, variant: "destructive" });
        return { ok: false, error: err };
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
        <div className="flex min-h-screen flex-col text-[#EAF3FF]">
          <FxLayer />
          <div className="mx-auto flex w-full max-w-[1720px] flex-1 flex-col gap-4 px-4 py-8">
            <Skeleton className="h-14 w-full rounded-xl bg-[#041428]" />
            <Skeleton className="h-10 w-72 rounded-lg bg-[#041428]" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_minmax(0,1fr)_350px]">
              <Skeleton className="h-96 rounded-xl bg-[#041428]" />
              <Skeleton className="h-[540px] rounded-xl bg-[#041428]" />
              <Skeleton className="h-96 rounded-xl bg-[#041428]" />
            </div>
          </div>
        </div>
      </FxProvider>
    );
  }

  return (
    <FxProvider>
      <AuthGate />
      <HaloVoiceProvider snapshot={state}>
      <ActionBridge handlers={bridgeHandlers} />
      <div className="flex min-h-screen flex-col text-[#EAF3FF]">
        <FxLayer />
        <BootSequence />
        <PwaRegister />
        {/* floating "new version deployed — reload to apply" alert (version
            poll + service-worker update detection; silent until a change) */}
        <UpdateAlert />
        {/* personalized JARVIS welcome — raised by the voice provider once per
            session (full on first opening, short welcome-back afterwards);
            the dashboard renders and polls underneath the whole time */}
        <WelcomeOverlay />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header state={state} busy={busy} onSymbol={changeSymbol} onTf={changeTf} />
          <NavChips view={view} onView={gotoView} />

          <div className="flex min-w-0 flex-1 items-start">
            <NavRail view={view} onView={gotoView} />

            <main key={view} className="halo-view-in min-w-0 flex-1 px-3 py-4 lg:px-4">
              {/* ════════ DASHBOARD (command center · mockup 01) ════════ */}
              {view === "terminal" && (
                <div className="grid grid-cols-12 gap-3">
                  {/* row 0 · personalized welcome + assistant status */}
                  <div className="col-span-12">
                    <WelcomeGreeting />
                  </div>

                  {/* row 1 · the chart + the AI right rail (orb · market overview · account) */}
                  <div className="col-span-12 min-w-0 space-y-3 xl:col-span-8">
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
                      pineStrategy={state.strategy && state.strategy.selected.kind === "pine" && state.strategy.selected.id ? { id: state.strategy.selected.id, name: state.strategy.selected.name } : null}
                    />
                  </div>
                  <div className="col-span-12 space-y-3 md:col-span-6 xl:col-span-4">
                    <HaloCore state={state} />
                    <MarketOverview state={state} />
                    <AccountSummary />
                  </div>

                  {/* row 2 · signal / monitoring / recent trades (mockup bottom row) */}
                  <div className="col-span-12 md:col-span-6 xl:col-span-4">
                    <LatestSignal state={state} />
                  </div>
                  <div className="col-span-12 md:col-span-6 xl:col-span-4">
                    <MonitorStatus state={state} />
                  </div>
                  <div className="col-span-12 min-h-[260px] xl:col-span-4">
                    <RecentTrades onOpenHistory={() => gotoView("trade-history")} />
                  </div>

                  {/* row 3 · live book + risk posture */}
                  <div className="col-span-12 min-h-[320px] xl:col-span-7">
                    <TradingActivity state={state} histKey={histKey} />
                  </div>
                  <div className="col-span-12 xl:col-span-5">
                    <RiskGuardian state={state} />
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
            {view === "scanner" && (
              <>
                <PageHeader
                  icon={Radar}
                  title="MARKET SCANNER"
                  sub="Every watchlist symbol runs the full 3EL engine — live formations, armed levels and per-symbol auto-trade switches."
                />
                <ScannerPanel notify={notify} onJumpToSymbol={jumpToSymbol} />
              </>
            )}

            {/* ════════ MARKET INTELLIGENCE (mockup 02) ════════ */}
            {view === "intel" && (
              <div className="grid grid-cols-12 gap-3">
                <PageHeader
                  className="col-span-full"
                  icon={Globe}
                  title="Market Intelligence"
                  sub="AI-powered market analysis and opportunities — live chart, armed levels and external feeds, sources stamped, nothing invented."
                />
                <div className="col-span-12 min-w-0 xl:col-span-8">
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
                    pineStrategy={state.strategy && state.strategy.selected.kind === "pine" && state.strategy.selected.id ? { id: state.strategy.selected.id, name: state.strategy.selected.name } : null}
                  />
                </div>
                <div className="col-span-12 space-y-3 xl:col-span-4">
                  <MarketPulse state={state} candles={candles} />
                  <MarketConditions state={state} candles={candles} />
                  <LevelsCard state={state} />
                </div>
                <div className="col-span-12">
                  <IntelPanel />
                </div>
              </div>
            )}

            {/* ════════ TRADING ACTIVITY (mockup 03) ════════ */}
            {view === "activity" && (
              <div className="space-y-4">
                <PageHeader
                  icon={Activity}
                  title="Trading Activity"
                  sub="Manage your active trades — open positions, orders and the engine log, exactly what the broker and the 3EL engine report."
                />
                <TradeCard state={state} />
                <TradingActivity state={state} histKey={histKey} />
                <QuickActions state={state} notify={notify} />
                <div className="grid gap-4 lg:grid-cols-2">
                  <Mt5MobileApp notify={notify} />
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

            {/* ════════ RISK GUARDIAN ════════ */}
            {view === "risk" && (
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <PageHeader
                  className="col-span-full"
                  icon={ShieldCheck}
                  title="RISK GUARDIAN"
                  sub="Account posture, armed levels, execution routing and engine controls — verified against the live broker feed."
                  right={
                    <span
                      className="rounded-full px-2 py-0.5 text-[8px] font-extrabold tracking-[0.12em]"
                      style={{
                        background: state.exec.executionMode === "live" ? "rgba(255,77,94,0.12)" : "rgba(0,214,143,0.12)",
                        color: state.exec.executionMode === "live" ? C.red : C.green,
                      }}
                    >
                      {state.exec.executionMode === "live" ? "LIVE ROUTING" : "PAPER ROUTING"}
                    </span>
                  }
                />
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

            {/* ════════ STRATEGY STUDIO · Pine Script → indicator → auto-trade ════════ */}
            {view === "strategies" && <StrategyStudio state={state} notify={notify} />}

            {/* ════════ TRADE HISTORY (mockup 04) ════════ */}
            {view === "trade-history" && (
              <div className="space-y-4">
                <PageHeader
                  icon={ScrollText}
                  title="Trade History"
                  sub="View and analyse your past trades — the DB-backed bot book with period filters."
                  right={
                    <div className="flex gap-1">
                      {HISTORY_PERIODS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setHistFilter(p)}
                          aria-pressed={histFilter === p}
                          className="rounded-lg px-2.5 py-1 text-[9px] font-extrabold tracking-[0.12em] transition-colors"
                          style={{
                            background: histFilter === p ? A.cyan(0.12) : "transparent",
                            color: histFilter === p ? C.cyan : C.label,
                            boxShadow: `inset 0 0 0 1px ${histFilter === p ? A.cyan(0.35) : C.lineInner}`,
                          }}
                        >
                          {p === "all" ? "ALL" : p.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  }
                />
                <HistoryPanel mintick={state.mintick} refreshKey={histKey} filter={histFilter} />
              </div>
            )}

            {/* ════════ DAILY BRIEFING ════════ */}
            {view === "briefing" && (
              <div className="space-y-4">
                <PageHeader
                  icon={SunMedium}
                  title="Daily Briefing"
                  sub="The engine's honest read of the session — posture, levels and what the co-pilot is watching right now."
                />
                <DailyBriefing state={state} />
              </div>
            )}

            {/* ════════ LEARNING MISSIONS ════════ */}
            {view === "learning" && (
              <div className="space-y-4">
                <PageHeader
                  icon={BookOpen}
                  title="Learning Missions"
                  sub="Master the 3EL method — how C1 / C2 formations arm, what the C3 trigger means, and how the engine manages a live trade."
                />
                <StrategyExplainer state={state} />
              </div>
            )}

            {/* ════════ HALO VOICE COMMAND CENTER (mockup 08) ════════ */}
            {view === "voice" && (
              <div className="grid grid-cols-12 gap-3">
                <PageHeader
                  className="col-span-full"
                  icon={Mic}
                  title="Voice Command Center"
                  sub="Talk to HALO — say the wake word, type in the console, or run the allowlisted operator actions."
                />
                <div className="col-span-12 min-h-[560px] xl:col-span-8">
                  <JarvisConsole variant="docked" />
                </div>
                <div className="col-span-12 space-y-3 xl:col-span-4">
                  <HaloCore state={state} />
                  <VoiceSettingsCard />
                </div>
              </div>
            )}

            {/* ════════ STRATEGY LAB · real-data backtests ════════ */}
            {view === "backtest" && (
              <div className="space-y-6">
                <PageHeader
                  icon={FlaskConical}
                  title="STRATEGY LAB"
                  sub="Replay and backtest the 3EL strategy over real market history — no synthetic data, ever."
                />
                <BacktestLive symbol={state.symbol} tf={state.tf} config={state.config} />
                <BacktestPanel symbol={state.symbol} tf={state.tf} config={state.config} />
              </div>
            )}

            {/* ════════ PERFORMANCE ════════ */}
            {view === "performance" && (
              <div className="grid items-start gap-4 lg:grid-cols-3">
                <PageHeader
                  className="col-span-full"
                  icon={TrendingUp}
                  title="PERFORMANCE"
                  sub="The Pine dashboard mirror and the closed-trade book — win rate, profit factor, expectancy, drawdown."
                />
                <DashboardPanel state={state} />
                <PerformanceIntel refreshKey={histKey} />
                <HistoryPanel mintick={state.mintick} refreshKey={histKey} filter={histFilter} />
              </div>
            )}

            {/* ════════ BROKERS ════════ */}
            {view === "brokers" && (
              <>
                <PageHeader
                  icon={Landmark}
                  title="BROKERS & MT5"
                  sub="Connect MetaTrader via MetaApi, browse the prop-firm directory and arm live order routing."
                />
                <BrokersPanel notify={notify} />
              </>
            )}

            {/* ════════ ALERTS ════════ */}
            {view === "alerts" && (
              <>
                <PageHeader
                  icon={Bell}
                  title="ALERTS & DELIVERY"
                  sub="Telegram, e-mail and web-push channels with the full event matrix — test fires are real attempts, honestly reported."
                />
                <AlertsPanel notify={notify} />
              </>
            )}

            {/* ════════ SETTINGS ════════ */}
            {view === "settings" && (
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
                <PageHeader
                  className="col-span-full"
                  icon={Settings}
                  title="SETTINGS"
                  sub="Strategy inputs (Pine v1.2), FX ambience, HALO voice & profile, and the TradingView EA bridge."
                />
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

      {/* BOT ANNOUNCER — the bot speaks its strategy events (levels armed
          with their prices, C3 breaks of the dotted line, fired trades,
          TP/SL, ranging-market skips) the moment they happen */}
      <BotAnnouncer />

      {/* JARVIS console — floating on every view; the full-screen console lives in Voice Command */}
      <JarvisConsole variant="floating" />

      <footer className="mt-auto border-t border-[#0F2E58] py-3">
        <div className="mx-auto flex w-full max-w-[1800px] flex-col items-center justify-between gap-1 px-4 text-[10px] tracking-wider text-[#8AA2C2] sm:flex-row">
          <span>
            <span className="font-bold" style={{ color: C.goldDim }}>© {new Date().getFullYear()} · HALO 3EL AUTOTRADER · CREATED BY BISMARK ARKO-OFORI · ALL RIGHTS RESERVED</span>
            {" · "}
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
