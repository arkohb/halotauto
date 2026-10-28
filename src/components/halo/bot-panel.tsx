"use client";

import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { C, fmtPips, type BotStateRes } from "@/lib/halo/ui-helpers";

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
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1C2A47] flex items-center justify-between">
        <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">
          EA BOT · {state.exec.executionMode === "live" ? `LIVE · ${state.exec.broker?.label ?? "NO BROKER"}` : "PAPER EXECUTION"}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: running ? C.green : C.muted }}>
          <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse" : ""}`} style={{ background: running ? C.green : "#5D606B" }} />
          {running ? "LIVE" : "OFF"}
        </span>
      </div>

      <div className="p-4 space-y-3">
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

        <div className="flex items-center justify-between rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
          <div>
            <div className="text-[10px] tracking-wider text-[#8C98AE]">FEED</div>
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
            <AlertDialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-[#D4AF37]">Reset strategy engine?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#8C98AE]">
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
          <div className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: "rgba(212,175,55,0.4)", background: "rgba(212,175,55,0.08)", color: C.gold }}>
            ⚠ {state.feed.note}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
      <div className="text-[10px] tracking-wider text-[#8C98AE]">{label}</div>
      <div className={`font-mono font-bold ${small ? "text-[11px]" : "text-sm"}`} style={{ color }}>
        {value}
      </div>
    </div>
  );
}
