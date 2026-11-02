"use client";

// ════════════════════════════════════════════════════════════════════════
//  EA AUTO-ATTACH CARD · the built-in EA attaches itself to the chart
//  PRIMARY (zero manual steps): the EA engine watches the exact symbol &
//  timeframe shown on the TradingView chart and every C3 fire routes to
//  the linked broker account — attaches automatically on boot.
//  OPTIONAL (collapsed): the Pine webhook bridge for external TradingView
//  alerts — copy Pine EA → TV alert → /api/webhook/tv → same engine.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { A, C } from "@/lib/halo/ui-helpers";
import type { BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";
import { buildPineEa } from "@/lib/pine-ea";

interface WebhookInfo {
  secret: string;
  enabled: boolean;
  fireCount: number;
  lastFireAt: string | null;
}

interface Props {
  state: BotStateRes;
  notify: (title: string, desc?: string, bad?: boolean) => void;
  busy: string | null;
  /** attach (start) / detach (stop) the EA straight from this card */
  onToggleBot: () => void;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-extrabold"
        style={{ background: C.gold, color: C.navy }}
      >
        {n}
      </span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}

export function EaAttachCard({ state, notify, busy, onToggleBot }: Props) {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [pineBusy, setPineBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/webhook/tv", { cache: "no-store" });
      if (r.ok) setInfo((await r.json()) as WebhookInfo);
    } catch {
      // keep old info
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const live = state.exec.executionMode === "live";
  const brokerLabel = state.exec.broker?.label ?? "";
  const attached = state.enabled;
  const routing = live ? `LIVE → ${brokerLabel || "broker"}` : "PAPER";

  const copy = useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify(`${what} COPIED`, "Paste it into TradingView now.");
      } catch {
        notify(`Cannot copy ${what}`, "Clipboard blocked — select and copy manually.", true);
      }
    },
    [notify]
  );

  const copyPine = useCallback(async () => {
    if (!info?.secret) return;
    setPineBusy("pine");
    try {
      await navigator.clipboard.writeText(buildPineEa(info.secret, state.config));
      notify("PINE EA COPIED", "Your bot's settings and secret are embedded — paste into TradingView's Pine Editor.");
    } catch {
      notify("Cannot copy Pine EA", "Clipboard blocked by the browser.", true);
    } finally {
      setPineBusy(null);
    }
  }, [info, notify, state.config]);

  const regenerate = useCallback(async () => {
    setPineBusy("regen");
    try {
      const r = await fetch("/api/webhook/tv/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      const j = (await r.json()) as WebhookInfo & { ok: boolean };
      if (j.ok) {
        setInfo(j);
        notify("SECRET REGENERATED", "Re-paste the Pine EA into TradingView — the old alerts are now rejected.");
      }
    } finally {
      setPineBusy(null);
    }
  }, [notify]);

  const testFire = useCallback(async () => {
    setPineBusy("test");
    try {
      const r = await fetch("/api/webhook/tv/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: state.symbol }),
      });
      const j = (await r.json()) as { ok: boolean; mode?: string; error?: string; detail?: string };
      if (j.ok) {
        notify(
          "TEST FIRE EXECUTED",
          j.detail ?? `Synthetic C3 alert processed → ${j.mode ?? "PAPER"} record created. Check TRADE HISTORY.`
        );
      } else {
        notify("TEST FIRE FAILED", j.error, true);
      }
      void load();
    } catch (e) {
      notify("TEST FIRE FAILED", (e as Error).message, true);
    } finally {
      setPineBusy(null);
    }
  }, [state.symbol, notify, load]);

  const webhookUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/webhook/tv`;
  const toggling = busy === "start" || busy === "stop";

  return (
    <section aria-label="Attach EA to TradingView chart" className="min-w-0">
    <PanelCard
      title="EA · TRADINGVIEW AUTO-ATTACH"
      icon={Puzzle}
      accent="gold"
      bodyClassName="p-4"
      right={
        <>
          {live ? (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-[0.12em]"
              style={{ background: A.gold(0.14), color: C.gold, border: `1px solid ${A.gold(0.45)}` }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: C.gold }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.gold }} />
              </span>
              ARMED · LIVE {brokerLabel ? `→ ${brokerLabel}` : ""}
            </span>
          ) : (
            <span
              className="rounded-full border px-2 py-0.5 text-[9px] font-extrabold tracking-[0.12em]"
              style={{ borderColor: C.line, color: C.muted }}
            >
              SIM ROUTING · PAPER
            </span>
          )}
          <span className="text-[9px] tracking-[0.14em] text-[var(--hx-muted)]">
            WEBHOOK FIRES {info ? info.fireCount : "—"}
          </span>
        </>
      }
    >
      {/* ── PRIMARY · auto-attach panel ── */}
      <div
        className="rounded-lg border p-3"
        style={{
          borderColor: attached ? A.green(0.45) : C.line,
          background: attached ? A.green(0.06) : C.navy,
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-extrabold tracking-wide">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${attached ? "animate-pulse" : ""}`}
                style={{ background: attached ? C.green : C.dim }}
              />
              <span style={{ color: attached ? C.txt : C.muted }}>
                {attached ? "ATTACHED — EA IS WATCHING THIS CHART" : "DETACHED — EA NOT WATCHING"}
              </span>
            </div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-[var(--hx-muted)]">
              {attached ? (
                <>
                  Built-in EA locked to <span className="font-bold text-[var(--hx-txt)]">{state.symbol} · {state.tf}</span> — every C3
                  fire auto-executes on <span style={{ color: live ? C.gold : C.green }}>{routing}</span>. Zero manual steps.
                </>
              ) : (
                <>Press ATTACH EA — the engine re-attaches to the chart instantly and resumes auto-trading.</>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleBot}
            disabled={busy !== null}
            aria-label={attached ? "Detach EA from chart" : "Attach EA to chart"}
            className="rounded-lg px-4 py-2.5 text-[10px] font-extrabold tracking-[0.14em] transition-opacity hover:opacity-90 disabled:opacity-50"
            style={attached ? { border: `1px solid ${C.line}`, background: C.navy2, color: C.txt } : { background: C.gold, color: C.navy }}
          >
            {toggling ? "WORKING…" : attached ? "DETACH EA" : "ATTACH EA"}
          </button>
        </div>

        {/* status mini-row */}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hx-line)] pt-2.5 text-[9px] font-bold tracking-[0.12em] text-[var(--hx-muted)]">
          <span>
            WATCHING <span className="text-[var(--hx-txt)]">{state.symbol} · {state.tf}</span>
          </span>
          <span>
            MODE <span style={{ color: live ? C.gold : C.green }}>{live ? "LIVE ORDERS" : "PAPER"}</span>
          </span>
          <span>
            ROUTING{" "}
            <span className="text-[var(--hx-txt)]">
              {live ? brokerLabel || "broker account" : "simulated fills"}
            </span>
          </span>
          <span>
            AUTO-ATTACH <span style={{ color: state.autoAttach ? C.gold : C.muted }}>{state.autoAttach ? "ON · RE-ATTACHES ON BOOT" : "OFF"}</span>
          </span>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--hx-muted)]">
        The EA attaches itself to the TradingView chart above — switch the symbol or timeframe on the
        chart and the EA follows automatically, scanning for C1/C2 equal levels and sending every C3
        fire to your linked account (MT4/MT5 via MetaApi, OANDA, IG, Binance or any bridge). The Pine
        webhook bridge below is <span className="font-bold text-[var(--hx-txt)]">optional</span> — only for
        forwarding alerts from external TradingView charts into the same engine.
      </p>

      {/* ── OPTIONAL · manual Pine webhook bridge (collapsed) ── */}
      <details className="group mt-3 rounded-lg border border-[var(--hx-line)] bg-[var(--hx-bg)]">
        <summary
          className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] text-[var(--hx-muted)] transition-colors hover:text-[var(--hx-txt)]"
          aria-label="Toggle optional Pine webhook bridge"
        >
          <span>
            OPTIONAL · EXTERNAL TV ALERTS <span style={{ color: C.gold }}>(PINE WEBHOOK BRIDGE)</span>
          </span>
          <span className="text-[9px] transition-transform group-open:rotate-180" aria-hidden>▼</span>
        </summary>

        <div className="border-t border-[var(--hx-line)] p-3">
          {/* actions */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => void copyPine()}
              disabled={!info || pineBusy !== null}
              aria-label="Copy Pine EA source code"
              className="rounded-lg px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: C.gold, color: C.navy }}
            >
              {pineBusy === "pine" ? "COPYING…" : "COPY PINE EA"}
            </button>
            <button
              type="button"
              onClick={() => void copy(webhookUrl, "WEBHOOK URL")}
              aria-label="Copy webhook URL"
              className="rounded-lg border border-[var(--hx-line)] bg-[var(--hx-card2)] px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] text-[var(--hx-txt)] transition-colors hover:bg-[var(--hx-card3)]"
            >
              COPY WEBHOOK URL
            </button>
            <button
              type="button"
              onClick={() => void testFire()}
              disabled={pineBusy !== null}
              aria-label="Send test fire through webhook pipeline"
              className="rounded-lg border border-[var(--hx-line)] bg-[var(--hx-card2)] px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] text-[var(--hx-txt)] transition-colors hover:bg-[var(--hx-card3)] disabled:opacity-50"
            >
              {pineBusy === "test" ? "FIRING…" : "SEND TEST FIRE"}
            </button>
          </div>

          {/* secret + url readouts */}
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-lg border border-[var(--hx-line)] bg-[var(--hx-bg)] px-3 py-2">
              <div className="text-[8px] font-bold tracking-[0.2em] text-[var(--hx-muted)]">WEBHOOK URL</div>
              <div className="truncate font-mono text-[11px] text-[var(--hx-txt)]" title={webhookUrl}>
                {webhookUrl || "…"}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--hx-line)] bg-[var(--hx-bg)] px-3 py-2">
              <div className="min-w-0">
                <div className="text-[8px] font-bold tracking-[0.2em] text-[var(--hx-muted)]">SECRET</div>
                <div className="truncate font-mono text-[11px]" style={{ color: C.gold }}>
                  {info ? info.secret : "…"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => info && void copy(info.secret, "SECRET")}
                aria-label="Copy webhook secret"
                className="rounded border border-[var(--hx-line)] px-2 py-1 text-[9px] font-bold tracking-wider text-[var(--hx-muted)] hover:text-[var(--hx-txt)]"
              >
                COPY
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    aria-label="Regenerate webhook secret"
                    disabled={pineBusy !== null}
                    className="rounded border border-[var(--hx-line)] px-2 py-1 text-[9px] font-bold tracking-wider text-[var(--hx-muted)] hover:text-[var(--hx-red)] disabled:opacity-50"
                  >
                    REGEN
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-[var(--hx-line)] bg-[var(--hx-card)] text-[var(--hx-txt)]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate webhook secret?</AlertDialogTitle>
                    <AlertDialogDescription className="text-[var(--hx-muted)]">
                      Alerts signed with the old secret are rejected immediately. After regenerating,
                      re-copy the Pine EA into TradingView so the new secret is embedded.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-[var(--hx-line)] bg-transparent text-[var(--hx-txt)] hover:bg-[var(--hx-card3)]">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void regenerate()}
                      className="bg-[var(--hx-red)] text-white hover:brightness-90"
                    >
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* steps */}
          <ol className="mt-3 space-y-1.5 rounded-lg border border-[var(--hx-line)] bg-[var(--hx-bg)] p-3 text-[10.5px] text-[var(--hx-muted)]">
            <Step n={1}>
              Press <span style={{ color: C.gold }}>COPY PINE EA</span> → TradingView Pine Editor → paste →
              {" "}“Add to chart”. The webhook secret is already embedded.
            </Step>
            <Step n={2}>
              On TradingView press <span style={{ color: C.gold }}>ALERT</span> → condition “HALO 3EL EA” →
              check <span style={{ color: C.gold }}>Webhook URL</span> → paste the URL above → Create.
            </Step>
            <Step n={3}>
              Go <span style={{ color: C.gold }}>LIVE</span> in HALO with your linked account
              (BROKERS → MT4/MT5 login card → GO LIVE) so fires execute for real.
            </Step>
            <Step n={4}>
              Watch it work: <span style={{ color: C.gold }}>SEND TEST FIRE</span> pushes a synthetic C3
              through the same pipeline (always paper) — check TRADE HISTORY.
            </Step>
          </ol>
        </div>
      </details>
    </PanelCard>
    </section>
  );
}
