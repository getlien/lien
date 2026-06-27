/**
 * Action input parsing.
 *
 * Reads and validates the `INPUT_*` environment variables GitHub injects from
 * the workflow `with:` block, and resolves the LLM provider from the supplied
 * API keys. OpenRouter wins if present (cheaper Gemini path), Anthropic is the
 * fallback, and absent both we run complexity-only (`llm === null`).
 */

import type { ReviewLLMConfig } from '@liendev/review';

/** OpenRouter cost per million tokens (matches the retired runner's numbers). */
const OPENROUTER_INPUT_COST_PER_MTOK = 0.5;
const OPENROUTER_OUTPUT_COST_PER_MTOK = 3;
/** Anthropic cost per million tokens (claude-sonnet-4-6). */
const ANTHROPIC_INPUT_COST_PER_MTOK = 3;
const ANTHROPIC_OUTPUT_COST_PER_MTOK = 15;

const OPENROUTER_MODEL = 'google/gemini-3-flash-preview';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

export type FailOn = 'error' | 'never' | 'any';

export interface ReviewTypes {
  complexity: boolean;
  bugs: boolean;
  summary: boolean;
  architectural: boolean;
}

export interface ActionInputs {
  githubToken: string;
  threshold: string;
  blockOnNewErrors: boolean;
  failOn: FailOn;
  reviewTypes: ReviewTypes;
  llm: ReviewLLMConfig;
}

/**
 * Read an action input. GitHub exposes `with: foo-bar` as `INPUT_FOO-BAR`
 * (uppercased, spaces → `_`), but some runners also expose `INPUT_FOO_BAR`.
 * Try the hyphen form first, then the underscore form.
 */
function readInput(name: string): string {
  const upper = name.toUpperCase();
  const hyphen = process.env[`INPUT_${upper}`];
  if (hyphen !== undefined) return hyphen.trim();
  const underscore = process.env[`INPUT_${upper.replace(/-/g, '_')}`];
  return underscore !== undefined ? underscore.trim() : '';
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = readInput(name).toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function parseFailOn(raw: string): FailOn {
  if (raw === 'never' || raw === 'any' || raw === 'error') return raw;
  // Default: 'never' — the review is advisory out of the box (findings show as
  // annotations + comments without failing CI). Consumers opt into gating with
  // fail-on: error | any.
  if (raw === '') return 'never';
  throw new Error(`Invalid fail-on value "${raw}" — expected one of: error, never, any`);
}

/**
 * Parse the `threshold` input. Must be a positive integer (it is consumed as
 * `parseInt(threshold, 10)` downstream); a non-numeric value like "high" would
 * otherwise silently degrade into NaN and produce misleading complexity output.
 */
function parseThreshold(raw: string): string {
  const value = raw === '' ? '15' : raw;
  if (!/^\d+$/.test(value) || parseInt(value, 10) <= 0) {
    throw new Error(`Invalid threshold value "${raw}" — expected a positive integer`);
  }
  return value;
}

const VALID_REVIEW_TYPES = ['complexity', 'bugs', 'summary', 'architectural'] as const;
type ReviewTypeName = (typeof VALID_REVIEW_TYPES)[number];

/**
 * Parse the `review-types` input — a comma-separated list of the review types
 * to enable (complexity, bugs, summary, architectural). When unset we use
 * sensible defaults: complexity + bugs + summary on, architectural off.
 *
 * Rejects unknown or empty values rather than silently dropping them: a typo
 * like `summmary` or a stray `,` would otherwise leave every flag false, so the
 * review would register no plugins and report success having checked nothing.
 */
function parseReviewTypes(raw: string): ReviewTypes {
  if (raw === '') {
    return { complexity: true, bugs: true, summary: true, architectural: false };
  }
  const tokens = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = tokens.filter(t => !VALID_REVIEW_TYPES.includes(t as ReviewTypeName));
  if (tokens.length === 0 || unknown.length > 0) {
    const detail = unknown.length > 0 ? `unknown type(s): ${unknown.join(', ')}` : 'no valid types';
    throw new Error(
      `Invalid review-types value "${raw}" (${detail}) — expected a comma-separated list of: ${VALID_REVIEW_TYPES.join(', ')}`,
    );
  }
  const enabled = new Set(tokens);
  return {
    complexity: enabled.has('complexity'),
    bugs: enabled.has('bugs'),
    summary: enabled.has('summary'),
    architectural: enabled.has('architectural'),
  };
}

/**
 * Resolve the LLM provider from the supplied keys. OpenRouter takes precedence
 * (cheaper Gemini path); Anthropic is the fallback; absent both, `null` means
 * complexity-only review with no agent.
 */
function resolveLLM(openrouterKey: string, anthropicKey: string): ReviewLLMConfig {
  if (openrouterKey) {
    return {
      provider: 'openai',
      apiKey: openrouterKey,
      model: OPENROUTER_MODEL,
      baseUrl: OPENROUTER_BASE_URL,
      inputCostPerMTok: OPENROUTER_INPUT_COST_PER_MTOK,
      outputCostPerMTok: OPENROUTER_OUTPUT_COST_PER_MTOK,
    };
  }
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: ANTHROPIC_MODEL,
      inputCostPerMTok: ANTHROPIC_INPUT_COST_PER_MTOK,
      outputCostPerMTok: ANTHROPIC_OUTPUT_COST_PER_MTOK,
    };
  }
  return null;
}

export function readInputs(): ActionInputs {
  const githubToken = readInput('github-token');
  if (!githubToken) {
    throw new Error('github-token input is required (defaults to ${{ github.token }})');
  }

  const threshold = parseThreshold(readInput('threshold'));
  const blockOnNewErrors = readBool('block-on-new-errors', false);
  const failOn = parseFailOn(readInput('fail-on'));
  const reviewTypes = parseReviewTypes(readInput('review-types'));
  const llm = resolveLLM(readInput('openrouter-api-key'), readInput('anthropic-api-key'));

  return { githubToken, threshold, blockOnNewErrors, failOn, reviewTypes, llm };
}
