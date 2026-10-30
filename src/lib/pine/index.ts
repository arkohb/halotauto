// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script v5 (subset) — public surface
// ════════════════════════════════════════════════════════════════════════

export { PineError } from "./runtime";
export { PineRuntime, normalizeColor, type RuntimeOpts, type SimTrade, type PlanEntry, type PlanExit } from "./runtime";
export { compilePine, type CompiledPine, type CompileResult, type PineDiagnostic, type PineInputDef, type PinePlotDef, type PineShapeDef } from "./compile";
export type { Expr, Stmt, Program } from "./parser";
