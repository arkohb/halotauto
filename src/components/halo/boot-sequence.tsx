"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO BOOT SEQUENCE · cinematic once-per-session startup
//
//  "HALO CORE ONLINE" — hexagon core draw, typed boot lines, progress bar,
//  gold flash, fade-out. ~2.4s total, click anywhere to skip, suppressed
//  for the rest of the browser session (sessionStorage) and entirely for
//  prefers-reduced-motion users. Pure overlay — never blocks interaction
//  after it clears.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";

const SEEN_KEY = "halo3el.boot.seen.v1";

const LINES: Array<[string, string]> = [
  ["NEURAL MARKET LINK", "ONLINE"],
  ["3EL STRATEGY CORE", "LOADED"],
  ["EA EXECUTION ENGINE", "ARMED"],
];

export function BootSequence() {
  const [phase, setPhase] = useState<"hidden" | "run" | "fade">("hidden");
  const [step, setStep] = useState(0); // 0..LINES.length lines revealed
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // ignore
    }
    if (reduced || seen) return;

    const t = timers.current;
    t.push(window.setTimeout(() => setPhase("run"), 60));
    t.push(window.setTimeout(() => setStep(1), 420));
    t.push(window.setTimeout(() => setStep(2), 900));
    t.push(window.setTimeout(() => setStep(3), 1380));
    t.push(window.setTimeout(() => setPhase("fade"), 1950));
    t.push(
      window.setTimeout(() => {
        setPhase("hidden");
        try {
          window.sessionStorage.setItem(SEEN_KEY, "1");
        } catch {
          // ignore
        }
      }, 2450)
    );
    return () => {
      for (const id of t) window.clearTimeout(id);
      timers.current = [];
    };
  }, []);

  if (phase === "hidden") return null;

  const skip = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setPhase("hidden");
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="presentation"
      onClick={skip}
      className="fixed inset-0 z-[90] flex cursor-pointer items-center justify-center bg-[#000714] transition-opacity duration-500"
      style={{ opacity: phase === "fade" ? 0 : 1 }}
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center">
        {/* hexagon core */}
        <svg width="92" height="104" viewBox="0 0 92 104" aria-hidden className="halo-float">
          <polygon
            points="46,4 86,27 86,77 46,100 6,77 6,27"
            fill="rgba(233,185,78,0.06)"
            stroke="#E9B94E"
            strokeWidth="2"
          />
          <polygon
            points="46,22 70,36 70,64 46,78 22,64 22,36"
            fill="none"
            stroke="rgba(233,185,78,0.45)"
            strokeWidth="1"
          />
          <circle cx="46" cy="50" r="9" fill="#E9B94E" style={{ animation: "halo-core-pulse 1.1s ease-in-out infinite" }} />
          <circle cx="46" cy="50" r="15" fill="none" stroke="rgba(233,185,78,0.5)" strokeWidth="1" style={{ animation: "halo-ring 1.6s ease-out infinite" }} />
        </svg>

        <div>
          <div className="halo-caret text-lg font-extrabold tracking-[0.42em] text-[#E9B94E]">HALO CORE</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.34em] text-[#8AA2C2]">
            Robotic Trading Intelligence
          </div>
        </div>

        {/* boot lines */}
        <div className="w-[248px] space-y-1.5 font-mono text-[10px] sm:w-[290px]">
          {LINES.map(([label, status], i) => (
            <div
              key={label}
              className="flex items-center justify-between"
              style={{ opacity: step > i ? 1 : 0.12, transition: "opacity 240ms" }}
            >
              <span className="tracking-[0.14em] text-[#8AA2C2]">{label}</span>
              <span className="font-bold tracking-[0.18em]" style={{ color: step > i ? "#00D68F" : "#3A4A6E" }}>
                {status}
              </span>
            </div>
          ))}
        </div>

        {/* progress */}
        <div className="h-[3px] w-[248px] overflow-hidden rounded-full bg-[#041428] sm:w-[290px]">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-linear"
            style={{
              width: `${Math.min(100, (step / LINES.length) * 100)}%`,
              background: "linear-gradient(90deg, rgba(233,185,78,0.4), #E9B94E)",
            }}
          />
        </div>

        <div className="text-[8px] font-bold uppercase tracking-[0.3em] text-[#8AA2C2]/60">tap to skip</div>
      </div>
    </div>
  );
}
