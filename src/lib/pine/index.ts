// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · Pine Script v5 (subset) — public surface
// ════════════════════════════════════════════════════════════════════════

export { PineError } from "./runtime";
export { PineRuntime, normalizeColor, type RuntimeOpts, type SimTrade, type PlanEntry, type PlanExit } from "./runtime";
export { compilePine, type CompiledPine, type CompileResult, type PineDiagnostic, type PineInputDef, type PinePlotDef, type PineShapeDef } from "./compile";
export { MAX_PINE_CHARS, MAX_PINE_LINES, PINE_BAR_BUDGET_MS, MAX_EXPR_DEPTH } from "./limits";
export type { Expr, Stmt, Program } from "./parser";
export { exportDrawings, type PineDrawings } from "./drawings";
