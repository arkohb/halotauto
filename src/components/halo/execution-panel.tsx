"use client";

// ════════════════════════════════════════════════════════════════════════
//  EXECUTION PANEL · PAPER ↔ LIVE broker routing + sizing + manual close
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { A, C, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard, StateFrame } from "./panel";

interface BrokerRow {
  id: string;
  kind: string;
  label: string;
  env: string;
  status: string;
  statusMsg: string;
  active: boolean;
}

interface Props {
  state: BotStateRes;
  onSaved: (msg: string) => void;
  onError: (title: string, msg?: string) => void;
}

export function ExecutionPanel({ state, onSaved, onError }: Props) {
  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  // honest-state: set only by the existing fetch catch, cleared when data arrives
  const [brokersErr, setBrokersErr] = useState(false);
  const [mode, setMode] = useState<"paper" | "live">(state.exec.executionMode);
  const [brokerId, setBrokerId] = useState(state.exec.broker?.id ?? "");
  const [sizingMode, setSizingMode] = useState<"fixed" | "percent">(state.exec.sizingMode);
  const [sizeFixed, setSizeFixed] = useState(String(state.exec.sizeFixed));
  const [sizePercent, setSizePercent] = useState(String(state.exec.sizePercent));
  const [busy, setBusy] = useState(false);
  const openTrade = Boolean(state.engine.trade);

  useEffect(() => {
    setMode(state.exec.executionMode);
    setBrokerId(state.exec.broker?.id ?? "");
    setSizingMode(state.exec.sizingMode);
    setSizeFixed(String(state.exec.sizeFixed));
    setSizePercent(String(state.exec.sizePercent));
  }, [state.exec]);

  useEffect(() => {
    let alive = true;
    fetch("/api/brokers", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { brokers?: BrokerRow[] }) => {
        if (alive && j.brokers) {
          setBrokers(j.brokers);
          setBrokersErr(false);
        }
      })
      .catch(() => {
        if (alive) setBrokersErr(true);
      });
    return () => {
      alive = false;
    };
  }, [state.exec.broker]);

  const tradable = brokers.filter((b) => b.status === "ok");

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exec: {
            executionMode: mode,
            brokerAccountId: brokerId,
            sizingMode,
            sizeFixed: Number(sizeFixed) || 0.01,
            sizePercent: Number(sizePercent) || 1,
            ...patch,
          },
        }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) onError("Execution change rejected", j.error);
      else onSaved(mode === "live" ? "LIVE EXECUTION ARMED" : "PAPER EXECUTION SET");
    } catch (e) {
      onError("Save failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closeNow = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/bot/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) onError("Cannot close", j.error);
      else onSaved("POSITION CLOSED AT MARKET");
    } catch (e) {
      onError("Close failed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const liveWithoutBroker = mode === "live" && !brokerId;

  return (
    <PanelCard
      title="EXECUTION ROUTING"
      icon={Route}
      accent="teal"
      bodyClassName="p-4 space-y-3"
      right={
        <span
          className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded"
          style={{
            background: mode === "live" ? A.red(0.18) : A.green(0.16),
            color: mode === "live" ? C.red : C.green,
          }}
        >
          {mode === "live" ? "LIVE ORDERS" : "PAPER"}
        </span>
      }
    >
      {/* mode */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode("paper")}
          className={`h-10 rounded-lg text-[11px] font-bold tracking-wider border transition-colors ${mode !== "paper" ? "border-[#1C2A47] text-[#8C98AE] hover:border-[#2A3A5C]" : ""}`}
          style={mode === "paper" ? { borderColor: C.green, color: C.green, background: A.green(0.1) } : undefined}
        >
          PAPER (SIM)
        </button>
        <button
          onClick={() => setMode("live")}
          className={`h-10 rounded-lg text-[11px] font-bold tracking-wider border transition-colors ${mode !== "live" ? "border-[#1C2A47] text-[#8C98AE] hover:border-[#2A3A5C]" : ""}`}
          style={mode === "live" ? { borderColor: C.red, color: C.red, background: A.red(0.1) } : undefined}
        >
          LIVE · REAL ORDERS
        </button>
      </div>

      {/* broker select */}
      {mode === "live" && (
        <div className="space-y-2">
          <label className="text-[10px] tracking-wider" style={{ color: C.muted }}>ACTIVE BROKER ACCOUNT</label>
          <Select value={brokerId || undefined} onValueChange={setBrokerId}>
            <SelectTrigger className="h-9 text-xs" style={{ background: C.navy, borderColor: C.line, color: C.txt }}>
              <SelectValue placeholder={tradable.length ? "select account" : "no tested accounts"} />
            </SelectTrigger>
            <SelectContent style={{ background: C.navy2, borderColor: C.line2, color: C.txt }}>
              {brokers.map((b) => (
                <SelectItem key={b.id} value={b.id} disabled={b.status !== "ok"} className="text-xs">
                  {b.label} · {b.kind}
                  {b.status !== "ok" ? " (untested)" : ""}
                </SelectItem>
              ))}
              {tradable.length === 0 && brokers.length === 0 && (
                <SelectItem value="_none" disabled className="text-xs">
                  Add a broker in the BROKERS tab
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {brokersErr && brokers.length === 0 && (
            <StateFrame state="error" title="Broker list unavailable" compact />
          )}
          {tradable.length === 0 && (
            <div className="rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: A.gold(0.4), background: A.gold(0.08), color: C.gold }}>
              Add a broker account in the <b>BROKERS</b> tab and run TEST — then route live orders here.
            </div>
          )}
        </div>
      )}

      {/* sizing */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSizingMode("fixed")}
          className={`h-9 rounded-lg text-[10px] font-bold tracking-wider border ${sizingMode !== "fixed" ? "border-[#1C2A47] text-[#8C98AE]" : ""}`}
          style={sizingMode === "fixed" ? { borderColor: C.gold, color: C.gold } : undefined}
        >
          FIXED SIZE
        </button>
        <button
          onClick={() => setSizingMode("percent")}
          className={`h-9 rounded-lg text-[10px] font-bold tracking-wider border ${sizingMode !== "percent" ? "border-[#1C2A47] text-[#8C98AE]" : ""}`}
          style={sizingMode === "percent" ? { borderColor: C.gold, color: C.gold } : undefined}
        >
          RISK % EQUITY
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="any"
          min="0"
          value={sizingMode === "fixed" ? sizeFixed : sizePercent}
          onChange={(e) => (sizingMode === "fixed" ? setSizeFixed(e.target.value) : setSizePercent(e.target.value))}
          className="h-9 text-sm font-mono"
          style={{ background: C.navy, borderColor: C.line, color: C.txt }}
        />
        <span className="text-[10px] whitespace-nowrap" style={{ color: C.muted }}>
          {sizingMode === "fixed" ? "native units / lots" : "% equity per trade"}
        </span>
      </div>

      <Button
        onClick={() => void save({})}
        disabled={busy || liveWithoutBroker}
        className="w-full h-10 rounded-lg font-bold text-xs tracking-wider text-[#0B1426] bg-[#D4AF37] hover:bg-[#E3C25A] disabled:opacity-50"
      >
        {busy ? "…" : "APPLY ROUTING"}
      </Button>

      {openTrade && (
        <Button
          onClick={closeNow}
          disabled={busy}
          variant="outline"
          className="w-full h-9 rounded-lg text-[11px] font-bold tracking-wider border-[#2A3A5C] text-[#E8ECF4] hover:border-[#F23645] hover:text-[#F23645] bg-transparent"
        >
          ✕ CLOSE OPEN POSITION AT MARKET
        </Button>
      )}
    </PanelCard>
  );
}
