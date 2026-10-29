"use client";

// ════════════════════════════════════════════════════════════════════════
//  EXECUTION PANEL · PAPER ↔ LIVE broker routing + sizing + manual close
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { C, type BotStateRes } from "@/lib/halo/ui-helpers";

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
        if (alive && j.brokers) setBrokers(j.brokers);
      })
      .catch(() => {});
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
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1C2A47] flex items-center justify-between">
        <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">EXECUTION ROUTING</span>
        <span
          className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded"
          style={{
            background: mode === "live" ? "rgba(242,54,69,0.18)" : "rgba(8,153,129,0.16)",
            color: mode === "live" ? C.red : C.green,
          }}
        >
          {mode === "live" ? "LIVE ORDERS" : "PAPER"}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* mode */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setMode("paper")}
            className={`h-10 rounded-lg text-[11px] font-bold tracking-wider border transition-colors ${
              mode === "paper" ? "border-[#089981] text-[#089981] bg-[rgba(8,153,129,0.1)]" : "border-[#1C2A47] text-[#8C98AE] hover:border-[#2A3A5C]"
            }`}
          >
            PAPER (SIM)
          </button>
          <button
            onClick={() => setMode("live")}
            className={`h-10 rounded-lg text-[11px] font-bold tracking-wider border transition-colors ${
              mode === "live" ? "border-[#F23645] text-[#F23645] bg-[rgba(242,54,69,0.1)]" : "border-[#1C2A47] text-[#8C98AE] hover:border-[#2A3A5C]"
            }`}
          >
            LIVE · REAL ORDERS
          </button>
        </div>

        {/* broker select */}
        {mode === "live" && (
          <div className="space-y-2">
            <label className="text-[10px] tracking-wider text-[#8C98AE]">ACTIVE BROKER ACCOUNT</label>
            <Select value={brokerId || undefined} onValueChange={setBrokerId}>
              <SelectTrigger className="h-9 bg-[#0B1426] border-[#1C2A47] text-xs text-[#E8ECF4]">
                <SelectValue placeholder={tradable.length ? "select account" : "no tested accounts"} />
              </SelectTrigger>
              <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
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
            {tradable.length === 0 && (
              <div className="rounded-lg border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.08)] px-3 py-2 text-[11px] text-[#D4AF37] leading-relaxed">
                Add a broker account in the <b>BROKERS</b> tab and run TEST — then route live orders here.
              </div>
            )}
          </div>
        )}

        {/* sizing */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSizingMode("fixed")}
            className={`h-9 rounded-lg text-[10px] font-bold tracking-wider border ${
              sizingMode === "fixed" ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#1C2A47] text-[#8C98AE]"
            }`}
          >
            FIXED SIZE
          </button>
          <button
            onClick={() => setSizingMode("percent")}
            className={`h-9 rounded-lg text-[10px] font-bold tracking-wider border ${
              sizingMode === "percent" ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#1C2A47] text-[#8C98AE]"
            }`}
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
            className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm font-mono text-[#E8ECF4]"
          />
          <span className="text-[10px] text-[#8C98AE] whitespace-nowrap">
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
      </div>
    </div>
  );
}
