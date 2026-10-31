// Smoke test for the Deriv symbol catalog additions (pure functions only).
import { SYMBOLS, SYMBOL_GROUPS, symbolsByGroup, SYMBOL_BY_TV, simStyleOf, getSymbolMeta } from "../src/lib/market-symbols";
import { resolveSymbol as resolveVoice } from "../src/lib/halo/actions";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name} ${extra}`);
  }
}

// 1. counts per group
for (const g of SYMBOL_GROUPS) {
  check(`group ${g.key} non-empty`, symbolsByGroup(g.key).length > 0, `${symbolsByGroup(g.key).length}`);
}
const counts = Object.fromEntries(SYMBOL_GROUPS.map((g) => [g.key, symbolsByGroup(g.key).length]));
console.log("counts:", JSON.stringify(counts), "total:", SYMBOLS.length);

// 2. uniqueness of ids + tv
const ids = new Set(SYMBOLS.map((s) => s.id));
check("unique ids", ids.size === SYMBOLS.length, `${ids.size} vs ${SYMBOLS.length}`);
const tvs = SYMBOLS.filter((s) => s.tv).map((s) => s.tv.toUpperCase());
check("unique tv", new Set(tvs).size === tvs.length);

// 3. all minticks positive & finite, base > 0
check("minticks valid", SYMBOLS.every((s) => isFinite(s.mintick) && s.mintick > 0));
check("bases valid", SYMBOLS.every((s) => isFinite(s.base) && s.base > 0));

// 4. key Deriv ids exist
for (const id of ["V75", "V75S", "BOOM1000", "CRASH500", "BOOM600", "CRASH900", "STEP", "JUMP25", "RB100", "RB200", "MS2", "CBF500", "HFVOL75", "VSWLOW", "LADDERUP", "TREKUP", "DEX900UP", "DS10", "SKEWSTEP", "US30", "USOIL", "NGAS", "USDZAR", "EURTRY"]) {
  check(`id ${id} exists`, ids.has(id));
}

// 5. TV pro-name map
check("tv map V75", SYMBOL_BY_TV["DERIV:VOLATILITY_75_INDEX"] === "V75");
check("tv map BOOM1000", SYMBOL_BY_TV["DERIV:BOOM_1000_INDEX"] === "BOOM1000");
check("tv map STEP", SYMBOL_BY_TV["DERIV:STEP_INDEX"] === "STEP");
check("tv map CRASH500", SYMBOL_BY_TV["DERIV:CRASH_500_INDEX"] === "CRASH500");
check("no tv for est symbols", !getSymbolMeta("BOOM400").tv);

// 6. sim styles
check("boom style", simStyleOf("BOOM1000").kind === "boom" && simStyleOf("BOOM1000").k === 1000);
check("crash style", simStyleOf("CRASH500").kind === "crash" && simStyleOf("CRASH500").k === 500);
check("vboom style", simStyleOf("VBOOM400").kind === "boom" && simStyleOf("VBOOM400").k === 400);
check("cbf style", simStyleOf("CBF500").kind === "cbf");
check("jump style", simStyleOf("JUMP25").kind === "jump");
check("step style", simStyleOf("STEP").kind === "step" && simStyleOf("MS2").kind === "step");
check("walk style", simStyleOf("V75").kind === "walk" && simStyleOf("DS10").kind === "walk");

// 7. voice resolution
check("voice 'volatility 75'", resolveVoice("volatility 75") === "V75");
check("voice 'volatility75 1s'", resolveVoice("volatility 75 1s") === "V75S");
check("voice 'boom 1000'", resolveVoice("boom 1000") === "BOOM1000");
check("voice 'boom'", resolveVoice("boom") === "BOOM1000");
check("voice 'crash'", resolveVoice("crash") === "CRASH1000");
check("voice 'crash 500'", resolveVoice("crash 500") === "CRASH500");
check("voice 'step index'", resolveVoice("step index") === "STEP");
check("voice 'jump 25'", resolveVoice("jump 25") === "JUMP25");
check("voice 'range break 200'", resolveVoice("range break 200") === "RB200");
check("voice 'V75'", resolveVoice("V75") === "V75");
check("voice 'BOOM1000'", resolveVoice("BOOM1000") === "BOOM1000");
check("voice 'gold' unchanged", resolveVoice("gold") === "XAUUSD");
check("voice 'EUR/USD' unchanged", resolveVoice("EUR/USD") === "EURUSD");
check("voice 'VOL 75 (1S)' label", resolveVoice("VOL 75 (1S)") === "V75S");
check("voice 'vol 75' label→V75 first", resolveVoice("vol 75") === "V75");
check("voice 'wti'", resolveVoice("wti") === "USOIL");
check("voice 'us 30' label", resolveVoice("US 30") === "US30");
check("voice garbage → null", resolveVoice("zzzz") === null);

// 8. INDICES group sanity: tv present for all, yahoo map wired via market (spot-check via getSymbolMeta)
check("US30 tv", getSymbolMeta("US30").tv === "DJ:DJI");
check("NGAS tv", getSymbolMeta("NGAS").tv === "NYMEX:NG1!");
check("V75 group", getSymbolMeta("V75").group === "SYNTHETICS");
check("USOIL group", getSymbolMeta("USOIL").group === "INDICES");
check("USDZAR group", getSymbolMeta("USDZAR").group === "FOREX");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
