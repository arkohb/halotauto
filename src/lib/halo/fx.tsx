"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO FX SETTINGS · one source of truth for decorative motion intensity
//
//   full    — everything: WebGL AI core at full detail, ambience backdrop,
//             radar sweeps, shield scans, pointer depth
//   reduced — same visuals at low cost: AI core runs ~20fps at DPR 1 with
//             fewer particles, ambience is static, no pointer depth.
//             Auto-selected on low-power devices.
//   off     — decorative motion stripped app-wide (the existing
//             html[data-ambience="off"] CSS kill-switches do the CSS half)
//
//  The OS "reduce motion" preference is always respected on top: when the
//  user asks their device for less motion the AI core renders single
//  static frames (no animation loop) regardless of the mode chosen here.
//
//  Migrates the older halo-ambience on/off toggle transparently.
// ════════════════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type FxMode = "full" | "reduced" | "off";

const KEY = "halo-fx-mode.v1";
const LEGACY_KEY = "halo-ambience";

interface FxCtx {
  mode: FxMode;
  motionOK: boolean; // OS-level reduced-motion preference
  lowPower: boolean; // heuristic: few cores / little memory
  setMode: (m: FxMode) => void;
  cycle: () => void;
}

const DEFAULT_CTX: FxCtx = {
  mode: "full",
  motionOK: true,
  lowPower: false,
  setMode: () => undefined,
  cycle: () => undefined,
};

const Ctx = createContext<FxCtx>(DEFAULT_CTX);

export function useFx(): FxCtx {
  return useContext(Ctx);
}

const ORDER: FxMode[] = ["full", "reduced", "off"];
const LABEL: Record<FxMode, string> = { full: "FULL FX", reduced: "LOW FX", off: "FX OFF" };

export function fxModeLabel(m: FxMode): string {
  return LABEL[m];
}

export function FxProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<FxMode>("full");
  const [motionOK, setMotionOK] = useState(true);
  const [lowPower, setLowPower] = useState(false);

  // hydrate: stored preference → legacy toggle → OS/low-power heuristics
  useEffect(() => {
    const t = window.setTimeout(() => {
      let next: FxMode | null = null;
      try {
        const raw = window.localStorage.getItem(KEY);
        if (raw === "full" || raw === "reduced" || raw === "off") next = raw;
        else if (window.localStorage.getItem(LEGACY_KEY) === "off") next = "off";
      } catch {
        // storage blocked — session default below
      }
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      setMotionOK(!mq.matches);
      const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
      const low = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 2;
      setLowPower(low);
      if (!next) next = low ? "reduced" : "full";
      setModeState(next);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // track OS reduced-motion changes live (users can flip it mid-session)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setMotionOK(!mq.matches);
    try {
      mq.addEventListener("change", onChange);
    } catch {
      mq.addListener(onChange); // older Safari
    }
    return () => {
      try {
        mq.removeEventListener("change", onChange);
      } catch {
        mq.removeListener(onChange);
      }
    };
  }, []);

  // mirror onto <html> — CSS kill-switches + orb/fx readers
  useEffect(() => {
    document.documentElement.dataset.fx = mode;
    document.documentElement.dataset.ambience = mode === "off" ? "off" : "on";
  }, [mode]);

  const setMode = useCallback((m: FxMode) => {
    setModeState(m);
    try {
      window.localStorage.setItem(KEY, m);
    } catch {
      // storage blocked — session-only
    }
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => {
      const next = ORDER[(ORDER.indexOf(prev) + 1) % ORDER.length];
      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        // session-only
      }
      return next;
    });
  }, []);

  const value = useMemo<FxCtx>(() => ({ mode, motionOK, lowPower, setMode, cycle }), [mode, motionOK, lowPower, setMode, cycle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { LABEL as FX_LABELS };
