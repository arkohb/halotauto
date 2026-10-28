"use client";

// ════════════════════════════════════════════════════════════════════════
//  BROKERS PANEL · connect CFD broker accounts for REAL order execution
//  OANDA v20 · IG Markets · MT4/MT5 (MetaApi) · Binance · FXCM / cTrader /
//  Deriv / custom via secure order bridge.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { C } from "@/lib/halo/ui-helpers";
import { BROKERS, brokerMeta, type CredField } from "@/lib/brokers/broker-meta";

export interface BrokerRow {
  id: string;
  kind: string;
  label: string;
  env: string;
  status: string;
  statusMsg: string;
  active: boolean;
  lastCheckAt: string | null;
  masked: Record<string, string>;
}

interface Props {
  notify: (title: string, desc?: string, bad?: boolean) => void;
}

export function BrokersPanel({ notify }: Props) {
  const [rows, setRows] = useState<BrokerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brokers", { cache: "no-store" });
      const j = (await r.json()) as { brokers?: BrokerRow[] };
      setRows(j.brokers ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (id: string, act: "test" | "activate", after?: () => void) => {
    setBusyId(`${id}:${act}`);
    try {
      const r = await fetch(`/api/brokers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act }),
      });
      const j = (await r.json()) as { ok: boolean; status?: string; statusMsg?: string; warn?: string; error?: string };
      if (!j.ok) notify(`${act} failed`, j.error, true);
      else if (act === "test") {
        notify(
          j.status === "ok" ? "CONNECTION OK" : "TEST FAILED",
          j.statusMsg,
          j.status !== "ok"
        );
      } else {
        notify("ACCOUNT ACTIVATED", j.warn ?? "Live orders route through this account.");
        if (j.warn) notify("Heads up", j.warn, true);
      }
      await load();
      after?.();
    } catch (e) {
      notify("Action failed", (e as Error).message, true);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(`${id}:del`);
    try {
      await fetch(`/api/brokers/${id}`, { method: "DELETE" });
      notify("ACCOUNT REMOVED");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold tracking-wider text-[#E8ECF4]">CFD BROKER CONNECTIONS</div>
            <div className="text-[11px] text-[#8C98AE] mt-0.5">
              Real market orders with SL/TP. Credentials stay on this server — only masked hints reach the browser.
            </div>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="h-9 px-4 rounded-lg bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold text-xs tracking-wider">
                + CONNECT BROKER
              </Button>
            </DialogTrigger>
            <AddBrokerDialog
              onDone={() => {
                setAddOpen(false);
                void load();
              }}
              notify={notify}
            />
          </Dialog>
        </div>
      </div>

      {rows.length === 0 && !loading && (
        <div className="rounded-xl border border-dashed border-[#2A3A5C] bg-[#0F1A30] p-8 text-center text-[#8C98AE] text-sm">
          No broker accounts yet — connect OANDA, IG, your MT4/MT5 broker via MetaApi, Binance, or a custom bridge.
          Until then the EA runs on <span className="text-[#D4AF37]">paper execution</span>.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((b) => {
          const meta = brokerMeta(b.kind);
          const statusColor = b.status === "ok" ? C.green : b.status === "error" ? C.red : C.gold;
          return (
            <div key={b.id} className={`rounded-xl border bg-[#0F1A30] p-4 ${b.active ? "border-[#D4AF37]" : "border-[#1C2A47]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-[#E8ECF4] truncate">{b.label}</span>
                    <Badge variant="outline" className="text-[9px] border-[#2A3A5C] text-[#8C98AE] uppercase">
                      {meta?.name ?? b.kind}
                    </Badge>
                    {b.env && b.env !== "—" && (
                      <Badge
                        variant="outline"
                        className="text-[9px] uppercase"
                        style={{
                          borderColor: /live|real/i.test(b.env) ? "rgba(242,54,69,0.6)" : "rgba(8,153,129,0.6)",
                          color: /live|real/i.test(b.env) ? C.red : C.green,
                        }}
                      >
                        {String(b.env)}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-[#8C98AE] mt-1 truncate">{meta?.tagline}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider" style={{ color: statusColor }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
                    {b.active ? "ACTIVE" : b.status.toUpperCase()}
                  </span>
                  {b.active && (
                    <Switch checked={b.active} disabled aria-label="active account" className="scale-75 pointer-events-none" />
                  )}
                </div>
              </div>

              {b.statusMsg && (
                <div
                  className="mt-2 text-[11px] font-mono rounded-md px-2 py-1.5 leading-relaxed"
                  style={{
                    background: b.status === "ok" ? "rgba(8,153,129,0.08)" : "rgba(242,54,69,0.08)",
                    color: b.status === "ok" ? C.green : C.red,
                  }}
                >
                  {b.statusMsg}
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#5D606B] font-mono">
                {Object.entries(b.masked).slice(0, 4).map(([k, v]) => (
                  <span key={k}>
                    {k}: <span className="text-[#8C98AE]">{v}</span>
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => void action(b.id, "test")}
                  className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#E8ECF4] hover:border-[#D4AF37] hover:text-[#D4AF37] bg-transparent"
                >
                  {busyId === `${b.id}:test` ? "TESTING…" : "TEST"}
                </Button>
                {!b.active && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void action(b.id, "activate")}
                    className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#E8ECF4] hover:border-[#089981] hover:text-[#089981] bg-transparent"
                  >
                    SET ACTIVE
                  </Button>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId !== null}
                      className="h-8 px-3 text-[11px] border-[#2A3A5C] text-[#8C98AE] hover:border-[#F23645] hover:text-[#F23645] bg-transparent ml-auto"
                    >
                      REMOVE
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-[#D4AF37]">Remove {b.label}?</AlertDialogTitle>
                      <AlertDialogDescription className="text-[#8C98AE]">
                        Credentials are wiped. If it was the active live account, execution falls back to paper.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="bg-transparent border-[#2A3A5C] text-[#8C98AE]">Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-[#F23645] text-white hover:bg-[#FF4D5B]" onClick={() => void remove(b.id)}>
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── add-broker dialog ─────────────────────────

function AddBrokerDialog({ onDone, notify }: { onDone: () => void; notify: Props["notify"] }) {
  const [kind, setKind] = useState<string>("oanda");
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [symbolMap, setSymbolMap] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = brokerMeta(kind);

  const pickKind = (k: string) => {
    setKind(k);
    setValues({});
    setLabel("");
    setSymbolMap("");
  };

  const save = async () => {
    if (!meta) return;
    setBusy(true);
    try {
      const creds: Record<string, unknown> = { ...values };
      creds.environment = creds.environment ?? meta.fields.find((f) => f.key === "environment")?.options?.[0];
      if (symbolMap.trim()) {
        try {
          creds.symbolMap = JSON.parse(symbolMap);
        } catch {
          notify("Symbol map is not valid JSON", undefined, true);
          setBusy(false);
          return;
        }
      }
      const r = await fetch("/api/brokers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label: label || meta.name, creds }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string; id?: string };
      if (!j.ok) {
        notify("Could not add broker", j.error, true);
        setBusy(false);
        return;
      }
      // immediately test
      if (j.id) {
        const tr = await fetch(`/api/brokers/${j.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "test" }),
        });
        const tj = (await tr.json()) as { ok: boolean; status?: string; statusMsg?: string };
        notify(
          tj.status === "ok" ? "BROKER CONNECTED" : "ADDED — BUT TEST FAILED",
          tj.statusMsg,
          tj.status !== "ok"
        );
      }
      onDone();
    } catch (e) {
      notify("Save failed", (e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4] max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#D4AF37] text-base">Connect a CFD broker</DialogTitle>
        <DialogDescription className="text-[#8C98AE] text-xs">
          Pick a platform, paste its API credentials, then TEST. The active account receives the EA&apos;s real orders.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-2">
        {BROKERS.filter((b) => b.kind !== "paper").map((b) => (
          <button
            key={b.kind}
            onClick={() => pickKind(b.kind)}
            className={`text-left rounded-lg border px-3 py-2 transition-colors ${
              kind === b.kind ? "border-[#D4AF37] bg-[rgba(212,175,55,0.08)]" : "border-[#1C2A47] hover:border-[#2A3A5C]"
            }`}
          >
            <div className="text-xs font-bold text-[#E8ECF4]">{b.name}</div>
            <div className="text-[10px] text-[#8C98AE] leading-snug mt-0.5 line-clamp-2">{b.tagline}</div>
          </button>
        ))}
      </div>

      {meta && (
        <div className="space-y-3 pt-1">
          <Field label="LABEL">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={meta.name}
              className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
            />
          </Field>
          {meta.fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <CredInput field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
            </Field>
          ))}
          <Field
            label="SYMBOL MAP (optional, JSON)"
            hint='internal → broker symbol, e.g. {"PAXGUSDT":"XAU_USD"}'
          >
            <Input
              value={symbolMap}
              onChange={(e) => setSymbolMap(e.target.value)}
              placeholder='{"PAXGUSDT":"XAU_USD"}'
              className="h-9 bg-[#0B1426] border-[#1C2A47] text-xs font-mono text-[#E8ECF4]"
            />
          </Field>
          {meta.notes.length > 0 && (
            <ul className="text-[10px] text-[#8C98AE] leading-relaxed list-disc pl-4 space-y-0.5">
              {meta.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DialogFooter>
        <Button
          onClick={() => void save()}
          disabled={busy || !meta}
          className="w-full h-10 rounded-lg bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A] font-bold text-xs tracking-wider"
        >
          {busy ? "CONNECTING…" : "CONNECT + TEST"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] tracking-wider text-[#8C98AE]">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-[#5D606B] leading-snug">{hint}</div>}
    </div>
  );
}

function CredInput({ field, value, onChange }: { field: CredField; value: string; onChange: (v: string) => void }) {
  if (field.type === "switch") {
    return (
      <div className="flex items-center gap-2 h-9">
        <Switch checked={value === "yes"} onCheckedChange={(c) => onChange(c ? "yes" : "")} />
        <span className="text-xs text-[#8C98AE]">{value === "yes" ? "enabled" : "disabled"}</span>
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="grid grid-cols-2 gap-2">
        {(field.options ?? []).map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`h-9 rounded-lg text-[11px] font-bold uppercase tracking-wider border ${
              value === o ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#1C2A47] text-[#8C98AE]"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }
  return (
    <Input
      type={field.type === "password" ? "password" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      autoComplete="off"
      className="h-9 bg-[#0B1426] border-[#1C2A47] text-sm text-[#E8ECF4]"
    />
  );
}
