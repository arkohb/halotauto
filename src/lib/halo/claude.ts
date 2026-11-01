// ════════════════════════════════════════════════════════════════════════
//  HALO · Claude conversational core (server-side only)
//  One helper for every place HALO talks: the operator brain, the read-only
//  assistant and the journal insights. Replaces the old z-ai SDK.
//    • model: Claude Opus 5.5, effort "low" — short voice-grade replies fast
//    • server-side refusal fallback ("default" routing)
//    • the stable instruction block is prompt-cached; the live snapshot
//      (prices, positions…) goes after the cache breakpoint
//  Needs ANTHROPIC_API_KEY on the server (never sent to the browser).
// ════════════════════════════════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";

export const HALO_MODEL = process.env.HALO_CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AskInput {
  /** instructions that rarely change — cached */
  stable: string;
  /** per-request context (live snapshot) — not cached */
  live?: string;
  history?: ChatTurn[];
  message: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export class ClaudeUnavailableError extends Error {}

/** Plain-language error for the UI — never leaks keys or stack traces. */
export function friendlyClaudeError(e: unknown): string {
  if (e instanceof ClaudeUnavailableError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "the Claude API key is invalid — check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.PermissionDeniedError) return "this Claude API key is not allowed to use the model.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now — try again in a moment.";
  if (e instanceof Anthropic.APIConnectionError) return "cannot reach the Claude API — check the internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ""}`.trim() + ".";
  return (e as Error)?.message?.slice(0, 160) || "unknown error.";
}

export async function askClaude(input: AskInput): Promise<string> {
  if (!claudeConfigured()) {
    throw new ClaudeUnavailableError("no Claude API key is set — add ANTHROPIC_API_KEY on the server.");
  }

  // the API needs user/assistant alternation starting with a user turn;
  // the console history often opens with HALO's own greeting — drop it
  const turns = [...(input.history ?? [])];
  while (turns.length && turns[0].role !== "user") turns.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...turns.filter((t) => t.text.trim()).map((t) => ({ role: t.role, content: t.text })),
    { role: "user", content: input.message },
  ];

  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: input.stable, cache_control: { type: "ephemeral" } }];
  if (input.live) system.push({ type: "text", text: input.live });

  const res = await getClient().beta.messages.create({
    model: HALO_MODEL,
    max_tokens: input.maxTokens ?? 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: input.effort ?? "low" },
    system,
    messages,
  });

  if (res.stop_reason === "refusal") {
    throw new ClaudeUnavailableError("Claude declined to answer that request.");
  }
  const text = res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new ClaudeUnavailableError(res.stop_reason === "max_tokens" ? "the reply was cut off — try a shorter question." : "Claude returned an empty reply.");
  return text;
}
