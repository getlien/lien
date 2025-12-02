/**
 * OpenRouter API client for LLM access
 */

import * as core from '@actions/core';
import type { OpenRouterResponse, ComplexityViolation } from './types.js';
import { buildLineCommentPrompt } from './prompt.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

  if (data.usage) {
    core.info(
      `Tokens used: ${data.usage.prompt_tokens} prompt, ${data.usage.completion_tokens} completion`
    );
  }

  return review;
}

/**
 * Generate a brief comment for a single violation
 */
export async function generateLineComment(
  violation: ComplexityViolation,
  codeSnippet: string | null,
  apiKey: string,
  model: string
): Promise<string> {
  const prompt = buildLineCommentPrompt(violation, codeSnippet);

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
            'You are a code reviewer. Write brief, actionable comments about code complexity. Be direct and specific.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 300, // Short comments
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from OpenRouter');
  }

  return data.choices[0].message.content;
}

/**
 * Generate line comments for multiple violations in parallel
 */
export async function generateLineComments(
  violations: ComplexityViolation[],
  codeSnippets: Map<string, string>,
  apiKey: string,
  model: string
): Promise<Map<ComplexityViolation, string>> {
  const results = new Map<ComplexityViolation, string>();

  // Process in parallel with concurrency limit
  const CONCURRENCY = 3;
  
  for (let i = 0; i < violations.length; i += CONCURRENCY) {
    const batch = violations.slice(i, i + CONCURRENCY);
    
    const promises = batch.map(async (violation) => {
      const key = `${violation.filepath}::${violation.symbolName}`;
      const snippet = codeSnippets.get(key) || null;
      
      try {
        const comment = await generateLineComment(violation, snippet, apiKey, model);
        return { violation, comment };
      } catch (error) {
        core.warning(`Failed to generate comment for ${violation.symbolName}: ${error}`);
        // Fallback comment
        return {
          violation,
          comment: `⚠️ **Complexity: ${violation.complexity}** (threshold: ${violation.threshold})\n\nThis ${violation.symbolType} exceeds the complexity threshold. Consider refactoring to improve readability and testability.`,
        };
      }
    });

    const batchResults = await Promise.all(promises);
    for (const { violation, comment } of batchResults) {
      results.set(violation, comment);
    }
  }

  return results;
}

