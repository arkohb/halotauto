"use client";

// ════════════════════════════════════════════════════════════════════════
//  RISK SHIELD · protective hologram for the Risk Guardian card
//
//  Pure SVG + CSS — the colour and one restrained scanline are the whole
//  show:
//    pass   → cyan/green steady shimmer   (verified checks passing)
//    warn   → amber slow shimmer          (verified warnings present)
//    breach → red with a short pulse      (verified failure present)
//
//  This component is strictly PRESENTATION: it reads a level string and
//  can never modify limits, checks or execution. Animations honour the
//  FX setting (off = static, reduced/full per CSS kill-switches) and the
//  OS reduce-motion preference.
// ════════════════════════════════════════════════════════════════════════

import { useFx } from "@/lib/halo/fx";
import { C } from "@/lib/halo/ui-helpers";

export type ShieldLevel = "pass" | "warn" | "breach";

export function RiskShield({ level, size = 96 }: { level: ShieldLevel; size?: number }) {
  const { mode } = useFx();
  const animate = mode !== "off";
  const main = level === "pass" ? C.green : level === "warn" ? C.gold : C.red;
  const accent = level === "pass" ? C.cyan : main;

  const shieldPath = "M60 8 L104 24 V64 C104 92 84 112 60 122 C36 112 16 92 16 64 V24 Z";

  return (
    <svg
      viewBox="0 0 120 130"
      width={size}
      height={Math.round((size * 130) / 120)}
      role="img"
      aria-label={`Risk shield — ${level === "pass" ? "all checks passing" : level === "warn" ? "warnings present" : "breach — review required"}`}
      style={{ filter: `drop-shadow(0 0 10px ${main}44)` }}
    >
      <defs>
        <linearGradient id={`shieldFill-${level}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={main} stopOpacity="0.16" />
          <stop offset="100%" stopColor={C.navy} stopOpacity="0.55" />
        </linearGradient>
        <clipPath id={`shieldClip-${level}`}>
          <path d={shieldPath} />
        </clipPath>
      </defs>

      {/* body */}
      <path d={shieldPath} fill={`url(#shieldFill-${level})`} stroke={main} strokeWidth="1.6" />
      {/* inner offset contour */}
      <path d="M60 16 L96 29 V64 C96 87 79 104 60 113 C41 104 24 87 24 64 V29 Z" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.4" strokeDasharray="5 4" />
      {/* vertical edge light */}
      <path d="M60 8 L60 122" stroke={accent} strokeWidth="0.6" opacity="0.18" />

      {/* scanline — only while FX is on; frozen by the CSS kill-switches */}
      {animate && (
        <g clipPath={`url(#shieldClip-${level})`}>
          <rect
            className="halo-shield-scan"
            x="14"
            y="58"
            width="92"
            height="7"
            fill={accent}
            opacity="0.14"
          />
        </g>
      )}

      {/* check emblem */}
      <path
        d="M44 64 L55 76 L78 50"
        fill="none"
        stroke={level === "breach" ? C.red : level === "warn" ? C.gold : "#08D9A9"}
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.95"
      />
      {level !== "pass" && (
        <circle
          cx="60"
          cy="64"
          r="30"
          fill="none"
          stroke={main}
          strokeWidth="1"
          opacity="0.35"
          strokeDasharray={level === "warn" ? "3 6" : "none"}
        />
      )}
    </svg>
  );
}
