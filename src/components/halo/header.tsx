"use client";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { C, type BotStateRes } from "@/lib/halo/ui-helpers";
import { usePwa } from "./pwa";
import { SYMBOL_GROUPS, symbolsByGroup, TIMEFRAMES } from "@/lib/market-symbols";

interface Props {
  state: BotStateRes | null;
  busy: string | null;
  onSymbol: (s: string) => Promise<void>;
  onTf: (tf: string) => Promise<void>;
}

export function Header({ state, busy, onSymbol, onTf }: Props) {
  const { canInstall, install } = usePwa();

  return (
    <header className="sticky top-0 z-40 border-b border-[#1C2A47] bg-[#0B1426]/92 backdrop-blur supports-[backdrop-filter]:bg-[#0B1426]/80">
      {/* copyright strip · gold */}
      <div className="border-b border-[#1C2A47]/70 bg-gradient-to-r from-[#0B1426] via-[#101C33] to-[#0B1426]">
        <div className="mx-auto flex w-full max-w-[1720px] items-center justify-center gap-2 px-3 py-1.5">
          <span aria-hidden className="h-px w-8 shrink-0" style={{ background: `linear-gradient(to right, transparent, ${C.gold}66)` }} />
          <span className="text-[10px] font-bold tracking-[0.24em] whitespace-nowrap" style={{ color: C.gold, textShadow: "0 0 12px rgba(212,175,55,0.35)" }}>
            © {new Date().getFullYear()} · CREATED BY BISMARK ARKO-OFORI
          </span>
          <span aria-hidden className="h-px w-8 shrink-0" style={{ background: `linear-gradient(to left, transparent, ${C.gold}66)` }} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1720px] px-3 lg:px-5">
        <div className="flex h-14 items-center gap-3">
          {/* logo */}
          <div className="flex items-center gap-2 shrink-0">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
              <rect x="1" y="1" width="24" height="24" rx="6" fill="none" stroke={C.gold} strokeWidth="1.4" opacity="0.5" />
              <path d="M13 3.5 L17 7.5 L13 11.5 L9 7.5 Z" fill={C.gold} />
              <line x1="3" y1="16" x2="23" y2="16" stroke={C.gold} strokeWidth="1.2" strokeDasharray="3 2" opacity="0.85" />
              <rect x="6" y="8" width="3.4" height="6" rx="0.8" fill={C.red} />
              <line x1="7.7" y1="6" x2="7.7" y2="16.5" stroke={C.red} strokeWidth="1.1" />
              <rect x="16.5" y="18" width="3.4" height="5" rx="0.8" fill={C.green} />
              <line x1="18.2" y1="15.5" x2="18.2" y2="24" stroke={C.green} strokeWidth="1.1" />
            </svg>
            <div className="leading-tight">
              <div className="text-sm font-extrabold tracking-wide" style={{ color: C.gold }}>
                HALO 3EL
              </div>
              <div className="text-[9px] tracking-[0.22em] text-[#8C98AE]">AUTOTRADER · EA BOT</div>
            </div>
          </div>

          {/* symbol + tf */}
          <div className="hidden sm:flex items-center gap-2 ml-2">
            <Select
              value={state?.symbol ?? "PAXGUSDT"}
              onValueChange={(v) => void onSymbol(v)}
              disabled={busy !== null}
            >
              <SelectTrigger className="h-8 w-[150px] text-xs bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4] max-h-[380px]">
                {SYMBOL_GROUPS.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel className="text-[9px] tracking-[0.18em] text-[#D4AF37]/80 pl-2">{g.label}</SelectLabel>
                    {symbolsByGroup(g.key).map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Select value={state?.tf ?? "5m"} onValueChange={(v) => void onTf(v)} disabled={busy !== null}>
              <SelectTrigger className="h-8 w-[76px] text-xs bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                {TIMEFRAMES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1" />

          {/* feed badge */}
          {state && (
            <span
              className="hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider"
              style={{
                borderColor: state.feed.source === "simulator" ? "rgba(212,175,55,0.5)" : "rgba(8,153,129,0.5)",
                color: state.feed.source === "simulator" ? C.gold : C.green,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: state.feed.source === "simulator" ? C.gold : C.green }} />
              {state.feed.source}
            </span>
          )}

          {/* install */}
          {canInstall && (
            <button
              onClick={() => void install()}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-bold tracking-wide transition-colors"
              style={{ borderColor: C.gold, color: C.gold }}
            >
              ⬇ INSTALL APP
            </button>
          )}

          {/* bot pill */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold tracking-wider"
            style={{
              background: state?.enabled ? "rgba(8,153,129,0.15)" : "rgba(140,152,174,0.12)",
              color: state?.enabled ? C.green : C.muted,
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${state?.enabled ? "animate-pulse" : ""}`} style={{ background: state?.enabled ? C.green : "#5D606B" }} />
            {state?.enabled ? "EA ON" : "EA OFF"}
          </span>
        </div>

        {/* mobile symbol/tf row */}
        <div className="flex sm:hidden items-center gap-2 pb-2">
          <Select value={state?.symbol ?? "PAXGUSDT"} onValueChange={(v) => void onSymbol(v)} disabled={busy !== null}>
            <SelectTrigger className="h-8 flex-1 text-xs bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4] max-h-[380px]">
              {SYMBOL_GROUPS.map((g) => (
                <SelectGroup key={g.key}>
                  <SelectLabel className="text-[9px] tracking-[0.18em] text-[#D4AF37]/80 pl-2">{g.label}</SelectLabel>
                  {symbolsByGroup(g.key).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Select value={state?.tf ?? "5m"} onValueChange={(v) => void onTf(v)} disabled={busy !== null}>
            <SelectTrigger className="h-8 w-[80px] text-xs bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
              {TIMEFRAMES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </header>
  );
}
