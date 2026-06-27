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
