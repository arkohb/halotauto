"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO-B · ROBOTIC TRADING ASSISTANT
//
//  The face of the EA: a hovering navy/gold robot that lives in the corner
//  of the terminal and REACTS to the live bot state (polled every 2s):
//    • SCANNING  — gold eyes sweep while the engine hunts for C1/C2
//    • ARMED     — one or both wick-line levels armed (pulsing gold ring)
//    • ALERT     — C3 is working the dotted wick line / a trade FIRES
//    • CELEBRATE — TP hit: arms up, happy eyes, gold confetti burst
//    • SAD       — SL hit: red eyes, "risk contained" composure
//    • SLEEP     — EA off: dim standby glow
//  Its eyes also track live price direction (green up / red down), it
//  speaks through a typewriter speech bubble, and tapping it returns a
//  live status report followed by rotating strategy tips.
//
//  Presentation only — reads the same BotStateRes the panels use; never
//  mutates engine state or routes orders.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/halo/types";
import { C, fmtPx, fmtPips, runPips, statusOf, type BotStateRes } from "@/lib/halo/ui-helpers";
import { bestC3Form, c3FormCheck } from "@/lib/halo/c3-form";

type Mood = "sleep" | "scan" | "armed" | "alert" | "celebrate" | "sad";
type Tone = "gold" | "green" | "red" | "info";

interface Bubble {
  text: string;
  tone: Tone;
  key: number;
}

interface ConfettiPiece {
  cx: string;
  cy: string;
  cr: string;
  size: number;
  color: string;
  left: string;
  delay: number;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches), 0);
    return () => window.clearTimeout(id);
  }, []);
  return reduced;
}

const TIPS: string[] = [
  "The dotted line is the highest wick of candles 1 & 2 — when C3 breaks it and comes back, I fire instantly. No hesitation.",
  "Armed levels never shift. The price I mark is the price I trade — no repainting, ever.",
  "One armed support + one armed resistance can be live together. Whichever breaks & returns first takes the trade.",
  "Same-bar SL + TP counts as a loss. I always plan for the worst case.",
  "1 : 3 risk-reward — I can be wrong more often than right and still grow the book.",
  "Instant mode watches the live candle on every tick. Bar-close mode waits for the candle to confirm first.",
  "Levels expire after 150 bars. Markets move on — so do I.",
];

function moodLabel(mood: Mood): string {
  switch (mood) {
    case "sleep":
      return "STANDBY";
    case "armed":
      return "LEVELS ARMED";
    case "alert":
      return "C3 WATCH";
    case "celebrate":
      return "TP HIT";
    case "sad":
      return "SL HIT";
    default:
      return "SCANNING";
  }
}

