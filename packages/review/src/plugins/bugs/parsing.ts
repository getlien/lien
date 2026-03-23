/**
 * LLM response parsing for bug reports.
 */

import { extractJSONFromCodeBlock } from '../../json-utils.js';
import type { Logger } from '../../logger.js';
import type { BugReport } from './types.js';

export function isValidBug(bug: unknown): bug is BugReport {
  if (!bug || typeof bug !== 'object') return false;
  const b = bug as Record<string, unknown>;
  return (
    typeof b.callerFilepath === 'string' &&
    typeof b.callerLine === 'number' &&
    typeof b.callerSymbol === 'string' &&
    typeof b.severity === 'string' &&
    typeof b.category === 'string' &&
    typeof b.description === 'string'
  );
}

export function parseBugResponse(content: string, logger: Logger): BugReport[] {
  const jsonStr = extractJSONFromCodeBlock(content);

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.bugs)) {
      const bugs = parsed.bugs.filter(isValidBug);
      logger.info(`Parsed ${bugs.length} bug report(s)`);
      return bugs.map(normalizeBug);
    }
  } catch {
    // Fall through to retry
  }

  // Aggressive retry
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && Array.isArray(parsed.bugs)) {
        const bugs = parsed.bugs.filter(isValidBug);
        logger.info(`Recovered ${bugs.length} bug report(s) with retry`);
        return bugs.map(normalizeBug);
      }
    } catch {
      // Total failure
    }
  }

  logger.warning('Failed to parse bug finder response');
  return [];
}

export function normalizeBug(bug: BugReport): BugReport {
  return {
    ...bug,
    changedFunction: bug.changedFunction ?? '',
    severity: bug.severity === 'error' ? 'error' : 'warning',
    callerSymbol: bug.callerSymbol ?? 'unknown',
    suggestion: bug.suggestion ?? '',
  };
}
