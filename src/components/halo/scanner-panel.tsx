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
import { C } from "@/lib/halo/ui-helpers";
import { SYMBOL_GROUPS, symbolsByGroup, TIMEFRAMES } from "@/lib/market-symbols";
import type { Side } from "@/lib/halo/types";

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

interface State {
  rows: RowState[];
  enabledCount: number;
  autoTradeCount: number;
  totalSignals: number;
  lastRun: number;
  maxRows: number;
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
  onJumpToSymbol?: (symbol: string) => void;
}

function statusColor(s: string): string {
  switch (s) {
    case "RUNNING": return C.red;
    case "C3 WATCH": return C.gold;
    case "ERROR": return C.red;
    case "PAUSED": return C.gray;
    case "WARMING": return C.muted;
    default: return C.green;
  }
}

export function ScannerPanel({ notify, onJumpToSymbol }: Props) {
  const [st, setSt] = useState<State | null>(null);
  const [addSym, setAddSym] = useState("BTCUSDT");
  const [addTf, setAddTf] = useState("5m");
  const [addAuto, setAddAuto] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/scanner", { cache: "no-store" });
      const j = (await r.json()) as State & { ok: boolean };
      if (j.ok) setSt(j);
    } catch {
      // ignore
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

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold tracking-wider text-[#E8ECF4]">MULTI-SYMBOL SCANNER</div>
            <div className="text-[11px] text-[#8C98AE] mt-0.5">
              Every row runs the full C1/C2 → C3 engine. Fires alert all channels; auto-trade rows execute through the EA&apos;s routing.
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => void post({ action: "scan" }, "scan")}
            disabled={busy !== null}
            className="h-9 px-4 rounded-lg border-[#2A3A5C] text-[#E8ECF4] hover:border-[#D4AF37] hover:text-[#D4AF37] bg-transparent text-xs font-bold tracking-wider"
          >
            {busy === "scan" ? "SCANNING…" : "⟳ SCAN NOW"}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Chip label="SYMBOLS" value={st ? `${st.rows.length}/${st.maxRows}` : "—"} />
          <Chip label="ACTIVE" value={st ? String(st.enabledCount) : "—"} color={C.green} />
          <Chip label="AUTO-TRADE" value={st ? String(st.autoTradeCount) : "—"} color={C.gold} />
          <Chip label="SIGNALS" value={st ? String(st.totalSignals) : "—"} />
        </div>
      </div>

      {/* add row */}
      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] tracking-wider text-[#8C98AE]">SYMBOL</label>
            <Select value={addSym} onValueChange={setAddSym}>
              <SelectTrigger className="w-[190px] h-9 bg-[#0B1426] border-[#1C2A47] text-xs text-[#E8ECF4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4] max-h-[380px]">
                {SYMBOL_GROUPS.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel className="text-[9px] tracking-[0.18em] text-[#D4AF37]/80 pl-2">{g.label}</SelectLabel>
                    {symbolsByGroup(g.key).map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] tracking-wider text-[#8C98AE]">TIMEFRAME</label>
            <Select value={addTf} onValueChange={setAddTf}>
              <SelectTrigger className="w-[100px] h-9 bg-[#0B1426] border-[#1C2A47] text-xs text-[#E8ECF4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                {TIMEFRAMES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 h-9">
            <Switch checked={addAuto} onCheckedChange={setAddAuto} id="add-auto" />
            <label htmlFor="add-auto" className="text-[11px] text-[#8C98AE]">auto-trade on fire</label>
          </div>
          <Button
            onClick={() => void post({ action: "add", symbol: addSym, tf: addTf, autoTrade: addAuto }, "add")}
            disabled={busy !== null || (st?.rows.length ?? 0) >= (st?.maxRows ?? 12)}
            className="h-9 px-4 rounded-lg bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold text-xs tracking-wider"
          >
            {busy === "add" ? "ADDING…" : "+ ADD TO WATCHLIST"}
          </Button>
        </div>
      </div>

      {/* rows */}
      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-[#1C2A47] text-[9px] tracking-wider text-[#8C98AE]">
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
                  <td colSpan={11} className="px-4 py-8 text-center text-[#8C98AE] text-sm">
                    Watchlist empty — add symbols above to scan for 3EL setups across the board.
                  </td>
                </tr>
              )}
              {st?.rows.map((r) => (
                <tr key={r.id} className="border-b border-[#141F38] hover:bg-[#101C33] transition-colors">
                  <Td>
                    <button
                      onClick={() => onJumpToSymbol?.(r.symbol)}
                      className="font-bold text-xs text-[#E8ECF4] hover:text-[#D4AF37]"
                      title="open in terminal"
                    >
                      {r.symbolLabel.split("·")[0].trim()}
                    </button>
                    <div className="text-[9px] text-[#5D606B] font-mono">{r.tf}</div>
                  </Td>
                  <Td>
                    <span className="text-[10px] font-bold tracking-wider" style={{ color: statusColor(r.status) }}>
                      {r.status}
                    </span>
                    {r.error && <div className="text-[9px] text-[#F23645] font-mono max-w-[180px] truncate" title={r.error}>{r.error}</div>}
                  </Td>
                  <Td className="text-right font-mono text-xs text-[#E8ECF4]">{r.price ? r.price.toLocaleString("en-US") : "—"}</Td>
                  <Td className="text-right font-mono text-[11px] text-[#8C98AE]">{r.atr ? r.atr.toFixed(2) : "—"}</Td>
                  <Td className="text-center font-mono text-xs">
                    <span style={{ color: C.red }}>{r.freshSell}</span>
                    <span className="text-[#5D606B]"> / </span>
                    <span style={{ color: C.green }}>{r.freshBuy}</span>
                  </Td>
                  <Td className="text-right font-mono text-[11px]" >
                    {r.nearest ? (
                      <span style={{ color: r.nearest.distAtr <= 0.6 ? C.gold : C.muted }}>
                        {r.nearest.side === -1 ? "R " : "S "}
                        {r.nearest.distAtr.toFixed(2)}·ATR
                      </span>
                    ) : (
                      <span className="text-[#5D606B]">—</span>
                    )}
                  </Td>
                  <Td>
                    {r.lastSignal ? (
                      <span className="text-[10px] font-bold tracking-wider" style={{ color: r.lastSignal.kind === "fire" ? (r.lastSignal.dir === -1 ? C.red : C.green) : C.gold }}>
                        {r.lastSignal.kind === "fire" ? (r.lastSignal.dir === -1 ? "▼ FIRE" : "▲ FIRE") : r.lastSignal.kind.toUpperCase()}{" "}
                        <span className="text-[#5D606B] font-mono font-normal">{timeAgo(r.lastSignal.time)}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#5D606B]">—</span>
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
                        <button className="text-[11px] text-[#5D606B] hover:text-[#F23645] px-1" aria-label={`remove ${r.symbol}`}>✕</button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                        <AlertDialogHeader>
                          <AlertDialogTitle className="text-[#D4AF37]">Remove {r.symbol} {r.tf}?</AlertDialogTitle>
                          <AlertDialogDescription className="text-[#8C98AE]">
                            Stops scanning and alerts for this row. Existing trades in history are kept.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="bg-transparent border-[#2A3A5C] text-[#8C98AE]">Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-[#F23645] text-white hover:bg-[#FF4D5B]" onClick={() => void post({ action: "remove", id: r.id }, `rm:${r.id}`)}>
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
      </div>

      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] px-4 py-3 text-[10px] text-[#8C98AE] leading-relaxed">
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

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-3 py-2">
      <div className="text-[9px] tracking-wider text-[#8C98AE]">{label}</div>
      <div className="font-mono font-bold text-sm" style={{ color: color ?? C.txt }}>{value}</div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