// ── the robot body ───────────────────────────────────────────────────────
function RobotSvg({ mood, eyeColor, reduced }: { mood: Mood; eyeColor: string; reduced: boolean }) {
  const awake = mood !== "sleep";
  const happy = mood === "celebrate";
  const scanning = mood === "scan" && !reduced;
  const eyes = (
    <>
      {happy ? (
        <>
          <path d="M36 34 q4 -6 8 0" stroke={eyeColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M52 34 q4 -6 8 0" stroke={eyeColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <g className={scanning ? "halo-eye-scan" : undefined} style={scanning ? { animationDuration: "2.6s" } : undefined}>
          <g
            className={awake && !reduced ? "halo-blink" : undefined}
            style={awake && !reduced ? { transformBox: "fill-box", transformOrigin: "center", animationDuration: "4.6s" } : undefined}
          >
            <circle cx="40" cy="33" r="3.1" fill={eyeColor} />
            <circle cx="56" cy="33" r="3.1" fill={eyeColor} />
            <circle cx="41" cy="32" r="1" fill="rgba(255,255,255,0.85)" />
            <circle cx="57" cy="32" r="1" fill="rgba(255,255,255,0.85)" />
          </g>
        </g>
      )}
    </>
  );

  return (
    <svg viewBox="0 0 96 112" className="h-full w-full" role="img" aria-label="HALO-B robot assistant">
      {/* thruster glow */}
      <ellipse
        cx="48"
        cy="107"
        rx="15"
        ry="4"
        fill="#D4AF37"
        className={awake && !reduced ? "halo-thrust" : undefined}
        style={{ opacity: awake ? undefined : 0.12, transformBox: "fill-box", transformOrigin: "center" }}
      />
      {/* pulsing ground ring */}
      <ellipse cx="48" cy="107" rx="20" ry="5" fill="none" stroke="rgba(212,175,55,0.25)" strokeWidth="1" />

      <g style={{ transform: mood === "sad" ? "rotate(-4deg)" : undefined, transformOrigin: "48px 60px", transition: "transform 400ms ease" }}>
        {/* antenna */}
        <line x1="48" y1="17" x2="48" y2="8" stroke="#2A3A5C" strokeWidth="2" />
        <circle
          cx="48"
          cy="6.5"
          r="3"
          fill={awake ? "#D4AF37" : "#3A4A6E"}
          style={awake && !reduced ? { animation: "halo-core-pulse 1.4s ease-in-out infinite" } : undefined}
        />

        {/* head */}
        <rect x="24" y="17" width="48" height="31" rx="10" fill="#16233D" stroke="#2A3A5C" strokeWidth="1.5" />
        {/* ear pods */}
        <rect x="18" y="27" width="6" height="11" rx="2.5" fill="#16233D" stroke="#2A3A5C" />
        <rect x="72" y="27" width="6" height="11" rx="2.5" fill="#16233D" stroke="#2A3A5C" />
        {/* visor */}
        <rect x="29" y="25" width="38" height="15" rx="7.5" fill="#0B1426" stroke="rgba(212,175,55,0.4)" strokeWidth="1" />
        {/* visor scan glint */}
        {scanning && (
          <rect x="31" y="27" width="5" height="11" rx="2.5" fill="rgba(212,175,55,0.22)" style={{ animation: "halo-eye-scan 2.6s ease-in-out infinite", transformBox: "fill-box", transformOrigin: "center" }} />
        )}
        {eyes}

        {/* neck */}
        <rect x="43" y="48" width="10" height="4" rx="2" fill="#2A3A5C" />

        {/* body */}
        <rect x="30" y="52" width="36" height="27" rx="9" fill="#16233D" stroke="#2A3A5C" strokeWidth="1.5" />
        {/* chest core */}
        <circle
          cx="48"
          cy="65"
          r="4.6"
          fill={awake ? "#D4AF37" : "#3A4A6E"}
          style={awake && !reduced ? { animation: "halo-core-pulse 1.8s ease-in-out infinite" } : undefined}
        />
        <circle cx="48" cy="65" r="7.5" fill="none" stroke={awake ? "rgba(212,175,55,0.45)" : "#2A3A5C"} strokeWidth="1" />

        {/* arms — raise on celebration */}
        <g
          style={{
            transform: happy ? "rotate(-52deg)" : undefined,
            transformBox: "fill-box",
            transformOrigin: "top right",
            transition: "transform 350ms ease",
          }}
        >
          <rect x="19" y="54" width="8" height="17" rx="4" fill="#16233D" stroke="#2A3A5C" />
        </g>
        <g
          style={{
            transform: happy ? "rotate(52deg)" : undefined,
            transformBox: "fill-box",
            transformOrigin: "top left",
            transition: "transform 350ms ease",
          }}
        >
          <rect x="69" y="54" width="8" height="17" rx="4" fill="#16233D" stroke="#2A3A5C" />
        </g>
      </g>
    </svg>
  );
}

// ── confetti burst ───────────────────────────────────────────────────────
function Confetti({ pieces }: { pieces: ConfettiPiece[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-6 z-20 h-24">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-[1px]"
          style={
            {
              left: p.left,
              bottom: 0,
              width: p.size,
              height: p.size * 2.2,
              background: p.color,
              animation: "halo-confetti 1s ease-out forwards",
              animationDelay: `${p.delay}s`,
              "--cx": p.cx,
              "--cy": p.cy,
              "--cr": p.cr,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ── main assistant ───────────────────────────────────────────────────────
export function RobotAssistant({ state, candles }: { state: BotStateRes; candles: Candle[] }) {
  const reduced = useReducedMotion();
  const [mood, setMood] = useState<Mood>("scan");
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [typed, setTyped] = useState(0);
  const [visible, setVisible] = useState(false);
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);
  const [jumpKey, setJumpKey] = useState(0);
  const [flashDir, setFlashDir] = useState<number | null>(null);
  const [priceDir, setPriceDir] = useState<0 | 1 | -1>(0);
  const [tipIdx, setTipIdx] = useState(0);
  const [asked, setAsked] = useState(false);

  const hideTimer = useRef<number | null>(null);
  const lastLogKey = useRef<string>("");
  const lastArmed = useRef<string>("");
  const lastEnabled = useRef<boolean | null>(null);
  const lastSymbol = useRef<string>("");
  const prevPrice = useRef<number>(0);
  const lastFormKey = useRef<string>("");
  const lastTalk = useRef<number>(0);
  const bubbleKey = useRef(0);

  const speak = useCallback(
    (text: string, tone: Tone, opts?: { stickFor?: number }) => {
      bubbleKey.current += 1;
      setBubble({ text, tone, key: bubbleKey.current });
      setTyped(0);
      setVisible(true);
      lastTalk.current = Date.now();
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), opts?.stickFor ?? 7600);
    },
    []
  );

  // ── welcome (once, after mount) ──
  useEffect(() => {
    const t0 = window.setTimeout(() => {
      speak("HALO-B online. I watch the market so you don't have to.", "gold");
    }, 900);
    return () => window.clearTimeout(t0);
  }, [speak]);

  // ── react to the live bot state (polled every 2s) ──
  useEffect(() => {
    const id = window.setTimeout(() => {
      const s = state;
      const st = s.engine.stats;

      // price direction drives the eye tint between events
      if (s.feed.price > 0) {
        if (prevPrice.current > 0 && s.feed.price !== prevPrice.current) {
          setPriceDir(s.feed.price > prevPrice.current ? 1 : -1);
        }
        prevPrice.current = s.feed.price;
      }

      // 1) newest engine log entry — fire / win / loss events
      const top = s.engine.log[0];
      const logKey = top ? `${top.time}:${top.kind}` : "";
      if (lastLogKey.current === "") lastLogKey.current = logKey; // baseline on first poll
      if (logKey && logKey !== lastLogKey.current) {
        lastLogKey.current = logKey;
        if (top.kind === "fire") {
          const dirTxt = top.dir === -1 ? "SELL" : "BUY";
          const t = s.engine.trade;
          setMood("alert");
          setFlashDir(top.dir);
          setJumpKey((k) => k + 1);
          speak(
            `C3 broke & returned — ${dirTxt} FIRED @ ${fmtPx(top.entry, s.mintick)}${t ? ` · SL ${fmtPx(t.sl, s.mintick)} · TP ${fmtPx(t.tp, s.mintick)}` : ""}. Executing.`,
            top.dir === -1 ? "red" : "green",
            { stickFor: 9000 }
          );
          return;
        }
        if (top.kind === "win") {
          setMood("celebrate");
          setJumpKey((k) => k + 1);
          if (!reduced) {
            const colors = ["#D4AF37", "#F5D879", "#089981", "#E8ECF4"];
            setConfetti(
              Array.from({ length: 18 }, (_, i) => ({
                cx: `${Math.round((Math.random() - 0.5) * 130)}px`,
                cy: `${-Math.round(40 + Math.random() * 60)}px`,
                cr: `${Math.round((Math.random() - 0.5) * 540)}deg`,
                size: 3 + Math.round(Math.random() * 3),
                color: colors[i % colors.length],
                left: `${Math.round(10 + Math.random() * 80)}%`,
                delay: Math.round(Math.random() * 180) / 1000,
              }))
            );
            window.setTimeout(() => setConfetti([]), 1500);
          }
          speak(
            `TP HIT ${fmtPips(top.pips)} pips booked. That's ${st.wins}W / ${st.losses}L — the robot eats well tonight.`,
            "green",
            { stickFor: 9000 }
          );
          return;
        }
        if (top.kind === "loss") {
          setMood("sad");
          setFlashDir(-1);
          speak(
            `SL hit ${fmtPips(-top.pips)} pips. Risk contained — recalibrating and hunting the next formation.`,
            "red",
            { stickFor: 8600 }
          );
          return;
        }
      }

      // 2) EA on/off transitions
      if (lastEnabled.current !== null && lastEnabled.current !== s.enabled) {
        if (s.enabled) {
          setMood("scan");
          speak(`EA engine ON — scanning ${s.symbol} ${s.tf}. I'll call out every setup.`, "gold");
        } else {
          setMood("sleep");
          speak("Standing by. Flip EA ON and I'll guard the market again.", "info");
        }
        lastEnabled.current = s.enabled;
        return;
      }
      lastEnabled.current = s.enabled;

      // 3) symbol retarget
      if (lastSymbol.current && lastSymbol.current !== s.symbol) {
        setMood("scan");
        speak(`Retargeting — ${s.symbol} · ${s.tf}. Rebuilding equal levels…`, "info");
        lastSymbol.current = s.symbol;
        lastArmed.current = s.engine.levels.map((l) => l.id).join(",");
        return;
      }
      lastSymbol.current = s.symbol;

      // 4) armed level changes
      const armedKey = s.engine.levels.map((l) => l.id).join(",");
      if (lastArmed.current === "") lastArmed.current = armedKey;
      if (armedKey !== lastArmed.current) {
        lastArmed.current = armedKey;
        if (!s.engine.trade) {
          if (s.engine.levels.length === 0) {
            setMood("scan");
            if (s.enabled) speak(`Levels burned. Scanning ${s.symbol} ${s.tf} for a fresh C1/C2…`, "info");
          } else {
            const sup = s.engine.levels.some((l) => l.side === 1);
            const res = s.engine.levels.some((l) => l.side === -1);
            setMood("armed");
            if (sup && res)
              speak(
                `Support ${fmtPx(s.engine.levels.find((l) => l.side === 1)?.ext ?? 0, s.mintick)} + Resistance ${fmtPx(
                  s.engine.levels.find((l) => l.side === -1)?.ext ?? 0,
                  s.mintick
                )} armed. Whichever wick line breaks & returns first — I fire.`,
                "gold",
                { stickFor: 9000 }
              );
            else {
              const L = s.engine.levels[0];
              speak(
                `${L.side === -1 ? "Resistance" : "Support"} armed @ ${fmtPx(L.ext, s.mintick)}. Waiting for C3 to break the dotted line.`,
                "gold",
                { stickFor: 9000 }
              );
            }
          }
        }
        return;
      }

      // 5) idle running status while a trade is open (throttled 25s)
      const since = Date.now() - lastTalk.current;
      if (s.engine.trade && since > 25000) {
        const rp = runPips(s);
        setMood(s.engine.trade.dir === -1 ? "alert" : "alert");
        speak(
          `Running ${s.engine.trade.dir === -1 ? "SELL" : "BUY"} · ${rp === null ? "—" : fmtPips(rp)} pips open · SL ${fmtPx(
            s.engine.trade.sl,
            s.mintick
          )} · TP ${fmtPx(s.engine.trade.tp, s.mintick)}.`,
          "info"
        );
        return;
      }

      // 6) default idle mood
      setMood((m) => {
        if (m === "celebrate" || m === "sad" || m === "alert") return s.enabled ? "scan" : "sleep";
        return m;
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [state, reduced, speak]);

  // ── C3 forming tracker (fires before the engine does) ──
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!state.enabled || state.engine.trade) return;
      const forming = c3FormCheck(candles[candles.length - 1], state.engine.levels, state.engine.atr, state.config);
      const best = bestC3Form(forming);
      const key = best ? `${best.levelId}:${best.stage}` : "";
      if (!best || key === lastFormKey.current) {
        if (!best) lastFormKey.current = "";
        return;
      }
      lastFormKey.current = key;
      if (Date.now() - lastTalk.current < 4200) return; // never talk over bigger news
      setMood("alert");
      const which = best.side === -1 ? "resistance" : "support";
      if (best.stage === "retest")
        speak(`C3 is BACK on the ${which} wick line — fire imminent!`, "gold", { stickFor: 6500 });
      else speak(`C3 breaking the ${which} wick line… watching for the return.`, "gold", { stickFor: 6500 });
    }, 0);
    return () => window.clearTimeout(id);
  }, [candles, state, speak]);

  // ── typewriter reveal ──
  useEffect(() => {
    if (!bubble) return;
    if (reduced) {
      const t0 = window.setTimeout(() => setTyped(bubble.text.length), 0);
      return () => window.clearTimeout(t0);
    }
    const iv = window.setInterval(() => {
      setTyped((t) => {
        if (t >= bubble.text.length) {
          window.clearInterval(iv);
          return t;
        }
        return t + 1;
      });
    }, 16);
    return () => window.clearInterval(iv);
  }, [bubble, reduced]);

  // ── tap: status report first, then rotating tips ──
  const onTap = useCallback(() => {
    const st = state.engine.stats;
    if (!asked) {
      setAsked(true);
      const stat = statusOf(state);
      speak(
        `STATUS · ${state.symbol} ${state.tf} · EA ${state.enabled ? "ON" : "OFF"} · ${stat.text} · ${st.wins}W/${st.losses}L · net ${fmtPips(
          state.feed.realizedPips
        )} pips. Tap again for a tip.`,
        "gold",
        { stickFor: 10000 }
      );
      return;
    }
    setTipIdx((i) => {
      const next = (i + 1) % TIPS.length;
      speak(TIPS[next], "info", { stickFor: 10000 });
      return next;
    });
  }, [asked, speak, state]);

  const eyeColor = (() => {
    if (mood === "sleep") return "#5D606B";
    if (flashDir !== null) return flashDir === -1 ? C.red : C.green;
    if (mood === "sad") return C.red;
    if (priceDir === 1) return "#3FD9A4";
    if (priceDir === -1) return "#FF6B75";
    return C.gold;
  })();

  const toneBorder =
    bubble?.tone === "green"
      ? "rgba(8,153,129,0.65)"
      : bubble?.tone === "red"
        ? "rgba(242,54,69,0.65)"
        : "rgba(212,175,55,0.55)";

  const showBubble = visible && bubble !== null;
  const ringOn = mood === "armed" || mood === "alert";

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-40 flex flex-col items-end gap-2">
      {/* speech bubble */}
      {showBubble && bubble && (
        <div
          role="status"
          aria-label="HALO-B assistant message"
          className="pointer-events-auto w-[248px] origin-bottom-right rounded-xl border bg-[#0F1A30]/95 p-3 shadow-2xl backdrop-blur sm:w-[300px]"
          style={{ borderColor: toneBorder, animation: reduced ? undefined : "halo-pop 0.35s ease-out" }}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[8.5px] font-extrabold tracking-[0.22em] text-[#D4AF37]">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: eyeColor }} />
              HALO-B · {moodLabel(mood)}
            </span>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => setVisible(false)}
              className="text-[10px] leading-none text-[#8C98AE] transition-colors hover:text-[#E8ECF4]"
            >
              ✕
            </button>
          </div>
          <p className="min-h-[32px] text-[11px] leading-snug text-[#E8ECF4]">
            <span className={typed < bubble.text.length ? "halo-caret" : undefined}>
              {bubble.text.slice(0, typed)}
            </span>
          </p>
        </div>
      )}

      {/* the robot */}
      <div className="pointer-events-auto relative">
        {ringOn && (
          <span
            aria-hidden
            className="halo-ring absolute inset-0 rounded-full border-2"
            style={{ borderColor: "rgba(212,175,55,0.6)", animationDuration: "1.8s" }}
          />
        )}
        <button
          type="button"
          onClick={onTap}
          aria-label="HALO-B robotic assistant — tap for live status and tips"
          title="HALO-B · tap me"
          className="relative block h-16 w-16 cursor-pointer outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-[#D4AF37] sm:h-[76px] sm:w-[76px]"
        >
          <span
            key={jumpKey}
            className="halo-float block h-full w-full"
            style={jumpKey > 0 && !reduced ? { animation: "halo-pop 0.55s ease-out, halo-float 3.4s ease-in-out 0.55s infinite" } : undefined}
          >
            <RobotSvg mood={mood} eyeColor={eyeColor} reduced={reduced} />
          </span>
        </button>
        {confetti.length > 0 && <Confetti pieces={confetti} />}
        {/* nameplate */}
        <span className="pointer-events-none absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full border border-[#1C2A47] bg-[#0F1A30]/95 px-1.5 py-px text-[6.5px] font-extrabold tracking-[0.22em] text-[#D4AF37]">
          HALO-B
        </span>
      </div>
    </div>
  );
}
