"use client";

// ══════════════════════════════════════════════════════════════════════════
//  JOURNAL TRADES · searchable, filterable, paginated closed-trade book
//  with the full trade-detail dialog (record + the trader's own review:
//  notes, discipline tags, rating, entry/exit reasons, lessons).
//  Tags are journaling classifications — never trading signals.
// ══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search, Star, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill, StateFrame } from "@/components/halo/panel";
import { A, C } from "@/lib/halo/ui-helpers";
import type { JournalRec } from "@/lib/journal/stats";
import { JOURNAL_TAGS } from "@/lib/journal/stats";
import { dt, dur, money, moneyPlain, pnlColor, price, num } from "./journal-fmt";

interface Meta {
  sources: string[];
  symbols: string[];
  strategies: string[];
  timeframes: string[];
}

interface Props {
  filterQS: string; // period/dates/symbol/direction/outcome — owned by the parent
  refreshKey: number;
  meta: Meta | null;
  notify: (title: string, desc?: string, bad?: boolean) => void;
  onChanged: () => void;
}

const PAGE_SIZE = 25;

export function JournalTrades({ filterQS, refreshKey, meta, notify, onChanged }: Props) {
  const [rows, setRows] = useState<JournalRec[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [strategy, setStrategy] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [source, setSource] = useState("");
  const [open, setOpen] = useState<JournalRec | null>(null);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams(filterQS);
        qs.set("page", String(p));
        qs.set("pageSize", String(PAGE_SIZE));
        if (q) qs.set("q", q);
        if (strategy) qs.set("strategy", strategy);
        if (timeframe) qs.set("timeframe", timeframe);
        if (source) qs.set("source", source);
        const res = await fetch(`/api/journal?${qs.toString()}`, { cache: "no-store" });
        const j = (await res.json()) as { ok: boolean; trades?: JournalRec[]; total?: number; error?: string };
        if (!j.ok) throw new Error(j.error ?? "Could not load the trade book.");
        setRows(j.trades ?? []);
        setTotal(j.total ?? 0);
        setPage(p);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [filterQS, q, strategy, timeframe, source]
  );

  useEffect(() => {
    void load(1);
  }, [load, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      {/* search + facet filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[150px] flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.label }} aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search instrument or notes…"
            aria-label="Search trades"
            className="w-full rounded-md border py-1.5 pl-7 pr-2 text-[10px] font-semibold outline-none placeholder:text-[#51678A]"
            style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
          />
        </div>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="Filter by strategy" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
          <option value="">Strategy: all recorded</option>
          {(meta?.strategies ?? []).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} aria-label="Filter by timeframe" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
          <option value="">Timeframe: all recorded</option>
          {(meta?.timeframes ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" className="rounded-md border px-2 py-1.5 text-[10px] font-bold outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
          <option value="">Source: all</option>
          {(meta?.sources ?? []).map((s) => (
            <option key={s} value={s}>{s === "DEMO" ? "DEMO (labeled)" : s}</option>
          ))}
        </select>
      </div>

      {/* table */}
      {loading ? (
        <StateFrame state="loading" title="Loading the trade book" hint="Reading your recorded closed trades." />
      ) : err ? (
        <StateFrame state="error" title="Could not load trades" hint={err} onRetry={() => void load(1)} />
      ) : rows.length === 0 ? (
        <StateFrame state="empty" title="No trades match this filter" hint="Adjust the filters, synchronize MT5 history, import a CSV or add a manual entry." />
      ) : (
        <div className="halo-scroll overflow-x-auto rounded-lg border" style={{ borderColor: C.lineInner }}>
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr style={{ background: A.blue(0.07) }}>
                {["CLOSED (UTC)", "INSTRUMENT", "DIR", "ENTRY", "EXIT", "LOTS", "SL", "TP", "NET P&L", "R", "DURATION", "SOURCE", "STRATEGY"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2.5 py-2 text-[8px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpen(r)}
                  className="cursor-pointer border-t transition-colors hover:bg-[#07203F]/60"
                  style={{ borderColor: C.lineInner }}
                >
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{dt(r.closedAt)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-[10px] font-bold" style={{ color: C.txt }}>
                    {r.symbol} {r.isDemo && <Pill tone="gold">DEMO</Pill>}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="text-[9.5px] font-extrabold" style={{ color: r.direction === "BUY" ? C.green : C.red }}>
                      {r.direction === "BUY" ? "▲ BUY" : "▼ SELL"}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{price(r.entryPrice)}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{price(r.exitPrice)}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{num(r.volume, 2)}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{r.sl !== null ? price(r.sl) : "—"}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{r.tp !== null ? price(r.tp) : "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[10px] font-bold" style={{ color: pnlColor(r.netPnl) }}>{moneyPlain(r.netPnl, r.currency)}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: r.rMultiple !== null ? pnlColor(r.rMultiple) : C.label }}>{r.rMultiple !== null ? `${r.rMultiple > 0 ? "+" : ""}${r.rMultiple.toFixed(2)}R` : "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[9.5px]" style={{ color: C.txt2 }}>{dur(r.durationMin)}</td>
                  <td className="px-2.5 py-1.5"><Pill tone={r.source === "MT5" ? "info" : r.source === "DEMO" ? "gold" : "muted"}>{r.source}</Pill></td>
                  <td className="max-w-[110px] truncate px-2.5 py-1.5 text-[9.5px]" style={{ color: r.strategy ? C.txt2 : C.label }} title={r.strategy}>{r.strategy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px]" style={{ color: C.label }}>
            {total} trades · page {page} / {pages}
          </span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void load(page - 1)} disabled={page <= 1 || loading} className="rounded-md border px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.12em] disabled:opacity-40" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }} aria-label="Previous page">
              <ChevronLeft size={11} />
            </button>
            <button type="button" onClick={() => void load(page + 1)} disabled={page >= pages || loading} className="rounded-md border px-2.5 py-1.5 text-[9px] font-extrabold tracking-[0.12em] disabled:opacity-40" style={{ borderColor: C.line2, background: C.navy2, color: C.txt2 }} aria-label="Next page">
              <ChevronRight size={11} />
            </button>
          </div>
        </div>
      )}

      {open && (
        <TradeDetail
          rec={open}
          onClose={() => setOpen(null)}
          notify={notify}
          onChanged={() => {
            setOpen(null);
            onChanged();
            void load(page);
          }}
        />
      )}
    </div>
  );
}

// ── detail dialog + review editor ────────────────────────────────────────

function TradeDetail({ rec, onClose, notify, onChanged }: { rec: JournalRec; onClose: () => void; notify: Props["notify"]; onChanged: () => void }) {
  const [notes, setNotes] = useState(rec.notes);
  const [tags, setTags] = useState<string[]>(rec.tags);
  const [rating, setRating] = useState<number>(rec.review.rating ?? 0);
  const [reasonEntry, setReasonEntry] = useState(rec.review.reasonEntry ?? "");
  const [reasonExit, setReasonExit] = useState(rec.review.reasonExit ?? "");
  const [chartNotes, setChartNotes] = useState(rec.review.chartNotes ?? "");
  const [mistakes, setMistakes] = useState(rec.review.mistakes ?? "");
  const [lessons, setLessons] = useState(rec.review.lessons ?? "");
  const [strategy, setStrategy] = useState(rec.strategy);
  const [timeframe, setTimeframe] = useState(rec.timeframe);
  const [saving, setSaving] = useState(false);

  const ccy = rec.currency;
  const rows: { label: string; value: string; color?: string }[] = [
    { label: "Opened (UTC)", value: dt(rec.openedAt) },
    { label: "Closed (UTC)", value: dt(rec.closedAt) },
    { label: "Duration", value: dur(rec.durationMin) },
    { label: "Direction", value: rec.direction, color: rec.direction === "BUY" ? C.green : C.red },
    { label: "Volume", value: `${num(rec.volume, 2)} lots (${num(rec.volumeExit, 2)} closed)` },
    { label: "Entry / Exit", value: `${price(rec.entryPrice)} → ${price(rec.exitPrice)}` },
    { label: "Stop loss", value: rec.sl !== null ? price(rec.sl) : "not recorded" },
    { label: "Take profit", value: rec.tp !== null ? price(rec.tp) : "not recorded" },
    { label: "Gross P&L", value: moneyPlain(rec.grossProfit, ccy), color: pnlColor(rec.grossProfit) },
    { label: "Commission", value: moneyPlain(rec.commission, ccy) },
    { label: "Swap", value: moneyPlain(rec.swap, ccy) },
    { label: "Fees", value: moneyPlain(rec.fees, ccy) },
    { label: "Net P&L", value: moneyPlain(rec.netPnl, ccy), color: pnlColor(rec.netPnl) },
    { label: "R-multiple", value: rec.rMultiple !== null ? `${rec.rMultiple.toFixed(2)}R (price-based, SL recorded)` : "not calculable — no SL recorded", color: rec.rMultiple !== null ? pnlColor(rec.rMultiple) : C.label },
    { label: "Source", value: `${rec.source}${rec.brokerLabel ? ` · ${rec.brokerLabel}` : ""}` },
    { label: "Session (derived)", value: rec.session || "— (derived from the UTC open hour)" },
  ];

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/journal/trades/${rec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          tags,
          strategy,
          timeframe,
          review: { reasonEntry, reasonExit, chartNotes, mistakes, lessons, ...(rating > 0 ? { rating } : {}) },
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "Save failed.");
      notify("Trade review saved", `${rec.symbol} ${rec.direction} · ${dt(rec.closedAt)}`);
      onChanged();
    } catch (e) {
      notify("Performance Journal", (e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this trade from the journal? MT5-synced rows would come back on the next sync.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/journal/trades/${rec.id}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "Delete failed.");
      notify("Trade removed", `${rec.symbol} ${rec.direction}`);
      onChanged();
    } catch (e) {
      notify("Performance Journal", (e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-h-[88vh] overflow-y-auto border sm:max-w-[680px]" style={{ background: "linear-gradient(180deg, #041428, #000714)", borderColor: C.panelLine }} dir="ltr">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold tracking-wide" style={{ color: C.txt3 }}>
            <span>{rec.symbol}</span>
            <span style={{ color: rec.direction === "BUY" ? C.green : C.red }}>{rec.direction}</span>
            <span style={{ color: pnlColor(rec.netPnl) }}>{money(rec.netPnl, ccy)}</span>
            {rec.isDemo && <Pill tone="gold">DEMO DATA</Pill>}
            <Pill tone={rec.source === "MT5" ? "info" : "muted"}>{rec.source}</Pill>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-x-4 gap-y-0 rounded-lg border px-3 py-2 sm:grid-cols-2" style={{ borderColor: C.lineInner, background: A.blue(0.04) }}>
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-2 border-b py-[5px] last:border-0" style={{ borderColor: A.white(0.05) }}>
              <span className="shrink-0 text-[8.5px] font-bold uppercase tracking-[0.12em]" style={{ color: C.label }}>{r.label}</span>
              <span className="truncate text-right font-mono text-[10px] font-bold" style={{ color: r.color ?? C.txt2 }}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* discipline tags */}
        <div>
          <div className="pb-1.5 text-[9px] font-extrabold tracking-[0.14em]" style={{ color: C.label }}>DISCIPLINE TAGS (YOUR OWN CLASSIFICATION)</div>
          <div className="flex flex-wrap gap-1.5">
            {JOURNAL_TAGS.map((t) => {
              const on = tags.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTags((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                  aria-pressed={on}
                  className="rounded-full border px-2.5 py-1 text-[9px] font-bold transition-all"
                  style={
                    on
                      ? { borderColor: t.positive ? A.green(0.6) : A.warn(0.6), background: t.positive ? A.green(0.14) : A.warn(0.12), color: t.positive ? C.green : C.warn }
                      : { borderColor: C.line, background: C.navy2, color: C.muted }
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* review fields */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Reason for entering"><textarea value={reasonEntry} onChange={(e) => setReasonEntry(e.target.value)} rows={2} className="halo-scroll w-full rounded-md border px-2 py-1.5 text-[10px] outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Reason for exiting"><textarea value={reasonExit} onChange={(e) => setReasonExit(e.target.value)} rows={2} className="halo-scroll w-full rounded-md border px-2 py-1.5 text-[10px] outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Chart observations"><textarea value={chartNotes} onChange={(e) => setChartNotes(e.target.value)} rows={2} className="halo-scroll w-full rounded-md border px-2 py-1.5 text-[10px] outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Mistakes made"><textarea value={mistakes} onChange={(e) => setMistakes(e.target.value)} rows={2} className="halo-scroll w-full rounded-md border px-2 py-1.5 text-[10px] outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Lessons learned"><textarea value={lessons} onChange={(e) => setLessons(e.target.value)} rows={2} className="halo-scroll w-full rounded-md border px-2 py-1.5 text-[10px] outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Personal rating">
            <div className="flex items-center gap-1 pt-0.5" role="radiogroup" aria-label="Personal rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(rating === n ? 0 : n)} aria-label={`${n} star${n > 1 ? "s" : ""}`} className="p-0.5">
                  <Star size={14} style={{ color: n <= rating ? C.gold : C.dim, fill: n <= rating ? C.gold : "transparent" }} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Strategy / setup (optional)"><input value={strategy} onChange={(e) => setStrategy(e.target.value)} placeholder="only if you classify it" className="w-full rounded-md border px-2 py-1.5 text-[10px] outline-none placeholder:text-[#51678A]" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
          <Field label="Timeframe (optional)"><input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="only if you record it" className="w-full rounded-md border px-2 py-1.5 text-[10px] outline-none placeholder:text-[#51678A]" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} /></Field>
        </div>
        <Field label="Personal observations / notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="halo-scroll w-full rounded-md border px-2 py-1.5 text-[10px] outline-none" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} />
        </Field>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={remove} disabled={saving} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50" style={{ borderColor: A.red(0.4), background: A.red(0.08), color: C.red }}>
            <Trash2 size={11} /> REMOVE
          </button>
          <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-[9px] font-extrabold tracking-[0.12em] transition-all hover:brightness-125 disabled:opacity-50" style={{ borderColor: A.cyan(0.5), background: `linear-gradient(135deg, ${A.blue(0.3)}, ${A.cyan(0.18)})`, color: "#FFFFFF" }}>
            {saving ? <Loader2 size={11} className="animate-spin" /> : null}
            SAVE REVIEW
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block pb-1 text-[8.5px] font-extrabold uppercase tracking-[0.12em]" style={{ color: C.label }}>{label}</span>
      {children}
    </label>
  );
}
