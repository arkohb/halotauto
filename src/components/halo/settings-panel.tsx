"use client";

// Settings panel — every PineScript input, grouped ① Formation / ② Candle 3 / ③ Trade

import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { HaloConfig } from "@/lib/halo/types";
import { C } from "@/lib/halo/ui-helpers";
import { useToast } from "@/hooks/use-toast";

interface Props {
  config: HaloConfig;
  saving: boolean;
  onSave: (cfg: HaloConfig) => Promise<void>;
}

const PRESETS: Array<{ name: string; patch: Partial<HaloConfig> }> = [
  { name: "Gold 1:3 (Pine defaults)", patch: { slMode: "points", slPts: 1000, slBufPts: 50, slATRm: 1.5, rrMult: 3, pipMult: 10 } },
  { name: "BTC 15k pts", patch: { slMode: "points", slPts: 15000, rrMult: 3, pipMult: 10 } },
  { name: "ETH 1.5k pts", patch: { slMode: "points", slPts: 1500, rrMult: 3, pipMult: 10 } },
  { name: "ATR stop 1.5×", patch: { slMode: "atr", slATRm: 1.5, rrMult: 3 } },
  { name: "Wick stop 2:1", patch: { slMode: "wick", slBufPts: 50, rrMult: 2 } },
];

