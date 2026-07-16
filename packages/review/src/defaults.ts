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

/**
 * Default OpenRouter provider-routing preferences, sent as the request's
 * `provider` block. `moonshotai/kimi-k2.7-code` is multiplexed across several
 * upstream providers of varying speed, and slow ones drive the intermittent
 * 120s request timeouts. `sort: 'throughput'` steers to the fastest endpoint
 * (the direct lever against those timeouts); `allow_fallbacks` keeps the run
 * resilient if that endpoint fails. Overridable via the `providerRouting`
 * config (e.g. add `ignore`/`order` once logs name a flaky provider).
 */
export const DEFAULT_PROVIDER_ROUTING: Record<string, unknown> = {
  sort: 'throughput',
  allow_fallbacks: true,
};

/**
 * Per-request abort timeout (ms) for OpenRouter chat calls — covers response
 * headers AND body read. Generous so a slow large-context reasoning turn isn't
 * cut off. Overridable via the `requestTimeoutMs` config; don't lower/raise the
 * default without evidence from the per-request latency logs.
 */
export const DEFAULT_CHAT_REQUEST_TIMEOUT_MS = 120_000;

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
 *
 * Raised 1.5x → 2.0x (2026-07) after PR #781's job 87554927152 showed the
 * 1.5x floor was too tight: the main pass hit the wrap-up nudge after just 3
 * read_file turns (100,215 of 145,749 tokens, 68.8% — over the 60% nearBudget
 * threshold), forcing it to abandon mid-verification of a real finding
 * (numeric-union-arm consumer detection) and emit 0 findings. A 10-run sample
 * of the workflow found the nudge fires in ~4 of 7 pass-instances on
 * content-heavy small-file-count PRs — this is a routine failure mode, not a
 * one-off. 1.5x was originally calibrated (#598) to the FLOOR of observed
 * need ("~160-180K for a real multi-file review"), leaving no headroom above
 * it; 2.0x moves the typical medium-PR budget from ~162K to ~216K, clearing
 * that range with margin. Cost impact is ~$0.00092/token and ONLY applies to
 * runs that actually use the extra headroom (a ceiling raise doesn't change
 * agent behavior on runs that already finish under budget) — a few cents on
 * the affected runs, nothing on the rest.
 */
export const REVIEW_TOKEN_BUDGET_MULTIPLIERS: Record<string, number> = {
  [DEFAULT_REVIEW_MODEL]: 2.0,
};

/** Budget multiplier for a model slug (1× when unknown). */
export function reviewTokenBudgetMultiplier(model: string): number {
  return REVIEW_TOKEN_BUDGET_MULTIPLIERS[model] ?? 1;
}
