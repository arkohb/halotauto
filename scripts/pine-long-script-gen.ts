// ════════════════════════════════════════════════════════════════════════
//  PINE LONG-SCRIPT GENERATOR · deterministic ~2,500-line strategy source
//  Shared by pine-longscript-test.ts (unit) and pine-long-live-test.ts (API).
//  Shaped like real commercial packs: many inputs, multi-line helper
//  functions, dozens of indicator blocks, a 120-term confluence chain,
//  scripted SL/TP entries, plots and alerts — every line real Pine v5.
// ════════════════════════════════════════════════════════════════════════

export function genLongScript(targetLines: number): string {
  const L: string[] = [];
  const p = (s = "") => L.push(s);
  p("//@version=5");
  p("strategy(\"HALO Long Script Load Test\", overlay=true, pyramiding=0)");
  p("// generated load test — every block is real, compiling Pine v5");
  // inputs — every index defines all three families so cross-references never dangle
  const N_IN = 48;
  for (let i = 1; i <= N_IN; i++) {
    p(`inLen${i} = input.int(${4 + (i % 20)}, "Length ${i}", minval=1, group="Trend")`);
    p(`inMult${i} = input.float(${(0.5 + (i % 9) * 0.25).toFixed(2)}, "Mult ${i}", step=0.25, group="Risk")`);
    p(`inOn${i} = input.bool(true, "Enable block ${i}", group="Blocks")`);
  }
  // multi-line helper functions
  const N_FN = 24;
  for (let f = 1; f <= N_FN; f++) {
    p("");
    p(`fWeighted${f}(src, len) =>`);
    p(`    acc = 0.0`);
    p(`    wsum = 0.0`);
    p(`    for i = 0 to math.max(len - 1, 0)`);
    p(`        w = i % ${1 + (f % 4)} + 1`);
    p(`        acc := acc + nz(src[i]) * w`);
    p(`        wsum := wsum + w`);
    p(`    base = wsum > 0 ? acc / wsum : close`);
    p(`    if base > close`);
    p(`        base := base * ${0.9 + f * 0.001}`);
    p(`    else`);
    p(`        base := base * ${1.1 - f * 0.001}`);
    p(`    slope = nz(src[1]) != 0 ? (base - nz(src[1])) / math.abs(nz(src[1])) : 0.0`);
    p(`    result = base + slope * inMult${(f % N_IN) + 1}`);
    p(`    result`);
  }
  // computation blocks (blank + comment + 27 code lines each)
  const blockLines = () => 29;
  const tail = 23;
  const headLines = L.length;
  const nBlocks = Math.max(8, Math.ceil((targetLines - headLines - N_FN * 16 - tail) / blockLines()));
  for (let b = 1; b <= nBlocks; b++) {
    const i = (b % N_IN) + 1;
    p("");
    p(`// ── block ${b}`);
    p(`raw${b} = fWeighted${((b - 1) % N_FN) + 1}(close, inLen${i})`);
    p(`smooth${b} = ta.ema(raw${b}, math.max(inLen${i} - 2, 2))`);
    p(`fast${b} = ta.wma(raw${b}, math.max(math.floor(inLen${i} / 2), 2))`);
    p(`band${b} = ta.atr(inLen${i}) * inMult${i}`);
    p(`upper${b} = smooth${b} + band${b}`);
    p(`lower${b} = smooth${b} - band${b}`);
    p(`rise${b} = ta.rising(smooth${b}, 3)`);
    p(`fall${b} = ta.falling(smooth${b}, 3)`);
    p(`cross${b} = ta.crossover(fast${b}, smooth${b})`);
    p(`xunder${b} = ta.crossunder(fast${b}, smooth${b})`);
    p(`hh${b} = ta.highest(high, inLen${i})`);
    p(`ll${b} = ta.lowest(low, inLen${i})`);
    p(`rangeOk${b} = (hh${b} - ll${b}) > band${b}`);
    p(`trend${b} = smooth${b} > smooth${b}[2]`);
    p(`score${b} = 0`);
    p(`if inOn${i} and rise${b}`);
    p(`    score${b} := score${b} + 1`);
    p(`if inOn${i} and fall${b}`);
    p(`    score${b} := score${b} - 1`);
    p(`if cross${b} and rangeOk${b}`);
    p(`    score${b} := score${b} + 2`);
    p(`if xunder${b} and rangeOk${b}`);
    p(`    score${b} := score${b} - 2`);
    p(`if close > upper${b}`);
    p(`    score${b} := score${b} + 1`);
    p(`if close < lower${b}`);
    p(`    score${b} := score${b} - 1`);
    p(`bull${b} = score${b} >= 2 and trend${b}`);
    p(`bear${b} = score${b} <= -2 and not trend${b}`);
  }
  // confluence chains (terms sampled from every block — iteratively evaluated)
  p("");
  p("// ── confluence");
  const orTerms: string[] = [];
  const orTermsShort: string[] = [];
  for (let b = 1; b <= nBlocks; b++) {
    if (b % 7 === 0) orTerms.push(`bull${b}`);
    if (b % 11 === 0) orTermsShort.push(`bear${b}`);
  }
  // pad the chain to ≥ 120 terms so the iterative path is exercised
  let k = 1;
  while (orTerms.length < 120) orTerms.push(`bull${((k++ * 7) % nBlocks) + 1}`);
  k = 1;
  while (orTermsShort.length < 120) orTermsShort.push(`bear${((k++ * 11) % nBlocks) + 1}`);
  p(`megaLong = ${orTerms.join(" or ")}`);
  p(`megaShort = ${orTermsShort.join(" or ")}`);
  p(`megaLong := megaLong and not megaShort`);
  p(`megaShort := megaShort and not megaLong`);
  p(`flux = ta.cum(megaLong ? 1 : 0) - ta.cum(megaShort ? 1 : 0)`);
  // trading logic
  p("");
  p("// ── trading logic");
  p(`if megaLong`);
  p(`    strategy.entry("Long", strategy.long)`);
  p(`    strategy.exit("XL", from_entry="Long", stop=close - band1 * 2, limit=close + band1 * 4)`);
  p(`if megaShort`);
  p(`    strategy.entry("Short", strategy.short)`);
  p(`    strategy.exit("XS", from_entry="Short", stop=close + band1 * 2, limit=close - band1 * 4)`);
  p(`if flux > 50`);
  p(`    strategy.close_all(comment="overheated")`);
  p(`alertcondition(megaLong, "HALO long", "Long confluence fired")`);
  p(`plot(smooth1, "Core", color=color.aqua, linewidth=2)`);
  p(`plot(upper1, "Upper", color=color.gray)`);
  p(`plot(lower1, "Lower", color=color.gray)`);
  p(`plotshape(megaLong, style=shape.triangleup, color=color.lime, size=size.small)`);
  p(`plotshape(megaShort, style=shape.triangledown, color=color.red, size=size.small)`);
  // self-correcting line count — deterministic pad plots close any estimate gap
  let pad = 0;
  while (L.length < targetLines - 8) {
    pad++;
    p(`pad${pad} = ta.sma(close, ${(pad % 40) + 2})`);
    p(`plot(pad${pad}, "Pad ${pad}", color=color.olive)`);
  }
  return L.join("\n");
}
