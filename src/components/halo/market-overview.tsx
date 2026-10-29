"use client";

// ════════════════════════════════════════════════════════════════════════
//  MARKET OVERVIEW · multi-symbol quote rows (dashboard right column)
//
//  Data source: the existing /api/intel/quote endpoint (real Yahoo Finance
//  quotes, server-cached). Rows that fail to fetch show an honest "—",
//  never a placeholder price. The active trading symbol is pinned first.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { ListTree } from "lucide-react";
import { C, type BotStateRes } from "@/lib/halo/ui-helpers";
import { PanelCard, StateFrame } from "./panel";

interface QuoteRow {
  ok: boolean;
  label: string;
  price: number | null;
  changePct: number | null;
}

const WATCH = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"];

function MarketOverviewInner({ state }: { state: BotStateRes }) {
  const [quotes, setQuotes] = useState<Record<string, QuoteRow>>({});
  const [loaded, setLoaded] = useState(false);
  // active symbol first, then the fixed watchlist (deduped, max 5 rows) —
  // derived from props, no state needed
  const order = [state.symbol, ...WATCH.filter((s) => s !== state.symbol)].slice(0, 5);

  useEffect(() => {
    let alive = true;
    const syms = order;
    const load = async () => {
      const next: Record<string, QuoteRow> = {};
      await Promise.all(
        syms.map(async (s) => {
          try {
            const r = await fetch(`/api/intel/quote?symbol=${encodeURIComponent(s)}`, { cache: "no-store" });
            if (r.ok) {
              const j = (await r.json()) as QuoteRow;
              next[s] = j;
              return;
            }
          } catch {
            // honest miss — row renders as unavailable
          }
          next[s] = { ok: false, label: s, price: null, changePct: null };
        })
      );
      if (alive) {
        setQuotes(next);
        setLoaded(true);
      }
    };
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state.symbol]);

  const rows = order.map((s) => [s, quotes[s]] as const).filter(([, q]) => Boolean(q));

  return (
    <div className="flex h-full flex-col px-2 pb-2 pt-1.5">
      {rows.length === 0 && !loaded ? (
        <StateFrame state="loading" title="Loading quotes…" compact className="m-1.5" />
      ) : (
        <div className="flex flex-col gap-[3px]">
          {rows.map(([sym, q]) => {
            const up = (q.changePct ?? 0) >= 0;
            const active = sym === state.symbol;
            return (
              <div
                key={sym}
                className="flex items-center gap-2 rounded-lg border px-2.5 py-[7px]"
                style={{
                  borderColor: active ? `${C.cyan}55` : C.lineInner,
                  background: active ? `linear-gradient(90deg, ${C.cyan}14, transparent 70%)` : "rgba(2,11,26,0.65)",
                  boxShadow: active ? `0 0 10px 0 ${C.cyan}22` : undefined,
                }}
              >
                <span className="w-[64px] shrink-0 truncate text-[11px] font-extrabold tracking-wide" style={{ color: active ? C.cyan : C.txt2 }}>
                  {sym}
                </span>
                <span className="ml-auto font-mono text-[11.5px] font-bold tabular-nums" style={{ color: q.price != null ? C.txt : C.dim }}>
                  {q.price != null
                    ? q.price.toLocaleString("en-US", { minimumFractionDigits: q.price < 10 ? 3 : 2, maximumFractionDigits: q.price < 10 ? 3 : 2 })
                    : "—"}
                </span>
                <span
                  className="w-[58px] shrink-0 text-right font-mono text-[10px] font-bold tabular-nums"
                  style={{ color: q.changePct == null ? C.dim : up ? C.green : C.red }}
                >
                  {q.changePct == null ? "—" : `${up ? "+" : "−"}${Math.abs(q.changePct).toFixed(2)}%`}
                </span>
              </div>
            );
          })}
          <div className="px-1 pt-0.5 text-right text-[7.5px] tracking-wide" style={{ color: C.dim }}>
            Yahoo Finance · delayed quotes
          </div>
        </div>
      )}
    </div>
  );
}

export function MarketOverview({ state }: { state: BotStateRes }) {
  return (
    <PanelCard title="MARKET OVERVIEW" icon={ListTree} accent="cyan">
      <MarketOverviewInner state={state} />
    </PanelCard>
  );
}
