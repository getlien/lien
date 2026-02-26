/**
 * OpenRouter API client for LLM access
 */

import type { ComplexityViolation, ComplexityReport } from '@liendev/parser';
import type { LogicFinding, LineComment } from './types.js';
import type { Logger } from './logger.js';
import { buildBatchedCommentsPrompt } from './prompt.js';
import { buildLogicReviewPrompt } from './logic-prompt.js';
import { parseLogicReviewResponse } from './logic-response.js';
import { extractJSONFromCodeBlock, estimatePromptTokens } from './json-utils.js';
import { LOGIC_MARKER_PREFIX } from './github-api.js';

/**
 * OpenRouter API response structure
 * Cost is returned in usage.cost when usage accounting is enabled
 * See: https://openrouter.ai/docs/guides/guides/usage-accounting
 */
export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number; // Returned when usage: { include: true } is set in request
  };
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Token usage tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number; // Actual cost from OpenRouter API
}

/**
 * Global token usage accumulator
 */
let totalUsage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cost: 0,
};

/**
 * Reset token usage (call at start of review)
 */
export function resetTokenUsage(): void {
  totalUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
}

/**
 * Get current token usage
 */
export function getTokenUsage(): TokenUsage {
  return { ...totalUsage };
}

/**
 * Accumulate token usage from API response
 * Cost is returned in usage.cost when usage accounting is enabled
 */
export function trackUsage(
  usage:
    | { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost?: number }
    | undefined,
): void {
  if (!usage) return;

  totalUsage.promptTokens += usage.prompt_tokens;
  totalUsage.completionTokens += usage.completion_tokens;
  totalUsage.totalTokens += usage.total_tokens;
  totalUsage.cost += usage.cost || 0;
}

/**
 * Parse JSON comments response from AI, handling markdown code blocks
 * Returns null if parsing fails after retry attempts
 * Exported for testing
 */
export function parseCommentsResponse(
  content: string,
  logger: Logger,
): Record<string, string> | null {
  const jsonStr = extractJSONFromCodeBlock(content);

  logger.info(`Parsing JSON response (${jsonStr.length} chars)`);

  try {
    const parsed = JSON.parse(jsonStr);
    logger.info(`Successfully parsed ${Object.keys(parsed).length} comments`);
    return parsed;
  } catch (parseError) {
    logger.warning(`Initial JSON parse failed: ${parseError}`);
  }

  // Aggressive retry: extract any JSON object from response
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      logger.info(`Recovered JSON with aggressive parsing: ${Object.keys(parsed).length} comments`);
      return parsed;
    } catch (retryError) {
      logger.warning(`Retry parsing also failed: ${retryError}`);
    }
  }

  logger.warning(`Full response content:\n${content}`);
  return null;
}

/** Max tokens to reserve for the prompt (leaves room for output within 128K context) */
const PROMPT_TOKEN_BUDGET = 100_000;

/** Models known to support OpenRouter's extended reasoning parameter */
const REASONING_MODELS = /deepseek|minimax|o1|o3|qwq/i;

/**
 * Call OpenRouter API with batched comments prompt
 */
export async function callBatchedCommentsAPI(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<OpenRouterResponse> {
  const supportsReasoning = REASONING_MODELS.test(model);

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/getlien/lien',
      'X-Title': 'Lien Review',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            "You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON. Before suggesting refactorings, analyze the code snippets provided to identify the codebase's architectural patterns (e.g., functions vs classes, module organization, naming conventions). Then suggest refactorings that match those existing patterns.",
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 32768,
      temperature: 0.3,
      ...(supportsReasoning ? { reasoning: { effort: 'high' } } : {}),
      usage: { include: true },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from OpenRouter');
  }

  return data;
}

/**
 * Map parsed comments to violations, with fallback for missing comments
 * Exported for testing
 */
export function mapCommentsToViolations(
  commentsMap: Record<string, string> | null,
  violations: ComplexityViolation[],
  logger: Logger,
): Map<ComplexityViolation, string> {
  const results = new Map<ComplexityViolation, string>();
  const fallbackMessage = (v: ComplexityViolation) =>
    `This ${v.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`;

  if (!commentsMap) {
    for (const violation of violations) {
      results.set(violation, fallbackMessage(violation));
    }
    return results;
  }

  // AI responds with one comment per filepath::symbolName (grouped).
  // Map the same comment to all violations sharing that key.
  for (const violation of violations) {
    const key = `${violation.filepath}::${violation.symbolName}`;
    const comment = commentsMap[key];

    if (comment) {
      results.set(violation, comment.replace(/\\n/g, '\n'));
    } else {
      logger.warning(`No comment generated for ${key}`);
      results.set(violation, fallbackMessage(violation));
    }
  }

  return results;
}

