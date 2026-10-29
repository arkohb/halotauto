"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { C, type BotStateRes } from "@/lib/halo/ui-helpers";
import { fxModeLabel, useFx } from "@/lib/halo/fx";
import { usePwa } from "./pwa";
import { SYMBOL_GROUPS, symbolsByGroup, TIMEFRAMES } from "@/lib/market-symbols";

interface Props {
  state: BotStateRes | null;
  busy: string | null;
  onSymbol: (s: string) => Promise<unknown> | void; // result is verified by the voice-operator bridge when used
  onTf: (tf: string) => Promise<unknown> | void;
}

/** UTC clock — client-only, ticks every second. */
function UtcClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(t);
      clearInterval(id);
    };
  }, []);
  if (!now) {
    return (
      <span className="hidden items-center gap-1.5 font-mono text-[10.5px] tracking-wider text-[#8C98AE] xl:inline-flex">
        · · UTC
      </span>
    );
  }
  return (
    <span className="hidden items-center gap-1.5 font-mono text-[10.5px] tracking-wider text-[#8C98AE] xl:inline-flex" suppressHydrationWarning>
      <span className="text-[#B8C2D6]">
        {now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
      </span>
      <span className="text-[#4FD8FF]">
        {now.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" })} UTC
      </span>
    </span>
  );
}

export function Header({ state, busy, onSymbol, onTf }: Props) {
  const { canInstall, install } = usePwa();

  // ── FX switch — cycles FULL → REDUCED → OFF (persisted by the provider) ──
  const fx = useFx();

  const feedLive = state ? state.feed.source !== "simulator" && !/slow|error|unreachable/i.test(state.feed.note || "") : false;

  return (
    <header className="sticky top-0 z-40 border-b border-[#1E3358] bg-[#0B1426]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0B1426]/85">
      {/* creator strip · gold */}
      <div className="border-b border-[#1C2A47]/70 bg-gradient-to-r from-[#0B1426] via-[#101C33] to-[#0B1426]">
        <div className="mx-auto flex w-full max-w-[1800px] items-center justify-center gap-2 px-3 py-1">
          <span aria-hidden className="h-px w-8 shrink-0" style={{ background: `linear-gradient(to right, transparent, ${C.gold}66)` }} />
          <span className="whitespace-nowrap text-[9.5px] font-bold tracking-[0.24em]" style={{ color: C.gold, textShadow: "0 0 12px rgba(212,175,55,0.35)" }}>
            © {new Date().getFullYear()} · CREATED BY BISMARK ARKO-OFORI
          </span>
          <span aria-hidden className="h-px w-8 shrink-0" style={{ background: `linear-gradient(to left, transparent, ${C.gold}66)` }} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1800px] px-3 lg:px-4">
        <div className="flex h-14 items-center gap-3">
          {/* logo + tagline */}
          <div className="flex shrink-0 items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 26 26" aria-hidden>
              <rect x="1" y="1" width="24" height="24" rx="6" fill="none" stroke={C.gold} strokeWidth="1.4" opacity="0.5" />
              <path d="M13 3.5 L17 7.5 L13 11.5 L9 7.5 Z" fill={C.gold} />
              <line x1="3" y1="16" x2="23" y2="16" stroke={C.gold} strokeWidth="1.2" strokeDasharray="3 2" opacity="0.85" />
              <rect x="6" y="8" width="3.4" height="6" rx="0.8" fill={C.red} />
              <line x1="7.7" y1="6" x2="7.7" y2="16.5" stroke={C.red} strokeWidth="1.1" />
              <rect x="16.5" y="18" width="3.4" height="5" rx="0.8" fill={C.green} />
              <line x1="18.2" y1="15.5" x2="18.2" y2="24" stroke={C.green} strokeWidth="1.1" />
            </svg>
            <div className="leading-tight">
              <div className="text-[15px] font-extrabold tracking-wide" style={{ color: C.gold, textShadow: "0 0 14px rgba(212,175,55,0.25)" }}>
                HALO 3EL
              </div>
              <div className="text-[8px] tracking-[0.3em] text-[#8C98AE]">AUTOTRADER</div>
            </div>
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-[#1E3358] lg:block" />
            <span className="hidden text-[9px] font-bold tracking-[0.28em] text-[#4FD8FF]/85 lg:inline">TRADE SMARTER · WITH AI</span>
          </div>

          <div className="flex-1" />

          {/* live feed pill — honest: simulator shows amber */}
          {state && (
            <span
              className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] md:inline-flex"
              style={{
                borderColor: feedLive ? "rgba(8,153,129,0.5)" : "rgba(212,175,55,0.5)",
                color: feedLive ? C.green : C.gold,
                background: feedLive ? "rgba(8,153,129,0.08)" : "rgba(212,175,55,0.08)",
              }}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: feedLive ? C.green : C.gold }} />
              Live · {state.feed.source}
            </span>
          )}

          <UtcClock />

          {/* symbol selector — gold, like the reference */}
          <div className="hidden items-center gap-2 sm:flex">
            <Select value={state?.symbol ?? "PAXGUSDT"} onValueChange={(v) => void onSymbol(v)} disabled={busy !== null}>
              <SelectTrigger
                className="h-9 w-[142px] border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.07)] text-[11.5px] font-bold text-[#F5D778] hover:bg-[rgba(212,175,55,0.12)]"
                aria-label="Trading symbol"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[380px] border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
                {SYMBOL_GROUPS.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel className="pl-2 text-[9px] tracking-[0.18em] text-[#D4AF37]/80">{g.label}</SelectLabel>
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
              <SelectTrigger className="h-9 w-[70px] border-[#2A3A5C] bg-[#101C33] text-[11px] font-bold text-[#E8ECF4]" aria-label="Timeframe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
                {TIMEFRAMES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* FX switch — full / reduced / off */}
          <button
            type="button"
            onClick={fx.cycle}
            aria-label={`Visual effects: ${fxModeLabel(fx.mode)} — click for the next level`}
            title={`Visual effects: ${fxModeLabel(fx.mode)} — click to cycle FULL → REDUCED → OFF`}
            className="hidden items-center gap-1 rounded-lg border px-2 py-1.5 text-[9px] font-extrabold tracking-[0.18em] transition-colors md:inline-flex"
            style={{
              borderColor: fx.mode === "off" ? "#2A3A5C" : "rgba(79,216,255,0.45)",
              color: fx.mode === "off" ? C.muted : C.cyan,
              background: fx.mode === "full" ? "rgba(79,216,255,0.06)" : "transparent",
            }}
          >
            ✦ {fxModeLabel(fx.mode)}
          </button>

          {/* install */}
          {canInstall && (
            <button
              onClick={() => void install()}
              className="hidden rounded-lg border px-3 py-1.5 text-[10px] font-bold tracking-wide transition-colors lg:inline-flex"
              style={{ borderColor: C.gold, color: C.gold }}
            >
              ⬇ INSTALL
            </button>
          )}

          {/* bot pill */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-extrabold tracking-[0.14em]"
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
        <div className="flex items-center gap-2 pb-2 sm:hidden">
          <Select value={state?.symbol ?? "PAXGUSDT"} onValueChange={(v) => void onSymbol(v)} disabled={busy !== null}>
            <SelectTrigger className="h-8 flex-1 border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.07)] text-xs font-bold text-[#F5D778]" aria-label="Trading symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[380px] border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
              {SYMBOL_GROUPS.map((g) => (
                <SelectGroup key={g.key}>
                  <SelectLabel className="pl-2 text-[9px] tracking-[0.18em] text-[#D4AF37]/80">{g.label}</SelectLabel>
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
            <SelectTrigger className="h-8 w-[80px] border-[#2A3A5C] bg-[#101C33] text-xs text-[#E8ECF4]" aria-label="Timeframe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[#2A3A5C] bg-[#101C33] text-[#E8ECF4]">
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
