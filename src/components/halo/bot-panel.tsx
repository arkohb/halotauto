"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { A, C, fmtPips, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard } from "./panel";

interface Props {
  state: BotStateRes;
  busy: string | null;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onReset: () => Promise<void>;
}

export function BotPanel({ state, busy, onStart, onStop, onReset }: Props) {
  const [resetOpen, setResetOpen] = useState(false);
  const running = state.enabled;

  const toggle = async () => {
    if (running) await onStop();
    else await onStart();
  };

  return (
    <PanelCard
      title={`EA BOT · ${state.exec.executionMode === "live" ? `LIVE · ${state.exec.broker?.label ?? "NO BROKER"}` : "PAPER EXECUTION"}`}
      icon={Bot}
      accent="gold"
      bodyClassName="p-4 space-y-3"
      right={
        <span className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: running ? C.green : C.muted }}>
          <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse" : ""}`} style={{ background: running ? C.green : C.dim }} />
          {running ? "LIVE" : "OFF"}
        </span>
      }
    >
      <Button
        onClick={toggle}
        disabled={busy !== null}
        className="w-full h-11 rounded-lg font-bold text-sm tracking-wider text-white disabled:opacity-60"
        style={{ background: running ? C.red : C.green }}
      >
        {busy === "start" || busy === "stop" ? "…" : running ? "■ STOP EA BOT" : "▶ START EA BOT"}
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="REALIZED PIPS" value={fmtPips(state.feed.realizedPips)} color={state.feed.realizedPips >= 0 ? C.green : C.red} />
        <MiniStat label="LAST RESULT" value={state.engine.stats.lastResult.text} color={state.engine.stats.lastResult.kind === "win" ? C.green : state.engine.stats.lastResult.kind === "loss" ? C.red : C.muted} small />
      </div>

      <div className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: C.line, background: C.navy }}>
        <div>
          <div className="text-[10px] tracking-wider" style={{ color: C.muted }}>FEED</div>
          <div className="text-xs font-mono uppercase" style={{ color: state.feed.source === "simulator" ? C.gold : C.green }}>
            {state.feed.source}
          </div>
        </div>
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              disabled={busy !== null}
              className="h-8 px-3 text-[11px] rounded-md border-[#2A3A5C] text-[#8C98AE] hover:text-[#E8ECF4] hover:border-[#8C98AE] bg-transparent"
            >
              RESET ENGINE
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent style={{ background: C.navy2, borderColor: C.line2, color: C.txt }}>
            <AlertDialogHeader>
              <AlertDialogTitle style={{ color: C.gold }}>Reset strategy engine?</AlertDialogTitle>
              <AlertDialogDescription style={{ color: C.muted }}>
                Clears all fresh levels, counters and stats, then re-warms the engine over the latest
                history. Trade history in the database is kept. Requires a flat book.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-transparent border-[#2A3A5C] text-[#8C98AE] hover:text-[#E8ECF4]">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A]"
                onClick={async (e) => {
                  e.preventDefault();
                  setResetOpen(false);
                  await onReset();
                }}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {state.feed.note && (
        <div className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: A.gold(0.4), background: A.gold(0.08), color: C.gold }}>
          ⚠ {state.feed.note}
        </div>
      )}
    </PanelCard>
  );
}

function MiniStat({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: C.line, background: C.navy }}>
      <div className="text-[10px] tracking-wider" style={{ color: C.muted }}>{label}</div>
      <div className={`font-mono font-bold ${small ? "text-[11px]" : "text-sm"}`} style={{ color }}>
        {value}
      </div>
    </div>
  );
}