export function SettingsPanel({ config, saving, onSave }: Props) {
  const [draft, setDraft] = useState<HaloConfig>(config);
  const [dirty, setDirty] = useState(false);
  const { toast } = useToast();

  // server config is shown until the user edits; polls never clobber typing
  const shown = dirty ? draft : config;

  const edit = (patch: Partial<HaloConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const num = (k: keyof HaloConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const v = raw === "" ? 0 : Number(raw);
    edit({ [k]: isFinite(v) ? v : 0 } as Partial<HaloConfig>);
  };

  const apply = async () => {
    await onSave(shown);
    setDirty(false);
    setDraft(shown);
    toast({ title: "Settings applied", description: "EA engine now runs with the new HALO 3EL parameters." });
  };

  return (
    <div className="rounded-xl border border-[#1C2A47] bg-[#0F1A30] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1C2A47] flex items-center justify-between">
        <span className="text-xs font-bold tracking-wider text-[#E8ECF4]">① ② ③ STRATEGY SETTINGS</span>
        <span className="text-[10px] text-[#8C98AE]">PineScript v1.1 port</span>
      </div>

      <div className="px-3 pt-3 pb-1 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => edit(p.patch)}
            className="rounded-full border border-[#2A3A5C] px-2.5 py-1 text-[10px] text-[#8C98AE] hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors"
          >
            {p.name}
          </button>
        ))}
      </div>

      <Accordion type="multiple" defaultValue={["f1", "f2", "f3"]} className="px-3">
        <AccordionItem value="f1" className="border-[#1C2A47]">
          <AccordionTrigger className="text-xs font-bold tracking-wider text-[#D4AF37] py-3 hover:no-underline">
            ① C1 / C2 FORMATION
          </AccordionTrigger>
          <AccordionContent className="space-y-2.5 pb-3">
            <NumRow label="ATR length" k="atrLen" draft={shown} onChange={num("atrLen")} />
            <NumRow label="Min body C1 & C2 (×ATR)" k="bodyMinATR" step="0.05" draft={shown} onChange={num("bodyMinATR")} />
            <NumRow label="Max gap C1↔C2 (×ATR)" k="pairTolATR" step="0.01" draft={shown} onChange={num("pairTolATR")} />
            <NumRow label="Too-close distance (×ATR)" k="minSepATR" step="0.1" draft={shown} onChange={num("minSepATR")} />
            <NumRow label="Max fresh levels / side" k="maxLevels" draft={shown} onChange={num("maxLevels")} />
            <NumRow label="Level expiry (bars)" k="expiryBars" draft={shown} onChange={num("expiryBars")} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#8C98AE] leading-tight">
                Focus current signal — a new C1/C2 replaces older levels, the EA follows the latest signal only
              </span>
              <Switch checked={shown.focusCurrent} onCheckedChange={(v) => edit({ focusCurrent: v })} />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="f2" className="border-[#1C2A47]">
          <AccordionTrigger className="text-xs font-bold tracking-wider text-[#D4AF37] py-3 hover:no-underline">
            ② C3 TRIGGER · BREAK &amp; RETURN
          </AccordionTrigger>
          <AccordionContent className="space-y-2.5 pb-3">
            <div className="rounded-lg border border-[#1C2A47] bg-[#0B1426] px-2.5 py-2 text-[10px] leading-relaxed text-[#8C98AE]">
              The <span className="font-bold text-[#D4AF37]">dotted line</span> marks the highest wick of candle 1 &amp; 2 (lowest for
              buys). C3 must <span className="font-bold text-[#E8ECF4]">break</span> that wick line, then
              <span className="font-bold text-[#E8ECF4]"> come back to it</span> — the trade fires instantly at the line.
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#8C98AE]">Signal mode</span>
              <Select value={shown.sigMode} onValueChange={(v) => edit({ sigMode: v as HaloConfig["sigMode"] })}>
                <SelectTrigger className="w-36 h-8 text-xs bg-[#0B1426] border-[#2A3A5C]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                  <SelectItem value="instant">Instant (intrabar)</SelectItem>
                  <SelectItem value="barclose">Bar close</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumRow label="Break beyond wick line (×ATR)" k="breakATR" step="0.01" draft={shown} onChange={num("breakATR")} />
            <NumRow label="Return-to-line tolerance (×ATR)" k="eqTolATR" step="0.01" draft={shown} onChange={num("eqTolATR")} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="f3" className="border-[#1C2A47]">
          <AccordionTrigger className="text-xs font-bold tracking-wider text-[#D4AF37] py-3 hover:no-underline">
            ③ TRADE MODULE
          </AccordionTrigger>
          <AccordionContent className="space-y-2.5 pb-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#8C98AE]">Stop-loss mode</span>
              <Select value={shown.slMode} onValueChange={(v) => edit({ slMode: v as HaloConfig["slMode"] })}>
                <SelectTrigger className="w-40 h-8 text-xs bg-[#0B1426] border-[#2A3A5C]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#101C33] border-[#2A3A5C] text-[#E8ECF4]">
                  <SelectItem value="points">Fixed points</SelectItem>
                  <SelectItem value="wick">Break extreme + buffer</SelectItem>
                  <SelectItem value="atr">ATR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <NumRow label="Fixed SL (points)" k="slPts" draft={shown} onChange={num("slPts")} />
            <NumRow label="Break-extreme buffer (points)" k="slBufPts" draft={shown} onChange={num("slBufPts")} />
            <NumRow label="ATR SL multiple" k="slATRm" step="0.1" draft={shown} onChange={num("slATRm")} />
            <NumRow label="Take profit (R multiple)" k="rrMult" step="0.5" draft={shown} onChange={num("rrMult")} />
            <NumRow label="Points per pip" k="pipMult" draft={shown} onChange={num("pipMult")} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="p-3">
        <Button
          onClick={apply}
          disabled={saving}
          className="w-full h-9 rounded-lg font-bold text-xs tracking-wider bg-[#D4AF37] text-[#0B1426] hover:bg-[#E3C25A]"
        >
          {saving ? "APPLYING…" : "APPLY SETTINGS"}
        </Button>
        <p className="mt-2 text-[10px] leading-relaxed text-[#8C98AE]">
          Changing symbol/timeframe requires a flat book. Instant mode can execute intrabar —
          bar-close mode only fires on confirmed candles.
        </p>
      </div>
    </div>
  );
}

function NumRow({
  label,
  k,
  draft,
  onChange,
  step,
}: {
  label: string;
  k: keyof HaloConfig;
  draft: HaloConfig;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  step?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-[#8C98AE] leading-tight">{label}</span>
      <Input
        type="number"
        step={step ?? "1"}
        value={String(draft[k])}
        onChange={onChange}
        className="w-24 h-8 text-xs font-mono text-right bg-[#0B1426] border-[#2A3A5C] text-[#E8ECF4]"
      />
    </div>
  );
}
