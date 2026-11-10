"use client";

// ════════════════════════════════════════════════════════════════════════
//  CONTROL DECK · dashboard quick-action buttons on the main screen
//  POWER / MODE / CLOSE / RESET / SCANNER / BROKERS / ALERTS / INSTALL
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, type ReactNode } from "react";
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
import { A, C, fmtPips, runPips, type BotStateRes, openTrade } from "@/lib/halo/ui-helpers";
import { PanelCard, StateFrame, StatCell } from "./panel";
import { usePwa } from "./pwa";

export type DeckView = "terminal" | "scanner" | "activity" | "backtest" | "brokers" | "alerts";

interface Props {
  state: BotStateRes;
  busy: string | null;
  view: DeckView;
  onView: (v: DeckView) => void;
  onControl: (action: "start" | "stop" | "reset" | "close") => Promise<void>;
  onExecMode: (m: "paper" | "live") => Promise<void>;
}

interface ScannerBadge {
  enabledCount: number;
  autoTradeCount: number;
  totalSignals: number;
}

interface AlertBadge {
  telegramEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

type DotState = "ok" | "err" | "none";

interface TileSpec {
  icon: string;
  label: string;
  sub?: string;
  disabled?: boolean;
  selected?: boolean;
  gold?: boolean;
  danger?: boolean;
  active?: boolean;
  activeBg?: string;
  pulse?: boolean;
  badge?: string;
  dot?: DotState;
  onClick?: () => void;
  ariaLabel?: string;
}

export function ControlDeck({ state, busy, view, onView, onControl, onExecMode }: Props) {
  const { canInstall, installed, install } = usePwa();
  const [scanBadge, setScanBadge] = useState<ScannerBadge | null>(null);
  const [scanErr, setScanErr] = useState(false);
  const [alertBadge, setAlertBadge] = useState<AlertBadge | null>(null);
  const disabled = busy !== null;
  const running = state.enabled;
  const live = state.exec.executionMode === "live";
  const hasTrade = Boolean(openTrade(state));

  // ── scanner badge: watchlist size + live signal count ──
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/scanner", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Partial<ScannerBadge> & { ok?: boolean }) => {
          if (alive) setScanErr(false);
          if (alive && typeof j.enabledCount === "number") {
            setScanBadge({
              enabledCount: j.enabledCount ?? 0,
              autoTradeCount: j.autoTradeCount ?? 0,
              totalSignals: j.totalSignals ?? 0,
            });
          }
        })
        .catch(() => {
          setScanErr(true); // badge is unavailable — surfaced as a tiny honest note, tiles stay live
        });
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ── alert channel badge: which channels are on ──
  useEffect(() => {
    let alive = true;
    fetch("/api/alerts/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; settings?: AlertBadge }) => {
        if (alive && j.settings) {
          setAlertBadge({
            telegramEnabled: Boolean(j.settings.telegramEnabled),
            emailEnabled: Boolean(j.settings.emailEnabled),
            pushEnabled: Boolean(j.settings.pushEnabled),
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const go = (v: DeckView) => () => onView(v);

  // headline mini-stats
  const s = state.engine.stats;
  const net = s.sumTP - s.sumSL;
  const tot = s.wins + s.losses;
  const wr = tot > 0 ? (s.wins * 100) / tot : null;
  const rp = runPips(state);
  const alertSub = alertBadge
    ? [alertBadge.telegramEnabled && "TG", alertBadge.emailEnabled && "MAIL", alertBadge.pushEnabled && "PUSH"]
        .filter(Boolean)
        .join("·") || "none on"
    : "telegram·email";

  return (
    <section aria-label="Dashboard control deck" className="mb-4">
      <PanelCard
        title="CONTROL DECK"
        icon={Zap}
        accent="gold"
        right={
          <div className="hidden items-center gap-2 md:flex">
            <StatCell label="NET" value={fmtPips(net)} color={net >= 0 ? C.green : C.red} />
            <StatCell label="WIN" value={wr !== null ? `${wr.toFixed(0)}%` : "—"} color={wr !== null && wr >= 25 ? C.green : wr !== null ? C.red : C.muted} />
            <StatCell label="RUN" value={rp !== null ? fmtPips(rp) : "—"} color={rp !== null ? (rp >= 0 ? C.green : C.red) : C.muted} />
            <StatCell label="MODE" value={live ? "LIVE" : "PAPER"} color={live ? C.red : C.gold} />
          </div>
        }
      >
        {/* scanner badge unavailable — honest note, tiles stay fully live */}
        {scanErr && (
          <div className="px-3 pt-3">
            <StateFrame state="offline" title="Scanner badge unavailable" compact />
          </div>
        )}

        {/* button grid */}
        <div className="grid grid-cols-4 gap-2 p-3 sm:grid-cols-8">
        {/* 1 · POWER — start / stop the EA bot */}
        <Tile
          icon={running ? "■" : "▶"}
          label={running ? "STOP BOT" : "START BOT"}
          sub={running ? "EA engine on" : "EA engine off"}
          active
          activeBg={running ? C.red : C.green}
          pulse={running}
          disabled={disabled}
          onClick={() => void (running ? onControl("stop") : onControl("start"))}
          ariaLabel={running ? "Stop EA bot" : "Start EA bot"}
        />

        {/* 2 · EXECUTION MODE — paper ⇄ live */}
        {live ? (
          <Tile
            icon="◉"
            label="LIVE"
            sub="real orders"
            danger
            disabled={disabled}
            onClick={() => void onExecMode("paper")}
            ariaLabel="Switch back to paper execution"
          />
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label="Switch execution mode to live"
                className={tileClass({ gold: true })}
                style={tileStyle({ gold: true })}
              >
                <TileFace icon="◎" label="PAPER" sub="tap for live" gold />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#1C4478] bg-[#041428] text-[#EAF3FF]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-[#E9B94E]">Switch to LIVE order routing?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#8AA2C2]">
                  Real market orders with attached SL/TP will be sent to{" "}
                  <span className="text-[#EAF3FF]">{state.exec.broker?.label ?? "the active broker account"}</span>.
                  Configure and test the broker in the BROKERS deck first. Paper mode keeps every fill
                  simulated — you can switch back anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#1C4478] bg-transparent text-[#8AA2C2] hover:text-[#EAF3FF]">
                  Stay on paper
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-[#FF4D5E] text-white hover:bg-[#FF4B59]"
                  onClick={() => void onExecMode("live")}
                >
                  Go live
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* 3 · CLOSE POSITION — emergency flatten */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={disabled || !hasTrade}
              aria-label="Close open position"
              className={tileClass({ danger: true })}
              style={tileStyle({ danger: true })}
            >
              <TileFace icon="✕" label="CLOSE" sub={hasTrade ? "flatten now" : "flat book"} danger />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-[#1C4478] bg-[#041428] text-[#EAF3FF]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[#FF4D5E]">Close open position?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#8AA2C2]">
                {live
                  ? "A market close order is sent to the broker immediately and the EA trade record is finalized."
                  : "The paper position is closed at current price and the trade record is finalized."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-[#1C4478] bg-transparent text-[#8AA2C2] hover:text-[#EAF3FF]">
                Keep position
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#FF4D5E] text-white hover:bg-[#FF4B59]"
                onClick={(e) => {
                  e.preventDefault();
                  void onControl("close");
                }}
              >
                Close position
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 4 · RESET ENGINE */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Reset strategy engine"
              className={tileClass({})}
              style={tileStyle({})}
            >
              <TileFace icon="⟲" label="RESET" sub="clear levels" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="border-[#1C4478] bg-[#041428] text-[#EAF3FF]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[#E9B94E]">Reset strategy engine?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#8AA2C2]">
                Clears all fresh levels, counters and stats, then re-warms the engine over the latest
                history. Trade history in the database is kept. Requires a flat book.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-[#1C4478] bg-transparent text-[#8AA2C2] hover:text-[#EAF3FF]">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#2ECCFF] text-[#021229] hover:bg-[#7DDDFF]"
                onClick={(e) => {
                  e.preventDefault();
                  void onControl("reset");
                }}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 5 · SCANNER */}
        <Tile
          icon="⌖"
          label="SCANNER"
          sub={scanBadge ? `${scanBadge.enabledCount} symbols` : "multi-symbol"}
          selected={view === "scanner"}
          badge={scanBadge && scanBadge.totalSignals > 0 ? String(scanBadge.totalSignals) : undefined}
          disabled={disabled}
          onClick={go("scanner")}
          ariaLabel="Open multi-symbol scanner"
        />

        {/* 6 · BACKTEST */}
        <Tile
          icon="∝"
          label="BACKTEST"
          sub="live replay · P&L"
          selected={view === "backtest"}
          disabled={disabled}
          onClick={go("backtest")}
          ariaLabel="Open the real-data backtest dashboard"
        />

        {/* 7 · BROKERS */}
        <Tile
          icon="🏛"
          label="BROKERS"
          sub={state.exec.broker ? state.exec.broker.label : "connect API"}
          dot={state.exec.broker ? (state.exec.broker.status === "ok" ? "ok" : "err") : "none"}
          selected={view === "brokers"}
          disabled={disabled}
          onClick={go("brokers")}
          ariaLabel="Open broker connections"
        />

        {/* 8 · ALERTS */}
        <Tile
          icon="◆"
          label="ALERTS"
          sub={alertSub}
          selected={view === "alerts"}
          disabled={disabled}
          onClick={go("alerts")}
          ariaLabel="Open alert channels"
        />

        {/* 9 · INSTALL PWA / TERMINAL */}
        {canInstall ? (
          <Tile
            icon="⬇"
            label="INSTALL"
            sub="add to home"
            gold
            disabled={disabled}
            onClick={() => void install()}
            ariaLabel="Install app to device"
          />
        ) : (
          <Tile
            icon={installed ? "✓" : "▤"}
            label={installed ? "PWA OK" : "TERMINAL"}
            sub={installed ? "installed" : "chart·engine"}
            selected={view === "terminal"}
            disabled={disabled}
            onClick={go("terminal")}
            ariaLabel="Open terminal view"
          />
        )}
      </div>

      {/* live warning strip */}
      {live && (
        <div
          className="border-t px-3 py-1.5 text-center text-[10px] font-bold tracking-[0.18em]"
          style={{ borderColor: A.red(0.4), background: A.red(0.1), color: C.red }}
        >
          LIVE ORDER ROUTING ACTIVE — EVERY C3 FIRE IS SENT TO THE BROKER
        </div>
      )}
      </PanelCard>
    </section>
  );
}

/* ── tile primitives ── */

function tileClass(p: { danger?: boolean; gold?: boolean; selected?: boolean; active?: boolean }): string {
  const base =
    "group relative flex h-[72px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9B94E]/70 disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.97]";
  if (p.active) return `${base} text-white hover:brightness-110`;
  return `${base} hover:border-[#E9B94E]/70 hover:bg-[#07203F]`;
}

function tileStyle(p: { danger?: boolean; gold?: boolean; selected?: boolean; active?: boolean; activeBg?: string }): React.CSSProperties {
  if (p.active) {
    return {
      background: p.activeBg ?? C.green,
      borderColor: "transparent",
      boxShadow: `0 0 18px ${(p.activeBg ?? C.green)}55`,
    };
  }
  const border = p.danger
    ? A.red(0.55)
    : p.gold
      ? A.gold(0.55)
      : p.selected
        ? A.gold(0.7)
        : C.line;
  const bg = p.selected ? C.navy3 : p.danger ? A.red(0.07) : C.navy2;
  return { borderColor: border, background: bg };
}

function TileFace(p: { icon: string; label: string; sub?: string; danger?: boolean; gold?: boolean; selected?: boolean; active?: boolean; pulse?: boolean; badge?: string; dot?: DotState }) {
  const iconColor = p.active ? "#FFFFFF" : p.danger ? C.red : p.gold || p.selected ? C.gold : C.txt;
  const labelColor = p.active ? "#FFFFFF" : C.txt;
  return (
    <>
      <span className="text-base leading-none" style={{ color: iconColor }}>
        {p.icon}
        {p.pulse && (
          <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 animate-ping rounded-full bg-white/90" />
        )}
      </span>
      <span className="text-[10px] font-extrabold tracking-wider" style={{ color: labelColor }}>
        {p.label}
      </span>
      {p.sub && (
        <span className="max-w-full truncate px-0.5 text-[8px] uppercase tracking-wider text-[#8AA2C2] group-hover:text-[#B9CBE4]">
          {p.sub}
        </span>
      )}
      {p.badge && (
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[8px] font-bold"
          style={{ background: C.gold, color: C.navy }}
        >
          {p.badge}
        </span>
      )}
      {p.dot && (
        <span
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
          style={{
            background: p.dot === "ok" ? C.green : p.dot === "err" ? C.red : C.dim,
            boxShadow: p.dot === "ok" ? `0 0 6px ${C.green}` : undefined,
          }}
        />
      )}
    </>
  );
}

function Tile(p: TileSpec) {
  return (
    <button
      type="button"
      onClick={p.onClick}
      disabled={p.disabled}
      aria-label={p.ariaLabel}
      className={tileClass(p)}
      style={tileStyle(p)}
    >
      <TileFace
        icon={p.icon}
        label={p.label}
        sub={p.sub}
        danger={p.danger}
        gold={p.gold}
        selected={p.selected}
        active={p.active}
        pulse={p.pulse}
        badge={p.badge}
        dot={p.dot}
      />
    </button>
  );
}

// StatCell (panel.tsx) renders the deck's NET/WIN/RUN/MODE mini-stats

// ReactNode is re-exported for potential tile extensions
export type { ReactNode as TileNode };
