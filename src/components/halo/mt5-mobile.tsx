"use client";

// ════════════════════════════════════════════════════════════════════════
//  MT5 LIVE ACCOUNT · mobile-app interface on the dashboard
//  A MetaTrader-5-mobile-style panel that streams the live account:
//    · balance / equity / margin / free margin / margin level / leverage
//    · running trades with live P/L the moment the EA fires
//    · one-tap position close (live broker id or paper EA trade)
//    · recent closed history
//  Polls /api/brokers/live-account every 2.5s (visible tab only).
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { A, C, signedPips } from "@/lib/halo/ui-helpers";

interface LivePos {
  id: string;
  symbol: string;
  side: -1 | 1;
  volume: number;
  entryPrice: number | null;
  currentPrice: number | null;
  sl: number | null;
  tp: number | null;
  pnl: number;
  swap: number;
  commission: number | null;
  openTime: number | null;
  comment: string | null;
  ea: boolean;
  paper: boolean;
  pips: number | null;
}

interface LiveAcct {
  login: string;
  broker: string;
  server: string;
  platform: string;
  currency: string;
  leverage: number | null;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
}

interface HistoryRow {
  id: string;
  symbol: string;
  direction: number;
  resultPips: number | null;
  execMode: string;
  mode: string;
  status: string;
  closedAt: string | null;
}

