// ════════════════════════════════════════════════════════════════════════
//  HALO EDGE · Smart Trade Manager — live side
//  The engine decides (break-even / partial / trail on confirmed bars); this
//  module mirrors each decision onto the book and the broker:
//    • stop changes → MT5 (MetaApi) and OANDA via modifyPosition
//    • partial close → MT5 (MetaApi) only, via POSITION_PARTIAL
//    • every other broker → nothing is sent; the engine watches the managed
//      level and the bot closes the trade itself when price reaches it
//      (the existing win/loss → closeBrokerPosition backstop).
// ════════════════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { getAdapter, parseCreds } from "@/lib/brokers";
import type { ActiveBroker } from "@/lib/execution";
import type { ManageEvent } from "@/lib/halo/types";

const STOP_SYNC_KINDS = new Set(["metaapi", "oanda"]);
const PARTIAL_KINDS = new Set(["metaapi"]);

export interface ManageOutcome {
  broker: "sent" | "engine" | "failed" | "paper";
  note: string;
}

export async function applyManageLive(ev: ManageEvent, opts: { tradeDbId: string | null; broker: ActiveBroker | null; symbol: string }): Promise<ManageOutcome> {
  if (opts.tradeDbId) {
    try {
      await db.trade.update({
        where: { id: opts.tradeDbId },
        data: ev.action === "partial" ? { partialPips: ev.pips ?? null } : { sl: ev.sl },
      });
    } catch {
      // the book is best-effort; the broker step below still runs
    }
  }
  const b = opts.broker;
  if (!b) return { broker: "paper", note: "paper trade — managed by the engine" };

  const adapter = getAdapter(b.kind);
  const creds = parseCreds(b.credsJson);
  const wantStop = ev.action !== "partial";
  const supported = wantStop ? STOP_SYNC_KINDS.has(b.kind) && !!adapter.modifyPosition : PARTIAL_KINDS.has(b.kind) && !!adapter.partialClose;
  if (!supported) {
    return {
      broker: "engine",
      note: wantStop
        ? `${b.label} has no stop-amend API here — the bot will close the trade itself at ${ev.sl}`
        : `${b.label} has no partial-close API here — the full position stays open`,
    };
  }

  try {
    const positions = (await adapter.getPositions(creds, opts.symbol)).filter((p) => p.side === ev.dir);
    const targets = positions.some((p) => p.ea) ? positions.filter((p) => p.ea) : positions;
    if (targets.length === 0) return { broker: "failed", note: "no matching open position found at the broker" };
    const errors: string[] = [];
    for (const p of targets) {
      if (wantStop) {
        const r = await adapter.modifyPosition!(creds, p.id, { sl: ev.sl });
        if (!r.ok) errors.push(r.error ?? "modify failed");
      } else {
        const spec = adapter.volumeSpec ? await adapter.volumeSpec(creds, p.symbol) : { volumeMin: 0.01, volumeStep: 0.01 };
        const step = spec.volumeStep > 0 ? spec.volumeStep : 0.01;
        const vol = Math.floor((p.volume * (ev.frac ?? 0)) / step + 1e-9) * step;
        const rounded = Number(vol.toFixed(8));
        if (rounded < spec.volumeMin || rounded >= p.volume) {
          errors.push(`volume ${p.volume} too small to split (min ${spec.volumeMin}, step ${step})`);
          continue;
        }
        const r = await adapter.partialClose!(creds, p.id, rounded);
        if (!r.ok) errors.push(r.error ?? "partial close failed");
      }
    }
    if (errors.length) return { broker: "failed", note: errors.join("; ").slice(0, 240) };
    return { broker: "sent", note: wantStop ? `stop sent to ${b.label}` : `partial close sent to ${b.label}` };
  } catch (e) {
    return { broker: "failed", note: (e as Error).message.slice(0, 240) };
  }
}
