/**
 * Shared agent-review defaults — the single source of truth for the default
 * model and its OpenRouter pricing.
 *
 * Consumed by the GitHub Action (`@liendev/action` inputs), the agent-review
 * plugin's config schema, and the (legacy) runner, so bumping the default model
 * is a one-line change here instead of parallel literals that drift across
 * packages (see PR #592 review).
 */

/** Default agent-review model — OpenRouter model slug. */
export const DEFAULT_REVIEW_MODEL = 'moonshotai/kimi-k2.7-code';

/** OpenRouter API base URL (OpenAI-compatible endpoint). */
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** OpenRouter cost per million tokens for {@link DEFAULT_REVIEW_MODEL}. */
export const DEFAULT_OPENROUTER_INPUT_COST_PER_MTOK = 0.74;
export const DEFAULT_OPENROUTER_OUTPUT_COST_PER_MTOK = 3.5;

/** Hard ceiling for the scaled agent token budget — bounds worst-case cost. */
export const MAX_REVIEW_TOKEN_BUDGET = 250_000;

/**
 * Per-model token-budget multiplier, calibrated to observed token appetite.
 *
 * The base budget formula (`scaleAgentBudget` in review-pr.ts) was tuned for
 * Gemini 3 Flash (~8K tokens/turn). Kimi k2.7-code is a high-effort reasoning
 * model that re-spends far more per turn (~30–48K observed), so PRs that Gemini
 * finished were exhausting the budget and bailing without a verdict. Scale the
 * budget for such models. Unknown models default to 1× (unchanged).
 *
 * Keyed on the model slug so it tracks the actual model in use (incl. A/B
 * overrides), not just the default.
 */
export const REVIEW_TOKEN_BUDGET_MULTIPLIERS: Record<string, number> = {
  [DEFAULT_REVIEW_MODEL]: 1.5,
};

/** Budget multiplier for a model slug (1× when unknown). */
export function reviewTokenBudgetMultiplier(model: string): number {
  return REVIEW_TOKEN_BUDGET_MULTIPLIERS[model] ?? 1;
}
