/**
 * Response parsing for logic review LLM output
 */

import { z } from 'zod';
import type { Logger } from './logger.js';

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
 * Parse and validate logic review LLM response.
 * Returns null if parsing fails completely.
 */
export function parseLogicReviewResponse(
  content: string,
  logger: Logger,
): Record<string, LogicReviewEntry> | null {
  // Try extracting JSON from markdown code block first
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = (codeBlockMatch ? codeBlockMatch[1] : content).trim();

  logger.info(`Parsing logic review response (${jsonStr.length} chars)`);

  // Try parsing with Zod
  try {
    const parsed = JSON.parse(jsonStr);
    const result = LogicReviewResponseSchema.parse(parsed);
    logger.info(`Validated ${Object.keys(result).length} logic review entries`);
    return result;
  } catch (error) {
    logger.warning(`Zod validation failed: ${error}`);
  }

  // Aggressive retry: extract any JSON object
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      const result = LogicReviewResponseSchema.parse(parsed);
      logger.info(`Recovered ${Object.keys(result).length} logic review entries with retry`);
      return result;
    } catch (retryError) {
      logger.warning(`Retry parsing also failed: ${retryError}`);
    }

    // Last resort: parse JSON without Zod validation for partial results
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        const partial: Record<string, LogicReviewEntry> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (
            typeof value === 'object' &&
            value !== null &&
            'valid' in value &&
            'comment' in value
          ) {
            const v = value as { valid: unknown; comment: unknown; category?: unknown };
            partial[key] = {
              valid: Boolean(v.valid),
              comment: String(v.comment),
              category: String(v.category || 'unknown'),
            };
          }
        }
        if (Object.keys(partial).length > 0) {
          logger.info(
            `Partially recovered ${Object.keys(partial).length} entries without strict validation`,
          );
          return partial;
        }
      }
    } catch {
      // Fall through to null
    }
  }

  logger.warning(`Could not parse logic review response:\n${content}`);
  return null;
}
