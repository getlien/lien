/**
 * OpenRouter API client for LLM access
 */

import * as core from '@actions/core';
import type { OpenRouterResponse } from './types.js';

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

