"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO 3EL AUTOTRADER · main PWA page
//  TERMINAL: live chart + full strategy settings + EA bot + dashboard
//  SCANNER : multi-symbol 3EL watchlist · BROKERS: real CFD order routing
//  ALERTS  : Telegram / email / browser push
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { Candle } from "@/lib/halo/types";
import type { HaloConfig } from "@/lib/halo/types";
import { C, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { Header } from "@/components/halo/header";
import { ControlDeck, type DeckView } from "@/components/halo/control-deck";
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

type View = DeckView;

export default function Page() {
  const [state, setState] = useState<BotStateRes | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candleSource, setCandleSource] = useState("—");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>("terminal");
  const statsRef = useRef<string>("");
  const [histKey, setHistKey] = useState(0);
  const { toast } = useToast();

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
  }, [symbol, tf]);

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
    async (s: string) => {
      setBusy("symbol");
      try {
        const r = await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: s }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) setState(j.state);
        else toast({ title: "Cannot switch symbol", description: j.error, variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  const changeTf = useCallback(
    async (t: string) => {
      setBusy("tf");
      try {
        const r = await fetch("/api/bot/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tf: t }),
        });
        const j = (await r.json()) as { ok: boolean; state?: BotStateRes; error?: string };
        if (j.ok && j.state) setState(j.state);
        else toast({ title: "Cannot switch timeframe", description: j.error, variant: "destructive" });
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  const jumpToSymbol = useCallback(
    (sym: string) => {
      setView("terminal");
      void changeSymbol(sym);
    },
    [changeSymbol]
  );

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col bg-[#0B1426] text-[#E8ECF4]">
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
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0B1426] text-[#E8ECF4]">
      <PwaRegister />
      <Header state={state} busy={busy} onSymbol={changeSymbol} onTf={changeTf} />

      <main className="mx-auto w-full max-w-[1720px] flex-1 px-3 py-4 lg:px-5">
        <ControlDeck
          state={state}
          busy={busy}
          view={view}
          onView={(v) => setView(v)}
          onControl={control}
          onExecMode={setExecMode}
        />
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="grid w-full max-w-[700px] grid-cols-5 bg-[#101C33] border border-[#1C2A47] rounded-lg h-10 mb-4">
            <TabsTrigger value="terminal" className="text-[11px] font-bold tracking-wider data-[state=active]:text-[#D4AF37]">
              TERMINAL
            </TabsTrigger>
            <TabsTrigger value="scanner" className="text-[11px] font-bold tracking-wider data-[state=active]:text-[#D4AF37]">
              SCANNER
            </TabsTrigger>
            <TabsTrigger value="backtest" className="text-[11px] font-bold tracking-wider data-[state=active]:text-[#D4AF37]">
              BACKTEST
            </TabsTrigger>
            <TabsTrigger value="brokers" className="text-[11px] font-bold tracking-wider data-[state=active]:text-[#D4AF37]">
              BROKERS
            </TabsTrigger>
            <TabsTrigger value="alerts" className="text-[11px] font-bold tracking-wider data-[state=active]:text-[#D4AF37]">
              ALERTS
            </TabsTrigger>
          </TabsList>

          {/* ════════ TERMINAL ════════ */}
          <TabsContent value="terminal" className="mt-0">
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[330px_minmax(0,1fr)_352px]">
              {/* left: settings */}
              <div className="order-3 xl:order-1">
                <SettingsPanel config={state.config} saving={saving} onSave={saveConfig} />
              </div>

              {/* center: banner + chart + trade */}
              <div className="order-1 min-w-0 space-y-4 xl:order-2">
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
                <EaAttachCard
                  state={state}
                  notify={notify}
                  busy={busy}
                  onToggleBot={() => void control(state.enabled ? "stop" : "start")}
                />
                <TradeCard state={state} />
                <LevelsCard state={state} />
              </div>

              {/* right: bot + execution + dashboard + history */}
              <div className="order-2 space-y-4 xl:order-3">
                <BotPanel
                  state={state}
                  busy={busy}
                  onStart={() => control("start")}
                  onStop={() => control("stop")}
                  onReset={() => control("reset")}
                />
                <ExecutionPanel state={state} onSaved={(m) => notify(m)} onError={(t, d) => notify(t, d, true)} />
                <DashboardPanel state={state} />
                <Mt5MobileApp notify={notify} />
                <HistoryPanel mintick={state.mintick} refreshKey={histKey} />
              </div>
            </div>
          </TabsContent>

          {/* ════════ BACKTEST · real-data profitability dashboard ════════ */}
          <TabsContent value="backtest" className="mt-0">
            <div className="space-y-6">
              <BacktestLive symbol={state.symbol} tf={state.tf} config={state.config} />
              <BacktestPanel symbol={state.symbol} tf={state.tf} config={state.config} />
            </div>
          </TabsContent>

          {/* ════════ SCANNER ════════ */}
          <TabsContent value="scanner" className="mt-0">
            <ScannerPanel notify={notify} onJumpToSymbol={jumpToSymbol} />
          </TabsContent>

          {/* ════════ BROKERS ════════ */}
          <TabsContent value="brokers" className="mt-0">
            <BrokersPanel notify={notify} />
          </TabsContent>

          {/* ════════ ALERTS ════════ */}
          <TabsContent value="alerts" className="mt-0">
            <AlertsPanel notify={notify} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-[#1C2A47] py-3">
        <div className="mx-auto flex w-full max-w-[1720px] flex-col items-center justify-between gap-1 px-4 text-[10px] tracking-wider text-[#8C98AE] sm:flex-row">
          <span>
            HALO SUITE · 3EL v1.1 · {state.config.sigMode === "instant" ? "INSTANT" : "BAR CLOSE"} MODE ·{" "}
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
  );
}
