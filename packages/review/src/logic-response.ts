/**
 * Response parsing for logic review LLM output
 */

import { z } from 'zod';
import type { Logger } from './logger.js';
import { extractJSONFromCodeBlock } from './json-utils.js';

/**
 * Schema for a single logic review response entry
 */
const LogicReviewEntrySchema = z.object({
  valid: z.boolean(),
  comment: z.string(),
  category: z.enum(['breaking_change', 'unchecked_return', 'missing_tests']),
});

/**
 * Schema for the full logic review response
 */
const LogicReviewResponseSchema = z.record(z.string(), LogicReviewEntrySchema);

/**
 * Parsed logic review entry
 */
export interface LogicReviewEntry {
  valid: boolean;
  comment: string;
  category: string;
}

/**
 * Try strict Zod-validated parsing of a JSON string.
 */
function tryStrictParse(jsonStr: string): Record<string, LogicReviewEntry> | null {
  try {
    return LogicReviewResponseSchema.parse(JSON.parse(jsonStr));
  } catch {
    return null;
  }
}

/**
 * Try partial recovery: parse JSON without Zod, accepting entries with valid+comment fields.
 */
function tryPartialRecovery(jsonStr: string): Record<string, LogicReviewEntry> | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const partial: Record<string, LogicReviewEntry> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'object' && value !== null && 'valid' in value && 'comment' in value) {
        const v = value as { valid: unknown; comment: unknown; category?: unknown };
        partial[key] = {
          valid: Boolean(v.valid),
          comment: String(v.comment),
          category: String(v.category || 'unknown'),
        };
      }
    }
    return Object.keys(partial).length > 0 ? partial : null;
  } catch {
    return null;
  }
}

/**
 * Parse and validate logic review LLM response.
 * Returns null if parsing fails completely.
 */
export function parseLogicReviewResponse(
  content: string,
  logger: Logger,
): Record<string, LogicReviewEntry> | null {
  const jsonStr = extractJSONFromCodeBlock(content);
  logger.info(`Parsing logic review response (${jsonStr.length} chars)`);

  // Try strict parsing first
  const strict = tryStrictParse(jsonStr);
  if (strict) {
    logger.info(`Validated ${Object.keys(strict).length} logic review entries`);
    return strict;
  }

  // Aggressive retry: extract any JSON object from the raw content
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (!objectMatch) {
    logger.warning(`Could not parse logic review response:\n${content}`);
    return null;
  }

  const recovered = tryStrictParse(objectMatch[0]);
  if (recovered) {
    logger.info(`Recovered ${Object.keys(recovered).length} logic review entries with retry`);
    return recovered;
  }

  // Last resort: partial recovery without Zod
  const partial = tryPartialRecovery(objectMatch[0]);
  if (partial) {
    logger.info(
      `Partially recovered ${Object.keys(partial).length} entries without strict validation`,
    );
    return partial;
  }

  logger.warning(`Could not parse logic review response:\n${content}`);
  return null;
}
