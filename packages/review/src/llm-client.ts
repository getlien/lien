/**
 * Instance-based LLM client wrapping OpenRouter.
 * Replaces the global mutable state in openrouter.ts.
 *
 * Features:
 * - Per-instance token usage tracking (no global state)
 * - Per-call timeout via AbortSignal
 * - Per-instance token budget enforcement
 * - JSON response parsing with retry
 */

import type { LLMClient, LLMOptions, LLMResponse } from './plugin-types.js';
import type { Logger } from './logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Models known to support OpenRouter's extended reasoning parameter */
const REASONING_MODELS = /deepseek|minimax|o1|o3|qwq/i;

/** Default timeout per LLM call (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * OpenRouter API response structure.
 */
interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number;
  };
}

export interface OpenRouterLLMClientOptions {
  apiKey: string;
  model: string;
  /** Maximum total tokens across all calls (budget enforcement) */
  maxTotalTokens?: number;
  /** Default timeout per call in ms */
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Instance-based LLM client backed by OpenRouter.
 */
export class OpenRouterLLMClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTotalTokens: number;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;

  private usage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
  };

  constructor(opts: OpenRouterLLMClientOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.maxTotalTokens = opts.maxTotalTokens ?? Infinity;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = opts.logger;
  }

  async complete(prompt: string, opts?: LLMOptions): Promise<LLMResponse> {
    // Budget enforcement
    if (this.usage.totalTokens >= this.maxTotalTokens) {
      throw new Error(`Token budget exceeded: ${this.usage.totalTokens} >= ${this.maxTotalTokens}`);
    }

    const supportsReasoning = REASONING_MODELS.test(this.model);

    // Build AbortSignal: user-provided or timeout-based
    const signal = opts?.signal ?? AbortSignal.timeout(this.timeoutMs);

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/getlien/lien',
        'X-Title': 'Lien Review',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              "You are an expert code reviewer. Write detailed, actionable comments with specific refactoring suggestions. Respond ONLY with valid JSON. Before suggesting refactorings, analyze the code snippets provided to identify the codebase's architectural patterns (e.g., functions vs classes, module organization, naming conventions). Then suggest refactorings that match those existing patterns.",
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: opts?.maxTokens ?? 32768,
        temperature: opts?.temperature ?? 0.3,
        ...(supportsReasoning ? { reasoning: { effort: 'high' } } : {}),
        usage: { include: true },
      }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenRouter');
    }

    // Track usage
    if (data.usage) {
      this.usage.promptTokens += data.usage.prompt_tokens;
      this.usage.completionTokens += data.usage.completion_tokens;
      this.usage.totalTokens += data.usage.total_tokens;
      this.usage.cost += data.usage.cost || 0;

      const costStr = data.usage.cost ? ` ($${data.usage.cost.toFixed(6)})` : '';
      this.logger?.info(
        `LLM tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out${costStr}`,
      );
    }

    return {
      content: data.choices[0].message.content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
            cost: data.usage.cost || 0,
          }
        : undefined,
    };
  }

  getUsage() {
    return { ...this.usage };
  }
}

// ---------------------------------------------------------------------------
// JSON parsing helpers (migrated from openrouter.ts)
// ---------------------------------------------------------------------------

/**
 * Parse JSON comments response from LLM, handling markdown code blocks.
 * Returns null if parsing fails.
 */
export function parseJSONResponse(content: string, logger: Logger): Record<string, string> | null {
  // Greedy match: LLM responses may contain inner ``` blocks (code suggestions)
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();

  try {
    const parsed = JSON.parse(jsonStr);
    logger.info(`Successfully parsed ${Object.keys(parsed).length} entries`);
    return parsed;
  } catch {
    // Aggressive retry: extract any JSON object from response
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        logger.info(
          `Recovered JSON with aggressive parsing: ${Object.keys(parsed).length} entries`,
        );
        return parsed;
      } catch {
        // Total failure
      }
    }
  }

  logger.warning('Failed to parse LLM JSON response');
  return null;
}

/**
 * Estimate prompt token count using ~4 chars/token heuristic.
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
