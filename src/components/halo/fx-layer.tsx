"use client";

// ════════════════════════════════════════════════════════════════════════
//  HALO FX LAYER · ambient futuristic backdrop
//
//  Fixed, pointer-events-none layer painted BELOW the app panels (z -10 —
//  body carries the navy base) so the grid / particles glow through the
//  layout gaps and margins without ever sitting on top of content:
//    • perspective grid floor — slowly panning toward the horizon
//    • drifting gold particles — "market dust" rising through the void
//    • radar scan sweep — a soft light bar patrolling the viewport
//    • vignette — deep-space edges
//  Pure CSS animations; disabled under prefers-reduced-motion.
// ════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";

interface Particle {
  left: string;
  size: number;
  duration: number;
  delay: number;
  dx: string;
  opacity: number;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function FxLayer() {
  // deterministic particles — stable between server & client render
  const particles = useMemo<Particle[]>(() => {
    const rnd = mulberry(0x3e1b);
    return Array.from({ length: 14 }, () => {
      const size = 1.5 + rnd() * 2;
      return {
        left: `${(rnd() * 100).toFixed(2)}%`,
        size: Math.round(size * 10) / 10,
        duration: 16 + Math.round(rnd() * 18),
        delay: -Math.round(rnd() * 30),
        dx: `${Math.round((rnd() - 0.5) * 120)}px`,
        opacity: 0.25 + rnd() * 0.4,
      };
    });
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 30%, rgba(11,20,38,0) 40%, rgba(4,8,18,0.55) 100%)",
        }}
      />

      {/* perspective grid floor */}
      <div
        className="halo-grid-pan absolute inset-x-[-40%] bottom-[-6%] h-[42vh]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(212,175,55,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.13) 1px, transparent 1px)",
          backgroundSize: "46px 46px, 46px 46px",
          transform: "perspective(520px) rotateX(63deg)",
          transformOrigin: "center top",
          maskImage: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.35) 45%, transparent 90%)",
          WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.35) 45%, transparent 90%)",
          animation: "halo-grid-pan 3.2s linear infinite",
        }}
      />

      {/* radar scan sweep */}
      <div
        className="halo-scan-sweep absolute inset-x-0 top-0 h-[26vh]"
        style={{
          background:
            "linear-gradient(to bottom, transparent, rgba(212,175,55,0.05) 55%, rgba(212,175,55,0.11) 98%, rgba(212,175,55,0.22) 100%)",
          animation: "halo-scan-sweep 11s linear infinite",
        }}
      />

      {/* drifting gold particles */}
      {particles.map((p, i) => (
        <span
          key={i}
          className="halo-drift absolute rounded-full"
          style={
            {
              left: p.left,
              bottom: "-12px",
              width: p.size,
              height: p.size,
              background: "#D4AF37",
              boxShadow: "0 0 6px 1px rgba(212,175,55,0.55)",
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              "--dx": p.dx,
              "--po": p.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
