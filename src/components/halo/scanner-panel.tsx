"use client";

// ════════════════════════════════════════════════════════════════════════
//  MULTI-SYMBOL SCANNER · watchlist of symbol+tf rows, each running the
//  full 3EL engine. Fires → push/Telegram/email alerts, optional auto-trade.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ListPlus, Radar, ScanSearch, Table2 } from "lucide-react";
import { C, type PillTone } from "@/lib/halo/ui-helpers";
import { SYMBOL_GROUPS, symbolsByGroup, TIMEFRAMES } from "@/lib/market-symbols";
import type { Side } from "@/lib/halo/types";
import { PanelCard, Pill, StateFrame, StatCell } from "./panel";
import { StrategyRadar } from "./strategy-radar";

interface RowState {
  id: string;
  symbol: string;
  symbolLabel: string;
  tf: string;
  enabled: boolean;
  autoTrade: boolean;
  status: string;
  price: number;
  atr: number | null;
  freshSell: number;
  freshBuy: number;
  nearest: { side: Side; distAtr: number } | null;
  lastSignal: { dir: Side; kind: string; time: number } | null;
  source: string;
  error: string;
  warm: boolean;
}

interface SweepRowState {
  symbol: string;
  symbolLabel: string;
  tf: string;
  status: string;
  price: number;
  freshSell: number;
  freshBuy: number;
  nearest: { side: Side; distAtr: number } | null;
  lastSignal: { dir: Side; kind: string; time: number } | null;
  source: string;
  error: string;
  warm: boolean;
}

interface SweepState {
  enabled: boolean;
  autoTrade: boolean;
  tfWindow: string[];
  pairsTotal: number;
  pairsWarm: number;
  cursor: number;
  fires: number;
  lastRun: number;
  lastFire: { symbol: string; tf: string; dir: Side; entry: number; time: number; traded: boolean } | null;
  lock: { source: string; symbol: string; tf: string; dir: number; entry: number; sl: number; tp: number; openedAt: number } | null;
  setups: SweepRowState[];
}

interface State {
  rows: RowState[];
  enabledCount: number;
  autoTradeCount: number;
  totalSignals: number;
  lastRun: number;
  maxRows: number;
  sweep?: SweepState;
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
  onJumpToSymbol?: (symbol: string) => void;
}

function statusTone(s: string): PillTone {
  switch (s) {
    case "RUNNING": return "err";
    case "C3 WATCH": return "gold";
    case "ERROR": return "err";
    case "PAUSED": return "muted";
    case "WARMING": return "muted";
    default: return "ok";
  }
}

