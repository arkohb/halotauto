"use client";

// ════════════════════════════════════════════════════════════════════════
//  EA ATTACH CARD · wires the HALO 3EL EA onto any TradingView chart
//  1. copy the Pine EA (secret pre-embedded) → add to the TV chart
//  2. create the alert with the HALO webhook URL
//  3. every C3 fire posts back and auto-trades the linked broker account
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
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
import { C } from "@/lib/halo/ui-helpers";
import type { BotStateRes } from "@/lib/halo/ui-helpers";
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

export function EaAttachCard({ state, notify }: Props) {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    setBusy("pine");
    try {
      await navigator.clipboard.writeText(buildPineEa(info.secret));
      notify("PINE EA COPIED", "Secret embedded — paste into TradingView Pine Editor.");
    } catch {
      notify("Cannot copy Pine EA", "Clipboard blocked by the browser.", true);
    } finally {
      setBusy(null);
    }
  }, [info, notify]);

  const regenerate = useCallback(async () => {
    setBusy("regen");
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
      setBusy(null);
    }
  }, [notify]);

  const testFire = useCallback(async () => {
    setBusy("test");
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
      setBusy(null);
    }
  }, [state.symbol, notify, load]);

  const webhookUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/webhook/tv`;

  return (
    <section
      aria-label="Attach EA to TradingView chart"
      className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4"
    >
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-extrabold tracking-[0.18em] text-[#D4AF37]">
            EA → TRADINGVIEW ATTACH
          </span>
          {live ? (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-[0.12em]"
              style={{ background: "rgba(212,175,55,0.14)", color: C.gold, border: "1px solid rgba(212,175,55,0.45)" }}
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
              style={{ borderColor: "#1C2A47", color: C.muted }}
            >
              SIM ROUTING · PAPER
            </span>
          )}
        </div>
        <span className="text-[9px] tracking-[0.14em] text-[#8C98AE]">
          WEBHOOK FIRES {info ? info.fireCount : "—"}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#8C98AE]">
        Attach the built-in EA to the TradingView chart above: the Pine EA fires C3 signals on
        TradingView, posts them to your private webhook, and HALO instantly executes them on your
        linked account — MT4/MT5 (MetaApi), OANDA, IG, Binance or any bridge. Attach as many chart
        symbols as you like; every fire lands in the same execution engine.
      </p>

      {/* actions */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => void copyPine()}
          disabled={!info || busy !== null}
          aria-label="Copy Pine EA source code"
          className="rounded-lg px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: C.gold, color: C.navy }}
        >
          {busy === "pine" ? "COPYING…" : "COPY PINE EA"}
        </button>
        <button
          type="button"
          onClick={() => void copy(webhookUrl, "WEBHOOK URL")}
          aria-label="Copy webhook URL"
          className="rounded-lg border border-[#1C2A47] bg-[#101C33] px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] text-[#E8ECF4] transition-colors hover:bg-[#16233D]"
        >
          COPY WEBHOOK URL
        </button>
        <button
          type="button"
          onClick={() => void testFire()}
          disabled={busy !== null}
          aria-label="Send test fire through webhook pipeline"
          className="rounded-lg border border-[#1C2A47] bg-[#101C33] px-3 py-2.5 text-[10px] font-extrabold tracking-[0.14em] text-[#E8ECF4] transition-colors hover:bg-[#16233D] disabled:opacity-50"
        >
          {busy === "test" ? "FIRING…" : "SEND TEST FIRE"}
        </button>
      </div>

      {/* secret + url readouts */}
      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
          <div className="text-[8px] font-bold tracking-[0.2em] text-[#8C98AE]">WEBHOOK URL</div>
          <div className="truncate font-mono text-[11px] text-[#E8ECF4]" title={webhookUrl}>
            {webhookUrl || "…"}
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[8px] font-bold tracking-[0.2em] text-[#8C98AE]">SECRET</div>
            <div className="truncate font-mono text-[11px]" style={{ color: C.gold }}>
              {info ? info.secret : "…"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => info && void copy(info.secret, "SECRET")}
            aria-label="Copy webhook secret"
            className="rounded border border-[#1C2A47] px-2 py-1 text-[9px] font-bold tracking-wider text-[#8C98AE] hover:text-[#E8ECF4]"
          >
            COPY
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                aria-label="Regenerate webhook secret"
                disabled={busy !== null}
                className="rounded border border-[#1C2A47] px-2 py-1 text-[9px] font-bold tracking-wider text-[#8C98AE] hover:text-[#F23645] disabled:opacity-50"
              >
                REGEN
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#1C2A47] bg-[#0F1A30] text-[#E8ECF4]">
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate webhook secret?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#8C98AE]">
                  Alerts signed with the old secret are rejected immediately. After regenerating,
                  re-copy the Pine EA into TradingView so the new secret is embedded.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#1C2A47] bg-transparent text-[#E8ECF4] hover:bg-[#16233D]">
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void regenerate()}
                  className="bg-[#F23645] text-white hover:bg-[#d92c3a]"
                >
                  Regenerate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* steps */}
      <ol className="mt-3 space-y-1.5 rounded-lg border border-[#1C2A47] bg-[#0B1426] p-3 text-[10.5px] text-[#8C98AE]">
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
    </section>
  );
}