/**
 * Generate line comments for multiple violations in a single API call
 *
 * This is more efficient than individual calls:
 * - System prompt only sent once (saves ~100 tokens per violation)
 * - AI has full context of all violations (can identify patterns)
 * - Single API call = faster execution
 */
export async function generateLineComments(
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  apiKey: string,
  model: string,
  report: ComplexityReport,
  logger: Logger,
  diffHunks?: Map<string, string>,
): Promise<Map<ComplexityViolation, string>> {
  if (violations.length === 0) {
    return new Map();
  }

  logger.info(`Generating comments for ${violations.length} violations in single batch`);

  let prompt = buildBatchedCommentsPrompt(violations, codeSnippets, report, diffHunks);
  let estimatedTokens = estimatePromptTokens(prompt);
  logger.info(`Estimated prompt tokens: ${estimatedTokens.toLocaleString()}`);

  // If prompt exceeds budget, rebuild with fewer violations (keep top N by priority order)
  let usedViolations = violations;
  if (estimatedTokens > PROMPT_TOKEN_BUDGET) {
    logger.warning(
      `Prompt exceeds token budget (${estimatedTokens.toLocaleString()} > ${PROMPT_TOKEN_BUDGET.toLocaleString()}). Truncating violations...`,
    );
    // Binary-ish search: halve until under budget
    let count = violations.length;
    while (count > 1 && estimatedTokens > PROMPT_TOKEN_BUDGET) {
      count = Math.ceil(count / 2);
      usedViolations = violations.slice(0, count);
      prompt = buildBatchedCommentsPrompt(usedViolations, codeSnippets, report, diffHunks);
      estimatedTokens = estimatePromptTokens(prompt);
    }
    if (estimatedTokens > PROMPT_TOKEN_BUDGET && usedViolations.length === 1) {
      logger.warning(
        `Even a single violation exceeds the token budget (${estimatedTokens.toLocaleString()} > ${PROMPT_TOKEN_BUDGET.toLocaleString()}). Proceeding with minimal prompt.`,
      );
    } else {
      logger.warning(
        `Truncated to ${usedViolations.length}/${violations.length} violations (${estimatedTokens.toLocaleString()} tokens)`,
      );
    }
  }

  const data = await callBatchedCommentsAPI(prompt, apiKey, model);

  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
    logger.info(
      `Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`,
    );
  }

  const commentsMap = parseCommentsResponse(data.choices[0].message.content, logger);
  return mapCommentsToViolations(commentsMap, usedViolations, logger);
}

/**
 * Map validated LLM response entries to line comments, filtering false positives.
 */
function mapFindingsToComments(
  findings: LogicFinding[],
  parsed: Record<string, { valid: boolean; comment: string }>,
  logger: Logger,
): LineComment[] {
  const comments: LineComment[] = [];
  for (const finding of findings) {
    const key = `${finding.filepath}::${finding.symbolName}`;
    const entry = parsed[key];

    if (entry && entry.valid) {
      const categoryLabel = finding.category.replace(/_/g, ' ');
      comments.push({
        path: finding.filepath,
        line: finding.line,
        body: `${LOGIC_MARKER_PREFIX}${finding.filepath}::${finding.line}::${finding.category} -->\n**Logic Review** (beta) — ${categoryLabel}\n\n${entry.comment}`,
      });
    } else if (entry && !entry.valid) {
      logger.info(`Finding ${key} marked as false positive by LLM`);
    }
  }
  return comments;
}

/**
 * Generate validated logic review comments via LLM.
 * Takes raw findings, sends to LLM for validation, returns line comments for valid ones.
 */
export async function generateLogicComments(
  findings: LogicFinding[],
  codeSnippets: Map<string, string>,
  apiKey: string,
  model: string,
  report: ComplexityReport,
  logger: Logger,
  diffHunks?: Map<string, string>,
): Promise<LineComment[]> {
  if (findings.length === 0) {
    return [];
  }

  logger.info(`Validating ${findings.length} logic findings via LLM`);

  const prompt = buildLogicReviewPrompt(findings, codeSnippets, report, diffHunks);
  const data = await callBatchedCommentsAPI(prompt, apiKey, model);

  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
    logger.info(
      `Logic review tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`,
    );
  }

  const parsed = parseLogicReviewResponse(data.choices[0].message.content, logger);
  if (!parsed) {
    logger.warning('Failed to parse logic review response, skipping');
    return [];
  }

  const comments = mapFindingsToComments(findings, parsed, logger);
  logger.info(`${comments.length}/${findings.length} findings validated as real issues`);
  return comments;
}
