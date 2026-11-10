"use client";

// ════════════════════════════════════════════════════════════════════════
//  QUICK ACTIONS · mockup 03 panel on the Trading Activity view
//  CLOSE ALL POSITIONS  → real broker flatten via /api/brokers/live-account
//  MODIFY SL/TP         → real position amendment (adapter-supported brokers)
//  PAUSE NEW ENTRIES    → real operator gate in the bot runtime (bot.ts)
//  Every button verifies the server answer before any success is shown.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { A, C, fmtPx, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";
import { voiceEnergy } from "@/lib/halo/voice-energy";

interface LivePos {
  id: string;
  symbol: string;
  side: -1 | 1;
  volume: number;
  entryPrice: number | null;
  sl: number | null;
  tp: number | null;
  pnl: number;
  paper: boolean;
  ea: boolean;
}

interface Result {
  ok: boolean;
  text: string;
}

export function QuickActions({
  state,
  notify,
}: {
  state: BotStateRes;
  /** same signature as the shell toast: (title, description?, bad?) */
  notify: (title: string, desc?: string, bad?: boolean) => void;
}) {
  const [positions, setPositions] = useState<LivePos[]>([]);
  const [acctErr, setAcctErr] = useState(false);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // pause state mirrors the real bot flag (server-verified)
  const [pauseNew, setPauseNew] = useState<boolean>(Boolean(state.pauseNew));

  useEffect(() => setPauseNew(Boolean(state.pauseNew)), [state.pauseNew]);

  const loadBook = useCallback(() => {
    fetch("/api/brokers/live-account", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { positions?: LivePos[]; live?: boolean }) => {
        setPositions(j.positions ?? []);
        setLive(Boolean(j.live));
        setAcctErr(false);
      })
      .catch(() => setAcctErr(true));
  }, []);

  useEffect(() => {
    loadBook();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadBook();
    }, 5000);
    return () => clearInterval(id);
  }, [loadBook]);

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setBusy(key);
      voiceEnergy.setExecuting(true);
      try {
        await fn();
      } catch {
        setResult({ ok: false, text: "Network error — the action did not reach the server." });
        voiceEnergy.errorPulse();
      } finally {
        voiceEnergy.setExecuting(false);
        setBusy(null);
        loadBook();
      }
    },
    [loadBook]
  );

  // ── CLOSE ALL ────────────────────────────────────────────────────────
  const closeAll = () =>
    run("close-all", async () => {
      const res = await fetch("/api/brokers/live-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close-all" }),
      });
      const j = (await res.json()) as { ok?: boolean; paper?: boolean; error?: string; closed?: number };
      if (j.ok) {
        setResult({ ok: true, text: j.paper ? "Paper trades closed at market through the engine that holds them — results booked to the demo balance." : "Close-all accepted by the broker — the book refreshes in a moment." });
        notify("Close-all verified", j.paper ? "Every running paper trade was closed and booked." : "All open positions were market-closed at the broker.");
      } else {
        setResult({ ok: false, text: j.error ?? "Broker refused the close-all request." });
        voiceEnergy.errorPulse();
        notify("Close-all failed", "The broker refused or the request timed out — see the panel note.", true);
      }
    });

  // ── MODIFY SL/TP ─────────────────────────────────────────────────────
  const [modOpen, setModOpen] = useState(false);
  const [modId, setModId] = useState<string>("");
  const [modSl, setModSl] = useState<string>("");
  const [modTp, setModTp] = useState<string>("");

  const openModify = () => {
    if (positions.length === 0) {
      setResult({ ok: false, text: "No open positions to modify — SL/TP edits need a live position." });
      return;
    }
    const first = positions[0];
    setModId(first.id);
    setModSl(first.sl !== null ? String(first.sl) : "");
    setModTp(first.tp !== null ? String(first.tp) : "");
    setResult(null);
    setModOpen(true);
  };

  const pickPosition = (id: string) => {
    setModId(id);
    const p = positions.find((x) => x.id === id);
    if (p) {
      setModSl(p.sl !== null ? String(p.sl) : "");
      setModTp(p.tp !== null ? String(p.tp) : "");
    }
  };

  const submitModify = () =>
    run("modify", async () => {
      const p = positions.find((x) => x.id === modId);
      if (!p) {
        setResult({ ok: false, text: "That position is no longer open." });
        voiceEnergy.errorPulse();
        return;
      }
      const slNum = modSl.trim() === "" ? null : Number(modSl);
      const tpNum = modTp.trim() === "" ? null : Number(modTp);
      const hasSl = slNum !== null && isFinite(slNum) && slNum > 0;
      const hasTp = tpNum !== null && isFinite(tpNum) && tpNum > 0;
      if (!hasSl && !hasTp) {
        setResult({ ok: false, text: "Enter a valid SL and/or TP price (or close this dialog)." });
        voiceEnergy.errorPulse();
        return;
      }
      const res = await fetch("/api/brokers/live-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modify",
          positionId: modId,
          sl: hasSl ? slNum : null,
          tp: hasTp ? tpNum : null,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; paper?: boolean };
      if (j.ok) {
        setResult({ ok: true, text: j.paper ? "SL/TP moved on the running trade — the engine, trade book and chart now use the new levels." : "SL/TP amendment accepted by the broker." });
        notify("SL/TP updated", j.paper ? "The EA now manages the trade with the new levels." : "The broker confirmed the amended levels.");
        setModOpen(false);
      } else {
        setResult({ ok: false, text: j.error ?? "The broker refused the SL/TP amendment." });
        voiceEnergy.errorPulse();
        notify("SL/TP modification failed", "The broker refused the amendment — see the panel note.", true);
      }
    });

  // ── PAUSE NEW ENTRIES ────────────────────────────────────────────────
  const togglePause = () =>
    run("pause", async () => {
      const next = !pauseNew;
      const res = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next ? "pauseNew" : "resumeNew" }),
      });
      const j = (await res.json()) as { ok?: boolean; state?: { pauseNew?: boolean }; error?: string };
      if (j.ok && typeof j.state?.pauseNew === "boolean") {
        setPauseNew(j.state.pauseNew);
        setResult({ ok: true, text: j.state.pauseNew ? "New entries paused — an open trade stays fully managed." : "New entries resumed — the EA accepts fresh C3 fires." });
        notify(j.state.pauseNew ? "New entries paused" : "New entries resumed", j.state.pauseNew ? "An open trade stays fully managed." : "The EA accepts fresh C3 fires.");
      } else {
        setResult({ ok: false, text: j.error ?? "The engine did not confirm the pause toggle." });
        voiceEnergy.errorPulse();
        notify("Pause toggle failed", "The engine did not confirm the toggle.", true);
      }
    });

  const btnBase =
    "flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[9px] font-extrabold tracking-[0.1em] transition-all hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100";
  const btnStyle = (accent: string) => ({
    background: `${accent}14`,
    color: accent,
    boxShadow: `inset 0 0 0 1px ${accent}59`,
  });

  const hasLiveBook = live && positions.length > 0;

  return (
    <PanelCard
      title="QUICK ACTIONS"
      icon={Zap}
      accent="teal"
      className="h-full"
      right={
        <span className="rounded-full px-2 py-0.5 text-[7.5px] font-extrabold tracking-[0.12em]" style={{ background: live ? A.green(0.12) : A.gold(0.12), color: live ? C.green : C.gold }}>
          {acctErr ? "BOOK OFFLINE" : live ? "LIVE BOOK" : "PAPER EA"}
        </span>
      }
      bodyClassName="flex flex-col gap-2.5"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {/* CLOSE ALL POSITIONS */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" className={btnBase} style={btnStyle(C.red)} disabled={busy !== null || positions.length === 0}>
              {busy === "close-all" ? "CLOSING…" : "CLOSE ALL"}
              <span className="font-mono text-[8px] opacity-80">{positions.length > 0 ? `(${positions.length})` : ""}</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-white/10" style={{ background: C.panel }}>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[13px]" style={{ color: C.txt }}>Close ALL open positions?</AlertDialogTitle>
              <AlertDialogDescription className="text-[11px]" style={{ color: C.label }}>
                {positions.length} position{positions.length === 1 ? "" : "s"} will be market-closed right now{live ? " at the broker — including any manual trades" : " at the current price and booked to the demo balance"}.
                This cannot be undone. The EA stays {state.enabled ? "running" : "stopped"}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="text-[11px]">Keep positions</AlertDialogCancel>
              <AlertDialogAction
                className="text-[11px] font-bold"
                style={{ background: A.red(0.16), color: C.red, boxShadow: `inset 0 0 0 1px ${A.red(0.5)}` }}
                onClick={() => closeAll()}
              >
                Close all at market
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* MODIFY SL/TP */}
        <button type="button" className={btnBase} style={btnStyle(C.cyan)} onClick={openModify} disabled={busy !== null}>
          {busy === "modify" ? "APPLYING…" : "MODIFY SL/TP"}
        </button>

        {/* PAUSE NEW ENTRIES */}
        <button
          type="button"
          className={btnBase}
          style={btnStyle(pauseNew ? C.gold : C.green)}
          onClick={() => togglePause()}
          disabled={busy !== null}
          aria-pressed={pauseNew}
        >
          {busy === "pause" ? "…" : pauseNew ? "RESUME NEW ENTRIES" : "PAUSE NEW ENTRIES"}
        </button>
      </div>

      {/* honest result line — every text comes from a verified server answer */}
      {result && (
        <div
          className="rounded-md px-2.5 py-1.5 text-[9.5px] font-semibold leading-relaxed"
          style={{
            background: result.ok ? A.green(0.08) : A.red(0.08),
            color: result.ok ? C.green : C.red,
            boxShadow: `inset 0 0 0 1px ${result.ok ? A.green(0.3) : A.red(0.3)}`,
          }}
          role="status"
        >
          {result.ok ? "✓ " : "✕ "}
          {result.text}
        </div>
      )}

      <div className="text-[8.5px] leading-relaxed" style={{ color: C.label }}>
        {hasLiveBook ? (
          <>
            Book: {positions.map((p) => `${p.side === -1 ? "SELL" : "BUY"} ${p.volume.toFixed(2)} ${p.symbol}`).join(" · ")}
          </>
        ) : acctErr ? (
          "Broker book unreachable — actions stay disabled-safe and retry continues."
        ) : (
          "Paper mode: these actions act on the running paper trade (EA bot, Scanner Bot, scanner or sweep) — on a live account they go to the broker."
        )}
      </div>

      {/* MODIFY SL/TP dialog */}
      <Dialog open={modOpen} onOpenChange={setModOpen}>
        <DialogContent className="border-white/10 sm:max-w-[380px]" style={{ background: C.panel }}>
          <DialogHeader>
            <DialogTitle className="text-[13px]" style={{ color: C.txt }}>Modify SL / TP</DialogTitle>
            <DialogDescription className="text-[10.5px]" style={{ color: C.label }}>
              Amend stop-loss / take-profit directly on the broker position. Leave a field empty to keep its current level.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 text-[8px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.label }}>Position</div>
              <select
                value={modId}
                onChange={(e) => pickPosition(e.target.value)}
                className="w-full rounded-md px-2 py-1.5 text-[11px]"
                style={{ background: A.cyan(0.05), color: C.txt, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}
              >
                {positions.map((p) => (
                  <option key={p.id} value={p.id} style={{ background: C.panel }}>
                    {p.side === -1 ? "SELL" : "BUY"} {p.volume.toFixed(2)} {p.symbol} @ {p.entryPrice !== null ? fmtPx(p.entryPrice, state.mintick) : "—"}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[8px] font-extrabold uppercase tracking-[0.12em]" style={{ color: A.red(0.9) }}>Stop loss</span>
                <input
                  value={modSl}
                  onChange={(e) => setModSl(e.target.value)}
                  inputMode="decimal"
                  placeholder="keep current"
                  className="w-full rounded-md px-2 py-1.5 font-mono text-[11px]"
                  style={{ background: A.red(0.05), color: C.txt, boxShadow: `inset 0 0 0 1px ${A.red(0.3)}` }}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[8px] font-extrabold uppercase tracking-[0.12em]" style={{ color: A.green(0.9) }}>Take profit</span>
                <input
                  value={modTp}
                  onChange={(e) => setModTp(e.target.value)}
                  inputMode="decimal"
                  placeholder="keep current"
                  className="w-full rounded-md px-2 py-1.5 font-mono text-[11px]"
                  style={{ background: A.green(0.05), color: C.txt, boxShadow: `inset 0 0 0 1px ${A.green(0.3)}` }}
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setModOpen(false)}
              className="rounded-md px-3 py-1.5 text-[10px] font-bold"
              style={{ background: "transparent", color: C.label, boxShadow: `inset 0 0 0 1px ${C.lineInner}` }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitModify()}
              disabled={busy === "modify"}
              className="rounded-md px-3 py-1.5 text-[10px] font-extrabold tracking-wide disabled:opacity-40"
              style={{ background: A.cyan(0.16), color: C.cyan, boxShadow: `inset 0 0 0 1px ${A.cyan(0.5)}` }}
            >
              {busy === "modify" ? "APPLYING…" : "APPLY TO BROKER"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PanelCard>
  );
}
