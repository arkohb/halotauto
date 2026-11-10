// ════════════════════════════════════════════════════════════════════════
//  RUNTIME POSITIONS · one shared way for every multi-row EA runtime
//  (Scanner Bot, Market Scanner, all-pairs sweep) to report, close and
//  amend the trade it is running — so the Trading Activity book, Quick
//  Actions (CLOSE ALL · MODIFY SL/TP) and the Control Deck see and act on
//  a scanner-fired trade exactly like a chart-bot trade.
// ════════════════════════════════════════════════════════════════════════

import type { HaloEngine } from "./halo/engine";
import { resolveBroker } from "./execution";
import { applyStopsAmend, validateStops } from "./edge/trade-manager";
import { updateTradeLockStops, type AmendResult, type RunningPosition, type TradeLockSource } from "./trade-lock";

export interface PositionRow {
  symbol: string;
  tf: string;
  engine: HaloEngine;
  lastPrice: number;
  openTradeDbId: string | null;
  liveBrokerId: string | null;
  openTradeExec?: "PAPER" | "LIVE";
}

export function rowPositionHooks<R extends PositionRow>(
  source: TradeLockSource,
  rows: () => Iterable<R>,
  /** run the runtime's own close path (handleEvents on the engine's close event) */
  closeRow: (row: R, events: ReturnType<HaloEngine["forceClose"]>) => Promise<void> | void
) {
  const held = (): R[] => [...rows()].filter((r) => r.openTradeDbId && r.engine.snapshot().trade);
  const close = async (row: R): Promise<void> => {
    const t = row.engine.snapshot().trade!;
    const px = row.lastPrice || t.entry;
    await closeRow(row, row.engine.forceClose(px, Date.now()));
  };
  return {
    positions: (): RunningPosition[] =>
      held().map((r) => {
        const t = r.engine.snapshot().trade!;
        return {
          dbId: r.openTradeDbId!,
          source,
          symbol: r.symbol,
          tf: r.tf,
          dir: t.dir,
          entry: t.entry,
          sl: t.sl,
          tp: t.tp,
          price: r.lastPrice || 0,
          riskPips: t.riskPips,
          rewardPips: t.rewardPips,
          entryTime: t.entryTime,
          slModeLabel: t.slModeLabel,
          exec: r.openTradeExec ?? (r.liveBrokerId ? "LIVE" : "PAPER"),
        };
      }),
    forceClose: async (): Promise<boolean> => {
      const rs = held();
      for (const r of rs) await close(r);
      return rs.length > 0;
    },
    closeTrade: async (dbId: string): Promise<boolean> => {
      const r = held().find((x) => x.openTradeDbId === dbId);
      if (!r) return false;
      await close(r);
      return true;
    },
    amendStops: async (dbId: string, sl: number | null, tp: number | null): Promise<AmendResult | null> => {
      const r = held().find((x) => x.openTradeDbId === dbId);
      if (!r) return null;
      const t = r.engine.snapshot().trade!;
      const v = validateStops(t.dir, r.lastPrice, t, sl, tp);
      if (!v.ok) return { ok: false, error: v.error };
      const broker = r.liveBrokerId ? await resolveBroker(r.liveBrokerId) : null;
      const res = await applyStopsAmend({ tradeDbId: dbId, broker, symbol: r.symbol, dir: t.dir, sl: v.sl, tp: v.tp });
      if (!res.ok) return { ok: false, error: res.error, broker: res.broker };
      r.engine.amendStops(v.sl, v.tp);
      updateTradeLockStops(dbId, v.sl, v.tp);
      return { ok: true, broker: res.broker };
    },
  };
}
