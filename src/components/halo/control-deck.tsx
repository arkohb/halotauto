"use client";

// ════════════════════════════════════════════════════════════════════════
//  CONTROL DECK · dashboard quick-action buttons on the main screen
//  POWER / MODE / CLOSE / RESET / SCANNER / BROKERS / ALERTS / INSTALL
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, type ReactNode } from "react";
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
import { C, fmtPips, runPips, type BotStateRes } from "@/lib/halo/ui-helpers";
import { usePwa } from "./pwa";

export type DeckView = "terminal" | "scanner" | "backtest" | "brokers" | "alerts";

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
  const [alertBadge, setAlertBadge] = useState<AlertBadge | null>(null);
  const disabled = busy !== null;
  const running = state.enabled;
  const live = state.exec.executionMode === "live";
  const hasTrade = Boolean(state.engine.trade);

  // ── scanner badge: watchlist size + live signal count ──
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/scanner", { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Partial<ScannerBadge> & { ok?: boolean }) => {
          if (alive && typeof j.enabledCount === "number") {
            setScanBadge({
              enabledCount: j.enabledCount ?? 0,
              autoTradeCount: j.autoTradeCount ?? 0,
              totalSignals: j.totalSignals ?? 0,
            });
          }
        })
        .catch(() => {});
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
    <section aria-label="Dashboard control deck" className="mb-4 rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      {/* deck header + mini stats */}
      <div className="flex items-center justify-between gap-3 border-b border-[#1C2A47] px-3 py-2">
        <span className="text-[10px] font-bold tracking-[0.22em] text-[#8C98AE]">⌁ CONTROL DECK</span>
        <div className="hidden items-center gap-4 font-mono text-[11px] md:flex">
          <Stat label="NET" value={fmtPips(net)} color={net >= 0 ? C.green : C.red} />
          <Stat label="WIN" value={wr !== null ? `${wr.toFixed(0)}%` : "—"} color={wr !== null && wr >= 25 ? C.green : wr !== null ? C.red : C.muted} />
          <Stat label="RUN" value={rp !== null ? fmtPips(rp) : "—"} color={rp !== null ? (rp >= 0 ? C.green : C.red) : C.muted} />
          <Stat label="MODE" value={live ? "LIVE" : "PAPER"} color={live ? C.red : C.gold} />
        </div>
      </div>

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
            <AlertDialogContent className="border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-[#D4AF37]">Switch to LIVE order routing?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#8C98AE]">
                  Real market orders with attached SL/TP will be sent to{" "}
                  <span className="text-[#E8ECF4]">{state.exec.broker?.label ?? "the active broker account"}</span>.
                  Configure and test the broker in the BROKERS deck first. Paper mode keeps every fill
                  simulated — you can switch back anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#2A3A5C] bg-transparent text-[#8C98AE] hover:text-[#E8ECF4]">
                  Stay on paper
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-[#F23645] text-white hover:bg-[#FF4B59]"
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
          <AlertDialogContent className="border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[#F23645]">Close open position?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#8C98AE]">
                {live
                  ? "A market close order is sent to the broker immediately and the EA trade record is finalized."
                  : "The paper position is closed at current price and the trade record is finalized."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-[#2A3A5C] bg-transparent text-[#8C98AE] hover:text-[#E8ECF4]">
                Keep position
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#F23645] text-white hover:bg-[#FF4B59]"
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
          <AlertDialogContent className="border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[#D4AF37]">Reset strategy engine?</AlertDialogTitle>
              <AlertDialogDescription className="text-[#8C98AE]">
                Clears all fresh levels, counters and stats, then re-warms the engine over the latest
                history. Trade history in the database is kept. Requires a flat book.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-[#2A3A5C] bg-transparent text-[#8C98AE] hover:text-[#E8ECF4]">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A]"
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
          sub="real-data P&L"
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
          style={{ borderColor: "rgba(242,54,69,0.4)", background: "rgba(242,54,69,0.10)", color: C.red }}
        >
          LIVE ORDER ROUTING ACTIVE — EVERY C3 FIRE IS SENT TO THE BROKER
        </div>
      )}
    </section>
  );
}

/* ── tile primitives ── */

function tileClass(p: { danger?: boolean; gold?: boolean; selected?: boolean; active?: boolean }): string {
  const base =
    "group relative flex h-[72px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]/70 disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.97]";
  if (p.active) return `${base} text-white hover:brightness-110`;
  return `${base} hover:border-[#D4AF37]/70 hover:bg-[#16233D]`;
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
    ? "rgba(242,54,69,0.55)"
    : p.gold
      ? "rgba(212,175,55,0.55)"
      : p.selected
        ? "rgba(212,175,55,0.7)"
        : "#1C2A47";
  const bg = p.selected ? "#16233D" : p.danger ? "rgba(242,54,69,0.07)" : "#101C33";
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
        <span className="max-w-full truncate px-0.5 text-[8px] uppercase tracking-wider text-[#8C98AE] group-hover:text-[#B8C2D6]">
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
            background: p.dot === "ok" ? C.green : p.dot === "err" ? C.red : "#5D606B",
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

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[9px] tracking-[0.18em] text-[#8C98AE]">{label}</span>
      <span className="font-bold" style={{ color }}>
        {value}
      </span>
    </span>
  );
}

// ReactNode is re-exported for potential tile extensions
export type { ReactNode as TileNode };
