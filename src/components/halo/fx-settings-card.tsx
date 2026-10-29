"use client";

// ════════════════════════════════════════════════════════════════════════
//  VISUAL EFFECTS · user control for decorative motion intensity
//
//  full    — everything (3D AI core full detail, ambience, radar sweep)
//  reduced — same look at low cost: ~20fps core, static backdrop, no
//            pointer depth (auto-selected on low-power devices)
//  off     — decorative motion stripped app-wide; data & controls unchanged
//
//  The OS reduce-motion preference always wins on top of this setting —
//  when the device asks for less motion the 3D core renders static frames.
//  Presentation only: touching this card can never affect the engine,
//  execution, or risk behaviour.
// ════════════════════════════════════════════════════════════════════════

import { Sparkles } from "lucide-react";
import { PanelCard } from "./panel";
import { fxModeLabel, useFx, type FxMode } from "@/lib/halo/fx";
import { A, C } from "@/lib/halo/ui-helpers";

const MODES: { id: FxMode; title: string; desc: string }[] = [
  { id: "full", title: "FULL", desc: "3D AI core at full detail · ambient backdrop · pointer depth" },
  { id: "reduced", title: "REDUCED", desc: "Same visuals, low cost — lower fps, no parallax, static backdrop" },
  { id: "off", title: "OFF", desc: "Decorative motion removed; every data surface stays identical" },
];

export function FxSettingsCard() {
  const fx = useFx();
  const autoNotes: string[] = [];
  if (!fx.motionOK) autoNotes.push("OS reduce-motion is ON — the 3D core renders static frames");
  if (fx.lowPower) autoNotes.push("Low-power device detected — REDUCED was auto-selected");

  return (
    <PanelCard title="VISUAL EFFECTS" icon={Sparkles} accent="cyan">
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[10.5px] leading-snug text-[var(--hx-muted)]">
          Control how much decorative motion HALO uses. Animations are data-driven — they only react to real
          voice, engine and risk events, and they never touch trading behaviour.
        </p>
        <div role="radiogroup" aria-label="Visual effects level" className="grid grid-cols-3 gap-1.5">
          {MODES.map((m) => {
            const on = fx.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => fx.setMode(m.id)}
                title={m.desc}
                className="flex h-9 items-center justify-center rounded-lg border text-[9.5px] font-extrabold tracking-[0.14em] transition-all"
                style={{
                  borderColor: on ? A.cyan(0.65) : C.line2,
                  background: on ? A.cyan(0.14) : `${C.navy}99`,
                  color: on ? C.cyan : C.muted,
                  boxShadow: on ? `0 0 12px 1px ${A.cyan(0.2)}` : "none",
                }}
              >
                {m.title}
              </button>
            );
          })}
        </div>
        <p className="text-[9.5px] leading-snug text-[var(--hx-label)]">
          Current: <span className="font-bold text-[var(--hx-txt2)]">{fxModeLabel(fx.mode)}</span> — {MODES.find((m) => m.id === fx.mode)?.desc}
        </p>
        {autoNotes.length > 0 && (
          <p
            className="rounded-md border px-2 py-1 text-[9px] leading-snug"
            style={{ borderColor: A.gold(0.35), background: A.gold(0.07), color: C.gold }}
          >
            {autoNotes.join(" · ")}
          </p>
        )}
      </div>
    </PanelCard>
  );
}