interface Payload {
  ok: boolean;
  live: boolean;
  degraded: string | null;
  kind: string;
  brokerLabel: string;
  account: LiveAcct | null;
  positions: LivePos[];
  eaOpen: boolean;
  history: HistoryRow[];
  updatedAt: number;
}

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "—" : nf.format(v));
const px = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) || v === 0 ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 5 });
const pnlColor = (v: number) => (v > 0 ? C.green : v < 0 ? C.red : C.muted);
const pnlStr = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${money(Math.abs(v))}`;

function age(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Mt5MobileApp({ notify }: { notify?: (title: string, desc?: string, bad?: boolean) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [closing, setClosing] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const aliveRef = useRef(true);

  // ── poll the live account feed ──
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/brokers/live-account", { cache: "no-store" });
      if (r.ok && aliveRef.current) setData((await r.json()) as Payload);
    } catch {
      /* keep last snapshot */
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 2500);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  // ── phone status-bar clock ──
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, []);

  const closePosition = useCallback(
    async (p: LivePos) => {
      setClosing(p.id);
      try {
        const r = await fetch("/api/brokers/live-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close", positionId: p.id, symbol: p.symbol, side: p.side }),
        });
        const j = (await r.json()) as { ok: boolean; error?: string };
        if (j.ok) notify?.("POSITION CLOSED", `${p.symbol} ${p.side === -1 ? "SELL" : "BUY"} ${p.volume} closed at market.`);
        else notify?.("Close failed", j.error ?? "unknown error", true);
        void load();
      } catch (e) {
        notify?.("Close failed", (e as Error).message, true);
      } finally {
        setClosing(null);
      }
    },
    [notify, load]
  );

  const acct = data?.account ?? null;
  const positions = data?.positions ?? [];
  const floating = positions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const eaCount = positions.filter((p) => p.ea).length;
  const live = Boolean(data?.live);
  const deg = data?.degraded ?? null;
  const lastAge = data ? Math.max(0, Math.round((Date.now() - data.updatedAt) / 1000)) : null;

  return (
    <section aria-label="Live MT5 mobile account" className="flex justify-center">
      {/* ══ phone frame ══ */}
      <div
        className="w-full max-w-[400px] overflow-hidden rounded-[26px] border-2 shadow-2xl"
        style={{ borderColor: C.line, background: C.deep, boxShadow: `0 12px 44px rgba(0,0,0,0.55), 0 0 0 1px ${C.navy}` }}
      >
        {/* status bar */}
        <div className="flex items-center justify-between px-5 pb-1 pt-2.5" style={{ background: C.deep }}>
          <span className="font-mono text-[11px] font-bold" style={{ color: C.txt }}>{clock || "--:--"}</span>
          {/* notch */}
          <span className="h-4 w-20 rounded-full" style={{ background: C.navy, boxShadow: `0 0 0 1px ${C.line}` }} />
          <span className="flex items-center gap-1.5 text-[10px]" style={{ color: C.muted }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: data ? C.green : C.gray }} />
            <span style={{ letterSpacing: 1 }}>▂▄▆</span>
            <span>▮</span>
          </span>
        </div>

        {/* app bar */}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: C.line, background: C.navy }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-black" style={{ background: C.gold, color: C.navy }}>5</span>
              <span className="truncate text-[13px] font-bold" style={{ color: C.txt }}>
                {acct ? acct.login : "connecting…"}
              </span>
              {data && (
                <span
                  className="rounded px-1.5 py-0.5 text-[8px] font-black tracking-widest"
                  style={{
                    background: live ? A.red(0.15) : A.green(0.12),
                    color: live ? C.red : C.green,
                  }}
                >
                  {live ? "LIVE" : "PAPER"}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[9px] tracking-wider" style={{ color: C.muted }}>
              {acct ? `${acct.broker} · ${acct.server}${acct.leverage ? ` · 1:${acct.leverage}` : ""}` : `${data?.brokerLabel ?? "MT5"} · syncing`}
            </div>
          </div>
          {data?.eaOpen && (
            <span
              className="relative flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[8px] font-black tracking-widest"
              style={{ background: A.gold(0.14), color: C.gold }}
            >
              <span className="h-1.5 w-1.5 animate-ping rounded-full" style={{ background: C.gold }} />
              EA RUNNING
            </span>
          )}
        </div>

        {/* degraded strip */}
        {deg && (
          <div className="border-b px-4 py-1.5 text-[9px] font-bold tracking-wider" style={{ background: A.red(0.1), color: C.red, borderColor: A.red(0.35) }}>
            ⚠ BROKER LINK ERROR — RETRYING · {deg.slice(0, 90)}
          </div>
        )}

        {/* equity hero */}
        <div className="border-b px-4 py-3.5 text-center" style={{ borderColor: C.line, background: `linear-gradient(180deg, ${C.navy}, ${C.deep})` }}>
          <div className="text-[9px] font-bold tracking-[0.24em]" style={{ color: C.muted }}>EQUITY</div>
          <div className="mt-0.5 font-mono text-[28px] font-bold leading-none" style={{ color: C.gold }}>
            {acct ? money(acct.equity) : "······"}
            <span className="ml-1.5 text-[11px] font-semibold" style={{ color: C.muted }}>{acct?.currency ?? ""}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold"
              style={{ background: A.green(0.1), color: pnlColor(floating) }}
            >
              Floating {pnlStr(floating)}
            </span>
            {data && lastAge !== null && (
              <span className="font-mono text-[9px]" style={{ color: C.dim }}>
                {live ? "broker" : "engine"} · {lastAge}s
              </span>
            )}
          </div>
        </div>

        {/* 2×2 account tiles */}
        <div className="grid grid-cols-2 gap-px" style={{ background: C.line }}>
          <Tile label="Balance" value={acct ? money(acct.balance) : "—"} curr={acct?.currency ?? ""} color={C.txt} />
          <Tile label="Free margin" value={acct ? money(acct.freeMargin) : "—"} curr={acct?.currency ?? ""} color={C.txt} />
          <Tile label="Margin" value={acct ? money(acct.margin) : "—"} curr={acct?.currency ?? ""} color={C.txt} />
          <Tile
            label="Margin level"
            value={acct ? (acct.marginLevel > 0 ? `${money(acct.marginLevel)}%` : "—") : "—"}
            curr=""
            color={acct && acct.marginLevel > 0 && acct.marginLevel < 200 ? C.red : C.green}
          />
        </div>

        {/* tabs */}
        <div className="grid grid-cols-2 border-b" style={{ borderColor: C.line, background: C.navy }}>
          {(["positions", "history"] as const).map((t) => {
            const active = tab === t;
            const count = t === "positions" ? positions.length : data?.history.length ?? 0;
            return (
              <button
                key={t}
                type="button"
                aria-label={`Show ${t}`}
                onClick={() => setTab(t)}
                className="relative py-2.5 text-[10px] font-black tracking-[0.18em] transition-colors"
                style={{ color: active ? C.gold : C.dim }}
              >
                {t.toUpperCase()}
                {count > 0 && <span className="ml-1 font-mono text-[9px]">({count})</span>}
                {active && <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full" style={{ background: C.gold }} />}
              </button>
            );
          })}
        </div>

        {/* body */}
        <div className="min-h-[240px] px-2.5 py-2" style={{ background: C.deep }}>
          {!data ? (
            <div className="space-y-2 py-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg" style={{ background: C.navy }} />
              ))}
            </div>
          ) : tab === "positions" ? (
            positions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <span className="text-2xl" style={{ color: C.line }}>◎</span>
                <span className="text-[11px] font-bold tracking-wider" style={{ color: C.muted }}>NO OPEN POSITIONS</span>
                <span className="max-w-[240px] text-[9px] leading-relaxed" style={{ color: C.dim }}>
                  The EA book is flat. When HALO fires a C3 entry, the running trade appears here with live P/L.
                </span>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {positions.map((p) => (
                  <PositionRow key={p.id} p={p} closing={closing === p.id} onClose={() => void closePosition(p)} />
                ))}
              </ul>
            )
          ) : (data.history?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="text-2xl" style={{ color: C.line }}>≡</span>
              <span className="text-[11px] font-bold tracking-wider" style={{ color: C.muted }}>NO CLOSED TRADES YET</span>
              <span className="max-w-[240px] text-[9px] leading-relaxed" style={{ color: C.dim }}>
                TP / SL results booked by the EA land in this history feed.
              </span>
            </div>
          ) : (
            <ul className="space-y-1">
              {data.history.map((h) => {
                const win = h.status === "WIN";
                const pips = signedPips(h.status, h.resultPips); // sign from status
                return (
                  <li key={h.id} className="flex items-center justify-between rounded-lg px-2.5 py-2" style={{ background: C.navy }}>
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="rounded px-1 py-0.5 text-[8px] font-black"
                        style={{
                          background: h.direction === -1 ? A.red(0.14) : A.green(0.14),
                          color: h.direction === -1 ? C.red : C.green,
                        }}
                      >
                        {h.direction === -1 ? "SELL" : "BUY"}
                      </span>
                      <span className="truncate text-[11px] font-bold" style={{ color: C.txt }}>{h.symbol}</span>
                      <span
                        className="rounded px-1 py-0.5 text-[7px] font-bold tracking-wider"
                        style={{
                          background: h.execMode === "LIVE" ? A.red(0.12) : "rgba(140,152,174,0.12)",
                          color: h.execMode === "LIVE" ? C.red : C.muted,
                        }}
                      >
                        {h.execMode}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="font-mono text-[9px]" style={{ color: C.dim }}>{age(h.closedAt)}</span>
                      <span className="w-16 text-right font-mono text-[11px] font-bold" style={{ color: win ? C.green : C.red }}>
                        {pips > 0 ? "+" : pips < 0 ? "−" : ""}
                        {Math.abs(pips).toFixed(1)} p
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t px-4 py-2" style={{ borderColor: C.line, background: C.deep }}>
          <span className="text-[8px] font-bold tracking-[0.2em]" style={{ color: C.dim }}>
            {data ? (live ? "MT5 BROKER STREAM" : "EA ENGINE SIM STREAM") : "CONNECTING…"}
            {eaCount > 0 ? ` · ${eaCount} EA` : ""}
          </span>
          <span className="flex items-center gap-1 text-[8px] font-bold tracking-[0.2em]" style={{ color: data ? C.green : C.dim }}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${data ? "animate-pulse" : ""}`} style={{ background: data ? C.green : C.dim }} />
            {data ? "LIVE FEED" : "WAIT"}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── position row ── */

