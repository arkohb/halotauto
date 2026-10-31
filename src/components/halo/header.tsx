"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO HEADER · single command bar (mockup edition)
//
//  Layout: gold owl brand mark + wordmark · … · symbol/tf selectors ·
//  FX switch · install · LIVE feed pill · UTC clock · EA pill · avatar.
//  Every control keeps its existing real behaviour; only the chrome changed.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User } from "lucide-react";
import { A, C, type BotStateRes } from "@/lib/halo/ui-helpers";
import { fxModeLabel, useFx } from "@/lib/halo/fx";
import { usePwa } from "./pwa";
import { useHaloVoice } from "./voice-provider";
import { SYMBOL_GROUPS, symbolsByGroup, TIMEFRAMES, VENUES, symbolsByVenueGroup, venueGroupLabel, type Venue } from "@/lib/market-symbols";

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
      <span className="hidden items-center gap-1.5 font-mono text-[10.5px] tracking-wider md:inline-flex" style={{ color: C.muted }}>
        ·· / ·· / ···· ··:··:·· UTC
      </span>
    );
  }
  return (
    <span
      className="hidden items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[10px] tracking-wider md:inline-flex"
      style={{ borderColor: C.line, background: "#020B1Acc" }}
      suppressHydrationWarning
    >
      <span style={{ color: C.txt2 }}>
        {now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
      </span>
      <span style={{ color: C.cyan }}>
        {now.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" })} UTC
      </span>
    </span>
  );
}

/** gold owl brand mark — matches the reference emblem */
function OwlMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="14.5" fill="#0A1830" stroke={C.gold} strokeWidth="1.4" />
      <circle cx="16" cy="16" r="11.5" fill="none" stroke={C.gold} strokeWidth="0.7" opacity="0.45" />
      {/* owl eyes */}
      <circle cx="11.6" cy="13.2" r="3.1" fill="none" stroke={C.gold} strokeWidth="1.3" />
      <circle cx="20.4" cy="13.2" r="3.1" fill="none" stroke={C.gold} strokeWidth="1.3" />
      <circle cx="11.6" cy="13.2" r="1.05" fill={C.gold} />
      <circle cx="20.4" cy="13.2" r="1.05" fill={C.gold} />
      {/* beak */}
      <path d="M16 15.4 L18.2 19 L16 21.4 L13.8 19 Z" fill={C.gold} />
      {/* brow */}
      <path d="M7.6 9.6 Q16 5.4 24.4 9.6" fill="none" stroke={C.gold} strokeWidth="1.2" opacity="0.8" />
    </svg>
  );
}

