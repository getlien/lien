/**
 * OpenRouter API client for LLM access
 */

import * as core from '@actions/core';
import type { OpenRouterResponse, ComplexityViolation } from './types.js';
import { buildBatchedCommentsPrompt } from './prompt.js';

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
function trackUsage(
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost?: number } | undefined
): void {
  if (!usage) return;

  totalUsage.promptTokens += usage.prompt_tokens;
  totalUsage.completionTokens += usage.completion_tokens;
  totalUsage.totalTokens += usage.total_tokens;
  totalUsage.cost += usage.cost || 0;
}

/**
 * Generate an AI review using OpenRouter
 */
export async function generateReview(
  prompt: string,
  apiKey: string,
  model: string
): Promise<string> {
  core.info(`Calling OpenRouter with model: ${model}`);

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/getlien/lien',
      'X-Title': 'Lien AI Code Review',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert code reviewer. Provide actionable, specific feedback on code complexity issues. Be concise but thorough.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 2000,
      temperature: 0.3, // Lower temperature for more consistent reviews
      // Enable usage accounting to get cost data
      // https://openrouter.ai/docs/guides/guides/usage-accounting
      usage: {
        include: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter API error (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from OpenRouter');
  }

  const review = data.choices[0].message.content;

  // Cost is in usage.cost when usage accounting is enabled
  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
    core.info(
      `Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }

  return review;
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
  model: string
): Promise<Map<ComplexityViolation, string>> {
  const results = new Map<ComplexityViolation, string>();

  if (violations.length === 0) {
    return results;
  }

  core.info(`Generating comments for ${violations.length} violations in single batch`);

  const prompt = buildBatchedCommentsPrompt(violations, codeSnippets);

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/getlien/lien',
      'X-Title': 'Lien AI Code Review',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      // Scale tokens based on number of violations (~300 tokens per comment)
      max_tokens: Math.min(4000, 300 * violations.length + 200),
      temperature: 0.3,
      usage: {
        include: true,
      },
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

  if (data.usage) {
    trackUsage(data.usage);
    const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
    core.info(
      `Batch tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`
    );
  }

  // Parse JSON response
  const content = data.choices[0].message.content;
  let commentsMap: Record<string, string>;

  try {
    // Extract JSON from markdown code block if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
    commentsMap = JSON.parse(jsonStr);
  } catch (parseError) {
    core.warning(`Failed to parse batched response as JSON: ${parseError}`);
    core.debug(`Response content: ${content.slice(0, 500)}`);
    
    // Fallback: generate generic comments for all violations
    for (const violation of violations) {
      results.set(
        violation,
        `⚠️ **Complexity: ${violation.complexity}** (threshold: ${violation.threshold})\n\nThis ${violation.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`
      );
    }
    return results;
  }

  // Map comments back to violations
  for (const violation of violations) {
    const key = `${violation.filepath}::${violation.symbolName}`;
    const comment = commentsMap[key];

    if (comment) {
      // Unescape newlines from JSON
      results.set(violation, comment.replace(/\\n/g, '\n'));
    } else {
      core.warning(`No comment generated for ${key}`);
      results.set(
        violation,
        `⚠️ **Complexity: ${violation.complexity}** (threshold: ${violation.threshold})\n\nThis ${violation.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`
      );
    }
  }

  return results;
}