export function ScannerPanel({ notify, onJumpToSymbol }: Props) {
  const [st, setSt] = useState<State | null>(null);
  const [addSym, setAddSym] = useState("BTCUSDT");
  const [addTf, setAddTf] = useState("5m");
  const [addAuto, setAddAuto] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/scanner", { cache: "no-store" });
      const j = (await r.json()) as State & { ok: boolean };
      if (j.ok) {
        setSt(j);
        setErr(false);
      }
    } catch {
      setErr(true); // surfaced honestly above the table — last known data stays visible
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 4000);
    return () => clearInterval(id);
  }, [load]);

  const post = async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    try {
      const r = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as State & { ok: boolean; error?: string };
      if (!j.ok) notify("Scanner action failed", j.error, true);
      else setSt(j);
    } catch (e) {
      notify("Scanner request failed", (e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const hasRows = (st?.rows.length ?? 0) > 0;
  const feedErrorFrame = (
    <StateFrame
      state="error"
      hint="Feed unreachable — showing last known watchlist. Retry to refresh."
      onRetry={() => void load()}
    />
  );

  return (
    <div className="space-y-4">
      {/* header */}
      <PanelCard
        title="MULTI-SYMBOL SCANNER"
        icon={ScanSearch}
        accent="cyan"
        right={
          <Button
            variant="outline"
            onClick={() => void post({ action: "scan" }, "scan")}
            disabled={busy !== null}
            className="h-9 px-4 rounded-lg border-[#1C4478] text-[#EAF3FF] hover:border-[#E9B94E] hover:text-[#E9B94E] bg-transparent text-xs font-bold tracking-wider"
          >
            {busy === "scan" ? "SCANNING…" : "⟳ SCAN NOW"}
          </Button>
        }
        bodyClassName="p-4 space-y-3"
      >
        <p className="text-[11px]" style={{ color: C.muted }}>
          Every row runs the full C1/C2 → C3 engine. Fires alert all channels; auto-trade rows execute through the EA&apos;s routing.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCell label="SYMBOLS" value={st ? `${st.rows.length}/${st.maxRows}` : "—"} />
          <StatCell label="ACTIVE" value={st ? String(st.enabledCount) : "—"} color={C.green} />
          <StatCell label="AUTO-TRADE" value={st ? String(st.autoTradeCount) : "—"} color={C.gold} />
          <StatCell label="SIGNALS" value={st ? String(st.totalSignals) : "—"} />
        </div>
      </PanelCard>

      {/* ── ALL-PAIRS SWEEP · 1h–4h ── */}
      <PanelCard
        title="ALL-PAIRS SWEEP · 1H–4H"
        icon={Radar}
        accent="gold"
        right={
          <Button
            variant="outline"
            onClick={() => void post({ action: "sweepNow" }, "sweepNow")}
            disabled={busy !== null || !(st?.sweep?.enabled ?? true) || !!(st?.sweep?.lock)}
            className="h-9 px-4 rounded-lg border-[#1C4478] text-[#EAF3FF] hover:border-[#E9B94E] hover:text-[#E9B94E] bg-transparent text-xs font-bold tracking-wider"
          >
            {busy === "sweepNow" ? "SWEEPING…" : "⟳ SWEEP NOW"}
          </Button>
        }
        bodyClassName="p-4 space-y-3"
      >
        <p className="text-[11px]" style={{ color: C.muted }}>
          The bot scans <span className="font-bold" style={{ color: C.txt }}>every pair in the catalog</span> on the
          <span className="font-bold" style={{ color: C.gold }}> 1h and 4h timeframes only</span>. When a trade fires anywhere, all armed levels are
          deleted and scanning pauses until the running trade hits TP or SL — then scanning re-activates.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCell label="PAIRS" value={st?.sweep ? `${st.sweep.pairsWarm}/${st.sweep.pairsTotal}` : "—"} />
          <StatCell label="TF WINDOW" value={st?.sweep ? st.sweep.tfWindow.map((t) => t.toUpperCase()).join(" · ") : "—"} color={C.gold} />
          <StatCell label="FIRES" value={st?.sweep ? String(st.sweep.fires) : "—"} color={C.green} />
          <StatCell
            label="STATUS"
            value={st?.sweep?.lock ? "PAUSED · TRADE" : st?.sweep?.enabled ? "SCANNING" : "OFF"}
            color={st?.sweep?.lock ? C.red : st?.sweep?.enabled ? C.green : C.muted}
          />
        </div>
        {st?.sweep?.lock && (
          <div className="rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: C.red, background: "rgba(255,77,94,0.08)", color: C.red }}>
            SCANNING PAUSED — a {st.sweep.lock.dir === -1 ? "SELL" : "BUY"} trade is running on {st.sweep.lock.symbol} {st.sweep.lock.tf} @
            {" "}{st.sweep.lock.entry} (SL {st.sweep.lock.sl} · TP {st.sweep.lock.tp}). All armed levels were deleted; the sweep re-activates the moment it hits TP or SL.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-2">
            <Switch
              id="sweep-enabled"
              checked={st?.sweep?.enabled ?? true}
              onCheckedChange={(c) => void post({ action: "sweep", enabled: c }, "sweepOn")}
            />
            <label htmlFor="sweep-enabled" className="text-[11px]" style={{ color: C.muted }}>scan all pairs</label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="sweep-auto"
              checked={st?.sweep?.autoTrade ?? true}
              onCheckedChange={(c) => void post({ action: "sweep", autoTrade: c }, "sweepAuto")}
            />
            <label htmlFor="sweep-auto" className="text-[11px]" style={{ color: C.muted }}>auto-trade on fire</label>
          </div>
          {st?.sweep?.lastFire && (
            <span className="text-[10px] font-mono" style={{ color: C.dim }}>
              last fire: {st.sweep.lastFire.dir === -1 ? "SELL" : "BUY"} {st.sweep.lastFire.symbol} {st.sweep.lastFire.tf} @ {st.sweep.lastFire.entry}{st.sweep.lastFire.traded ? " · traded" : ""} · {timeAgo(st.sweep.lastFire.time)}
            </span>
          )}
        </div>
        {st?.sweep?.setups && st.sweep.setups.length > 0 && (
          <div className="overflow-x-auto" style={{ ["--row-hov" as string]: C.navy2 }}>
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b text-[9px] tracking-wider" style={{ borderBottomColor: C.line, color: C.muted }}>
                  <Th>PAIR</Th>
                  <Th>STATUS</Th>
                  <Th className="text-right">PRICE</Th>
                  <Th className="text-center">FRESH S / B</Th>
                  <Th className="text-right">NEAREST</Th>
                  <Th>LAST SIGNAL</Th>
                  <Th className="text-right">FEED</Th>
                </tr>
              </thead>
              <tbody>
                {st.sweep.setups.map((r) => (
                  <tr key={`${r.symbol}:${r.tf}`} className="border-b transition-colors hover:bg-[var(--row-hov)]" style={{ borderBottomColor: C.divider }}>
                    <Td>
                      <button
                        onClick={() => onJumpToSymbol?.(r.symbol)}
                        className="font-bold text-xs text-[#EAF3FF] hover:text-[#E9B94E]"
                        title="open in terminal"
                      >
                        {r.symbolLabel.split("·")[0].trim()}
                      </button>
                      <div className="text-[9px] font-mono" style={{ color: C.dim }}>{r.tf}</div>
                    </Td>
                    <Td><Pill tone={statusTone(r.status)}>{r.status}</Pill></Td>
                    <Td className="text-right font-mono text-xs" style={{ color: C.txt }}>{r.price ? r.price.toLocaleString("en-US") : "—"}</Td>
                    <Td className="text-center font-mono text-xs">
                      <span style={{ color: C.red }}>{r.freshSell}</span>
                      <span style={{ color: C.dim }}> / </span>
                      <span style={{ color: C.green }}>{r.freshBuy}</span>
                    </Td>
                    <Td className="text-right font-mono text-[11px]">
                      {r.nearest ? (
                        <span style={{ color: r.nearest.distAtr <= 0.6 ? C.gold : C.muted }}>
                          {r.nearest.side === -1 ? "R " : "S "}
                          {r.nearest.distAtr.toFixed(2)}·ATR
                        </span>
                      ) : (
                        <span style={{ color: C.dim }}>—</span>
                      )}
                    </Td>
                    <Td>
                      {r.lastSignal ? (
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: r.lastSignal.kind === "fire" ? (r.lastSignal.dir === -1 ? C.red : C.green) : C.gold }}>
                          {r.lastSignal.kind === "fire" ? (r.lastSignal.dir === -1 ? "▼ FIRE" : "▲ FIRE") : r.lastSignal.kind.toUpperCase()}{" "}
                          <span className="font-mono font-normal" style={{ color: C.dim }}>{timeAgo(r.lastSignal.time)}</span>
                        </span>
                      ) : (
                        <span className="text-[10px]" style={{ color: C.dim }}>—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <span className="text-[9px] font-mono uppercase" style={{ color: r.source === "simulator" ? C.gold : C.muted }}>
                        {r.source}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {/* holographic strategy radar — real rows, real sweep discipline */}
      <StrategyRadar
        rows={st?.rows ?? []}
        scanning={busy === "scan"}
        lastRun={st?.lastRun ?? 0}
        onJumpToSymbol={onJumpToSymbol}
      />

      {/* add row */}
      <PanelCard title="ADD SYMBOL" icon={ListPlus} accent="gold" bodyClassName="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] tracking-wider" style={{ color: C.muted }}>SYMBOL</label>
            <Select value={addSym} onValueChange={setAddSym}>
              <SelectTrigger className="w-[190px] h-9 bg-[#020B1A] border-[#0F2E58] text-xs text-[#EAF3FF]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#041428] border-[#1C4478] text-[#EAF3FF] max-h-[380px]">
                {SYMBOL_GROUPS.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel className="text-[9px] tracking-[0.18em] text-[#E9B94E]/80 pl-2">{g.label}</SelectLabel>
                    {symbolsByGroup(g.key).map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] tracking-wider" style={{ color: C.muted }}>TIMEFRAME</label>
            <Select value={addTf} onValueChange={setAddTf}>
              <SelectTrigger className="w-[100px] h-9 bg-[#020B1A] border-[#0F2E58] text-xs text-[#EAF3FF]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#041428] border-[#1C4478] text-[#EAF3FF]">
                {TIMEFRAMES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 h-9">
            <Switch checked={addAuto} onCheckedChange={setAddAuto} id="add-auto" />
            <label htmlFor="add-auto" className="text-[11px]" style={{ color: C.muted }}>auto-trade on fire</label>
          </div>
          <Button
            onClick={() => void post({ action: "add", symbol: addSym, tf: addTf, autoTrade: addAuto }, "add")}
            disabled={busy !== null || (st?.rows.length ?? 0) >= (st?.maxRows ?? 12)}
            className="h-9 px-4 rounded-lg bg-[#2ECCFF] text-[#021229] hover:bg-[#7DDDFF] font-bold text-xs tracking-wider"
          >
            {busy === "add" ? "ADDING…" : "+ ADD TO WATCHLIST"}
          </Button>
        </div>
      </PanelCard>

      {/* rows */}
      <PanelCard title="WATCHLIST" icon={Table2} accent="cyan">
        {err && hasRows && (
          <div className="p-3 pb-2">
            {feedErrorFrame}
          </div>
        )}
        {err && !hasRows ? (
          <div className="p-3">
            {feedErrorFrame}
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ ["--row-hov" as string]: C.navy2 }}>
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className="border-b text-[9px] tracking-wider" style={{ borderBottomColor: C.line, color: C.muted }}>
                  <Th>SYMBOL</Th>
                  <Th>STATUS</Th>
                  <Th className="text-right">PRICE</Th>
                  <Th className="text-right">ATR</Th>
                  <Th className="text-center">FRESH S / B</Th>
                  <Th className="text-right">NEAREST</Th>
                  <Th>LAST SIGNAL</Th>
                  <Th className="text-center">SCAN</Th>
                  <Th className="text-center">AUTO</Th>
                  <Th className="text-right">FEED</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {(!st || st.rows.length === 0) && (
                  <tr>
                    <td colSpan={11} className="px-4 py-4">
                      {!loaded ? (
                        <StateFrame state="loading" compact className="w-full" />
                      ) : (
                        <div className="py-4 text-center text-sm" style={{ color: C.muted }}>
                          Watchlist empty — add symbols above to scan for 3EL setups across the board.
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                {st?.rows.map((r) => (
                  <tr key={r.id} className="border-b transition-colors hover:bg-[var(--row-hov)]" style={{ borderBottomColor: C.divider }}>
                    <Td>
                      <button
                        onClick={() => onJumpToSymbol?.(r.symbol)}
                        className="font-bold text-xs text-[#EAF3FF] hover:text-[#E9B94E]"
                        title="open in terminal"
                      >
                        {r.symbolLabel.split("·")[0].trim()}
                      </button>
                      <div className="text-[9px] font-mono" style={{ color: C.dim }}>{r.tf}</div>
                    </Td>
                    <Td>
                      <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                      {r.error && <div className="text-[9px] font-mono max-w-[180px] truncate mt-0.5" style={{ color: C.red }} title={r.error}>{r.error}</div>}
                    </Td>
                    <Td className="text-right font-mono text-xs" style={{ color: C.txt }}>{r.price ? r.price.toLocaleString("en-US") : "—"}</Td>
                    <Td className="text-right font-mono text-[11px]" style={{ color: C.muted }}>{r.atr ? r.atr.toFixed(2) : "—"}</Td>
                    <Td className="text-center font-mono text-xs">
                      <span style={{ color: C.red }}>{r.freshSell}</span>
                      <span style={{ color: C.dim }}> / </span>
                      <span style={{ color: C.green }}>{r.freshBuy}</span>
                    </Td>
                    <Td className="text-right font-mono text-[11px]" >
                      {r.nearest ? (
                        <span style={{ color: r.nearest.distAtr <= 0.6 ? C.gold : C.muted }}>
                          {r.nearest.side === -1 ? "R " : "S "}
                          {r.nearest.distAtr.toFixed(2)}·ATR
                        </span>
                      ) : (
                        <span style={{ color: C.dim }}>—</span>
                      )}
                    </Td>
                    <Td>
                      {r.lastSignal ? (
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: r.lastSignal.kind === "fire" ? (r.lastSignal.dir === -1 ? C.red : C.green) : C.gold }}>
                          {r.lastSignal.kind === "fire" ? (r.lastSignal.dir === -1 ? "▼ FIRE" : "▲ FIRE") : r.lastSignal.kind.toUpperCase()}{" "}
                          <span className="font-mono font-normal" style={{ color: C.dim }}>{timeAgo(r.lastSignal.time)}</span>
                        </span>
                      ) : (
                        <span className="text-[10px]" style={{ color: C.dim }}>—</span>
                      )}
                    </Td>
                    <Td className="text-center">
                      <Switch checked={r.enabled} onCheckedChange={(c) => void post({ action: "patch", id: r.id, enabled: c }, `en:${r.id}`)} />
                    </Td>
                    <Td className="text-center">
                      <Switch checked={r.autoTrade} onCheckedChange={(c) => void post({ action: "patch", id: r.id, autoTrade: c }, `at:${r.id}`)} />
                    </Td>
                    <Td className="text-right">
                      <span className="text-[9px] font-mono uppercase" style={{ color: r.source === "simulator" ? C.gold : C.muted }}>
                        {r.source}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="text-[11px] text-[#51678A] hover:text-[#FF4D5E] px-1" aria-label={`remove ${r.symbol}`}>✕</button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[#041428] border-[#1C4478] text-[#EAF3FF]">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-[#E9B94E]">Remove {r.symbol} {r.tf}?</AlertDialogTitle>
                            <AlertDialogDescription className="text-[#8AA2C2]">
                              Stops scanning and alerts for this row. Existing trades in history are kept.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-transparent border-[#1C4478] text-[#8AA2C2]">Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-[#FF4D5E] text-white hover:bg-[#FF4D5B]" onClick={() => void post({ action: "remove", id: r.id }, `rm:${r.id}`)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      <div
        className="rounded-xl border px-4 py-3 text-[10px] leading-relaxed"
        style={{ borderColor: C.line, background: C.navy4, color: C.muted }}
      >
        Auto-trade rows respect the EA bot&apos;s single-execution guard per row and route through the active
        execution mode (PAPER or LIVE broker). Scanner engines use the strategy settings from the TERMINAL tab;
        changes re-arm rows automatically.
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 font-bold ${className}`}>{children}</th>;
}

function Td({ children, className = "", style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`} style={style}>{children}</td>;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
