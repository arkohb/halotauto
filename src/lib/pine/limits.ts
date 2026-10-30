// ════════════════════════════════════════════════════════════════════════
//  HALO STRATEGY STUDIO · compiler limits (single source of truth)
//
//  Long scripts are normal — commercial indicator packs routinely run
//  1,500–2,500 lines. The limits below give that a wide margin:
//    • 1,000,000 chars  ≈ 2,500 lines × ~400 chars (extremely dense) or
//                         ≈ 12,000+ lines of typical 80-char Pine
//    • 8,000 lines      — hard line guard (an honest early error beats a
//                         vague parse failure 5,000 lines in)
//  The runtime adds its own wall-clock budget (see PineRuntime) so even a
//  pathological script can never hang the server or the preview.
// ════════════════════════════════════════════════════════════════════════

/** Maximum accepted script size in characters. */
export const MAX_PINE_CHARS = 1_000_000;

/** Maximum accepted script length in lines. */
export const MAX_PINE_LINES = 8_000;

/** Wall-clock budget for evaluating ONE confirmed bar (ms). A single-bar
 *  evaluation that runs longer is pathological — fail honestly, never hang. */
export const PINE_BAR_BUDGET_MS = 10_000;

/** Maximum expression nesting depth (parens / ternaries / unary chains). */
export const MAX_EXPR_DEPTH = 400;

export function pineLimitMessage(len: number, lines: number): string {
  return `Script too large (${lines.toLocaleString()} lines, ${len.toLocaleString()} chars) — the HALO compiler accepts up to ${MAX_PINE_LINES.toLocaleString()} lines / ${MAX_PINE_CHARS.toLocaleString()} chars. Split helper logic into functions or trim unused blocks.`;
}
