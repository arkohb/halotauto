// E2E engine test · v1.2 wick-line break → return entry
// Proves: (1) both sides armed together, (2) instant intrabar fire on the
// live candle the moment C3 breaks the wick line AND returns to it,
// (3) entry is exactly at the dotted line price, (4) no fire before return.
import { HaloEngine } from "../src/lib/halo/engine";
import { DEFAULT_CONFIG } from "../src/lib/halo/types";
import type { Candle } from "../src/lib/halo/types";

const T0 = 1_700_000_000_000;
const S = 60_000; // 1m bars
let t = T0;
const bar = (o: number, h: number, l: number, c: number): Candle => ({ time: t, open: o, high: h, low: l, close: c });
const step = () => { t += S; };

const cfg = { ...DEFAULT_CONFIG, atrLen: 14, sigMode: "instant" as const, breakATR: 0.02, eqTolATR: 0.1 };
const eng = new HaloEngine(cfg, 0.01);

// warm up ATR with quiet bars (TR ≈ 0.4 → ATR ≈ 0.4)
for (let i = 0; i < 20; i++) { eng.processBar(bar(100, 100.2, 99.8, 100), true); step(); }

// resistance pair: C1 bullish (100→101, high 101.2) then C2 bearish (101→99.1)
const c1 = bar(100, 101.2, 99.9, 101); eng.processBar(c1, true); step();
const c2 = bar(101, 101.15, 99.0, 99.1); eng.processBar(c2, true); step();
// support pair: C1 bearish (99.1→98.2, low 98.0) then C2 bullish (98.2→99.1)
const c3 = bar(99.1, 99.2, 98.0, 98.2); eng.processBar(c3, true); step();
const c4 = bar(98.2, 99.2, 98.1, 99.1); eng.processBar(c4, true); step();

const snap = eng.snapshot();
const res = snap.levels.find((l) => l.side === -1);
const sup = snap.levels.find((l) => l.side === 1);
console.log("armed resistance:", !!res, "zone", res?.top.toFixed(2), res?.bot.toFixed(2), "· dotted ext", res?.ext.toFixed(2));
console.log("armed support   :", !!sup, "zone", sup?.top.toFixed(2), sup?.bot.toFixed(2), "· dotted ext", sup?.ext.toFixed(2));
if (!res || !sup) { console.error("FAIL: both sides must be armed"); process.exit(1); }

// dotted line = highest wick of C1 & C2 (resistance): max(101.2, 101.15) = 101.2
if (Math.abs(res.ext - 101.2) > 1e-9) { console.error(`FAIL: res ext ${res.ext} != highest wick 101.2`); process.exit(1); }
if (Math.abs(sup.ext - 98.0) > 1e-9) { console.error(`FAIL: sup ext ${sup.ext} != lowest wick 98.0`); process.exit(1); }
console.log("dotted line = highest/lowest wick of C1&C2 ✓");

// LIVE (unconfirmed) C3 intrabar: wick breaks the resistance dotted line (101.2)
// then price returns to it → must FIRE INSTANTLY, entry AT the dotted line
const live: Candle = { time: t, open: 100.5, high: 101.7, low: 100.2, close: 101.22 };
const evLive = eng.processBar(live, false); // confirmed=false → instant mode
const fire = evLive.find((e) => e.type === "fire");
if (!fire || fire.type !== "fire") { console.error("FAIL: no instant fire on break→return intrabar", JSON.stringify(evLive)); process.exit(1); }
if (Math.abs(fire.entry - 101.2) > 1e-9) { console.error(`FAIL: entry ${fire.entry} != dotted line 101.2`); process.exit(1); }
if (fire.dir !== -1) { console.error("FAIL: expected SELL at resistance"); process.exit(1); }
console.log(`INSTANT FIRE ✓ ${fire.dir === -1 ? "SELL" : "BUY"} entry ${fire.entry} (= dotted line) · SL ${fire.sl.toFixed(2)} · TP ${fire.tp.toFixed(2)}`);
console.log(`message: "${fire.message}"`);
const tr = eng.snapshot().trade;
if (!tr || Math.abs(tr.trigger - 101.2) > 1e-9) { console.error("FAIL: open trade trigger not pinned to the dotted line"); process.exit(1); }
console.log("open trade tracked · trigger", tr.trigger, "·", tr.slModeLabel, "stop ✓");

// negative test: break WITHOUT return must NOT fire (price still beyond the line)
const eng2 = new HaloEngine(cfg, 0.01);
t = T0;
for (let i = 0; i < 20; i++) { eng2.processBar(bar(100, 100.2, 99.8, 100), true); step(); }
eng2.processBar(bar(100, 101.2, 99.9, 101), true); step();
eng2.processBar(bar(101, 101.15, 99.0, 99.1), true); step();
const armedN = eng2.snapshot().levels.length;
const noReturn: Candle = { time: t, open: 100.5, high: 101.7, low: 100.2, close: 102.1 };
const evNo = eng2.processBar(noReturn, false);
if (evNo.some((e) => e.type === "fire")) { console.error("FAIL: fired without return to the line"); process.exit(1); }
if (eng2.snapshot().levels.length !== armedN) { console.error("FAIL: intrabar break without return must keep the level armed until bar close"); process.exit(1); }
console.log("break-without-return: no fire · level stays armed intrabar ✓");

// bar-close discipline: confirmed bar that broke and returned → fires in barclose mode too
const eng3 = new HaloEngine({ ...cfg, sigMode: "barclose" }, 0.01);
t = T0;
for (let i = 0; i < 20; i++) { eng3.processBar(bar(100, 100.2, 99.8, 100), true); step(); }
eng3.processBar(bar(100, 101.2, 99.9, 101), true); step();
eng3.processBar(bar(101, 101.15, 99.0, 99.1), true); step();
const evBC = eng3.processBar(bar(100.5, 101.7, 100.2, 101.22), true);
if (!evBC.some((e) => e.type === "fire")) { console.error("FAIL: barclose mode did not fire on confirmed break→return"); process.exit(1); }
console.log("bar-close mode: confirmed break→return fires ✓");

console.log("\nALL ENGINE TESTS PASSED");