export function Header({ state, busy, onSymbol, onTf }: Props) {
  const { canInstall, install } = usePwa();
  const v = useHaloVoice();

  // broker filter for the pair list — shares the chart panel's preference
  const [venue, setVenue] = useState<Venue | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const val = localStorage.getItem("halo3el.chartvenue.v1");
        if (val === "deriv" || val === "mt5" || val === "binance") setVenue(val);
      } catch {
        // ignore
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  const switchVenue = (nv: Venue | null) => {
    setVenue(nv);
    try {
      if (nv) localStorage.setItem("halo3el.chartvenue.v1", nv);
      else localStorage.removeItem("halo3el.chartvenue.v1");
    } catch {
      // ignore
    }
  };

  // ── session awareness: avatar links to the customer account dashboard
  // when a signed-in session exists (commercial mode). Owner mode → the
  // avatar stays a passive badge, exactly as before.
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { authenticated?: boolean }) => {
        if (alive) setSignedIn(!!j.authenticated);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ── FX switch — cycles FULL → REDUCED → OFF (persisted by the provider) ──
  const fx = useFx();

  const feedLive = state ? state.feed.source !== "simulator" && !/slow|error|unreachable/i.test(state.feed.note || "") : false;

  const initial = v.profile.hasName ? v.profile.displayName.trim().charAt(0).toUpperCase() : null;

  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur supports-[backdrop-filter]:bg-[#020B1A]/88"
      style={{
        borderColor: C.panelLine,
        background: "linear-gradient(180deg, rgba(2,16,36,0.97), rgba(1,8,20,0.94))",
        boxShadow: `0 1px 0 rgba(46,204,255,0.10), 0 8px 28px rgba(0,4,12,0.55)`,
      }}
    >
      <div className="mx-auto w-full max-w-[1800px] px-3 lg:px-4">
        <div className="flex h-[57px] items-center gap-2.5">
          {/* brand — owl mark + wordmark, exactly like the reference */}
          <div className="flex shrink-0 items-center gap-2.5">
            <OwlMark />
            <div className="leading-tight">
              <div className="text-[15.5px] font-extrabold tracking-[0.06em]" style={{ color: C.gold, textShadow: "0 0 16px rgba(233,185,78,0.35)" }}>
                HALO 3EL
              </div>
              <div className="text-[7.5px] font-bold tracking-[0.3em]" style={{ color: C.goldDim }}>AUTOMATED ENIGMA</div>
            </div>
            <span aria-hidden className="mx-1 hidden h-7 w-px lg:block" style={{ background: C.line }} />
            <span className="hidden text-[9px] font-bold tracking-[0.24em] lg:inline" style={{ color: A.cyan(0.8) }}>TRADE SMARTER · WITH AI</span>
          </div>

          <div className="flex-1" />

          {/* symbol selector — functional control, styled to the frame */}
          <div className="hidden items-center gap-2 sm:flex">
            <Select value={venue ?? "all"} onValueChange={(val) => switchVenue(val === "all" ? null : (val as Venue))} disabled={busy !== null}>
              <SelectTrigger
                className="h-9 w-[118px] text-[10px] font-bold uppercase"
                style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}
                aria-label="Broker — filters the pair list"
                title="Broker — the pair list shows this broker's catalog"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
                <SelectItem value="all" className="text-xs">ALL BROKERS</SelectItem>
                {VENUES.map((vr) => (
                  <SelectItem key={vr.key} value={vr.key} className="text-xs">
                    {vr.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={state?.symbol ?? "PAXGUSDT"} onValueChange={(val) => void onSymbol(val)} disabled={busy !== null}>
              <SelectTrigger
                className="h-9 w-[142px] text-[11.5px] font-bold"
                style={{ borderColor: A.cyan(0.35), background: A.cyan(0.06), color: C.ice }}
                aria-label="Trading symbol"
              >
                <SelectValue>{state?.symbol ?? "PAXGUSDT"}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[380px] text-[#EAF3FF]" style={{ borderColor: C.line2, background: C.navy2 }}>
                {venue === null
                  ? SYMBOL_GROUPS.map((g) => (
                      <SelectGroup key={g.key}>
                        <SelectLabel className="pl-2 text-[9px] tracking-[0.18em]" style={{ color: A.cyan(0.75) }}>{g.label}</SelectLabel>
                        {symbolsByGroup(g.key).map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-xs">
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))
                  : SYMBOL_GROUPS.map((g) => {
                      const syms = symbolsByVenueGroup(venue, g.key);
                      if (syms.length === 0) return null;
                      return (
                        <SelectGroup key={g.key}>
                          <SelectLabel className="pl-2 text-[9px] tracking-[0.18em]" style={{ color: A.cyan(0.75) }}>{venueGroupLabel(venue, g.key)}</SelectLabel>
                          {syms.map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
              </SelectContent>
            </Select>
            <Select value={state?.tf ?? "5m"} onValueChange={(val) => void onTf(val)} disabled={busy !== null}>
              <SelectTrigger className="h-9 w-[70px] text-[11px] font-bold" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} aria-label="Timeframe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
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
              borderColor: fx.mode === "off" ? C.line2 : A.cyan(0.45),
              color: fx.mode === "off" ? C.muted : C.cyan,
              background: fx.mode === "full" ? A.cyan(0.07) : "transparent",
            }}
          >
            ✦ {fxModeLabel(fx.mode)}
          </button>

          {/* install */}
          {canInstall && (
            <button
              onClick={() => void install()}
              className="hidden rounded-lg border px-3 py-1.5 text-[10px] font-bold tracking-wide transition-colors lg:inline-flex"
              style={{ borderColor: A.cyan(0.5), color: C.cyan }}
            >
              ⬇ INSTALL
            </button>
          )}

          {/* live feed pill — honest: simulator shows amber */}
          {state && (
            <span
              className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] md:inline-flex"
              style={{
                borderColor: feedLive ? A.green(0.5) : A.warn(0.5),
                color: feedLive ? C.green : C.warn,
                background: feedLive ? A.green(0.08) : A.warn(0.08),
              }}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${feedLive ? "animate-pulse" : ""}`} style={{ background: feedLive ? C.green : C.warn }} />
              Live · {state.feed.source}
            </span>
          )}

          <UtcClock />

          {/* EA pill */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-extrabold tracking-[0.14em]"
            style={{
              background: state?.enabled ? A.green(0.15) : A.white(0.07),
              color: state?.enabled ? C.green : C.muted,
              boxShadow: `inset 0 0 0 1px ${state?.enabled ? A.green(0.35) : A.white(0.1)}`,
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${state?.enabled ? "animate-pulse" : ""}`} style={{ background: state?.enabled ? C.green : C.dim }} />
            {state?.enabled ? "EA ON" : "EA OFF"}
          </span>

          {/* avatar — shows the trader's own initial when a name is set;
              links to /account whenever a session exists */}
          <a
            href={signedIn ? "/account" : undefined}
            aria-label={signedIn ? "My account" : "Trader"}
            title={v.profile.hasName ? v.profile.displayName : "Trader"}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${signedIn ? "transition-transform hover:scale-110" : ""}`}
            style={{ borderColor: A.cyan(0.4), background: `radial-gradient(circle at 35% 30%, ${A.cyan(0.25)}, ${C.navy2})`, boxShadow: `0 0 10px 0 ${A.cyan(0.2)}`, cursor: signedIn ? "pointer" : "default" }}
          >
            {initial ? (
              <span className="text-[12px] font-extrabold" style={{ color: C.ice }}>{initial}</span>
            ) : (
              <User size={14} style={{ color: C.ice }} />
            )}
          </a>
        </div>

        {/* mobile symbol/tf row */}
        <div className="flex items-center gap-2 pb-2 sm:hidden">
          <Select value={state?.symbol ?? "PAXGUSDT"} onValueChange={(val) => void onSymbol(val)} disabled={busy !== null}>
            <SelectTrigger className="h-8 flex-1 text-xs font-bold" style={{ borderColor: A.cyan(0.35), background: A.cyan(0.06), color: C.ice }} aria-label="Trading symbol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[380px]" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
              {SYMBOL_GROUPS.map((g) => (
                <SelectGroup key={g.key}>
                  <SelectLabel className="pl-2 text-[9px] tracking-[0.18em]" style={{ color: A.cyan(0.75) }}>{g.label}</SelectLabel>
                  {symbolsByGroup(g.key).map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <Select value={state?.tf ?? "5m"} onValueChange={(val) => void onTf(val)} disabled={busy !== null}>
            <SelectTrigger className="h-8 w-[80px] text-xs" style={{ borderColor: C.line2, background: C.navy2, color: C.txt }} aria-label="Timeframe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ borderColor: C.line2, background: C.navy2, color: C.txt }}>
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
