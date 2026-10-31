"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL DATA SOURCES · MT5 sync · CSV import · manual entry · demo data
//  Presentation + import plumbing only — no trading actions live here.
// ══════════════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import { CloudDownload, Database, FileUp, FlaskConical, PenLine, RefreshCw, Trash2 } from "lucide-react";
import { PanelCard, Pill, StateFrame } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import { dt } from "./journal-fmt";

export interface SyncState {
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  lastSyncMsg: string;
  balanceOps?: number;
}

interface MtAccount {
  id: string;
  label: string;
  status: string;
  statusMsg?: string;
  active?: boolean;
}

interface Props {
  sync: SyncState | null;
  accounts: MtAccount[];
  onChanged: () => void;
  notify: (title: string, desc?: string, bad?: boolean) => void;
  demoLoaded: boolean;
  hasAnyRecords: boolean;
}

export function JournalSyncCard({ sync, accounts, onChanged, notify, demoLoaded, hasAnyRecords }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [lookback, setLookback] = useState<string>("30");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      const msg = await fn();
      notify("Performance Journal", msg);
      onChanged();
    } catch (e) {
      notify("Performance Journal", (e as Error).message, true);
    } finally {
      setBusy(null);
    }
  };

  const doSync = () =>
    run("sync", async () => {
      const res = await fetch("/api/journal/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accountId || undefined, lookbackDays: Number(lookback) || 30 }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; result?: { tradesCreated: number; tradesUpdated: number; dealsSeen: number; label: string } };
      if (!j.ok || !j.result) throw new Error(j.error ?? "Synchronization failed.");
      return `MT5 sync complete — ${j.result.dealsSeen} deals scanned on "${j.result.label}", ${j.result.tradesCreated} new + ${j.result.tradesUpdated} updated journal trades.`;
    });

  const doCsv = (file: File | null) => {
    if (!file) return;
    void run("csv", async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/journal/import", { method: "POST", body: form });
      const j = (await res.json()) as { ok: boolean; error?: string; created?: number; skippedExisting?: number; skippedInvalid?: number };
      if (!j.ok) throw new Error(j.error ?? "Import failed.");
      return `CSV imported — ${j.created ?? 0} new trades${j.skippedExisting ? `, ${j.skippedExisting} duplicates skipped` : ""}${j.skippedInvalid ? `, ${j.skippedInvalid} invalid rows rejected` : ""}.`;
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const doDemo = (action: "seed" | "clear") =>
    run(action, async () => {
      const res = await fetch("/api/journal/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; result?: { created?: number; deleted?: number } };
      if (!j.ok) throw new Error(j.error ?? "Demo action failed.");
      return action === "seed" ? `Demo dataset loaded — ${j.result?.created ?? 0} clearly-labeled demo trades.` : `Demo data cleared — ${j.result?.deleted ?? 0} demo rows removed.`;
    });

  const target = accounts.find((a) => a.id === accountId) ?? accounts[0];

  return (
    <PanelCard
      title="DATA SOURCES · MT5 SYNC / CSV / MANUAL"
      icon={Database}
      accent="teal"
      right={
        sync ? (
          <Pill tone={sync.lastSyncOk ? "ok" : "err"} pulse={!sync.lastSyncOk}>
            {sync.lastSyncOk ? "SYNC OK" : "SYNC ERROR"}
          </Pill>
        ) : (
          <Pill tone="muted">NOT SYNCED YET</Pill>
        )
      }
    >
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {/* MT5 automatic sync */}
        <div className="min-w-0 rounded-lg border p-3" style={{ borderColor: C.lineInner, background: `linear-gradient(180deg, ${A.blue(0.05)}, ${C.deep})` }}>
          <div className="flex items-center gap-2 pb-1.5">
            <CloudDownload size={13} style={{ color: C.cyan }} />
            <span className="text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C.txt3 }}>AUTOMATIC MT5 HISTORY</span>
          </div>
          <p className="pb-2 text-[9.5px] leading-relaxed" style={{ color: C.muted }}>
            Reads closed-trade history through your connected MetaApi MT4/MT5 account. Read-only — it never places, modifies or closes anything. Duplicate-safe, partial-close aware.
          </p>
          {accounts.length === 0 ? (
            <StateFrame compact state="empty" title="No MT5 connection yet" hint="Connect a MetaApi account in Brokers & MT5 — or use CSV import / manual entry below." />
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="MT5 account to synchronize"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none"
                  style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} · {a.status}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="History look-back window"
                  value={lookback}
                  onChange={(e) => setLookback(e.target.value)}
                  className="w-[104px] rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none"
                  style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>
              <button
                type="button"
                onClick={doSync}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-[9.5px] font-extrabold tracking-[0.14em] transition-all hover:brightness-125 disabled:opacity-50"
                style={{ borderColor: A.teal(0.5), background: A.teal(0.1), color: C.teal }}
              >
                {busy === "sync" ? <RefreshCw size={12} className="animate-spin" /> : <CloudDownload size={12} />}
                {busy === "sync" ? "SYNCHRONIZING…" : "SYNC MT5 HISTORY NOW"}
              </button>
              {target?.statusMsg && (
                <p className="truncate text-[8.5px]" style={{ color: C.label }} title={target.statusMsg}>
                  Connection status: {target.statusMsg}
                </p>
              )}
            </div>
          )}
          {sync && (
            <div className="mt-2 border-t pt-1.5" style={{ borderColor: C.lineInner }}>
              <p className="text-[8.5px] leading-relaxed" style={{ color: sync.lastSyncOk ? C.green : C.red }}>
                Last sync: {dt(sync.lastSyncAt)} — {sync.lastSyncMsg || "—"}
              </p>
            </div>
          )}
        </div>

        {/* alternatives */}
        <div className="min-w-0 space-y-2 rounded-lg border p-3" style={{ borderColor: C.lineInner, background: `linear-gradient(180deg, ${A.blue(0.05)}, ${C.deep})` }}>
          <div className="flex items-center gap-2 pb-0.5">
            <FileUp size={13} style={{ color: C.gold }} />
            <span className="text-[10px] font-extrabold tracking-[0.14em]" style={{ color: C.txt3 }}>CSV IMPORT &amp; MANUAL ENTRY</span>
          </div>
          <p className="text-[9.5px] leading-relaxed" style={{ color: C.muted }}>
            Import a journal export (TradeZella / TraderSync / MT5 report) or record a trade by hand. Columns are matched by name; unknown fields stay empty — nothing is invented.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50"
              style={{ borderColor: A.gold(0.45), background: A.gold(0.08), color: C.goldHover }}
            >
              {busy === "csv" ? <RefreshCw size={11} className="animate-spin" /> : <FileUp size={11} />}
              IMPORT CSV
            </button>
            <button
              type="button"
              onClick={() => document.dispatchEvent(new CustomEvent("halo-journal-manual-entry"))}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125"
              style={{ borderColor: A.cyan(0.45), background: A.cyan(0.08), color: C.cyan }}
            >
              <PenLine size={11} />
              MANUAL ENTRY
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => doCsv(e.target.files?.[0] ?? null)}
            aria-label="CSV file to import"
          />
          <div className="border-t pt-2" style={{ borderColor: C.lineInner }}>
            <div className="flex items-center gap-1.5 pb-1">
              <FlaskConical size={11} style={{ color: C.muted }} />
              <span className="text-[8.5px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>DEMO DATA (CLEARLY LABELED)</span>
            </div>
            {demoLoaded ? (
              <button
                type="button"
                onClick={() => doDemo("clear")}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50"
                style={{ borderColor: A.red(0.4), background: A.red(0.08), color: C.red }}
              >
                <Trash2 size={11} />
                {busy === "clear" ? "CLEARING…" : "REMOVE DEMO DATA"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => doDemo("seed")}
                disabled={busy !== null || hasAnyRecords}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50"
                style={{ borderColor: A.white(0.2), background: A.white(0.05), color: C.txt2 }}
                title={hasAnyRecords ? "Demo data can only be loaded into an empty journal — it is never mixed with real records." : "Load the labeled sample dataset"}
              >
                <FlaskConical size={11} />
                {busy === "seed" ? "LOADING…" : "LOAD SAMPLE DATASET"}
              </button>
            )}
            <p className="pt-1 text-[8px] leading-relaxed" style={{ color: C.label }}>
              Demo rows are stamped DEMO on every screen and can only be seeded into an empty journal — real history is never mixed with sample data.
            </p>
          </div>
        </div>
      </div>
    </PanelCard>
  );
}
