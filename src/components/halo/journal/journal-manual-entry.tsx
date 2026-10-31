"use client";

// Manual trade entry — every field explicit, nothing pre-filled or guessed.
// Optional numeric fields left empty stay EMPTY (null) in the journal.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { A, C } from "@/lib/halo/ui-helpers";

interface Props {
  open: boolean;
  onClose: () => void;
  notify: (title: string, desc?: string, bad?: boolean) => void;
  onChanged: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block pb-1 text-[8.5px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.label }}>{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-md border px-2 py-1.5 text-[10.5px] outline-none placeholder:text-[#51678A]";

export function ManualEntryDialog({ open, onClose, notify, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    symbol: "",
    direction: "BUY",
    volume: "",
    entryPrice: "",
    exitPrice: "",
    sl: "",
    tp: "",
    openedAt: "",
    closedAt: "",
    grossProfit: "",
    commission: "",
    swap: "",
    fees: "",
    currency: "USD",
    strategy: "",
    timeframe: "",
    notes: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        symbol: f.symbol,
        direction: f.direction,
        currency: f.currency,
        strategy: f.strategy,
        timeframe: f.timeframe,
        notes: f.notes,
      };
      for (const k of ["volume", "entryPrice", "exitPrice", "sl", "tp", "grossProfit", "commission", "swap", "fees"] as const) {
        if (f[k] !== "") body[k] = Number(f[k]);
      }
      if (f.openedAt) body.openedAt = new Date(f.openedAt).toISOString();
      if (f.closedAt) body.closedAt = new Date(f.closedAt).toISOString();
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "Could not record the trade.");
      notify("Manual entry recorded", `${f.symbol.toUpperCase()} ${f.direction}`);
      setF((p) => ({ ...p, symbol: "", volume: "", entryPrice: "", exitPrice: "", sl: "", tp: "", grossProfit: "", commission: "", swap: "", fees: "", notes: "" }));
      onChanged();
      onClose();
    } catch (e) {
      notify("Performance Journal", (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-h-[88vh] overflow-y-auto border sm:max-w-[560px]" style={{ background: "linear-gradient(180deg, #041428, #000714)", borderColor: C.panelLine }}>
        <DialogHeader>
          <DialogTitle className="text-[13px] font-extrabold tracking-wide" style={{ color: C.txt3 }}>MANUAL TRADE ENTRY</DialogTitle>
        </DialogHeader>
        <p className="text-[9px] leading-relaxed" style={{ color: C.label }}>
          Required: instrument, direction, entry/exit price, open/close time. Leave anything you did not record empty — the journal never fills gaps for you. Money fields use the account currency.
        </p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Instrument *"><input value={f.symbol} onChange={set("symbol")} placeholder="EURUSD" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Direction *">
            <select value={f.direction} onChange={set("direction")} className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </Field>
          <Field label="Entry price *"><input value={f.entryPrice} onChange={set("entryPrice")} type="number" step="any" placeholder="1.08543" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Exit price *"><input value={f.exitPrice} onChange={set("exitPrice")} type="number" step="any" placeholder="1.08621" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Opened at * (local datetime)">
            <input value={f.openedAt} onChange={set("openedAt")} type="datetime-local" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} />
          </Field>
          <Field label="Closed at * (local datetime)">
            <input value={f.closedAt} onChange={set("closedAt")} type="datetime-local" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} />
          </Field>
          <Field label="Volume (lots)"><input value={f.volume} onChange={set("volume")} type="number" step="any" placeholder="0.10" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Stop loss"><input value={f.sl} onChange={set("sl")} type="number" step="any" placeholder="optional" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Take profit"><input value={f.tp} onChange={set("tp")} type="number" step="any" placeholder="optional" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Gross P&L"><input value={f.grossProfit} onChange={set("grossProfit")} type="number" step="any" placeholder="e.g. 125.40 or −60" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Commission"><input value={f.commission} onChange={set("commission")} type="number" step="any" placeholder="e.g. −0.70" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Swap"><input value={f.swap} onChange={set("swap")} type="number" step="any" placeholder="e.g. −0.42" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Fees"><input value={f.fees} onChange={set("fees")} type="number" step="any" placeholder="optional" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Currency"><input value={f.currency} onChange={set("currency")} placeholder="USD" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Strategy / setup"><input value={f.strategy} onChange={set("strategy")} placeholder="optional — only if you classify it" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Timeframe"><input value={f.timeframe} onChange={set("timeframe")} placeholder="optional — e.g. 15m" className={inputCls} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
        </div>
        <Field label="Notes">
          <textarea value={f.notes} onChange={set("notes")} rows={2} className={`${inputCls} halo-scroll`} style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3.5 py-1.5 text-[9px] font-extrabold tracking-[0.12em]" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }}>
            CANCEL
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50"
            style={{ borderColor: A.cyan(0.5), background: `linear-gradient(135deg, ${A.blue(0.3)}, ${A.cyan(0.18)})`, color: "#FFFFFF" }}
          >
            {busy && <Loader2 size={11} className="animate-spin" />}
            RECORD TRADE
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