function PositionRow({ p, closing, onClose }: { p: LivePos; closing: boolean; onClose: () => void }) {
  const dirTxt = p.side === -1 ? "SELL" : "BUY";
  const dirColor = p.side === -1 ? C.red : C.green;
  const cur = p.currentPrice ?? 0;
  const entry = p.entryPrice ?? 0;
  const inProfit = p.pnl > 0;
  return (
    <li className="rounded-lg px-2.5 py-2" style={{ background: C.navy, boxShadow: "inset 0 0 0 1px rgba(15,46,88,0.6)" }}>
      <div className="flex items-center justify-between gap-2">
        {/* symbol + side + lots */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="rounded px-1 py-0.5 text-[8px] font-black"
            style={{ background: p.side === -1 ? A.red(0.14) : A.green(0.14), color: dirColor }}
          >
            {dirTxt}
          </span>
          <span className="truncate text-[12px] font-bold" style={{ color: C.txt }}>{p.symbol}</span>
          {p.ea && (
            <span className="rounded px-1 py-0.5 text-[7px] font-black tracking-wider" style={{ background: A.gold(0.16), color: C.gold }}>
              EA
            </span>
          )}
          <span className="shrink-0 font-mono text-[9px]" style={{ color: C.muted }}>{p.volume.toFixed(2)} lot</span>
        </div>
        {/* P/L + close */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-right">
            <span className="block font-mono text-[13px] font-bold leading-none" style={{ color: pnlColor(p.pnl) }}>
              {pnlStr(p.pnl)}
            </span>
            {p.pips !== null && (
              <span className="block font-mono text-[8px] leading-tight" style={{ color: pnlColor(p.pnl) }}>
                {p.pips > 0 ? "+" : ""}
                {p.pips.toFixed(1)} pips
              </span>
            )}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={closing}
                aria-label={`Close ${p.symbol} ${dirTxt} position`}
                className="grid h-6 w-6 place-items-center rounded-full border text-[10px] transition-all hover:brightness-125 disabled:opacity-50"
                style={{ borderColor: A.red(0.45), color: C.red, background: A.red(0.08) }}
              >
                ✕
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
              <AlertDialogHeader>
                <AlertDialogTitle style={{ color: C.red }}>Close {p.symbol} {dirTxt} {p.volume.toFixed(2)} lot?</AlertDialogTitle>
                <AlertDialogDescription style={{ color: C.muted }}>
                  {p.paper
                    ? "The paper position is closed at current price and the result is booked."
                    : "A market close order is sent to the broker for this position immediately."}
                  Current floating P/L: <span style={{ color: pnlColor(p.pnl) }}>{pnlStr(p.pnl)}</span>.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[#1C4478] bg-transparent text-[#8AA2C2] hover:text-[#EAF3FF]">Keep position</AlertDialogCancel>
                <AlertDialogAction className="bg-[#FF4D5E] text-white hover:brightness-125" onClick={(e) => { e.preventDefault(); onClose(); }}>
                  Close position
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* prices line */}
      <div className="mt-1.5 flex items-center justify-between gap-3 border-t pt-1.5 font-mono text-[10px]" style={{ borderColor: "rgba(15,46,88,0.7)" }}>
        <span className="flex items-baseline gap-1" style={{ color: C.muted }}>
          entry <span className="font-semibold" style={{ color: C.txt }}>{px(entry)}</span>
        </span>
        <span className="flex items-baseline gap-1" style={{ color: inProfit ? C.green : C.red }}>
          {p.side === -1 ? "▼" : "▲"} now <span className="font-semibold">{px(cur || entry)}</span>
        </span>
        <span className="flex items-baseline gap-1" style={{ color: C.muted }}>
          SL <span className="font-semibold" style={{ color: C.red }}>{px(p.sl)}</span>
        </span>
        <span className="flex items-baseline gap-1" style={{ color: C.muted }}>
          TP <span className="font-semibold" style={{ color: C.green }}>{px(p.tp)}</span>
        </span>
      </div>

      {/* extras */}
      {(p.swap !== 0 || p.commission !== 0 || (p.comment && p.paper)) && (
        <div className="mt-1 flex items-center justify-between font-mono text-[8px]" style={{ color: C.dim }}>
          <span className="truncate">{p.comment ?? ""}</span>
          <span className="shrink-0">
            {p.swap !== 0 && <span style={{ color: pnlColor(p.swap) }}>swap {pnlStr(p.swap)} </span>}
            {p.commission !== 0 && <span>comm {pnlStr(p.commission ?? 0)}</span>}
          </span>
        </div>
      )}
    </li>
  );
}

/* ── account stat tile ── */

function Tile({ label, value, curr, color }: { label: string; value: string; curr: string; color: string }) {
  return (
    <div className="px-3.5 py-2.5" style={{ background: C.navy }}>
      <div className="text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: C.dim }}>{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="font-mono text-[14px] font-bold" style={{ color }}>
          {value}
        </span>
        {curr && <span className="text-[8px] font-semibold" style={{ color: C.dim }}>{curr}</span>}
      </div>
    </div>
  );
}
